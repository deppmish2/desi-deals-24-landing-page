"use strict";

/**
 * Invalidate the Vercel KV cache entry for today's deal pool.
 *
 * Called from the GitHub Actions crawl workflow after the pool has been rebuilt.
 * Ensures the next API request to /api/v1/deals reads fresh data from the DB
 * rather than serving yesterday's cached pool.
 *
 * Exits 0 on success or when KV is not configured.
 * Exits 1 only on hard failure — use `continue-on-error: true` in the workflow
 * if you don't want this to block the deploy.
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { deletePoolFromKv, kvConfigured } = require("../server/services/pool-kv-cache");
const { getCurrentPoolDate } = require("../server/services/daily-deals-pool");

async function main() {
  if (!kvConfigured()) {
    console.log("[invalidate-kv] KV not configured — nothing to invalidate.");
    process.exit(0);
  }

  const poolDate = getCurrentPoolDate();
  console.log(`[invalidate-kv] Invalidating KV cache for pool date: ${poolDate}`);

  const deleted = await deletePoolFromKv(poolDate);

  if (deleted) {
    console.log("[invalidate-kv] Done. Next API request will re-read from DB.");
  } else {
    console.log("[invalidate-kv] Key was not present (already expired or not set).");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[invalidate-kv] Fatal error:", err.message);
  process.exit(1);
});
