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

// In-memory pool cache — safe because the daily pool is fixed until midnight Berlin.
// On warm instances this trims repeated Turso reads, while Turso remains the only
// persistent backing store.
const MEM_CACHE_TTL_MS = 5 * 60 * 1000;
const _memCache = new Map(); // key → { pool, expiresAt }

function getMemCache(key) {
  const entry = _memCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    _memCache.delete(key);
    return null;
  }
  return entry.pool;
}

function setMemCache(key, pool) {
  _memCache.set(key, { pool, expiresAt: Date.now() + MEM_CACHE_TTL_MS });
}

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
  // In Turso/Vercel mode the seed fallback can never fire — skip the round-trip.
  if (!seedFallbackAllowed()) return;
  const activeCount = Number(
    (await db
      .prepare("SELECT COUNT(*) AS cnt FROM deals WHERE is_active = 1")
      .get())?.cnt || 0,
  );
  if (activeCount === 0) await restoreDealsFromSeed(db);
}

router.get("/", async (req, res, next) => {
  const startedAt = Date.now();

  try {
    // Only needed in local SQLite mode — no-op in Turso/Vercel.
    await ensureDealsAvailable();

    const pageNum = Math.max(1, parseInt(req.query.page || "1", 10) || 1);
    const limitNum = Math.max(
      1,
      Math.min(DAILY_POOL_LIMIT, parseInt(req.query.limit || "24", 10) || 24),
    );
    const offset = (pageNum - 1) * limitNum;
    const curatedSeed = String(req.query.seed || "").trim() || getCurrentPoolDate();
    const isToday = curatedSeed === getCurrentPoolDate();

    // ── Cache fast path (memory → Turso) ─────────────────────────────────────
    // Memory: sub-millisecond, survives within same warm serverless instance.
    // Turso:  persistent source of truth for fixed daily pools.
    let pool = null;
    let cacheHit = false;
    if (pageNum === 1 && isToday) {
      pool = getMemCache(curatedSeed);
      if (!pool) {
        cacheHit = false;
      } else {
        cacheHit = true;
      }
    }

    // ── DB path — pool + meta queries fire in parallel ────────────────────────
    // Previously: pool fetch → 4 sequential meta queries = ~600ms wasted waiting.
    // Now: all 5 DB operations run concurrently, total latency = slowest single query.
    if (!pool) {
      const [
        freshPool,
        lastCrawlRow,
        activeStoresRow,
        localCrawlingRow,
        globalCrawling,
      ] = await Promise.all([
        getDailyDealsPool(db, {
          poolDate: curatedSeed,
          limit: DAILY_POOL_LIMIT,
          allowGenerate: !fixedPoolReadOnlyRuntime(),
        }),
        db.prepare(
          `SELECT finished_at FROM crawl_runs
           WHERE status = 'completed'
           ORDER BY finished_at DESC LIMIT 1`,
        ).get(),
        db.prepare(
          `SELECT COUNT(*) AS cnt FROM stores WHERE crawl_status = 'active'`,
        ).get(),
        db.prepare(
          `SELECT COUNT(*) AS cnt FROM crawl_runs WHERE status = 'running'`,
        ).get(),
        isCrawlLocked(db).catch(() => false),
      ]);

      pool = freshPool;
      pool._meta_ext = {
        last_crawl: lastCrawlRow?.finished_at || null,
        active_stores: Number(activeStoresRow?.cnt || 0),
        crawling: Number(localCrawlingRow?.cnt || 0) > 0 || globalCrawling,
      };

      // Populate memory so subsequent warm-instance requests are instant.
      if (isToday && pool.rows.length > 0) {
        setMemCache(curatedSeed, pool);
      }
    }

    // On memory hit the meta extension wasn't fetched — do it now.
    if (!pool._meta_ext) {
      const [lastCrawlRow, activeStoresRow, localCrawlingRow, globalCrawling] =
        await Promise.all([
          db.prepare(
            `SELECT finished_at FROM crawl_runs
             WHERE status = 'completed'
             ORDER BY finished_at DESC LIMIT 1`,
          ).get(),
          db.prepare(
            `SELECT COUNT(*) AS cnt FROM stores WHERE crawl_status = 'active'`,
          ).get(),
          db.prepare(
            `SELECT COUNT(*) AS cnt FROM crawl_runs WHERE status = 'running'`,
          ).get(),
          isCrawlLocked(db).catch(() => false),
        ]);
      pool._meta_ext = {
        last_crawl: lastCrawlRow?.finished_at || null,
        active_stores: Number(activeStoresRow?.cnt || 0),
        crawling: Number(localCrawlingRow?.cnt || 0) > 0 || globalCrawling,
      };
    }

    const pageRows = pool.rows.slice(offset, offset + limitNum);
    const data = pageRows.map(serializeDeal);

    // CDN caches for 5 min; serves stale up to 1h while revalidating.
    res.set("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: pool.rows.length,
        total_pages: Math.max(1, Math.ceil(pool.rows.length / limitNum)),
      },
      meta: {
        last_crawl: pool._meta_ext.last_crawl,
        active_stores: pool._meta_ext.active_stores,
        crawling: pool._meta_ext.crawling,
        curated: {
          mode: "daily_live_pool",
          seed: curatedSeed,
          ...pool.meta,
        },
      },
    });

    trackEvent(db, "browse.deals24", {
      route: req.originalUrl,
      payload: {
        duration_ms: Date.now() - startedAt,
        result_count: data.length,
        page: pageNum,
        limit: limitNum,
        curated_mode: "daily_live_pool",
        cache: cacheHit ? "memory_hit" : "db_read",
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
