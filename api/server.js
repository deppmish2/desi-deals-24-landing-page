"use strict";
const path = require("path");
const app = require("../server/index");
const db = require("../server/db");
const { runCrawl } = require("../crawler");
const {
  restoreFromSnapshot,
  isCrawlLocked,
} = require("../crawler/utils/snapshot");
const INITIAL_DATA_RETRY_MS = parseInt(
  process.env.INITIAL_DATA_RETRY_MS || "30000",
);
const INITIAL_DATA_MAX_ATTEMPTS = parseInt(
  process.env.INITIAL_DATA_MAX_ATTEMPTS || "40",
);
const isServerless = Boolean(process.env.VERCEL);

// ── Seed file loader (deals baked in at build time) ───────────────────────────
function loadFromSeedFile() {
  try {
    // require() is traced by Vercel's bundler — file is included in deployment.
    // eslint-disable-next-line import/no-unresolved
    const deals = require("../server/deals-seed.json");
    if (!Array.isArray(deals) || deals.length === 0) return false;

    const insert = db.prepare(`
      INSERT OR IGNORE INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
         product_url, image_url, weight_raw, weight_value, weight_unit,
         sale_price, original_price, discount_percent, price_per_kg, price_per_unit,
         currency, availability, bulk_pricing, best_before, is_active, created_at)
      VALUES
        (@id, @crawl_run_id, @crawl_timestamp, @store_id, @product_name, @product_category,
         @product_url, @image_url, @weight_raw, @weight_value, @weight_unit,
         @sale_price, @original_price, @discount_percent, @price_per_kg, @price_per_unit,
         @currency, @availability, @bulk_pricing, @best_before, @is_active, @created_at)
    `);

    db.transaction((items) => {
      for (const d of items) insert.run(d);
    })(deals);

    console.log(
      `[cold-start] Loaded ${deals.length} deals from build-time seed file`,
    );
    return true;
  } catch {
    return false;
  }
}

// ── Cold-start hydration ──────────────────────────────────────────────────────
// Priority order (fastest → freshest):
//   1. Redis snapshot  — persisted from last crawl, restored in ~1s
//   2. Build-time seed — baked into deployment, instant, always available
//   3. Background crawl — last resort, takes minutes
// Module-level code runs once per container instance (not per request).
function activeDealsCount() {
  return db.prepare("SELECT COUNT(*) as n FROM deals WHERE is_active = 1").get()
    .n;
}

async function ensureInitialData(attempt = 1) {
  if (activeDealsCount() > 0) return true;

  // Another container might have finished and saved data while we were waiting.
  const restored = await restoreFromSnapshot(db).catch(() => false);
  if (restored || activeDealsCount() > 0) return true;

  // Try to crawl ourselves. If lock is held, runCrawl returns skipped(lock).
  const result = await runCrawl(db).catch((e) => {
    console.error("[cold-start] Crawl error:", e.message);
    return null;
  });

  if (activeDealsCount() > 0) return true;

  const skippedForLock = result?.skipped && result.reason === "lock";
  if ((skippedForLock || !result) && attempt < INITIAL_DATA_MAX_ATTEMPTS) {
    console.log(
      `[cold-start] No data yet (attempt ${attempt}/${INITIAL_DATA_MAX_ATTEMPTS}); retrying in ${INITIAL_DATA_RETRY_MS}ms...`,
    );
    setTimeout(() => {
      ensureInitialData(attempt + 1).catch((e) =>
        console.error("[cold-start] Retry error:", e.message),
      );
    }, INITIAL_DATA_RETRY_MS);
    return false;
  }

  if (activeDealsCount() === 0) {
    console.warn("[cold-start] Initial data still empty after retries.");
  }
  return activeDealsCount() > 0;
}

const n = activeDealsCount();
if (n === 0) {
  console.log("[cold-start] No deals in DB — restoring...");

  restoreFromSnapshot(db)
    .then(async (restored) => {
      if (restored) return; // Redis snapshot loaded — done

      // Fall back to the seed file built into the deployment
      if (loadFromSeedFile()) return;

      // On Vercel, avoid startup crawl fan-out. Data is expected from Redis snapshot
      // and/or the scheduled daily cron crawl.
      if (isServerless) {
        console.warn(
          "[cold-start] Snapshot/seed not available on Vercel — skipping startup crawl. Waiting for scheduled /api/cron run.",
        );
        return;
      }

      // First-time/empty system: keep retrying until one crawl completes and data exists.
      const locked = await isCrawlLocked().catch(() => false);
      if (locked) {
        console.log(
          "[cold-start] Another container is crawling — waiting/retrying until data is available.",
        );
      } else {
        console.log(
          "[cold-start] No data anywhere — starting background crawl...",
        );
      }
      ensureInitialData().catch((e) =>
        console.error("[cold-start] Initial data error:", e.message),
      );
    })
    .catch((e) => {
      // Redis error — still try seed then crawl
      console.error("[cold-start] Snapshot error:", e.message);
      if (!loadFromSeedFile()) {
        if (isServerless) {
          console.warn(
            "[cold-start] Snapshot restore failed on Vercel — skipping startup crawl. Waiting for scheduled /api/cron run.",
          );
          return;
        }
        ensureInitialData().catch((e2) =>
          console.error("[cold-start] Initial data error:", e2.message),
        );
      }
    });
}

// ── Startup crawl ────────────────────────────────────────────────────────────
// Always attempt a background crawl on container startup so data stays fresh.
// Distributed Redis lock in runCrawl() prevents duplicate concurrent runs.
const startupCrawlEnabled = process.env.CRAWL_ON_STARTUP !== "false";
if (startupCrawlEnabled && !isServerless) {
  const delayMs = parseInt(process.env.STARTUP_CRAWL_DELAY_MS || "8000");
  console.log(`[startup-crawl] Scheduled in ${delayMs}ms`);
  setTimeout(() => {
    runCrawl(db).catch((e) =>
      console.error("[startup-crawl] Crawl error:", e.message),
    );
  }, delayMs);
} else if (startupCrawlEnabled && isServerless) {
  console.log(
    "[startup-crawl] Skipped timer-based startup crawl on Vercel/serverless.",
  );
}

module.exports = app;
