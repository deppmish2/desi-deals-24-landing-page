"use strict";

const fetch = require("node-fetch");
const {
  getCatalogCategories,
  normalizeCatalogText,
  resolveBaseProduct,
} = require("./base-product-catalog");
const {
  BERLIN_TIME_ZONE,
  formatBerlinDateKey,
  getZonedParts,
  zonedTimeToUtcMs,
} = require("./berlin-time");

const DAILY_POOL_LIMIT = 24;
const DAILY_POOL_MIN_STORES = 10;
const DAILY_POOL_MAX_PER_STORE = 3;
const DAILY_POOL_REPEAT_WINDOW_DAYS = 7;
const DAILY_POOL_CATEGORY_RATIO = 0.8;
const REFRESH_TIME_ZONE = BERLIN_TIME_ZONE;
const REFRESH_HOUR = 7;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function shiftZonedDate(parts, deltaDays, timeZone = REFRESH_TIME_ZONE) {
  const noonUtcMs = zonedTimeToUtcMs(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 12,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
  const shiftedUtcMs = noonUtcMs + Number(deltaDays || 0) * 24 * 60 * 60_000;
  return getZonedParts(new Date(shiftedUtcMs), timeZone);
}

function getCurrentPoolDate(nowMs = Date.now()) {
  const nowParts = getZonedParts(new Date(nowMs), REFRESH_TIME_ZONE);
  const effectiveParts =
    nowParts.hour >= REFRESH_HOUR
      ? nowParts
      : shiftZonedDate(nowParts, -1, REFRESH_TIME_ZONE);
  return `${effectiveParts.year}-${pad2(effectiveParts.month)}-${pad2(effectiveParts.day)}`;
}

function normalizePoolDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return getCurrentPoolDate();
}

function addDays(poolDate, deltaDays) {
  const base = new Date(`${normalizePoolDate(poolDate)}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + Number(deltaDays || 0));
  return base.toISOString().slice(0, 10);
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

function computeDiscountValue(row) {
  const direct = Number(row?.discount_percent);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const salePrice = Number(row?.sale_price);
  const originalPrice = Number(row?.original_price);
  if (
    Number.isFinite(salePrice) &&
    Number.isFinite(originalPrice) &&
    originalPrice > salePrice &&
    originalPrice > 0
  ) {
    return ((originalPrice - salePrice) / originalPrice) * 100;
  }

  return 0;
}

function normalizeProductSignature(productName) {
  return normalizeCatalogText(productName)
    .replace(/\s+/g, " ")
    .trim();
}

function compareCandidateRank(a, b) {
  const aDiscount = Number(a?.discount_value || 0);
  const bDiscount = Number(b?.discount_value || 0);
  if (aDiscount !== bDiscount) return bDiscount - aDiscount;

  const aPrice = Number(a?.sale_price);
  const bPrice = Number(b?.sale_price);
  if (Number.isFinite(aPrice) && Number.isFinite(bPrice) && aPrice !== bPrice) {
    return aPrice - bPrice;
  }

  const aCrawl = Date.parse(a?.crawl_timestamp || "") || 0;
  const bCrawl = Date.parse(b?.crawl_timestamp || "") || 0;
  if (aCrawl !== bCrawl) return bCrawl - aCrawl;

  const aSeed = Number(a?.seed_rank || 0);
  const bSeed = Number(b?.seed_rank || 0);
  if (aSeed !== bSeed) return aSeed - bSeed;

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function buildStoreProductKey(storeId, productSignature) {
  return `${String(storeId || "").trim()}::${String(productSignature || "").trim()}`;
}

async function readPoolEntriesFromDb(db, poolDate) {
  return await db
    .prepare(
      `SELECT *
       FROM daily_deal_pool_entries
       WHERE pool_date = ?
       ORDER BY slot_index ASC`,
    )
    .all(normalizePoolDate(poolDate));
}

async function persistPoolEntries(db, poolDate, entries) {
  const normalizedDate = normalizePoolDate(poolDate);
  const insert = db.prepare(
    `INSERT INTO daily_deal_pool_entries (
      pool_date,
      slot_index,
      deal_id,
      store_id,
      base_key,
      product_signature,
      category,
      product_name_snapshot,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  await db.prepare(
    `DELETE FROM daily_deal_pool_entries
     WHERE pool_date = ?`,
  ).run(normalizedDate);

  const now = new Date().toISOString();
  for (const row of entries) {
    // eslint-disable-next-line no-await-in-loop
    await insert.run(
      normalizedDate,
      row.slot_index,
      row.deal_id || null,
      row.store_id,
      row.base_key || null,
      row.product_signature,
      row.category || null,
      row.product_name_snapshot || null,
      row.created_at || now,
    );
    if (row.deal_id) {
      // eslint-disable-next-line no-await-in-loop
      await db.prepare(
        `UPDATE deals SET last_pool_used_at = ? WHERE id = ?`,
      ).run(now, row.deal_id);
    }
  }
}

async function fetchActiveDealRows(db) {
  return await db
    .prepare(
      `SELECT d.*, s.name AS store_name, s.url AS store_url
       FROM deals d
       JOIN stores s ON s.id = d.store_id
       WHERE d.is_active = 1
         AND lower(coalesce(d.availability, '')) = 'in_stock'
         AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m', 'now'))
         AND d.discount_percent IS NOT NULL AND d.discount_percent >= 10`,
    )
    .all();
}

function buildEligibleCandidates(rows, poolDate) {
  const bestByStoreProduct = new Map();

  for (const row of rows) {
    if (!row?.id) continue;

    const resolved = resolveBaseProduct(row?.product_name);
    if (!resolved?.base_key) continue;

    const productSignature = normalizeProductSignature(row.product_name);
    if (!productSignature) continue;

    const candidate = {
      ...row,
      base_key: resolved.base_key,
      resolved_category:
        String(resolved.category || row.product_category || "").trim() || "Other",
      product_signature: productSignature,
      discount_value: computeDiscountValue(row),
      seed_rank: stableSeedRank(
        poolDate,
        `${row.store_id}:${productSignature}:${row.id}`,
      ),
    };

    const key = buildStoreProductKey(candidate.store_id, productSignature);
    const existing = bestByStoreProduct.get(key);
    if (!existing || compareCandidateRank(candidate, existing) < 0) {
      bestByStoreProduct.set(key, candidate);
    }
  }

  // Sort by day-seeded random rank so pool order varies daily, not by discount
  return Array.from(bestByStoreProduct.values()).sort(
    (a, b) => Number(a.seed_rank || 0) - Number(b.seed_rank || 0),
  );
}

async function getRecentProductSignatures(db, poolDate) {
  const normalizedDate = normalizePoolDate(poolDate);
  const startDate = addDays(
    normalizedDate,
    -(DAILY_POOL_REPEAT_WINDOW_DAYS - 1),
  );
  return new Set(
    (await db
      .prepare(
        `SELECT DISTINCT product_signature
         FROM daily_deal_pool_entries
         WHERE pool_date >= ?
           AND pool_date < ?`,
      )
      .all(startDate, normalizedDate))
      .map((row) => String(row?.product_signature || "").trim())
      .filter(Boolean),
  );
}

function shuffleWithSeed(arr, seed) {
  const out = arr.slice();
  let s = hashSeed(String(seed));
  for (let i = out.length - 1; i > 0; i--) {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function separateStores(arr) {
  // Greedy reorder: at each position pick the next item not from the same store as previous.
  // With max 3 per store across 10+ stores this always succeeds.
  const remaining = arr.slice();
  const result = [];
  while (remaining.length > 0) {
    const lastStore = result.length > 0 ? result[result.length - 1].store_id : null;
    const idx = remaining.findIndex((item) => item.store_id !== lastStore);
    result.push(remaining.splice(idx === -1 ? 0 : idx, 1)[0]);
  }
  return result;
}

function buildPoolEntriesFromSelection(selection, poolDate) {
  const shuffled = separateStores(shuffleWithSeed(selection, poolDate || "default"));
  return shuffled.map((candidate, index) => ({
    pool_date: null,
    slot_index: index,
    deal_id: candidate.id,
    store_id: candidate.store_id,
    base_key: candidate.base_key,
    product_signature: candidate.product_signature,
    category: candidate.resolved_category,
    product_name_snapshot: candidate.product_name,
    created_at: new Date().toISOString(),
  }));
}

function addSelectionCandidate(selectionState, candidate) {
  if (!candidate) return false;
  if (selectionState.usedProducts.has(candidate.product_signature)) {
    return false;
  }
  const storeId = String(candidate.store_id || "").trim();
  if ((selectionState.storeCount.get(storeId) || 0) >= DAILY_POOL_MAX_PER_STORE) {
    return false;
  }

  selectionState.selected.push(candidate);
  selectionState.usedProducts.add(candidate.product_signature);
  selectionState.usedStores.add(storeId);
  selectionState.storeCount.set(storeId, (selectionState.storeCount.get(storeId) || 0) + 1);
  selectionState.usedCategories.add(
    String(candidate.resolved_category || "").trim() || "Other",
  );
  return true;
}

function selectDailyPoolCandidates(candidates, previousProducts, limit) {
  const filtered = candidates.filter(
    (candidate) => !previousProducts.has(candidate.product_signature),
  );
  const targetLimit = Math.max(
    1,
    Math.min(DAILY_POOL_LIMIT, Number(limit) || DAILY_POOL_LIMIT),
  );
  const categoryTarget = Math.max(
    2,
    Math.ceil(getCatalogCategories().length * DAILY_POOL_CATEGORY_RATIO),
  );
  const selectionState = {
    selected: [],
    usedProducts: new Set(),
    usedStores: new Set(),
    usedCategories: new Set(),
    storeCount: new Map(),
  };

  const bestByCategory = new Map();
  for (const candidate of filtered) {
    if (!bestByCategory.has(candidate.resolved_category)) {
      bestByCategory.set(candidate.resolved_category, candidate);
    }
  }

  for (const candidate of bestByCategory.values()) {
    if (selectionState.selected.length >= targetLimit) break;
    addSelectionCandidate(selectionState, candidate);
    if (selectionState.usedCategories.size >= categoryTarget) break;
  }

  for (const candidate of filtered) {
    if (
      selectionState.selected.length >= targetLimit ||
      selectionState.usedStores.size >= DAILY_POOL_MIN_STORES
    ) {
      break;
    }
    if (selectionState.usedStores.has(candidate.store_id)) continue;
    addSelectionCandidate(selectionState, candidate);
  }

  for (const candidate of filtered) {
    if (selectionState.selected.length >= targetLimit) break;
    addSelectionCandidate(selectionState, candidate);
  }

  return {
    rows: selectionState.selected.slice(0, targetLimit),
    meta: {
      category_target: categoryTarget,
      category_count: selectionState.usedCategories.size,
      store_target: DAILY_POOL_MIN_STORES,
      store_count: selectionState.usedStores.size,
      repeat_window_days: DAILY_POOL_REPEAT_WINDOW_DAYS,
    },
  };
}

function materializePoolRows(entries, currentCandidates) {
  const byDealId = new Map();

  for (const candidate of currentCandidates) {
    byDealId.set(String(candidate.id || ""), candidate);
  }

  return entries
    .map((entry) => byDealId.get(String(entry?.deal_id || "")) || null)
    .filter(Boolean);
}

function buildPoolSummary(entries) {
  const uniqueStores = new Set();
  const uniqueCategories = new Set();

  for (const entry of entries) {
    if (entry?.store_id) uniqueStores.add(String(entry.store_id).trim());
    if (entry?.category) uniqueCategories.add(String(entry.category).trim());
  }

  return {
    size: entries.length,
    store_count: uniqueStores.size,
    category_count: uniqueCategories.size,
    category_target: Math.max(
      2,
      Math.ceil(getCatalogCategories().length * DAILY_POOL_CATEGORY_RATIO),
    ),
    store_target: DAILY_POOL_MIN_STORES,
    repeat_window_days: DAILY_POOL_REPEAT_WINDOW_DAYS,
  };
}

const URL_CHECK_TIMEOUT_MS = 6000;
const URL_CHECK_BATCH = 6;

async function isUrlAlive(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) return true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), URL_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(trimmed, {
      method: "HEAD",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DesiDeals24/1.0)" },
      redirect: "follow",
      signal: controller.signal,
    });
    return res.status !== 404;
  } catch {
    return true; // timeout or network error — assume live to avoid false drops
  } finally {
    clearTimeout(timer);
  }
}

async function filterDeadUrls(candidates) {
  const live = [];
  for (let i = 0; i < candidates.length; i += URL_CHECK_BATCH) {
    const batch = candidates.slice(i, i + URL_CHECK_BATCH);
    // eslint-disable-next-line no-await-in-loop
    const checks = await Promise.all(batch.map((c) => isUrlAlive(c?.product_url)));
    batch.forEach((c, j) => { if (checks[j]) live.push(c); });
  }
  return live;
}

async function isCrawlRunning(db) {
  return (
    Number(
      (await db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM crawl_runs
           WHERE status = 'running'`,
        )
        .get())?.cnt || 0,
    ) > 0
  );
}

async function findLatestPoolDateBefore(db, poolDate) {
  const row = await db
    .prepare(
      `SELECT pool_date
       FROM daily_deal_pool_entries
       WHERE pool_date < ?
       GROUP BY pool_date
       ORDER BY pool_date DESC
       LIMIT 1`,
    )
    .get(normalizePoolDate(poolDate));

  return row?.pool_date || null;
}

async function ensureDailyDealsPool(db, options = {}) {
  const poolDate = normalizePoolDate(options.poolDate || options.seed);
  const allowGenerate = options.allowGenerate !== false;
  let entries = await readPoolEntriesFromDb(db, poolDate);

  if (entries.length > 0) {
    return { entries, poolDate, requestedPoolDate: poolDate };
  }

  const crawling = await isCrawlRunning(db);
  if (crawling) {
    const previousPoolDate = await findLatestPoolDateBefore(db, poolDate);
    if (previousPoolDate) {
      entries = await readPoolEntriesFromDb(db, previousPoolDate);
      return {
        entries,
        poolDate: previousPoolDate,
        requestedPoolDate: poolDate,
        staleWhileCrawl: true,
      };
    }

    return {
      entries: [],
      poolDate,
      requestedPoolDate: poolDate,
      staleWhileCrawl: true,
    };
  }

  if (!allowGenerate) {
    const previousPoolDate = await findLatestPoolDateBefore(db, poolDate);
    if (previousPoolDate) {
      entries = await readPoolEntriesFromDb(db, previousPoolDate);
      return {
        entries,
        poolDate: previousPoolDate,
        requestedPoolDate: poolDate,
        staleWhileMissingPool: true,
      };
    }

    return {
      entries: [],
      poolDate,
      requestedPoolDate: poolDate,
      staleWhileMissingPool: true,
    };
  }

  const currentCandidates = buildEligibleCandidates(
    await fetchActiveDealRows(db),
    poolDate,
  );
  const previousProducts = await getRecentProductSignatures(db, poolDate);
  const selection = selectDailyPoolCandidates(
    currentCandidates,
    previousProducts,
    DAILY_POOL_LIMIT,
  );
  entries = buildPoolEntriesFromSelection(selection.rows, poolDate);
  await persistPoolEntries(db, poolDate, entries);

  return {
    entries,
    poolDate,
    requestedPoolDate: poolDate,
  };
}

async function getDailyDealsPool(db, options = {}) {
  const requestedPoolDate = normalizePoolDate(options.poolDate || options.seed);
  const limit = Math.max(
    1,
    Math.min(DAILY_POOL_LIMIT, Number(options.limit) || DAILY_POOL_LIMIT),
  );

  const ensured = await ensureDailyDealsPool(db, {
    poolDate: requestedPoolDate,
    allowGenerate: options.allowGenerate,
  });
  const poolDate = ensured.poolDate;
  const entries = ensured.entries;
  const currentCandidates = buildEligibleCandidates(
    await fetchActiveDealRows(db),
    poolDate,
  );
  const rows = materializePoolRows(entries, currentCandidates).slice(0, limit);
  const summary = buildPoolSummary(entries);

  return {
    rows,
    entries,
    meta: {
      pool_date: poolDate,
      requested_pool_date: requestedPoolDate,
      fixed_for_day: true,
      stale_while_crawl: Boolean(ensured.staleWhileCrawl),
      served_from_existing_pool: poolDate !== requestedPoolDate,
      stale_while_missing_pool: Boolean(ensured.staleWhileMissingPool),
      ...summary,
    },
  };
}

module.exports = {
  DAILY_POOL_LIMIT,
  DAILY_POOL_MIN_STORES,
  DAILY_POOL_REPEAT_WINDOW_DAYS,
  ensureDailyDealsPool,
  getCurrentPoolDate,
  getDailyDealsPool,
};
