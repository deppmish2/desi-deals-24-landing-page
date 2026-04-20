"use strict";

const express = require("express");

const db = require("../db");
const {
  buildDiversifiedPages,
  dateSeed,
  getDealStoreId,
  seededShuffle,
} = require("../services/deal-order");
const { filterAndRankDealsByQuery } = require("../services/deal-search");
const { phoneticFallback } = require("../services/phonetic-search");
const { trackEvent } = require("../services/event-tracker");
const { formatBerlinDateKey } = require("../services/berlin-time");
const { trackSearchQuery } = require("../services/search-tracker");
const { verifyJwt } = require("../utils/jwt");
const { batchGetRealSavings, computeRealSavings, explainRealSavings } = require("../services/real-savings");
const { getReplacements } = require("../services/product-replacements");

const router = express.Router();
const FAKE_DEAL_THRESHOLD_PP = 10;
const EXCLUDED_STORE_IDS = ["dookan"];
const EXCLUDED_STORE_IDS_SQL = EXCLUDED_STORE_IDS.map(
  (storeId) => `'${String(storeId).replace(/'/g, "''")}'`,
).join(", ");
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

// In-memory cache keyed by latest completed crawl — refreshes after 5 min.
const MEM_CACHE_TTL_MS = 5 * 60 * 1000;
const _memCache = new Map(); // cacheKey → { deals, expiresAt }
const SNAPSHOT_CONTEXT_TTL_MS = 60 * 1000;
let _snapshotContextCache = null;

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

async function getCurrentDealsSnapshotContext() {
  if (_snapshotContextCache && Date.now() < _snapshotContextCache.expiresAt) {
    return _snapshotContextCache.value;
  }

  const latestCrawl = await db
    .prepare(
      `SELECT id, crawl_date, finished_at
       FROM crawl_runs
       WHERE status = 'completed'
       ORDER BY finished_at DESC
       LIMIT 1`,
    )
    .get();

  const crawlDate =
    latestCrawl?.crawl_date ||
    (latestCrawl?.finished_at
      ? formatBerlinDateKey(new Date(latestCrawl.finished_at))
      : formatBerlinDateKey(new Date()));

  const snapshotContext = {
    cacheKey: latestCrawl?.id ? `crawl:${latestCrawl.id}` : `date:${crawlDate}`,
    crawlDate,
  };
  _snapshotContextCache = {
    value: snapshotContext,
    expiresAt: Date.now() + SNAPSHOT_CONTEXT_TTL_MS,
  };
  return snapshotContext;
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

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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
const FAST_CURRENT_DEALS_WHERE_SQL = `
  d.is_active = 1
  AND d.display_date = ?
  AND d.display_order IS NOT NULL
  AND lower(coalesce(d.availability, '')) = 'in_stock'
  AND lower(d.store_id) NOT IN (${EXCLUDED_STORE_IDS_SQL})
  AND ${DISPLAYABLE_DISCOUNT_SQL}
`;

router.get("/stores", async (req, res, next) => {
  try {
    const onlyInStock = req.query.in_stock !== "0";
    const rows = await db
      .prepare(
        `SELECT
           d.store_id,
           s.name AS store_name,
           COUNT(*) AS deal_count
         FROM deals d
         JOIN stores s ON s.id = d.store_id
         WHERE d.is_active = 1
           AND lower(d.store_id) NOT IN (${EXCLUDED_STORE_IDS_SQL})
           AND ${DISPLAYABLE_DISCOUNT_SQL}
           ${onlyInStock ? "AND lower(coalesce(d.availability, '')) = 'in_stock'" : ""}
         GROUP BY d.store_id, s.name
         ORDER BY s.name ASC`,
      )
      .all();

    res.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=3600",
    );

    res.json({
      data: rows.map((row) => ({
        id: row.store_id,
        name: row.store_name,
        deal_count: Number(row.deal_count || 0),
      })),
    });
  } catch (error) {
    next(error);
  }
});

function resolveAccessSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

async function getOptionalRequestIdentity(req) {
  const sessionId =
    String(req.headers["x-dd24-session-id"] || "")
      .trim()
      .slice(0, 128) || null;
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    return { userId: null, userEmail: null, sessionId };
  }

  const result = verifyJwt(token, resolveAccessSecret());
  if (!result.ok || result.payload?.type !== "access") {
    return { userId: null, userEmail: null, sessionId };
  }

  const userId = result.payload?.sub || null;
  const userEmailFromToken =
    result.payload?.email == null
      ? null
      : String(result.payload.email).trim().toLowerCase() || null;

  if (userEmailFromToken || !userId) {
    return { userId, userEmail: userEmailFromToken, sessionId };
  }

  const userRow = await db
    .prepare("SELECT email FROM users WHERE id = ? LIMIT 1")
    .get(userId);
  return {
    userId,
    userEmail:
      userRow?.email == null
        ? null
        : String(userRow.email).trim().toLowerCase() || null,
    sessionId,
  };
}

router.get("/", async (req, res, next) => {
  const startedAt = Date.now();

  try {
    const pageNum = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limitNum = Math.max(
      1,
      Math.min(100, parseInt(req.query.limit || "24", 10) || 24),
    );
    const rawSearchQuery = String(req.query.q || "")
      .trim()
      .replace(/\s+/g, " ");
    const searchQuery = rawSearchQuery.trim().toLowerCase();
    const shouldTrackSearch =
      Boolean(rawSearchQuery) &&
      pageNum === 1 &&
      String(req.query.track_search || "").trim() === "1";
    const filterStores = parseCsvList(req.query.stores || req.query.store);
    const focusDealId = String(req.query.deal_id || "").trim();
    const { cacheKey, crawlDate } = await getCurrentDealsSnapshotContext();

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
      const rawData = row ? [serializeDeal(row)] : [];
      const realSavingsMap = await batchGetRealSavings(db, rawData);
      const data = rawData.map((deal) => {
        const histData = realSavingsMap.get(deal.id);
        const rs = computeRealSavings(deal, histData);
        const isFakeDeal = rs && deal.discount_percent != null && (deal.discount_percent - rs.real_discount_pct) >= FAKE_DEAL_THRESHOLD_PP;
        const out = { ...deal, real_savings: rs, is_fake_deal: !!isFakeDeal };
        if (!rs) out.real_savings_debug = explainRealSavings(deal, histData);
        return out;
      });

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
          date: crawlDate,
          focused_deal_id: focusDealId,
        },
      });
      if (shouldTrackSearch) {
        const identity = await getOptionalRequestIdentity(req);
        await trackSearchQuery(db, {
          query: rawSearchQuery,
          userId: identity.userId,
          userEmail: identity.userEmail,
          sessionId: identity.sessionId,
          route: req.originalUrl,
          resultCount: data.length,
        });
      }
      return;
    }

    const filterCategory = String(req.query.category || "").trim();
    const minDiscount = parseFloat(req.query.min_discount || "0") || 0;
    const priceMin = parseFloat(req.query.price_min || "0") || 0;
    const priceMax = parseFloat(req.query.price_max || "0") || 0;
    const inStock = req.query.in_stock === "1";
    const hideExpired = req.query.hide_expired === "1";
    const realSavingsGap = parseFloat(req.query.real_savings_gap || "0") || 0;
    const sort = String(req.query.sort || "").trim();
    const includeInactive =
      process.env.NODE_ENV !== "production" && req.query.include_inactive === "1";
    const usesExplicitOrdering =
      sort === "discount" || sort === "price_per_kg" || sort === "price" || sort === "real_savings";
    const canUseFastPath = Boolean(
      !focusDealId &&
      !searchQuery &&
      filterStores.length === 0 &&
      !filterCategory &&
      minDiscount <= 0 &&
      priceMin <= 0 &&
      priceMax <= 0 &&
      inStock &&
      !hideExpired &&
      !usesExplicitOrdering &&
      !includeInactive,
    );

    if (canUseFastPath) {
      const offset = Math.max(0, (pageNum - 1) * limitNum);
      const rows = await db
        .prepare(
          `SELECT
             d.id, d.canonical_id, d.crawl_timestamp, d.store_id,
             s.name AS store_name, s.url AS store_url,
             d.product_name, d.product_category, d.product_url,
             d.image_url, d.weight_raw, d.weight_value, d.weight_unit,
             d.sale_price, d.original_price, d.discount_percent,
             d.price_per_kg, d.currency, d.availability, d.bulk_pricing, d.best_before,
             COUNT(*) OVER() AS total_count
           FROM deals d
           JOIN stores s ON s.id = d.store_id
           WHERE ${FAST_CURRENT_DEALS_WHERE_SQL}
           ORDER BY d.display_order ASC
           LIMIT ?
           OFFSET ?`,
        )
        .all(crawlDate, limitNum, offset);

      const total = rows.length
        ? Number(rows[0]?.total_count || 0)
        : Number(
            (
              await db
                .prepare(
                  `SELECT COUNT(*) AS total
                 FROM deals d
                 WHERE ${FAST_CURRENT_DEALS_WHERE_SQL}`,
                )
                .get(crawlDate)
            )?.total || 0,
          );
      if (total > 0) {
        const totalPages = Math.max(1, Math.ceil(total / limitNum));
        const data = rows.map(serializeDeal);

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
            sort: "random",
            date: crawlDate,
            fast_path: true,
            store_diversity: {
              no_adjacent_same_store: true,
              max_per_store: Math.max(1, Math.floor(limitNum * 0.2)),
              cap_enforced: true,
              unique_store_count: new Set(
                data.map((deal) => getDealStoreId(deal) || "__unknown__"),
              ).size,
              disabled_for_explicit_sort: false,
            },
          },
        });
        return;
      }
    }

    // Load + shuffle active deals — cached per latest completed crawl.
    let allDeals = includeInactive ? null : getMemCache(cacheKey);
    if (!allDeals) {
      const sql = includeInactive
        ? `${BASE_DEALS_SQL} WHERE lower(d.store_id) NOT IN (${EXCLUDED_STORE_IDS_SQL}) AND ${DISPLAYABLE_DISCOUNT_SQL}`
        : ACTIVE_DEALS_SQL;
      const rows = await db.prepare(sql).all();
      allDeals = seededShuffle(rows.map(serializeDeal), dateSeed(cacheKey));
      if (!includeInactive && allDeals.length > 0) setMemCache(cacheKey, allDeals);
    }

    // Apply filters (all gated in frontend, server supports freely)
    let filtered = allDeals;
    let isPhoneticFallback = false;
    if (searchQuery) {
      filtered = filterAndRankDealsByQuery(
        filtered,
        searchQuery,
        (deal) =>
          `${deal?.product_name || ""} ${deal?.store?.name || ""}`,
      );
      if (filtered.length === 0) {
        filtered = await phoneticFallback(db, allDeals, searchQuery);
        isPhoneticFallback = filtered.length > 0;
      }
    }
    if (filterStores.length > 0) {
      const storeFilterSet = new Set(filterStores);
      filtered = filtered.filter((d) => storeFilterSet.has(d.store?.name));
    }
    if (filterCategory) {
      filtered = filtered.filter((d) => d.product_category === filterCategory);
    }
    if (minDiscount > 0) {
      filtered = filtered.filter(
        (d) => (d.discount_percent || 0) >= minDiscount,
      );
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
      filtered = filtered.filter(
        (d) => !d.best_before || d.best_before >= thisMonth,
      );
    }

    if (sort === "discount") {
      filtered = [...filtered].sort(
        (a, b) =>
          (b.discount_percent || 0) - (a.discount_percent || 0) ||
          (a.sale_price || 0) - (b.sale_price || 0) ||
          String(a.product_name || "").localeCompare(
            String(b.product_name || ""),
          ),
      );
    } else if (sort === "price_per_kg") {
      filtered = [...filtered].sort(
        (a, b) =>
          (a.price_per_kg || Infinity) - (b.price_per_kg || Infinity) ||
          (b.discount_percent || 0) - (a.discount_percent || 0) ||
          String(a.product_name || "").localeCompare(
            String(b.product_name || ""),
          ),
      );
    } else if (sort === "price") {
      filtered = [...filtered].sort(
        (a, b) =>
          (a.sale_price || 0) - (b.sale_price || 0) ||
          (b.discount_percent || 0) - (a.discount_percent || 0) ||
          String(a.product_name || "").localeCompare(
            String(b.product_name || ""),
          ),
      );
    } else if (sort === "real_savings") {
      // Fetch real_savings for all filtered deals, then sort by real_discount_pct desc
      const rsMap = await batchGetRealSavings(db, filtered);
      const rsScores = new Map(
        filtered.map((d) => {
          const rs = computeRealSavings(d, rsMap.get(d.id));
          return [d.id, rs?.real_discount_pct ?? -1];
        }),
      );
      filtered = [...filtered].sort(
        (a, b) => (rsScores.get(b.id) ?? -1) - (rsScores.get(a.id) ?? -1),
      );
    }

    // Filter by minimum real savings gap (real_discount_pct vs stated discount_percent)
    if (realSavingsGap > 0) {
      const rsMapForGap = await batchGetRealSavings(db, filtered);
      filtered = filtered.filter((d) => {
        const rs = computeRealSavings(d, rsMapForGap.get(d.id));
        if (!rs) return false;
        const stated = Number(d.discount_percent) || 0;
        return Math.abs(rs.real_discount_pct - stated) >= realSavingsGap;
      });
    }

    const total = filtered.length;
    const uniqueStoreCount = new Set(filtered.map((deal) => getDealStoreId(deal) || "__unknown__")).size;
    const DISPLAY_OPTS = {
      maxStoreRatio: 0.25,
      qualityFloorRatio: 0.40,
      qualityMinDiscount: 25,
      qualityPages: 2,
    };
    const pageLayout = usesExplicitOrdering
      ? null
      : buildDiversifiedPages(
        filtered,
        limitNum,
        dateSeed(`${cacheKey}:${sort || "random"}:${limitNum}`),
        DISPLAY_OPTS,
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

    // Attach Real Savings ratings (graceful no-op if history table not yet populated)
    const realSavingsMap = await batchGetRealSavings(db, data);
    const dataWithSavings = data.map((deal) => {
      const histData = realSavingsMap.get(deal.id);
      const rs = computeRealSavings(deal, histData);
      const isFakeDeal = rs && deal.discount_percent != null && (deal.discount_percent - rs.real_discount_pct) >= FAKE_DEAL_THRESHOLD_PP;
      const out = { ...deal, real_savings: rs, is_fake_deal: !!isFakeDeal };
      if (!rs) out.real_savings_debug = explainRealSavings(deal, histData);
      return out;
    });

    // CDN caches for 5 min; serves stale up to 1h while revalidating.
    res.set(
      "Cache-Control",
      "public, s-maxage=300, stale-while-revalidate=3600",
    );

    res.json({
      data: dataWithSavings,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: totalPages,
      },
      meta: {
        sort: sort || "random",
        date: crawlDate,
        phonetic_fallback: isPhoneticFallback,
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

    if (shouldTrackSearch) {
      const identity = await getOptionalRequestIdentity(req);
      await trackSearchQuery(db, {
        query: rawSearchQuery,
        userId: identity.userId,
        userEmail: identity.userEmail,
        sessionId: identity.sessionId,
        route: req.originalUrl,
        resultCount: total,
      });
    }

    trackEvent(db, "browse.deals", {
      route: req.originalUrl,
      payload: {
        duration_ms: Date.now() - startedAt,
        result_count: data.length,
        page: pageNum,
        limit: limitNum,
        sort: sort || "random",
        search: searchQuery || null,
        store_filters: filterStores,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/replacements", async (req, res, next) => {
  try {
    const canonicalId = String(req.query.canonical_id || "").trim();
    const storeId = String(req.query.store_id || "").trim();
    const dealId = String(req.query.deal_id || "").trim() || null;
    if (!canonicalId || !storeId) {
      return res
        .status(400)
        .json({ error: "canonical_id and store_id are required" });
    }

    const result = await getReplacements(db, { canonicalId, storeId, dealId });
    if (!result) return res.status(404).json({ error: "canonical not found" });

    res.set(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=600"
    );
    res.json({
      canonical_id: canonicalId,
      store_id: storeId,
      tiers: result.tiers.map((tier) => ({
        ...tier,
        deals: tier.deals.map(serializeDeal),
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/same-product-other-stores", async (req, res, next) => {
  try {
    const canonicalId = String(req.query.canonical_id || "").trim();
    const storeId = String(req.query.store_id || "").trim();
    if (!canonicalId || !storeId) {
      return res.status(400).json({ error: "canonical_id and store_id are required" });
    }

    // Look up source canonical's base_key and category for SQL-based cross-store matching.
    // base_key groups semantically equivalent products across Hindi/English terminology
    // (e.g. "Mung Sabut Whole" ↔ "TRS Mung Beans" → base_key "moong dal yellow").
    // Category guard prevents cross-category false positives (snack vs ingredient).
    const src = await db
      .prepare(`SELECT base_key, category FROM canonical_products WHERE id = ? LIMIT 1`)
      .get(canonicalId);

    let rows;
    if (src?.base_key) {
      rows = await db
        .prepare(
          `SELECT d.id, d.product_name, d.sale_price, d.discount_percent,
                  d.price_per_kg, d.weight_raw, d.weight_value, d.weight_unit, d.product_url, d.image_url,
                  s.id AS store_id, s.name AS store_name, s.url AS store_url
           FROM deals d
           JOIN stores s ON s.id = d.store_id
           JOIN canonical_products cp ON cp.id = d.canonical_id
           WHERE cp.base_key = ? AND cp.category = ? AND d.store_id != ? AND d.is_active = 1
           ORDER BY s.name ASC, d.sale_price ASC`
        )
        .all(src.base_key, src.category, storeId);
    } else {
      // Fallback: exact canonical_id match (no base_key populated yet)
      rows = await db
        .prepare(
          `SELECT d.id, d.product_name, d.sale_price, d.discount_percent,
                  d.price_per_kg, d.weight_raw, d.weight_value, d.weight_unit, d.product_url, d.image_url,
                  s.id AS store_id, s.name AS store_name, s.url AS store_url
           FROM deals d
           JOIN stores s ON s.id = d.store_id
           WHERE d.canonical_id = ? AND d.store_id != ? AND d.is_active = 1
           ORDER BY s.name ASC, d.sale_price ASC`
        )
        .all(canonicalId, storeId);
    }

    const storeMap = new Map();
    for (const d of rows) {
      if (!storeMap.has(d.store_id)) {
        storeMap.set(d.store_id, {
          store_id: d.store_id,
          store_name: d.store_name,
          store_url: d.store_url,
          deals: [],
        });
      }
      storeMap.get(d.store_id).deals.push({
        id: d.id,
        product_name: d.product_name,
        sale_price: d.sale_price,
        discount_percent: d.discount_percent,
        price_per_kg: d.price_per_kg,
        weight_raw: d.weight_raw,
        weight_value: d.weight_value,
        weight_unit: d.weight_unit,
        product_url: d.product_url,
        image_url: d.image_url,
      });
    }

    res.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.json({ stores: [...storeMap.values()] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.serializeDeal = serializeDeal;
