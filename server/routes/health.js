"use strict";

/**
 * Health endpoints for ops monitoring.
 *
 * GET /api/v1/health        — public, minimal, used by UptimeRobot / load balancers
 * GET /api/v1/health/detail — admin auth, full crawl + pool + DB latency diagnostics
 *
 * The public endpoint intentionally exposes no sensitive data and is fast:
 * it runs two cheap COUNT queries and returns within ~20ms.
 */

const { Router } = require("express");
const db = require("../db");
const requireAuth = require("../middleware/auth");
const { isCrawlLocked } = require("../../crawler/utils/snapshot");
const { getCurrentPoolDate } = require("../services/daily-deals-pool");
const { latestJobRun } = require("../services/job-runs");
const { kvConfigured } = require("../services/pool-kv-cache");

const router = Router();

const MIN_POOL_SIZE = parseInt(process.env.HEALTH_MIN_POOL_SIZE || "18", 10);
const STALE_CRAWL_HOURS = parseInt(process.env.HEALTH_STALE_CRAWL_HOURS || "26", 10);

function hoursSince(isoTs) {
  if (!isoTs) return null;
  const ts = Date.parse(isoTs);
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / (60 * 60 * 1000);
}

async function gatherHealthData() {
  const startMs = Date.now();

  const [
    lastCrawlRow,
    activeDealsRow,
    poolRow,
    crawlingRow,
  ] = await Promise.all([
    db.prepare(
      `SELECT finished_at, stores_succeeded, stores_attempted, deals_found, status
       FROM crawl_runs
       ORDER BY started_at DESC
       LIMIT 1`,
    ).get(),
    db.prepare(`SELECT COUNT(*) AS cnt FROM deals WHERE is_active = 1`).get(),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM daily_deal_pool_entries WHERE pool_date = ?`,
    ).get(getCurrentPoolDate()),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM crawl_runs WHERE status = 'running'`,
    ).get(),
  ]);

  const dbLatencyMs = Date.now() - startMs;
  const lastCrawlHoursAgo = hoursSince(lastCrawlRow?.finished_at);
  const poolSize = Number(poolRow?.cnt || 0);
  const activeDeals = Number(activeDealsRow?.cnt || 0);
  const crawling = Number(crawlingRow?.cnt || 0) > 0 || await isCrawlLocked(db).catch(() => false);

  const crawlFresh = lastCrawlHoursAgo !== null && lastCrawlHoursAgo <= STALE_CRAWL_HOURS;
  const poolHealthy = poolSize >= MIN_POOL_SIZE;
  const hasDeals = activeDeals > 0;

  const status = (crawlFresh || crawling) && poolHealthy && hasDeals ? "ok" : "degraded";

  return {
    status,
    db_latency_ms: dbLatencyMs,
    crawl: {
      last_finished_at: lastCrawlRow?.finished_at || null,
      hours_ago: lastCrawlHoursAgo !== null
        ? Math.round(lastCrawlHoursAgo * 10) / 10
        : null,
      fresh: crawlFresh,
      stale_threshold_hours: STALE_CRAWL_HOURS,
      running: crawling,
      last_status: lastCrawlRow?.status || null,
    },
    pool: {
      date: getCurrentPoolDate(),
      size: poolSize,
      healthy: poolHealthy,
      min_expected: MIN_POOL_SIZE,
    },
    deals: {
      active_count: activeDeals,
    },
    cache: {
      kv_configured: kvConfigured(),
    },
  };
}

// ── Public health endpoint (no auth) ─────────────────────────────────────────
// Used by UptimeRobot, load balancers, and the GitHub Actions verify step.
// Returns 200 + { status: "ok" } when healthy, 200 + { status: "degraded" } otherwise.
// We always return 200 so UptimeRobot uses keyword monitoring ("ok") rather than
// status code monitoring — avoids false alarms during brief degraded windows.
router.get("/", async (_req, res) => {
  try {
    const data = await gatherHealthData();
    res.set("Cache-Control", "no-store");
    res.json({
      status: data.status,
      pool_size: data.pool.size,
      last_crawl_hours_ago: data.crawl.hours_ago,
      crawling: data.crawl.running,
      db_latency_ms: data.db_latency_ms,
    });
  } catch (err) {
    console.error("[health] Error:", err.message);
    res.json({ status: "error", error: err.message });
  }
});

// ── Detailed health (admin auth) ──────────────────────────────────────────────
router.get("/detail", requireAuth, async (_req, res) => {
  try {
    const data = await gatherHealthData();

    const [recentRuns, latestCrawlJob, latestPoolJob, latestVerifyJob] =
      await Promise.all([
        db.prepare(
          `SELECT id, started_at, finished_at, status,
                  stores_attempted, stores_succeeded, deals_found,
                  json(errors) AS errors
           FROM crawl_runs
           ORDER BY started_at DESC
           LIMIT 7`,
        ).all(),
        latestJobRun(db, "full_crawl"),
        latestJobRun(db, "daily_pool_refresh"),
        latestJobRun(db, "daily_pool_verify"),
      ]);

    res.set("Cache-Control", "no-store");
    res.json({
      ...data,
      jobs: {
        full_crawl: latestCrawlJob,
        daily_pool_refresh: latestPoolJob,
        daily_pool_verify: latestVerifyJob,
      },
      recent_crawl_runs: recentRuns.map((run) => ({
        id: run.id,
        started_at: run.started_at,
        finished_at: run.finished_at,
        status: run.status,
        stores_attempted: run.stores_attempted,
        stores_succeeded: run.stores_succeeded,
        deals_found: run.deals_found,
        success_rate_pct: run.stores_attempted
          ? Math.round((run.stores_succeeded / run.stores_attempted) * 1000) / 10
          : null,
        errors: run.errors ? JSON.parse(run.errors) : [],
        flagged: run.stores_attempted &&
          run.stores_succeeded / run.stores_attempted < 0.7,
      })),
    });
  } catch (err) {
    console.error("[health] detail error:", err.message);
    res.status(500).json({ status: "error", error: err.message });
  }
});

module.exports = router;
