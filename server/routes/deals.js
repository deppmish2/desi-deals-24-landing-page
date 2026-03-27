"use strict";

const express = require("express");

const db = require("../db");
const { trackEvent } = require("../services/event-tracker");
const { getCurrentPoolDate } = require("../services/daily-deals-pool");

const router = express.Router();

// In-memory cache keyed by date string — refreshes after 5 min or on next day.
const MEM_CACHE_TTL_MS = 5 * 60 * 1000;
const _memCache = new Map(); // date → { deals, expiresAt }

function getMemCache(key) {
  const entry = _memCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    _memCache.delete(key);
    return null;
  }
  return entry.deals;
}

function setMemCache(key, deals) {
  _memCache.set(key, { deals, expiresAt: Date.now() + MEM_CACHE_TTL_MS });
}

// Seeded xorshift32 pseudo-random — deterministic per seed.
function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// FNV-1a hash of a date string like "2026-03-27" → uint32 seed.
function dateSeed(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i++) {
    h = Math.imul(h ^ dateStr.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Fisher-Yates shuffle with a seeded RNG.
function seededShuffle(arr, seed) {
  const copy = [...arr];
  const rand = seededRandom(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function serializeDeal(row) {
  return {
    id: row.id,
    canonical_id: row.canonical_id || null,
    crawl_timestamp: row.crawl_timestamp,
    store: {
      id: row.store_id,
      name: row.store_name,
      url: row.store_url,
    },
    product_name: row.product_name,
    product_category: row.product_category,
    product_url: row.product_url,
    image_url: row.image_url,
    weight_raw: row.weight_raw,
    weight_value: row.weight_value,
    weight_unit: row.weight_unit,
    sale_price: row.sale_price,
    original_price: row.original_price,
    discount_percent: row.discount_percent,
    price_per_kg: row.price_per_kg,
    currency: row.currency,
    availability: row.availability,
    bulk_pricing: row.bulk_pricing ? JSON.parse(row.bulk_pricing) : null,
    best_before: row.best_before || null,
  };
}

const DEALS_SQL = `
  SELECT
    d.id, d.canonical_id, d.crawl_timestamp, d.store_id,
    s.name AS store_name, s.url  AS store_url,
    d.product_name, d.product_category, d.product_url,
    d.image_url, d.weight_raw, d.weight_value, d.weight_unit,
    d.sale_price, d.original_price, d.discount_percent,
    d.price_per_kg, d.currency, d.availability, d.bulk_pricing, d.best_before
  FROM deals d
  JOIN stores s ON s.id = d.store_id
  WHERE d.is_active = 1
`;

router.get("/", async (req, res, next) => {
  const startedAt = Date.now();

  try {
    const pageNum = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limitNum = Math.max(
      1,
      Math.min(100, parseInt(req.query.limit || "24", 10) || 24),
    );
    const searchQuery = String(req.query.q || "")
      .trim()
      .toLowerCase();
    const filterStore = String(req.query.store || "").trim();
    const today = getCurrentPoolDate();

    // Load + shuffle active deals — cached per date so the order is stable within a day.
    let allDeals = getMemCache(today);
    if (!allDeals) {
      const rows = await db.prepare(DEALS_SQL).all();
      allDeals = seededShuffle(rows.map(serializeDeal), dateSeed(today));
      if (allDeals.length > 0) setMemCache(today, allDeals);
    }

    const filterCategory = String(req.query.category || "").trim();

    // Apply filters (all gated in frontend, server supports freely)
    let filtered = allDeals;
    if (searchQuery) {
      filtered = filtered.filter(
        (d) =>
          d.product_name?.toLowerCase().includes(searchQuery) ||
          d.store?.name?.toLowerCase().includes(searchQuery) ||
          d.product_category?.toLowerCase().includes(searchQuery),
      );
    }
    if (filterStore) {
      filtered = filtered.filter((d) => d.store?.name === filterStore);
    }
    if (filterCategory) {
      filtered = filtered.filter((d) => d.product_category === filterCategory);
    }

    // Sort override — gated in the frontend, server supports freely.
    const sort = String(req.query.sort || "").trim();
    if (sort === "discount") {
      filtered = [...filtered].sort(
        (a, b) => (b.discount_percent || 0) - (a.discount_percent || 0),
      );
    } else if (sort === "price_per_kg") {
      filtered = [...filtered].sort(
        (a, b) => (a.price_per_kg || Infinity) - (b.price_per_kg || Infinity),
      );
    } else if (sort === "price") {
      filtered = [...filtered].sort(
        (a, b) => (a.sale_price || 0) - (b.sale_price || 0),
      );
    }

    const total = filtered.length;
    const offset = (pageNum - 1) * limitNum;
    const data = filtered.slice(offset, offset + limitNum);

    // CDN caches for 5 min; serves stale up to 1h while revalidating.
    res.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=3600",
    );

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.max(1, Math.ceil(total / limitNum)),
      },
      meta: {
        sort: sort || "random",
        date: today,
      },
    });

    trackEvent(db, "browse.deals", {
      route: req.originalUrl,
      payload: {
        duration_ms: Date.now() - startedAt,
        result_count: data.length,
        page: pageNum,
        limit: limitNum,
        sort: sort || "random",
        search: searchQuery || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
