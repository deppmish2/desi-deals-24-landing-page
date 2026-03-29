"use strict";

const express = require("express");

const db = require("../db");
const { trackEvent } = require("../services/event-tracker");
const { getCurrentPoolDate } = require("../services/daily-deals-pool");

const router = express.Router();
const EXCLUDED_STORE_IDS = ["dookan"];
const EXCLUDED_STORE_IDS_SQL = EXCLUDED_STORE_IDS
  .map((storeId) => `'${String(storeId).replace(/'/g, "''")}'`)
  .join(", ");
const DISPLAYABLE_DISCOUNT_SQL = `
  (
    coalesce(d.discount_percent, 0) > 0
    OR (
      d.original_price IS NOT NULL
      AND d.sale_price IS NOT NULL
      AND d.original_price > d.sale_price
      AND d.original_price > 0
    )
  )
`;

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

// Levenshtein distance — used for fuzzy token matching.
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Returns true if any word in `text` fuzzy-matches `token`.
// Exact substring match first; falls back to edit-distance tolerance
// scaled by token length (1 error per 4 chars, min threshold 1).
function fuzzyTokenMatch(text, token) {
  if (!text || !token) return false;
  if (text.includes(token)) return true;
  const words = text.split(/\s+/);
  const tolerance = Math.max(1, Math.floor(token.length / 4));
  return words.some((w) => levenshtein(w, token) <= tolerance);
}

// Split query into tokens and require all to match somewhere in the target.
function fuzzySearch(haystack, query) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = haystack.toLowerCase();
  return tokens.every((tok) => fuzzyTokenMatch(text, tok));
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

function getDealStoreId(deal) {
  return String(deal?.store?.id || "").trim();
}

function scoreStoreCandidate(
  storeId,
  totalDeals,
  position,
  totalPerStore,
  placedPerStore,
  queues,
  storePriority,
) {
  const expectedPlaced = ((totalPerStore.get(storeId) || 0) / totalDeals) * position;
  const deficit = expectedPlaced - (placedPerStore.get(storeId) || 0);
  return {
    storeId,
    deficit,
    remaining: queues.get(storeId)?.length || 0,
    priority: storePriority.get(storeId) || 0,
  };
}

function buildDiversifiedPages(deals, pageSize, seed) {
  const safeDeals = Array.isArray(deals) ? deals.filter(Boolean) : [];
  if (safeDeals.length === 0) {
    return {
      pages: [],
      enforcePageCap: false,
      relaxedAdjacencyUsed: false,
      relaxedCapUsed: false,
      maxPerStore: Math.max(1, Math.floor(pageSize * 0.2)),
      uniqueStoreCount: 0,
    };
  }

  const queues = new Map();
  const totalPerStore = new Map();
  for (const deal of safeDeals) {
    const storeId = getDealStoreId(deal) || "__unknown__";
    if (!queues.has(storeId)) queues.set(storeId, []);
    queues.get(storeId).push(deal);
    totalPerStore.set(storeId, (totalPerStore.get(storeId) || 0) + 1);
  }

  const storeIds = Array.from(queues.keys());
  const maxPerStore = Math.max(1, Math.floor(pageSize * 0.2));
  const minStoresNeeded = Math.max(1, Math.ceil(pageSize / maxPerStore));
  const enforcePageCap = storeIds.length >= minStoresNeeded;
  const storePriority = new Map(
    seededShuffle(storeIds, seed).map((storeId, index) => [storeId, index]),
  );
  const perStoreLimit = enforcePageCap ? maxPerStore : Number.POSITIVE_INFINITY;
  const placedPerStore = new Map();
  const ordered = [];
  let currentPageCounts = new Map();
  let relaxedAdjacencyUsed = false;
  let relaxedCapUsed = false;

  while (ordered.length < safeDeals.length) {
    if (ordered.length > 0 && ordered.length % pageSize === 0) {
      currentPageCounts = new Map();
    }

    const previousStoreId =
      ordered.length > 0 ? getDealStoreId(ordered[ordered.length - 1]) || "__unknown__" : null;
    const position = ordered.length + 1;

    let candidates = storeIds.filter((storeId) => {
      const remaining = queues.get(storeId)?.length || 0;
      const pageCount = currentPageCounts.get(storeId) || 0;
      return remaining > 0 && storeId !== previousStoreId && pageCount < perStoreLimit;
    });

    if (candidates.length === 0) {
      candidates = storeIds.filter((storeId) => {
        const remaining = queues.get(storeId)?.length || 0;
        const pageCount = currentPageCounts.get(storeId) || 0;
        return remaining > 0 && pageCount < perStoreLimit;
      });
      if (candidates.length > 0) relaxedAdjacencyUsed = true;
    }

    if (candidates.length === 0) {
      candidates = storeIds.filter((storeId) => {
        const remaining = queues.get(storeId)?.length || 0;
        return remaining > 0 && storeId !== previousStoreId;
      });
      if (candidates.length > 0) relaxedCapUsed = true;
    }

    if (candidates.length === 0) {
      candidates = storeIds.filter((storeId) => (queues.get(storeId)?.length || 0) > 0);
      if (candidates.length > 0) {
        relaxedAdjacencyUsed = true;
        relaxedCapUsed = true;
      }
    }

    if (candidates.length === 0) break;

    const scoredCandidates = candidates
      .map((storeId) =>
        scoreStoreCandidate(
          storeId,
          safeDeals.length,
          position,
          totalPerStore,
          placedPerStore,
          queues,
          storePriority,
        ),
      )
      .sort((a, b) => {
        if (b.deficit !== a.deficit) return b.deficit - a.deficit;
        if (b.remaining !== a.remaining) return b.remaining - a.remaining;
        return a.priority - b.priority;
      });

    const selectedStoreId = scoredCandidates[0]?.storeId;

    const selectedDeal = selectedStoreId ? queues.get(selectedStoreId)?.shift() : null;
    if (!selectedDeal) break;

    ordered.push(selectedDeal);
    placedPerStore.set(selectedStoreId, (placedPerStore.get(selectedStoreId) || 0) + 1);
    currentPageCounts.set(
      selectedStoreId,
      (currentPageCounts.get(selectedStoreId) || 0) + 1,
    );
  }

  const orderedPages = [];
  for (let index = 0; index < ordered.length; index += pageSize) {
    orderedPages.push(ordered.slice(index, index + pageSize));
  }

  return {
    pages: orderedPages,
    enforcePageCap,
    relaxedAdjacencyUsed,
    relaxedCapUsed,
    maxPerStore,
    uniqueStoreCount: storeIds.length,
  };
}

function paginateSequential(deals, pageSize, pageNum) {
  const safeDeals = Array.isArray(deals) ? deals.filter(Boolean) : [];
  const totalPages = Math.max(1, Math.ceil(safeDeals.length / pageSize));
  const startIndex = Math.max(0, (pageNum - 1) * pageSize);
  return {
    totalPages,
    data: safeDeals.slice(startIndex, startIndex + pageSize),
  };
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

const BASE_DEALS_SQL = `
  SELECT
    d.id, d.canonical_id, d.crawl_timestamp, d.store_id,
    s.name AS store_name, s.url  AS store_url,
    d.product_name, d.product_category, d.product_url,
    d.image_url, d.weight_raw, d.weight_value, d.weight_unit,
    d.sale_price, d.original_price, d.discount_percent,
    d.price_per_kg, d.currency, d.availability, d.bulk_pricing, d.best_before
  FROM deals d
  JOIN stores s ON s.id = d.store_id
`;

const ACTIVE_DEALS_SQL = `
  ${BASE_DEALS_SQL}
  WHERE d.is_active = 1
    AND lower(d.store_id) NOT IN (${EXCLUDED_STORE_IDS_SQL})
    AND ${DISPLAYABLE_DISCOUNT_SQL}
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
    const focusDealId = String(req.query.deal_id || "").trim();
    const today = getCurrentPoolDate();

    if (focusDealId) {
      const row = await db
        .prepare(
          `${BASE_DEALS_SQL}
           WHERE d.id = ?
             AND lower(d.store_id) NOT IN (${EXCLUDED_STORE_IDS_SQL})
             AND ${DISPLAYABLE_DISCOUNT_SQL}
           LIMIT 1`,
        )
        .get(focusDealId);
      const data = row ? [serializeDeal(row)] : [];

      res.set(
        "Cache-Control",
        "public, s-maxage=300, stale-while-revalidate=3600",
      );

      res.json({
        data,
        pagination: {
          page: 1,
          limit: 1,
          total: data.length,
          total_pages: 1,
        },
        meta: {
          sort: "focused_deal",
          date: today,
          focused_deal_id: focusDealId,
        },
      });
      return;
    }

    // Load + shuffle active deals — cached per date so the order is stable within a day.
    let allDeals = getMemCache(today);
    if (!allDeals) {
      const rows = await db.prepare(ACTIVE_DEALS_SQL).all();
      allDeals = seededShuffle(rows.map(serializeDeal), dateSeed(today));
      if (allDeals.length > 0) setMemCache(today, allDeals);
    }

    const filterCategory = String(req.query.category || "").trim();
    const minDiscount = parseFloat(req.query.min_discount || "0") || 0;
    const priceMin = parseFloat(req.query.price_min || "0") || 0;
    const priceMax = parseFloat(req.query.price_max || "0") || 0;
    const inStock = req.query.in_stock === "1";
    const hideExpired = req.query.hide_expired === "1";

    // Apply filters (all gated in frontend, server supports freely)
    let filtered = allDeals;
    if (searchQuery) {
      filtered = filtered.filter((d) =>
        fuzzySearch(`${d.product_name || ""} ${d.store?.name || ""} ${d.product_category || ""}`, searchQuery),
      );
    }
    if (filterStore) {
      filtered = filtered.filter((d) => d.store?.name === filterStore);
    }
    if (filterCategory) {
      filtered = filtered.filter((d) => d.product_category === filterCategory);
    }
    if (minDiscount > 0) {
      filtered = filtered.filter((d) => (d.discount_percent || 0) >= minDiscount);
    }
    if (priceMin > 0) {
      filtered = filtered.filter((d) => (d.sale_price || 0) >= priceMin);
    }
    if (priceMax > 0) {
      filtered = filtered.filter((d) => (d.sale_price || 0) <= priceMax);
    }
    if (inStock) {
      filtered = filtered.filter((d) => d.availability === "in_stock");
    }
    if (hideExpired) {
      const thisMonth = new Date().toISOString().slice(0, 7);
      filtered = filtered.filter((d) => !d.best_before || d.best_before >= thisMonth);
    }

    // Sort override — gated in the frontend, server supports freely.
    const sort = String(req.query.sort || "").trim();
    const usesExplicitOrdering =
      sort === "discount" || sort === "price_per_kg" || sort === "price";

    if (sort === "discount") {
      filtered = [...filtered].sort(
        (a, b) =>
          (b.discount_percent || 0) - (a.discount_percent || 0) ||
          (a.sale_price || 0) - (b.sale_price || 0) ||
          String(a.product_name || "").localeCompare(String(b.product_name || "")),
      );
    } else if (sort === "price_per_kg") {
      filtered = [...filtered].sort(
        (a, b) =>
          (a.price_per_kg || Infinity) - (b.price_per_kg || Infinity) ||
          (b.discount_percent || 0) - (a.discount_percent || 0) ||
          String(a.product_name || "").localeCompare(String(b.product_name || "")),
      );
    } else if (sort === "price") {
      filtered = [...filtered].sort(
        (a, b) =>
          (a.sale_price || 0) - (b.sale_price || 0) ||
          (b.discount_percent || 0) - (a.discount_percent || 0) ||
          String(a.product_name || "").localeCompare(String(b.product_name || "")),
      );
    }

    const total = filtered.length;
    const uniqueStoreCount = new Set(filtered.map((deal) => getDealStoreId(deal) || "__unknown__")).size;
    const pageLayout = usesExplicitOrdering
      ? null
      : buildDiversifiedPages(
        filtered,
        limitNum,
        dateSeed(`${today}:${sort || "random"}:${limitNum}`),
      );
    const orderedPage = usesExplicitOrdering
      ? paginateSequential(filtered, limitNum, pageNum)
      : null;
    const totalPages = usesExplicitOrdering
      ? orderedPage.totalPages
      : Math.max(1, pageLayout.pages.length);
    const data = usesExplicitOrdering
      ? orderedPage.data
      : pageLayout.pages[pageNum - 1] || [];

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
        total_pages: totalPages,
      },
      meta: {
        sort: sort || "random",
        date: today,
        store_diversity: {
          no_adjacent_same_store: usesExplicitOrdering
            ? false
            : !pageLayout.relaxedAdjacencyUsed,
          max_per_store: usesExplicitOrdering
            ? null
            : pageLayout.enforcePageCap && !pageLayout.relaxedCapUsed
              ? pageLayout.maxPerStore
              : null,
          cap_enforced: usesExplicitOrdering
            ? false
            : pageLayout.enforcePageCap && !pageLayout.relaxedCapUsed,
          unique_store_count: usesExplicitOrdering
            ? uniqueStoreCount
            : pageLayout.uniqueStoreCount,
          disabled_for_explicit_sort: usesExplicitOrdering,
        },
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
