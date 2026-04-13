"use strict";

const { Router } = require("express");
const db = require("../db");
const requireAdminAuth = require("../middleware/user-admin-auth");

const router = Router();
router.use(requireAdminAuth);

function realEmailSql(columnSql) {
  const normalized = `lower(trim(coalesce(${columnSql}, '')))`;
  return `(
    ${normalized} <> ''
    AND ${normalized} NOT LIKE '%@example.com'
    AND ${normalized} NOT LIKE '%@example.org'
    AND ${normalized} NOT LIKE '%@example.net'
    AND ${normalized} NOT LIKE '%@desideals24.local'
    AND ${normalized} NOT LIKE '%@localhost'
  )`;
}

function realOrAnonymousSearchEmailSql(columnSql) {
  const normalized = `lower(trim(coalesce(${columnSql}, '')))`;
  return `(
    ${normalized} = ''
    OR (
      ${normalized} NOT LIKE '%@example.com'
      AND ${normalized} NOT LIKE '%@example.org'
      AND ${normalized} NOT LIKE '%@example.net'
      AND ${normalized} NOT LIKE '%@desideals24.local'
      AND ${normalized} NOT LIKE '%@localhost'
    )
  )`;
}

function serializeDashboardUser(row) {
  const normalizedUserType = String(row?.user_type || "").trim().toLowerCase();
  let status = "signed_up";
  if (Number(row?.is_admin) === 1) status = "admin";
  else if (normalizedUserType === "premium") status = "premium";
  else if (normalizedUserType === "basic") status = "basic";
  else if (row?.email_verified_at) status = "verified";
  return {
    email: row.email,
    name: row.first_name || row.name || null,
    created_at: row.created_at,
    last_login_at: row.last_login_at || null,
    email_verified: !!row.email_verified_at,
    user_type: normalizedUserType || null,
    is_admin: Number(row.is_admin) === 1,
    status,
  };
}

function isMissingSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("has no column named")
  );
}

async function safeGet(sql, params = [], fallback = {}) {
  try {
    return (await db.prepare(sql).get(params)) || fallback;
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

async function safeAll(sql, params = [], fallback = []) {
  try {
    return (await db.prepare(sql).all(params)) || fallback;
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsersRow,
      newUsers30dRow,
      searchesTodayRow,
      searches30dRow,
      uniqueSearchers30dRow,
      signupsByDay,
      searchesByDay,
      topSearchTerms,
      recentSearches,
      recentUsers,
      allUsers,
      latestCrawlRun,
      recentCrawlRuns,
    ] = await Promise.all([
      safeGet(`SELECT COUNT(*) as count FROM users WHERE ${realEmailSql("email")}`),
      safeGet(
        `SELECT COUNT(*) as count FROM users WHERE ${realEmailSql("email")} AND created_at >= datetime('now', '-30 days')`,
        [], { count: 0 },
      ),
      safeGet(
        `SELECT COUNT(*) as count FROM search_queries WHERE created_at >= datetime('now', 'start of day') AND ${realOrAnonymousSearchEmailSql("user_email")}`,
        [], { count: 0 },
      ),
      safeGet(
        `SELECT COUNT(*) as count FROM search_queries WHERE created_at >= datetime('now', '-30 days') AND ${realOrAnonymousSearchEmailSql("user_email")}`,
        [], { count: 0 },
      ),
      safeGet(
        `SELECT COUNT(DISTINCT
          CASE
            WHEN user_email IS NOT NULL AND trim(user_email) <> '' THEN lower(trim(user_email))
            WHEN session_id IS NOT NULL AND trim(session_id) <> '' THEN 'anon:' || trim(session_id)
            ELSE NULL
          END
        ) as count
        FROM search_queries
        WHERE created_at >= datetime('now', '-30 days')
          AND ${realOrAnonymousSearchEmailSql("user_email")}`,
        [], { count: 0 },
      ),
      safeAll(
        `SELECT date(created_at) as day, COUNT(*) as count FROM users
         WHERE ${realEmailSql("email")} AND created_at >= date('now', '-30 days')
         GROUP BY date(created_at) ORDER BY day ASC`,
      ),
      safeAll(
        `SELECT date(created_at) as day, COUNT(*) as count FROM search_queries
         WHERE created_at >= date('now', '-30 days') AND ${realOrAnonymousSearchEmailSql("user_email")}
         GROUP BY date(created_at) ORDER BY day ASC`,
      ),
      safeAll(
        `SELECT normalized_query, MIN(query) as display_query, COUNT(*) as search_count,
          COUNT(DISTINCT
            CASE
              WHEN user_email IS NOT NULL AND trim(user_email) <> '' THEN lower(trim(user_email))
              WHEN session_id IS NOT NULL AND trim(session_id) <> '' THEN 'anon:' || trim(session_id)
              ELSE NULL
            END
          ) as unique_searchers
         FROM search_queries
         WHERE created_at >= datetime('now', '-30 days') AND ${realOrAnonymousSearchEmailSql("user_email")}
         GROUP BY normalized_query ORDER BY search_count DESC, normalized_query ASC LIMIT 15`,
      ),
      safeAll(
        `SELECT query, normalized_query, user_email, session_id, result_count, created_at
         FROM search_queries WHERE ${realOrAnonymousSearchEmailSql("user_email")}
         ORDER BY created_at DESC LIMIT 30`,
      ),
      safeAll(
        `SELECT email, first_name, name, created_at, last_login_at, email_verified_at, user_type, is_admin
         FROM users WHERE ${realEmailSql("email")} ORDER BY created_at DESC LIMIT 20`,
      ),
      safeAll(
        `SELECT email, first_name, name, created_at, last_login_at, email_verified_at, user_type, is_admin
         FROM users WHERE ${realEmailSql("email")}
         ORDER BY COALESCE(last_login_at, created_at) DESC, created_at DESC, email ASC`,
      ),
      safeGet(
        `SELECT id, crawl_date, started_at, finished_at, status, stores_attempted, stores_succeeded, deals_found, errors
         FROM crawl_runs ORDER BY started_at DESC LIMIT 1`,
        [], null,
      ),
      safeAll(
        `SELECT id, crawl_date, started_at, finished_at, status, stores_attempted, stores_succeeded, deals_found
         FROM crawl_runs ORDER BY started_at DESC LIMIT 8`,
      ),
    ]);

    const latestCrawlStores = latestCrawlRun?.id
      ? await safeAll(
          `SELECT store_id, store_name, store_url, started_at, finished_at, status,
                  deals_scraped, deals_inserted, deals_updated, deals_unchanged,
                  deals_removed, history_rows_written, category_counts_json, error_message
           FROM crawl_store_results WHERE crawl_run_id = ?
           ORDER BY CASE status WHEN 'failed' THEN 0 ELSE 1 END, deals_scraped DESC, store_name ASC`,
          [latestCrawlRun.id],
        )
      : [];

    const crawlCategoryTotals = {};
    for (const row of latestCrawlStores) {
      const categoryCounts = parseJsonObject(row.category_counts_json);
      for (const [category, count] of Object.entries(categoryCounts)) {
        crawlCategoryTotals[category] = (crawlCategoryTotals[category] || 0) + Number(count || 0);
      }
    }

    const crawlErrors = parseJsonObject(latestCrawlRun?.errors);

    res.json({
      kpis: {
        total_users: Number(totalUsersRow?.count ?? 0),
        new_users_30d: Number(newUsers30dRow?.count ?? 0),
        searches_today: Number(searchesTodayRow?.count ?? 0),
        searches_30d: Number(searches30dRow?.count ?? 0),
        unique_searchers_30d: Number(uniqueSearchers30dRow?.count ?? 0),
      },
      latest_crawl: latestCrawlRun
        ? {
            id: latestCrawlRun.id,
            crawl_date: latestCrawlRun.crawl_date || null,
            started_at: latestCrawlRun.started_at,
            finished_at: latestCrawlRun.finished_at || null,
            status: latestCrawlRun.status,
            stores_attempted: Number(latestCrawlRun.stores_attempted || 0),
            stores_succeeded: Number(latestCrawlRun.stores_succeeded || 0),
            stores_failed: Math.max(
              0,
              Number(latestCrawlRun.stores_attempted || 0) - Number(latestCrawlRun.stores_succeeded || 0),
            ),
            deals_found: Number(latestCrawlRun.deals_found || 0),
            errors: Array.isArray(crawlErrors) ? crawlErrors : [],
            category_totals: Object.entries(crawlCategoryTotals)
              .sort((l, r) => r[1] - l[1])
              .map(([category, count]) => ({ category, count: Number(count || 0) })),
            store_results: latestCrawlStores.map((row) => ({
              store_id: row.store_id,
              store_name: row.store_name,
              store_url: row.store_url || null,
              started_at: row.started_at || null,
              finished_at: row.finished_at || null,
              status: row.status,
              deals_scraped: Number(row.deals_scraped || 0),
              deals_inserted: Number(row.deals_inserted || 0),
              deals_updated: Number(row.deals_updated || 0),
              deals_unchanged: Number(row.deals_unchanged || 0),
              deals_removed: Number(row.deals_removed || 0),
              history_rows_written: Number(row.history_rows_written || 0),
              category_counts: parseJsonObject(row.category_counts_json),
              error_message: row.error_message || null,
            })),
          }
        : null,
      recent_crawl_runs: recentCrawlRuns.map((row) => ({
        id: row.id,
        crawl_date: row.crawl_date || null,
        started_at: row.started_at,
        finished_at: row.finished_at || null,
        status: row.status,
        stores_attempted: Number(row.stores_attempted || 0),
        stores_succeeded: Number(row.stores_succeeded || 0),
        deals_found: Number(row.deals_found || 0),
      })),
      signups_by_day: signupsByDay.map((r) => ({ day: r.day, count: Number(r.count) })),
      searches_by_day: searchesByDay.map((r) => ({ day: r.day, count: Number(r.count) })),
      top_search_terms: topSearchTerms.map((r) => ({
        query: r.display_query || r.normalized_query,
        normalized_query: r.normalized_query,
        search_count: Number(r.search_count),
        unique_searchers: Number(r.unique_searchers),
      })),
      recent_searches: recentSearches.map((r) => ({
        query: r.query,
        normalized_query: r.normalized_query,
        user_email: r.user_email || null,
        session_id: r.session_id || null,
        result_count: r.result_count == null ? null : Number(r.result_count),
        created_at: r.created_at,
      })),
      recent_users: recentUsers.map((r) => serializeDashboardUser(r)),
      all_users: allUsers.map((r) => serializeDashboardUser(r)),
    });
  } catch (err) {
    console.error("[admin-stats] stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

module.exports = router;
