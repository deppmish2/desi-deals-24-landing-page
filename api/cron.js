"use strict";

/**
 * Vercel Cron — daily pool refresh (equivalent to scripts/rebuild-pool-today.js).
 * Runs the same logic regardless of hour — idempotent guard prevents double-runs.
 * Crawl is handled separately (GitHub Actions) due to Hobby's 60s function limit.
 */

const db = require("../server/db");
const {
  ensureDailyDealsPool,
  getCurrentPoolDate,
} = require("../server/services/daily-deals-pool");
const { formatBerlinDateKey, getBerlinHour } = require("../server/services/berlin-time");

const MIN_DISCOUNT = Number(process.env.DAILY_POOL_MIN_DISCOUNT_PCT || 20);
const TARGET = 24;

async function getPoolCountForDate(dateKey) {
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM daily_deal_pool_entries WHERE pool_date = ?`)
    .get(dateKey);
  return Number(row?.cnt || 0);
}

module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  try {
    await db.ready;
    const now = new Date();
    const berlinDate = formatBerlinDateKey(now);
    const berlinHour = getBerlinHour(now);

    // Idempotent: skip if today's pool is already fully generated
    const existingCount = await getPoolCountForDate(berlinDate);
    if (existingCount >= TARGET) {
      return res.json({
        ok: true,
        berlin_date: berlinDate,
        berlin_hour: berlinHour,
        daily_pool: { skipped: true, reason: "already_generated", entries: existingCount },
      });
    }

    // Remove any existing incomplete/bad entries for today and regenerate fresh
    await db.prepare(`DELETE FROM daily_deal_pool_entries WHERE pool_date = ?`).run(berlinDate);
    const pool = await ensureDailyDealsPool(db, { poolDate: berlinDate });

    res.json({
      ok: true,
      berlin_date: berlinDate,
      berlin_hour: berlinHour,
      daily_pool: {
        generated: true,
        pool_date: pool.poolDate,
        entries: pool.entries.length,
        min_discount_pct: MIN_DISCOUNT,
      },
    });
  } catch (e) {
    console.error("[cron] pool refresh error:", e);
    res.status(500).json({ error: e.message });
  }
};
