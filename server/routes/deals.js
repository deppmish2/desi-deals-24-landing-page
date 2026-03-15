"use strict";

const express = require("express");

const db = require("../db");
const { isCrawlLocked } = require("../../crawler/utils/snapshot");
const { restoreDealsFromSeed } = require("../services/deals-seed-loader");
const { trackEvent } = require("../services/event-tracker");
const {
  DAILY_POOL_LIMIT,
  getCurrentPoolDate,
  getDailyDealsPool,
} = require("../services/daily-deals-pool");

const router = express.Router();

function seedFallbackAllowed() {
  return !String(process.env.TURSO_DATABASE_URL || "").trim();
}

function fixedPoolReadOnlyRuntime() {
  return Boolean(
    String(process.env.VERCEL || "").trim() ||
      String(process.env.TURSO_DATABASE_URL || "").trim(),
  );
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

async function ensureDealsAvailable() {
  const activeCount = Number(
    (await db
      .prepare("SELECT COUNT(*) AS cnt FROM deals WHERE is_active = 1")
      .get())?.cnt || 0,
  );
  if (activeCount > 0) return;
  if (!seedFallbackAllowed()) return;
  await restoreDealsFromSeed(db);
}

async function buildMeta(curatedSeed, curatedMeta) {
  const lastCrawl = await db
    .prepare(
      `SELECT finished_at
       FROM crawl_runs
       WHERE status = 'completed'
       ORDER BY finished_at DESC
       LIMIT 1`,
    )
    .get();

  const activeStores = Number(
    (await db
      .prepare(`SELECT COUNT(*) AS cnt FROM stores WHERE crawl_status = 'active'`)
      .get())?.cnt || 0,
  );

  const localCrawling = Number(
    (await db
      .prepare(`SELECT COUNT(*) AS cnt FROM crawl_runs WHERE status = 'running'`)
      .get())?.cnt || 0,
  ) > 0;
  const globalCrawling = await isCrawlLocked(db).catch(() => false);

  return {
    last_crawl: lastCrawl?.finished_at || null,
    active_stores: activeStores,
    crawling: localCrawling || globalCrawling,
    curated: {
      mode: "daily_live_pool",
      seed: curatedSeed,
      ...curatedMeta,
    },
  };
}

router.get("/", async (req, res, next) => {
  const startedAt = Date.now();

  try {
    await ensureDealsAvailable();

    const pageNum = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limitNum = Math.max(
      1,
      Math.min(DAILY_POOL_LIMIT, parseInt(req.query.limit || "24", 10) || 24),
    );
    const offset = (pageNum - 1) * limitNum;
    const curatedSeed = String(req.query.seed || "").trim() || getCurrentPoolDate();

    const pool = await getDailyDealsPool(db, {
      poolDate: curatedSeed,
      limit: DAILY_POOL_LIMIT,
      allowGenerate: !fixedPoolReadOnlyRuntime(),
    });
    const pageRows = pool.rows.slice(offset, offset + limitNum);
    const data = pageRows.map(serializeDeal);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: pool.rows.length,
        total_pages: Math.max(1, Math.ceil(pool.rows.length / limitNum)),
      },
      meta: await buildMeta(curatedSeed, pool.meta),
    });

    trackEvent(db, "browse.deals24", {
      route: req.originalUrl,
      payload: {
        duration_ms: Date.now() - startedAt,
        result_count: data.length,
        page: pageNum,
        limit: limitNum,
        curated_mode: "daily_live_pool",
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
