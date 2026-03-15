"use strict";
/**
 * One-time script: delete today's pool and regenerate it with URL validation.
 * Run: node scripts/fix-pool-today.js
 */
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { ensureDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

(async () => {
  await db.ready;

  const poolDate = getCurrentPoolDate();
  console.log(`[fix-pool] Deleting pool for ${poolDate} and regenerating…`);

  await db.prepare(
    `DELETE FROM daily_deal_pool_entries WHERE pool_date = ?`,
  ).run(poolDate);

  console.log("[fix-pool] Pool entries deleted. Regenerating with URL checks…");

  const result = await ensureDailyDealsPool(db, { poolDate, allowGenerate: true });

  console.log(`[fix-pool] Done. Pool now has ${result.entries.length} entries for ${result.poolDate}.`);
  process.exit(0);
})().catch((err) => {
  console.error("[fix-pool] Error:", err);
  process.exit(1);
});
