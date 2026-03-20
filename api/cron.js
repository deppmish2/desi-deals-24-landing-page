"use strict";

/**
 * Manual / fallback pool refresh endpoint.
 *
 * The primary production scheduler lives in `.github/workflows/daily-pipeline.yml`.
 * This handler remains available for manual recovery or one-off fallback runs.
 */

const db = require("../server/db");
const {
  ensureDailyDealsPool,
  getCurrentPoolDate,
} = require("../server/services/daily-deals-pool");
const { formatBerlinDateKey, getBerlinHour } = require("../server/services/berlin-time");
const {
  finishJobRun,
  startJobRun,
} = require("../server/services/job-runs");

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

  await db.ready;
  const jobRun = await startJobRun(db, {
    jobName: "daily_pool_refresh",
    triggerType: "vercel_cron",
  });

  try {
    const now = new Date();
    const berlinDate = formatBerlinDateKey(now);
    const berlinHour = getBerlinHour(now);

    // Idempotent: skip if today's pool is already fully generated
    const existingCount = await getPoolCountForDate(berlinDate);
    if (existingCount >= TARGET) {
      await finishJobRun(db, jobRun, {
        status: "skipped",
        itemCount: existingCount,
        details: {
          berlin_date: berlinDate,
          berlin_hour: berlinHour,
          reason: "already_generated",
        },
      });
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
    const warningCount = pool.entries.length < TARGET ? 1 : 0;

    await finishJobRun(db, jobRun, {
      status: warningCount > 0 ? "completed_with_warnings" : "completed",
      itemCount: pool.entries.length,
      warningCount,
      details: {
        berlin_date: berlinDate,
        berlin_hour: berlinHour,
        min_discount_pct: MIN_DISCOUNT,
        target_entries: TARGET,
        pool_date: pool.poolDate,
      },
    });

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
    await finishJobRun(db, jobRun, {
      status: "failed",
      errorMessage: e.message,
    });
    console.error("[cron] pool refresh error:", e);
    res.status(500).json({ error: e.message });
  }
};
