"use strict";

const express = require("express");

const db = require("../db");
const {
  buildDiversifiedPages,
  dateSeed,
  getDealStoreId,
  seededShuffle,
} = require("../services/deal-order");
const { trackEvent } = require("../services/event-tracker");
const { formatBerlinDateKey } = require("../services/berlin-time");
const { trackSearchQuery } = require("../services/search-tracker");
const { verifyJwt } = require("../utils/jwt");

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
  if (
    _snapshotContextCache &&
    Date.now() < _snapshotContextCache.expiresAt
  ) {
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
const FAST_CURRENT_DEALS_WHERE_SQL = `
  d.is_active = 1
  AND d.display_date = ?
  AND d.display_order IS NOT NULL
  AND lower(coalesce(d.availability, '')) = 'in_stock'
  AND lower(d.store_id) NOT IN (${EXCLUDED_STORE_IDS_SQL})
  AND ${DISPLAYABLE_DISCOUNT_SQL}
`;

function resolveAccessSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

async function getOptionalRequestIdentity(req) {
  const sessionId = String(req.headers["x-dd24-session-id"] || "")
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
    const rawSearchQuery = String(req.query.q || "").trim().replace(/\s+/g, " ");
    const searchQuery = rawSearchQuery
      .trim()
      .toLowerCase();
    const shouldTrackSearch =
      Boolean(rawSearchQuery) &&
      pageNum === 1 &&
      String(req.query.track_search || "").trim() === "1";
    const filterStore = String(req.query.store || "").trim();
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
    const sort = String(req.query.sort || "").trim();
    const usesExplicitOrdering =
      sort === "discount" || sort === "price_per_kg" || sort === "price";
    const canUseFastPath = Boolean(
      !focusDealId &&
      !searchQuery &&
      !filterStore &&
      !filterCategory &&
      minDiscount <= 0 &&
      priceMin <= 0 &&
      priceMax <= 0 &&
      inStock &&
      !hideExpired &&
      !usesExplicitOrdering,
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
              unique_store_count: new Set(data.map((deal) => getDealStoreId(deal) || "__unknown__")).size,
              disabled_for_explicit_sort: false,
            },
          },
        });
        return;
      }
    }

    // Load + shuffle active deals — cached per latest completed crawl.
    let allDeals = getMemCache(cacheKey);
    if (!allDeals) {
      const rows = await db.prepare(ACTIVE_DEALS_SQL).all();
      allDeals = seededShuffle(rows.map(serializeDeal), dateSeed(cacheKey));
      if (allDeals.length > 0) setMemCache(cacheKey, allDeals);
    }

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
        dateSeed(`${cacheKey}:${sort || "random"}:${limitNum}`),
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
        date: crawlDate,
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
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
