"use strict";

const db = require("../server/db");
const { runCrawl } = require("../crawler");
const { isCrawlLocked } = require("../crawler/utils/snapshot");
const {
  ensureDailyDealsPool,
} = require("../server/services/daily-deals-pool");
const {
  formatBerlinDateKey,
  getBerlinHour,
  getBerlinUtcIso,
} = require("../server/services/berlin-time");

async function latestCompletedCrawlForDate(dateKey) {
  return await db
    .prepare(
      `SELECT id, started_at, finished_at
       FROM crawl_runs
       WHERE status = 'completed'
         AND finished_at >= ?
       ORDER BY finished_at DESC
       LIMIT 1`,
    )
    .get(getBerlinUtcIso(dateKey, 6, 0, 0));
}

async function hasPoolForDate(dateKey) {
  const row = await db
    .prepare(
      `SELECT pool_date
       FROM daily_deal_pool_entries
       WHERE pool_date = ?
       LIMIT 1`,
    )
    .get(dateKey);
  return Boolean(row?.pool_date);
}

// Called by Vercel Cron — verified via CRON_SECRET (auto-set by Vercel)
module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  try {
    const now = new Date();
    const berlinDate = formatBerlinDateKey(now);
    const berlinHour = getBerlinHour(now);
    const actions = {};

    if (berlinHour >= 6) {
      const completedCrawl = await latestCompletedCrawlForDate(berlinDate);
      if (completedCrawl) {
        actions.crawl = {
          skipped: true,
          reason: "already_completed_today",
          finished_at: completedCrawl.finished_at,
        };
      } else {
        actions.crawl = await runCrawl(db);
      }
    } else {
      actions.crawl = {
        skipped: true,
        reason: "before_06_berlin",
      };
    }

    if (berlinHour >= 7) {
      const poolExists = await hasPoolForDate(berlinDate);
      if (poolExists) {
        actions.daily_pool = {
          skipped: true,
          reason: "already_generated_today",
          pool_date: berlinDate,
        };
      } else {
        const crawling = await isCrawlLocked(db).catch(() => false);
        if (crawling) {
          actions.daily_pool = {
            skipped: true,
            reason: "crawl_running",
            pool_date: berlinDate,
          };
        } else {
          const pool = await ensureDailyDealsPool(db, {
            poolDate: berlinDate,
          });
          actions.daily_pool = {
            pool_date: pool.poolDate,
            entries: pool.entries.length,
            requested_pool_date: pool.requestedPoolDate,
          };
        }
      }
    } else {
      actions.daily_pool = {
        skipped: true,
        reason: "before_07_berlin",
        pool_date: berlinDate,
      };
    }

    res.json({
      ok: true,
      berlin_date: berlinDate,
      berlin_hour: berlinHour,
      actions,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
