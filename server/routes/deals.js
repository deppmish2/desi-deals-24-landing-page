"use strict";
const express = require("express");
const router = express.Router();
const db = require("../db");
const {
  isCrawlLocked,
  restoreFromSnapshot,
} = require("../../crawler/utils/snapshot");
const { restoreDealsFromSeed } = require("../services/deals-seed-loader");
const { trackEvent } = require("../services/event-tracker");
const { expandQuery } = require("../services/search-expander");
const { mapCategory } = require("../../crawler/utils/category-mapper");
const { reRankDeals } = require("../services/smart-ranker");
const { resolveBaseProduct } = require("../services/base-product-catalog");
const {
  getCurrentPoolDate,
  getDailyDealsPool,
} = require("../services/daily-deals-pool");

const FUZZY_PRODUCT_NAME_SQL = `
  replace(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(lower(d.product_name), 'aa', 'a'),
                  'aa', 'a'),
                'ee', 'e'),
              'ee', 'e'),
            'ii', 'i'),
          'ii', 'i'),
        'oo', 'o'),
      'oo', 'o'),
    'uu', 'u'),
  'uu', 'u')
`;

const PRODUCT_WORDS_SQL = `
  lower(
    replace(
      replace(
        replace(
          replace(
            replace(
              replace(d.product_name, '-', ' '),
            '/', ' '),
          '.', ' '),
        ',', ' '),
      '(', ' '),
    ')', ' ')
  )
`;

function collapseRepeatedVowels(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/([aeiou])\1+/g, "$1")
    .trim();
}

function normaliseBundleText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBundleSuggestions(raw) {
  if (raw == null) return [];
  const text = String(raw || "").trim();
  if (!text) return [];

  let values = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) values = parsed;
  } catch {
    values = text.split("||");
  }

  const out = [];
  const seen = new Set();
  for (const value of values) {
    const item = String(value || "").trim();
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 12) break;
  }
  return out;
}

function hasDealSignal(row) {
  const discount = Number(row?.discount_percent || 0);
  if (discount > 0) return true;
  const salePrice = Number(row?.sale_price || 0);
  const originalPrice = Number(row?.original_price || 0);
  return salePrice > 0 && originalPrice > salePrice;
}

function firstBundleMatchIndex(productName, bundleTermsNorm) {
  const nameNorm = normaliseBundleText(productName);
  if (!nameNorm) return Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < bundleTermsNorm.length; i += 1) {
    const termNorm = bundleTermsNorm[i];
    if (!termNorm) continue;
    if (nameNorm.includes(termNorm)) return i;
  }
  return Number.MAX_SAFE_INTEGER;
}

function isFlourIntentQuery(value) {
  const text = String(value || "").toLowerCase();
  return /\b(atta|ata|wheat flour|whole wheat|chakki|multigrain)\b/.test(text);
}

function parseCsvFilter(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableSeedRank(seed, key) {
  return hashSeed(`${seed}:${key}`);
}

function pickPopularCatalogRows(rows, limit, seed) {
  const resolvedByName = new Map();
  const bestByBaseKey = new Map();

  for (const row of rows) {
    const productName = String(row?.product_name || "").trim();
    if (!productName) continue;

    let resolved = resolvedByName.get(productName);
    if (resolved === undefined) {
      resolved = resolveBaseProduct(productName) || null;
      resolvedByName.set(productName, resolved);
    }
    if (!resolved?.base_key) continue;

    const existing = bestByBaseKey.get(resolved.base_key);
    if (!existing) {
      bestByBaseKey.set(resolved.base_key, { ...row, popular_base_key: resolved.base_key });
      continue;
    }

    const existingDiscount = Number(existing.discount_percent || 0);
    const nextDiscount = Number(row.discount_percent || 0);
    if (
      nextDiscount > existingDiscount ||
      (nextDiscount === existingDiscount &&
        Number(row.sale_price || Infinity) < Number(existing.sale_price || Infinity))
    ) {
      bestByBaseKey.set(resolved.base_key, { ...row, popular_base_key: resolved.base_key });
    }
  }

  const eligible = Array.from(bestByBaseKey.values()).sort((a, b) => {
    const aRank = stableSeedRank(seed, a.popular_base_key || a.id);
    const bRank = stableSeedRank(seed, b.popular_base_key || b.id);
    if (aRank !== bRank) return aRank - bRank;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  return {
    totalEligible: eligible.length,
    rows: eligible.slice(0, Math.max(1, limit)),
  };
}

// GET /api/v1/deals
router.get("/", async (req, res) => {
  const startedAt = Date.now();
  // Cold-start guard: on Vercel, the module-level snapshot restore in api/server.js
  // is async/fire-and-forget, so the first request can arrive before it completes.
  // If the DB is empty, block this request briefly to restore from snapshot,
  // ensuring the first page load returns real data instead of an empty list.
  if (
    db.prepare("SELECT COUNT(*) as n FROM deals WHERE is_active = 1").get()
      .n === 0
  ) {
    await restoreFromSnapshot(db).catch(() => {});
    if (
      db.prepare("SELECT COUNT(*) as n FROM deals WHERE is_active = 1").get()
        .n === 0
    ) {
      restoreDealsFromSeed(db);
    }
  }

  const {
    q,
    curated,
    seed,
    bundle,
    selected,
    suggested,
    store,
    category,
    min_discount,
    min_price,
    max_price,
    availability = "in_stock",
    near_expiry,
    hide_expired,
    sort = "discount_desc",
    page = 1,
    limit = 24,
    include_inactive,
  } = req.query;
  const curatedMode = String(curated || "").trim();
  const curatedDailyPool = curatedMode === "daily_live_pool";
  const curatedPopularCsvOnly =
    curatedMode === "popular_csv_daily_random" ||
    curatedMode === "popular_csv_random";
  const curatedSeed = String(seed || "").trim() || getCurrentPoolDate();

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 24));
  const offset = (pageNum - 1) * limitNum;

  if (curatedDailyPool) {
    const pool = await getDailyDealsPool(db, {
      poolDate: curatedSeed,
      limit: limitNum,
    });

    const lastCrawl = db
      .prepare(
        `SELECT finished_at FROM crawl_runs WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
      )
      .get();

    const activeStores = db
      .prepare(`SELECT COUNT(*) as cnt FROM stores WHERE crawl_status = 'active'`)
      .get().cnt;

    const localCrawling =
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM crawl_runs WHERE status = 'running'`,
        )
        .get().cnt > 0;
    const globalCrawling = await isCrawlLocked().catch(() => false);
    const crawling = localCrawling || globalCrawling;

    const data = pool.rows.map((row) => ({
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
    }));

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: pool.entries.length,
        total_pages: Math.ceil(pool.entries.length / limitNum),
      },
      meta: {
        last_crawl: lastCrawl?.finished_at || null,
        active_stores: activeStores,
        crawling,
        curated: {
          mode: curatedMode,
          seed: curatedSeed,
          ...pool.meta,
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
        curated_mode: curatedMode,
        has_query: Boolean(q),
        has_store_filter: Boolean(store),
        has_category_filter: Boolean(category),
      },
    });
    return;
  }

  const includeInactive = include_inactive === "1";
  let where = includeInactive ? `1=1` : `d.is_active = 1`;
  const params = [];

  // Computed once here so the smart re-ranker can reuse the same expanded terms
  // as the SQL WHERE clause (avoids re-expanding "jirra"→["jira","jeera","cumin"]).
  const expandedTerms = q ? expandQuery(String(q).trim()) : [];
  const hasSearchQuery = Boolean(String(q || "").trim());
  const bundleEnabled = String(bundle || "").trim() === "1";
  const selectedBundleTerm = String(selected || "").trim();
  const parsedBundleSuggestions = bundleEnabled
    ? parseBundleSuggestions(suggested)
    : [];
  const bundleTerms = [];
  const bundleSeen = new Set();
  for (const value of [selectedBundleTerm, ...parsedBundleSuggestions]) {
    const raw = String(value || "").trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (bundleSeen.has(key)) continue;
    bundleSeen.add(key);
    const normalised = normaliseBundleText(raw);
    if (!normalised) continue;
    bundleTerms.push({ raw, normalised });
    if (bundleTerms.length >= 12) break;
  }
  const bundleMode = bundleTerms.length > 0;

  if (q && !bundleMode) {
    // Expand the query to synonym and phonetic variants so that e.g. "jeera"
    // also finds products stored as "cumin", and "haldi" finds "turmeric".

    // Build OR conditions: each expanded term is matched both as-is and
    // (expandedTerms computed above at outer scope)
    // with vowel-collapse normalisation applied at the SQL level.
    const termClauses = expandedTerms.map(() => {
      return `(lower(d.product_name) LIKE ? OR ${FUZZY_PRODUCT_NAME_SQL} LIKE ?)`;
    });
    where += ` AND (${termClauses.join(" OR ")})`;
    for (const term of expandedTerms) {
      const fuzzy = collapseRepeatedVowels(term);
      params.push(`%${term}%`, `%${fuzzy}%`);
    }

    // Prevent "atta" queries from matching unrelated words like khatta/matta/thattai.
    if (isFlourIntentQuery(q)) {
      where += ` AND (
        (' ' || ${PRODUCT_WORDS_SQL} || ' ') LIKE ?
        OR (' ' || ${PRODUCT_WORDS_SQL} || ' ') LIKE ?
        OR ${PRODUCT_WORDS_SQL} LIKE ?
        OR ${PRODUCT_WORDS_SQL} LIKE ?
        OR (' ' || ${PRODUCT_WORDS_SQL} || ' ') LIKE ?
        OR (' ' || ${PRODUCT_WORDS_SQL} || ' ') LIKE ?
      )`;
      params.push(
        "% atta %",
        "% ata %",
        "%wheat flour%",
        "%whole wheat%",
        "% chakki %",
        "% multigrain %",
      );
    }
  }
  if (bundleTerms.length > 0) {
    const bundleClauses = bundleTerms
      .map(
        () => `(lower(d.product_name) LIKE ? OR ${PRODUCT_WORDS_SQL} LIKE ?)`,
      )
      .join(" OR ");
    where += ` AND (${bundleClauses})`;
    for (const term of bundleTerms) {
      params.push(`%${term.raw.toLowerCase()}%`, `%${term.normalised}%`);
    }
  }
  if (category) {
    const categories = parseCsvFilter(category);
    if (categories.length > 0) {
      where += ` AND d.product_category IN (${categories.map(() => "?").join(",")})`;
      params.push(...categories);
    }
  }
  if (min_discount) {
    where += ` AND d.discount_percent >= ?`;
    params.push(parseFloat(min_discount));
  }
  if (min_price) {
    where += ` AND d.sale_price >= ?`;
    params.push(parseFloat(min_price));
  }
  if (max_price) {
    where += ` AND d.sale_price <= ?`;
    params.push(parseFloat(max_price));
  }
  if (hide_expired === "1") {
    where += ` AND (d.best_before IS NULL OR d.best_before >= date('now'))`;
  }
  if (hasSearchQuery) {
    where += ` AND d.availability = ?`;
    params.push("in_stock");
  } else if (availability !== "all") {
    where += ` AND d.availability = ?`;
    params.push(availability);
  }
  if (near_expiry === "1") {
    where += ` AND d.best_before IS NOT NULL`;
  }
  if (store) {
    const storeIds = parseCsvFilter(store);
    if (storeIds.length) {
      where += ` AND d.store_id IN (${storeIds.map(() => "?").join(",")})`;
      params.push(...storeIds);
    }
  }

  const sortMap = {
    discount_desc: "COALESCE(d.discount_percent, 0) DESC",
    price_asc: "d.sale_price ASC",
    price_per_kg_asc: "COALESCE(d.price_per_kg, 9999999) ASC, d.sale_price ASC",
    price_desc: "d.sale_price DESC",
    newest: "d.crawl_timestamp DESC",
  };
  const orderBy = sortMap[sort] || sortMap.discount_desc;

  const base = `
    FROM deals d
    JOIN stores s ON d.store_id = s.id
    WHERE ${where}
  `;

  let total = db.prepare(`SELECT COUNT(*) as cnt ${base}`).get(...params).cnt;

  let rows = db
    .prepare(
      `
    SELECT d.*, s.name AS store_name, s.url AS store_url
    ${base}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limitNum, offset);

  if (curatedPopularCsvOnly) {
    const candidateRows = db
      .prepare(
        `
        SELECT d.*, s.name AS store_name, s.url AS store_url
        ${base}
        ORDER BY ${orderBy}
      `,
      )
      .all(...params);
    const curatedSelection = pickPopularCatalogRows(
      candidateRows,
      limitNum,
      curatedSeed,
    );
    total = curatedSelection.totalEligible;
    rows = curatedSelection.rows;
  }

  // Smart re-ranking: when a search query is present, re-order SQL results by
  // multi-signal relevance score (embedding similarity + brand match + weight
  // class match + token overlap + phonetic similarity) so the best structural
  // matches appear first instead of whatever order SQL returned them.
  // Pass the pre-expanded terms so "jirra" re-ranks "jeera" products correctly.
  if (q && rows.length > 0 && !bundleMode) {
    rows = reRankDeals(expandedTerms, rows);
  }

  if (bundleTerms.length > 0 && rows.length > 1) {
    const selectedNorm =
      normaliseBundleText(selectedBundleTerm) || bundleTerms[0].normalised;
    const bundleTermsNorm = bundleTerms.map((term) => term.normalised);
    rows = [...rows].sort((a, b) => {
      const aNameNorm = normaliseBundleText(a.product_name);
      const bNameNorm = normaliseBundleText(b.product_name);
      const aSelected =
        selectedNorm && aNameNorm.includes(selectedNorm) ? 0 : 1;
      const bSelected =
        selectedNorm && bNameNorm.includes(selectedNorm) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;

      const aBundleIndex = firstBundleMatchIndex(
        a.product_name,
        bundleTermsNorm,
      );
      const bBundleIndex = firstBundleMatchIndex(
        b.product_name,
        bundleTermsNorm,
      );
      if (aBundleIndex !== bBundleIndex) return aBundleIndex - bBundleIndex;

      const aDeal = hasDealSignal(a) ? 0 : 1;
      const bDeal = hasDealSignal(b) ? 0 : 1;
      if (aDeal !== bDeal) return aDeal - bDeal;

      const aDiscount = Number(a.discount_percent || 0);
      const bDiscount = Number(b.discount_percent || 0);
      if (aDiscount !== bDiscount) return bDiscount - aDiscount;

      return String(a.product_name || "").localeCompare(
        String(b.product_name || ""),
      );
    });
  }

  // Graceful degradation: if the text search returns nothing and no other
  // filters are active, fall back to deals from the closest matching category.
  if (total === 0 && q && !category && !store && bundleTerms.length === 0) {
    // expandedTerms already computed above (outer scope)
    let inferredCategory = null;
    for (const term of expandedTerms) {
      const cat = mapCategory(term);
      if (cat !== "Other") {
        inferredCategory = cat;
        break;
      }
    }
    if (!inferredCategory) inferredCategory = mapCategory(String(q).trim());

    if (inferredCategory && inferredCategory !== "Other") {
      const catBase = `
        FROM deals d
        JOIN stores s ON d.store_id = s.id
        WHERE d.is_active = 1 AND d.product_category = ?
          AND d.availability = 'in_stock'
      `;
      const catParams = [inferredCategory];

      total = db
        .prepare(`SELECT COUNT(*) as cnt ${catBase}`)
        .get(...catParams).cnt;
      rows = db
        .prepare(
          `SELECT d.*, s.name AS store_name, s.url AS store_url
           ${catBase}
           ORDER BY ${orderBy}
           LIMIT ? OFFSET ?`,
        )
        .all(...catParams, limitNum, offset);
    }
  }

  const lastCrawl = db
    .prepare(
      `SELECT finished_at FROM crawl_runs WHERE status = 'completed' ORDER BY finished_at DESC LIMIT 1`,
    )
    .get();

  const activeStores = db
    .prepare(`SELECT COUNT(*) as cnt FROM stores WHERE crawl_status = 'active'`)
    .get().cnt;

  // Check both local SQLite and global Redis lock — covers multi-container Vercel deployments.
  const localCrawling =
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM crawl_runs WHERE status = 'running'`,
      )
      .get().cnt > 0;
  const globalCrawling = await isCrawlLocked().catch(() => false);
  const crawling = localCrawling || globalCrawling;

  const data = rows.map((row) => ({
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
  }));

  res.json({
    data,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      total_pages: Math.ceil(total / limitNum),
    },
    meta: {
      last_crawl: lastCrawl?.finished_at || null,
      active_stores: activeStores,
      crawling,
      curated:
        curatedPopularCsvOnly
          ? {
              mode: curatedMode,
              seed: curatedSeed,
            }
          : null,
    },
  });
  trackEvent(db, "browse.deals", {
    route: req.originalUrl,
    payload: {
      duration_ms: Date.now() - startedAt,
      result_count: data.length,
      page: pageNum,
      limit: limitNum,
      curated_mode: curatedPopularCsvOnly ? curatedMode : null,
      has_query: Boolean(q),
      has_store_filter: Boolean(store),
      has_category_filter: Boolean(category),
    },
  });
});

// GET /api/v1/deals/suggest?q=<query>
router.get("/suggest", (req, res) => {
  const startedAt = Date.now();
  const q = (req.query.q || "").trim();
  if (q.length < 2) {
    res.json({ suggestions: [] });
    trackEvent(db, "search.suggest", {
      route: req.originalUrl,
      payload: {
        duration_ms: Date.now() - startedAt,
        query_length: q.length,
        result_count: 0,
      },
    });
    return;
  }

  const rows = db
    .prepare(
      `
    SELECT product_name, MAX(crawl_timestamp) AS latest_seen
    FROM deals
    WHERE product_name LIKE ?
      AND is_active = 1
      AND lower(coalesce(availability, '')) = 'in_stock'
    GROUP BY lower(trim(product_name))
    ORDER BY latest_seen DESC
    LIMIT 8
  `,
    )
    .all(`%${q}%`);

  const suggestions = rows.map((r) => r.product_name);
  res.json({ suggestions });
  trackEvent(db, "search.suggest", {
    route: req.originalUrl,
    payload: {
      duration_ms: Date.now() - startedAt,
      query_length: q.length,
      result_count: suggestions.length,
    },
  });
});

// GET /api/v1/deals/:id
router.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `
    SELECT d.*, s.name AS store_name, s.url AS store_url
    FROM deals d JOIN stores s ON d.store_id = s.id
    WHERE d.id = ?
  `,
    )
    .get(req.params.id);

  if (!row) return res.status(404).json({ error: "Deal not found" });

  res.json({
    ...row,
    canonical_id: row.canonical_id || null,
    store: { id: row.store_id, name: row.store_name, url: row.store_url },
    bulk_pricing: row.bulk_pricing ? JSON.parse(row.bulk_pricing) : null,
  });
});

module.exports = router;
