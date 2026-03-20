"use strict";

/**
 * Verify that today's daily deal pool meets the minimum quality bar.
 *
 * Checks:
 *   - Pool size >= MIN_POOL_SIZE (default 18 — allows partial crawl success)
 *   - Pool has deals from >= MIN_STORES distinct stores (default 5)
 *   - At least one deal has discount >= MIN_DISCOUNT
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { getCurrentPoolDate } = require("../server/services/daily-deals-pool");
const {
  finishJobRun,
  startJobRun,
} = require("../server/services/job-runs");
const { notifyThinPool } = require("../server/services/ops-notifier");

const MIN_POOL_SIZE = parseInt(
  process.env.VERIFY_MIN_POOL_SIZE || process.env.HEALTH_MIN_POOL_SIZE || "18",
  10,
);
const MIN_STORES = parseInt(process.env.VERIFY_MIN_STORES || "5", 10);
const MIN_DISCOUNT = Number(process.env.DAILY_POOL_MIN_DISCOUNT_PCT || 20);

async function verifyPoolQuality(options = {}) {
  await db.ready;

  const triggerType =
    String(options.triggerType || process.env.VERIFY_TRIGGER_TYPE || "manual")
      .trim() || "manual";
  const jobRun = await startJobRun(db, {
    jobName: "daily_pool_verify",
    triggerType,
  });

  const poolDate = options.poolDate || getCurrentPoolDate();
  console.log(`[verify-pool] Checking pool for ${poolDate}...`);

  try {
    const poolCountRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM daily_deal_pool_entries WHERE pool_date = ?`,
    ).get(poolDate);
    const poolSize = Number(poolCountRow?.cnt || 0);

    const storeCountRow = await db.prepare(
      `SELECT COUNT(DISTINCT store_id) AS cnt
       FROM daily_deal_pool_entries
       WHERE pool_date = ?`,
    ).get(poolDate);
    const storeCount = Number(storeCountRow?.cnt || 0);

    const discountCheckRow = await db.prepare(
      `SELECT COUNT(*) AS cnt
       FROM daily_deal_pool_entries e
       JOIN deals d ON d.id = e.deal_id
       WHERE e.pool_date = ?
         AND d.discount_percent >= ?`,
    ).get(poolDate, MIN_DISCOUNT);
    const dealsWithDiscount = Number(discountCheckRow?.cnt || 0);

    console.log(`[verify-pool] Pool size:     ${poolSize} (min: ${MIN_POOL_SIZE})`);
    console.log(`[verify-pool] Stores:        ${storeCount} (min: ${MIN_STORES})`);
    console.log(`[verify-pool] With discount: ${dealsWithDiscount}`);

    const pass =
      poolSize >= MIN_POOL_SIZE &&
      storeCount >= MIN_STORES &&
      dealsWithDiscount > 0;

    const details = {
      pool_date: poolDate,
      pool_size: poolSize,
      min_pool_size: MIN_POOL_SIZE,
      distinct_stores: storeCount,
      min_stores: MIN_STORES,
      deals_with_min_discount: dealsWithDiscount,
      min_discount_pct: MIN_DISCOUNT,
    };

    if (!pass) {
      await finishJobRun(db, jobRun, {
        status: "failed",
        itemCount: poolSize,
        details,
        errorMessage: "Pool verification failed",
      });

      notifyThinPool({
        poolDate,
        poolSize,
        minExpected: MIN_POOL_SIZE,
      }).catch((err) =>
        console.warn("[verify-pool] Notification failed:", err.message),
      );

      console.error(
        `[verify-pool] FAILED — pool does not meet quality bar for ${poolDate}`,
      );
      return {
        ok: false,
        poolDate,
        poolSize,
        storeCount,
        dealsWithDiscount,
      };
    }

    await finishJobRun(db, jobRun, {
      status: "completed",
      itemCount: poolSize,
      details,
    });

    console.log(`[verify-pool] PASSED — pool is healthy for ${poolDate}`);
    return {
      ok: true,
      poolDate,
      poolSize,
      storeCount,
      dealsWithDiscount,
    };
  } catch (error) {
    await finishJobRun(db, jobRun, {
      status: "failed",
      errorMessage: error.message,
      details: { pool_date: poolDate },
    });
    throw error;
  }
}

if (require.main === module) {
  verifyPoolQuality()
    .then((result) => {
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error("[verify-pool] Fatal error:", err.message);
      process.exit(1);
    });
}

module.exports = {
  verifyPoolQuality,
};
