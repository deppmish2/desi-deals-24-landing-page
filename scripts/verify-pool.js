"use strict";

/**
 * Verify that today's daily deal pool meets the minimum quality bar.
 *
 * Called as the final step in the GitHub Actions crawl workflow.
 * Exits 0 on pass, exits 1 on failure (which marks the GH Actions step failed
 * and triggers the downstream failure notification step).
 *
 * Checks:
 *   - Pool size >= MIN_POOL_SIZE (default 18 — allows partial crawl success)
 *   - Pool has deals from >= MIN_STORES distinct stores (default 5)
 *   - At least one deal has discount >= MIN_DISCOUNT
 *
 * These are deliberately lenient: a crawl that hits 80% of stores is still
 * a success. We alert but don't fail on partial results.
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { getCurrentPoolDate } = require("../server/services/daily-deals-pool");
const { notifyThinPool } = require("../server/services/ops-notifier");

const MIN_POOL_SIZE = parseInt(process.env.VERIFY_MIN_POOL_SIZE || process.env.HEALTH_MIN_POOL_SIZE || "18", 10);
const MIN_STORES = parseInt(process.env.VERIFY_MIN_STORES || "5", 10);
const MIN_DISCOUNT = Number(process.env.DAILY_POOL_MIN_DISCOUNT_PCT || 20);

db.ready
  .then(async () => {
    const poolDate = getCurrentPoolDate();
    console.log(`[verify-pool] Checking pool for ${poolDate}...`);

    // Count pool entries
    const poolCountRow = await db.prepare(
      `SELECT COUNT(*) AS cnt FROM daily_deal_pool_entries WHERE pool_date = ?`,
    ).get(poolDate);
    const poolSize = Number(poolCountRow?.cnt || 0);

    // Count distinct stores in pool
    const storeCountRow = await db.prepare(
      `SELECT COUNT(DISTINCT store_id) AS cnt
       FROM daily_deal_pool_entries
       WHERE pool_date = ?`,
    ).get(poolDate);
    const storeCount = Number(storeCountRow?.cnt || 0);

    // Check at least one deal with sufficient discount exists
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

    const pass = poolSize >= MIN_POOL_SIZE && storeCount >= MIN_STORES && dealsWithDiscount > 0;

    if (!pass) {
      console.error(
        `[verify-pool] FAILED — pool does not meet quality bar for ${poolDate}`,
      );

      // Fire-and-forget ops notification (don't let it block exit code)
      notifyThinPool({ poolDate, poolSize, minExpected: MIN_POOL_SIZE }).catch((err) =>
        console.warn("[verify-pool] Notification failed:", err.message),
      );

      // Give notification a moment to send before exiting
      await new Promise((r) => setTimeout(r, 3000));

      process.exit(1);
    }

    console.log(`[verify-pool] PASSED — pool is healthy for ${poolDate}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error("[verify-pool] Fatal error:", err.message);
    process.exit(1);
  });
