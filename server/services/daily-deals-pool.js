"use strict";

const {
  getCatalogCategories,
  normalizeCatalogText,
  resolveBaseProduct,
} = require("./base-product-catalog");
const { cacheJsonValue, getCachedJsonValue } = require("./session-store");

const DAILY_POOL_LIMIT = 24;
const DAILY_POOL_MIN_STORES = 10;
const DAILY_POOL_REPEAT_WINDOW_DAYS = 10;
const DAILY_POOL_CACHE_TTL_SECONDS = 21 * 24 * 60 * 60;
const DAILY_POOL_CATEGORY_RATIO = 0.5;
const REFRESH_TIME_ZONE = "Europe/Berlin";
const REFRESH_HOUR = 7;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getZonedParts(date, timeZone = REFRESH_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getOffsetMinutesAtUtc(utcMs, timeZone = REFRESH_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const tzName = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function zonedTimeToUtcMs(parts, timeZone = REFRESH_TIME_ZONE) {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
  );
  const offset1 = getOffsetMinutesAtUtc(localAsUtc, timeZone);
  const utcGuess1 = localAsUtc - offset1 * 60_000;
  const offset2 = getOffsetMinutesAtUtc(utcGuess1, timeZone);
  return localAsUtc - offset2 * 60_000;
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

function buildDailyPoolCacheKey(poolDate) {
  return `desiDeals24:dailyDealsPool:${normalizePoolDate(poolDate)}`;
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

  await db.transaction(async (rows) => {
    await db.prepare(`DELETE FROM daily_deal_pool_entries WHERE pool_date = ?`).run(
      normalizedDate,
    );
    for (const row of rows) {
      await insert.run(
        normalizedDate,
        row.slot_index,
        row.deal_id || null,
        row.store_id,
        row.base_key || null,
        row.product_signature,
        row.category || null,
        row.product_name_snapshot || null,
        row.created_at || new Date().toISOString(),
      );
    }
  })(entries);
}

async function restorePoolEntriesFromCache(db, poolDate) {
  const normalizedDate = normalizePoolDate(poolDate);
  const existing = await readPoolEntriesFromDb(db, normalizedDate);
  if (existing.length > 0) return existing;

  const cached = await getCachedJsonValue(buildDailyPoolCacheKey(normalizedDate));
  if (!Array.isArray(cached) || cached.length === 0) {
    return [];
  }

  await persistPoolEntries(db, normalizedDate, cached);
  return readPoolEntriesFromDb(db, normalizedDate);
}

async function persistPoolEntriesWithCache(db, poolDate, entries) {
  await persistPoolEntries(db, poolDate, entries);
  await cacheJsonValue(
    buildDailyPoolCacheKey(poolDate),
    entries,
    DAILY_POOL_CACHE_TTL_SECONDS,
  );
}

async function restoreRecentHistoryFromCache(db, poolDate) {
  for (
    let dayOffset = DAILY_POOL_REPEAT_WINDOW_DAYS - 1;
    dayOffset >= 0;
    dayOffset -= 1
  ) {
    // eslint-disable-next-line no-await-in-loop
    await restorePoolEntriesFromCache(db, addDays(poolDate, -dayOffset));
  }
}

async function fetchActiveDealRows(db) {
  return await db
    .prepare(
      `SELECT d.*, s.name AS store_name, s.url AS store_url
       FROM deals d
       JOIN stores s ON s.id = d.store_id
       WHERE d.is_active = 1
         AND lower(coalesce(d.availability, '')) = 'in_stock'`,
    )
    .all();
}

function buildEligibleCandidates(rows, poolDate) {
  const bestByStoreProduct = new Map();

  for (const row of rows) {
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

  return Array.from(bestByStoreProduct.values()).sort(compareCandidateRank);
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

function buildPoolEntriesFromSelection(selection) {
  return selection.map((candidate, index) => ({
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

  selectionState.selected.push(candidate);
  selectionState.usedProducts.add(candidate.product_signature);
  selectionState.usedStores.add(String(candidate.store_id || "").trim());
  selectionState.usedCategories.add(
    String(candidate.resolved_category || "").trim() || "Other",
  );
  return true;
}

function selectDailyPoolCandidates(candidates, previousProducts, limit) {
  const filtered = candidates.filter(
    (candidate) => !previousProducts.has(candidate.product_signature),
  );
  const targetLimit = Math.max(1, Math.min(DAILY_POOL_LIMIT, Number(limit) || DAILY_POOL_LIMIT));
  const categoryTarget = Math.max(
    2,
    Math.ceil(getCatalogCategories().length * DAILY_POOL_CATEGORY_RATIO),
  );
  const selectionState = {
    selected: [],
    usedProducts: new Set(),
    usedStores: new Set(),
    usedCategories: new Set(),
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

  if (selectionState.selected.length < targetLimit) {
    for (const candidate of candidates) {
      if (selectionState.selected.length >= targetLimit) break;
      addSelectionCandidate(selectionState, candidate);
    }
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
  const byStoreProduct = new Map();
  const byProduct = new Map();

  for (const candidate of currentCandidates) {
    byDealId.set(String(candidate.id || ""), candidate);

    const storeProductKey = buildStoreProductKey(
      candidate.store_id,
      candidate.product_signature,
    );
    if (!byStoreProduct.has(storeProductKey)) {
      byStoreProduct.set(storeProductKey, candidate);
    }
    if (!byProduct.has(candidate.product_signature)) {
      byProduct.set(candidate.product_signature, candidate);
    }
  }

  return entries
    .map((entry) => {
      const productSignature = String(entry?.product_signature || "").trim();
      const storeId = String(entry?.store_id || "").trim();
      return (
        byDealId.get(String(entry?.deal_id || "")) ||
        byStoreProduct.get(buildStoreProductKey(storeId, productSignature)) ||
        byProduct.get(productSignature) ||
        null
      );
    })
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

async function getDailyDealsPool(db, options = {}) {
  const poolDate = normalizePoolDate(options.poolDate || options.seed);
  const limit = Math.max(
    1,
    Math.min(DAILY_POOL_LIMIT, Number(options.limit) || DAILY_POOL_LIMIT),
  );

  await restoreRecentHistoryFromCache(db, poolDate);

  let entries = await readPoolEntriesFromDb(db, poolDate);
  if (entries.length === 0) {
    const currentCandidates = buildEligibleCandidates(await fetchActiveDealRows(db), poolDate);
    const previousProducts = await getRecentProductSignatures(db, poolDate);
    const selection = selectDailyPoolCandidates(
      currentCandidates,
      previousProducts,
      DAILY_POOL_LIMIT,
    );
    entries = buildPoolEntriesFromSelection(selection.rows);
    await persistPoolEntriesWithCache(db, poolDate, entries);
  }

  const currentCandidates = buildEligibleCandidates(await fetchActiveDealRows(db), poolDate);
  const rows = materializePoolRows(entries, currentCandidates).slice(0, limit);
  const summary = buildPoolSummary(entries);

  return {
    rows,
    entries,
    meta: {
      pool_date: poolDate,
      fixed_for_day: true,
      ...summary,
    },
  };
}

module.exports = {
  DAILY_POOL_LIMIT,
  DAILY_POOL_MIN_STORES,
  DAILY_POOL_REPEAT_WINDOW_DAYS,
  getCurrentPoolDate,
  getDailyDealsPool,
};
