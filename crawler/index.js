"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { v4: uuidv4 } = require("uuid");

const { parseBestBefore } = require("./utils/best-before-parser");
const {
  acquireCrawlLock,
  releaseCrawlLock,
} = require("./utils/snapshot");
const {
  ensureDailyDealsPool,
  getCurrentPoolDate,
} = require("../server/services/daily-deals-pool");
const { getBerlinHour } = require("../server/services/berlin-time");

const DELAY_MIN = parseInt(process.env.REQUEST_DELAY_MIN_MS || "2000", 10);
const DELAY_MAX = parseInt(process.env.REQUEST_DELAY_MAX_MS || "5000", 10);

const adapters = [
  require("./stores/jamoona"),
  require("./stores/dookan"),
  require("./stores/grocera"),
  require("./stores/little-india"),
  require("./stores/namma-markt"),
  require("./stores/globalfoodhub"),
  require("./stores/desigros"),
  require("./stores/zora-supermarkt"),
  require("./stores/md-store"),
  require("./stores/indiansupermarkt"),
  require("./stores/indianstorestuttgart"),
  require("./stores/anuhita-groceries"),
  require("./stores/sairas"),
  require("./stores/indische-lebensmittel-online"),
  require("./stores/indianfoodstore"),
  require("./stores/swadesh"),
  require("./stores/spicelands"),
  require("./stores/annachi"),
  require("./stores/namastedeutschland"),
  require("./stores/india-store"),
  require("./stores/india-express-food"),
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  return sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
}

function normalizeText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeBulkPricing(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  return JSON.stringify(value);
}

function toComparableDealShape(deal) {
  return {
    store_id: normalizeText(deal.store_id),
    product_name: normalizeText(deal.product_name),
    product_category: normalizeText(deal.product_category),
    product_url: normalizeText(deal.product_url),
    image_url: normalizeText(deal.image_url),
    weight_raw: normalizeText(deal.weight_raw),
    weight_value: normalizeNumber(deal.weight_value),
    weight_unit: normalizeText(deal.weight_unit),
    sale_price: normalizeNumber(deal.sale_price),
    original_price: normalizeNumber(deal.original_price),
    discount_percent: normalizeNumber(deal.discount_percent),
    price_per_kg: normalizeNumber(deal.price_per_kg),
    price_per_unit: normalizeNumber(deal.price_per_unit),
    currency: normalizeText(deal.currency) || "EUR",
    availability: normalizeText(deal.availability) || "unknown",
    bulk_pricing: normalizeBulkPricing(deal.bulk_pricing),
    best_before: normalizeText(deal.best_before),
  };
}

function dealsEqual(existing, next) {
  const left = toComparableDealShape(existing);
  const right = toComparableDealShape(next);
  return Object.keys(left).every((key) => left[key] === right[key]);
}

async function fetchActiveDealsForStore(db, storeId) {
  return await db
    .prepare(
      `SELECT *
       FROM deals
       WHERE store_id = ?
         AND is_active = 1`,
    )
    .all(storeId);
}

async function markDealsInactive(db, dealIds) {
  let changes = 0;
  for (const dealId of dealIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await db.prepare(
      `UPDATE deals
       SET is_active = 0
       WHERE id = ?
         AND is_active = 1`,
    ).run(dealId);
    changes += Number(result?.changes || 0);
  }
  return changes;
}

async function insertDeals(db, deals) {
  if (!Array.isArray(deals) || deals.length === 0) return 0;

  const insertDeal = db.prepare(`
    INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, image_url, weight_raw, weight_value, weight_unit,
       sale_price, original_price, discount_percent, price_per_kg, price_per_unit,
       currency, availability, bulk_pricing, best_before, is_active)
    VALUES
      (@id, @crawl_run_id, @crawl_timestamp, @store_id, @product_name, @product_category,
       @product_url, @image_url, @weight_raw, @weight_value, @weight_unit,
       @sale_price, @original_price, @discount_percent, @price_per_kg, @price_per_unit,
       @currency, @availability, @bulk_pricing, @best_before, 1)
  `);

  let changes = 0;
  for (const deal of deals) {
    // eslint-disable-next-line no-await-in-loop
    const result = await insertDeal.run(deal);
    changes += Number(result?.changes || 0);
  }
  return changes;
}

function buildNormalizedScrapedDeals(rawDeals, storeId, runId, crawlTimestamp) {
  const seenProductUrls = new Set();

  return (Array.isArray(rawDeals) ? rawDeals : [])
    .map((deal) => ({
      id: uuidv4(),
      crawl_run_id: runId,
      crawl_timestamp: crawlTimestamp,
      store_id: storeId,
      product_name: normalizeText(deal.product_name),
      product_category: normalizeText(deal.product_category) || "Other",
      product_url: normalizeText(deal.product_url),
      image_url: normalizeText(deal.image_url),
      weight_raw: normalizeText(deal.weight_raw),
      weight_value: normalizeNumber(deal.weight_value),
      weight_unit: normalizeText(deal.weight_unit),
      sale_price: normalizeNumber(deal.sale_price),
      original_price: normalizeNumber(deal.original_price),
      discount_percent: normalizeNumber(deal.discount_percent),
      price_per_kg: normalizeNumber(deal.price_per_kg),
      price_per_unit: normalizeNumber(deal.price_per_unit),
      currency: normalizeText(deal.currency) || "EUR",
      availability: normalizeText(deal.availability) || "unknown",
      bulk_pricing: normalizeBulkPricing(deal.bulk_pricing),
      best_before:
        normalizeText(parseBestBefore(deal.product_name)) ||
        normalizeText(deal.best_before),
    }))
    .filter((deal) => {
      if (!deal.product_name || !deal.product_url || deal.sale_price == null) {
        return false;
      }
      if (seenProductUrls.has(deal.product_url)) return false;
      seenProductUrls.add(deal.product_url);
      return true;
    });
}

async function reconcileStoreDeals(db, storeId, scrapedDeals) {
  const existingRows = await fetchActiveDealsForStore(db, storeId);
  const existingByUrl = new Map();

  for (const row of existingRows) {
    const productUrl = normalizeText(row.product_url);
    if (!productUrl || existingByUrl.has(productUrl)) continue;
    existingByUrl.set(productUrl, row);
  }

  const seenUrls = new Set();
  const inserts = [];
  const deactivateIds = [];
  const stats = {
    scraped: scrapedDeals.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    removed: 0,
  };

  for (const scraped of scrapedDeals) {
    const productUrl = normalizeText(scraped.product_url);
    if (!productUrl) continue;
    seenUrls.add(productUrl);

    const existing = existingByUrl.get(productUrl);
    if (!existing) {
      inserts.push(scraped);
      stats.inserted += 1;
      continue;
    }

    if (dealsEqual(existing, scraped)) {
      stats.unchanged += 1;
      continue;
    }

    deactivateIds.push(existing.id);
    inserts.push(scraped);
    stats.updated += 1;
  }

  for (const row of existingRows) {
    const productUrl = normalizeText(row.product_url);
    if (!productUrl || seenUrls.has(productUrl)) continue;
    deactivateIds.push(row.id);
    stats.removed += 1;
  }

  await markDealsInactive(db, deactivateIds);
  await insertDeals(db, inserts);
  return stats;
}

async function ensureTodayPoolAfterCrawl(db) {
  if (getBerlinHour(new Date()) < 7) return null;

  const poolDate = getCurrentPoolDate();
  const existingPool = await db
    .prepare(
      `SELECT pool_date
       FROM daily_deal_pool_entries
       WHERE pool_date = ?
       LIMIT 1`,
    )
    .get(poolDate);

  if (existingPool?.pool_date) {
    return {
      poolDate,
      reused: true,
    };
  }

  const pool = await ensureDailyDealsPool(db, { poolDate });
  return {
    poolDate: pool.poolDate,
    entries: pool.entries.length,
    reused: false,
  };
}

async function runCrawl(db) {
  const runId = uuidv4();
  const lock = await acquireCrawlLock(db, { ownerId: runId });
  if (!lock.acquired) {
    console.log("[crawl] Another crawl is already running — skipping.");
    return { skipped: true, reason: "lock" };
  }

  const startedAt = new Date().toISOString();
  console.log(`\n=== Crawl run ${runId} started at ${startedAt} ===`);

  try {
    await db.prepare(
      `INSERT INTO crawl_runs (id, started_at, status)
       VALUES (?, ?, 'running')`,
    ).run(runId, startedAt);

    let storesAttempted = 0;
    let storesSucceeded = 0;
    let dealsFound = 0;
    const errors = [];

    for (const adapter of adapters) {
      storesAttempted += 1;
      console.log(`\n--- Crawling: ${adapter.storeName} ---`);

      try {
        const rawDeals = await adapter.scrape();
        const crawlTimestamp = new Date().toISOString();
        const deals = buildNormalizedScrapedDeals(
          rawDeals,
          adapter.storeId,
          runId,
          crawlTimestamp,
        );
        const stats = await reconcileStoreDeals(db, adapter.storeId, deals);

        await db.prepare(
          `UPDATE stores
           SET last_crawled_at = ?, crawl_status = 'active'
           WHERE id = ?`,
        ).run(crawlTimestamp, adapter.storeId);

        dealsFound += deals.length;
        storesSucceeded += 1;
        console.log(
          `✓ ${adapter.storeName}: ${deals.length} scraped (${stats.inserted} new, ${stats.updated} changed, ${stats.unchanged} unchanged, ${stats.removed} removed)`,
        );
      } catch (error) {
        console.error(`✗ ${adapter.storeName}: ${error.message}`);
        errors.push({
          store_id: adapter.storeId,
          error_message: error.message,
        });

        await db.prepare(
          `UPDATE stores
           SET crawl_status = 'error'
           WHERE id = ?`,
        ).run(adapter.storeId);
      }

      if (adapters.indexOf(adapter) < adapters.length - 1) {
        await randomDelay();
      }
    }

    const finishedAt = new Date().toISOString();
    await db.prepare(
      `UPDATE crawl_runs
       SET finished_at = ?,
           status = 'completed',
           stores_attempted = ?,
           stores_succeeded = ?,
           deals_found = ?,
           errors = ?
       WHERE id = ?`,
    ).run(
      finishedAt,
      storesAttempted,
      storesSucceeded,
      dealsFound,
      JSON.stringify(errors),
      runId,
    );

    const dailyPool = await ensureTodayPoolAfterCrawl(db).catch((error) => {
      console.error("[crawl] Daily pool refresh error:", error.message);
      return null;
    });

    console.log(
      `\n=== Crawl finished: ${storesSucceeded}/${storesAttempted} stores, ${dealsFound} deals ===`,
    );
    if (dailyPool?.reused) {
      console.log(`[crawl] Daily pool already fixed for ${dailyPool.poolDate}.`);
    } else if (dailyPool?.poolDate) {
      console.log(
        `[crawl] Daily pool ready for ${dailyPool.poolDate} (${dailyPool.entries} deals).`,
      );
    }

    return {
      runId,
      storesAttempted,
      storesSucceeded,
      dealsFound,
      errors,
      dailyPool,
    };
  } finally {
    await releaseCrawlLock(db, { ownerId: runId });
  }
}

if (require.main === module) {
  const db = require("../server/db");
  runCrawl(db)
    .then((result) => {
      console.log("Done:", result);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  runCrawl,
  adapters,
};
