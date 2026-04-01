"use strict";

const { Router } = require("express");
const db = require("../db");
const requireAdminAuth = require("../middleware/user-admin-auth");

const router = Router();

router.use(requireAdminAuth);

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
    ] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM users").get(),
      db
        .prepare(
          "SELECT COUNT(*) as count FROM users WHERE created_at >= datetime('now', '-30 days')",
        )
        .get(),
      db
        .prepare(
          "SELECT COUNT(*) as count FROM search_queries WHERE created_at >= datetime('now', 'start of day')",
        )
        .get(),
      db
        .prepare(
          "SELECT COUNT(*) as count FROM search_queries WHERE created_at >= datetime('now', '-30 days')",
        )
        .get(),
      db
        .prepare(
          `
        SELECT COUNT(DISTINCT
          CASE
            WHEN user_email IS NOT NULL AND trim(user_email) <> '' THEN lower(trim(user_email))
            WHEN session_id IS NOT NULL AND trim(session_id) <> '' THEN 'anon:' || trim(session_id)
            ELSE NULL
          END
        ) as count
        FROM search_queries
        WHERE created_at >= datetime('now', '-30 days')
      `,
        )
        .get(),
      db
        .prepare(
          `
        SELECT date(created_at) as day, COUNT(*) as count
        FROM users
        WHERE created_at >= date('now', '-30 days')
        GROUP BY date(created_at)
        ORDER BY day ASC
      `,
        )
        .all(),
      db
        .prepare(
          `
        SELECT date(created_at) as day, COUNT(*) as count
        FROM search_queries
        WHERE created_at >= date('now', '-30 days')
        GROUP BY date(created_at)
        ORDER BY day ASC
      `,
        )
        .all(),
      db
        .prepare(
          `
        SELECT
          normalized_query,
          MIN(query) as display_query,
          COUNT(*) as search_count,
          COUNT(DISTINCT
            CASE
              WHEN user_email IS NOT NULL AND trim(user_email) <> '' THEN lower(trim(user_email))
              WHEN session_id IS NOT NULL AND trim(session_id) <> '' THEN 'anon:' || trim(session_id)
              ELSE NULL
            END
          ) as unique_searchers
        FROM search_queries
        WHERE created_at >= datetime('now', '-30 days')
        GROUP BY normalized_query
        ORDER BY search_count DESC, normalized_query ASC
        LIMIT 15
      `,
        )
        .all(),
      db
        .prepare(
          `
        SELECT query, normalized_query, user_email, session_id, result_count, created_at
        FROM search_queries
        ORDER BY created_at DESC
        LIMIT 30
      `,
        )
        .all(),
      db
        .prepare(
          `
        SELECT email, first_name, name, created_at, last_login_at, email_verified_at
        FROM users
        ORDER BY created_at DESC
        LIMIT 20
      `,
        )
        .all(),
    ]);

    res.json({
      kpis: {
        total_users: Number(totalUsersRow?.count ?? 0),
        new_users_30d: Number(newUsers30dRow?.count ?? 0),
        searches_today: Number(searchesTodayRow?.count ?? 0),
        searches_30d: Number(searches30dRow?.count ?? 0),
        unique_searchers_30d: Number(uniqueSearchers30dRow?.count ?? 0),
      },
      signups_by_day: signupsByDay.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
      searches_by_day: searchesByDay.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
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
        result_count:
          r.result_count == null ? null : Number(r.result_count),
        created_at: r.created_at,
      })),
      recent_users: recentUsers.map((r) => ({
        email: r.email,
        name: r.first_name || r.name || null,
        created_at: r.created_at,
        last_login_at: r.last_login_at || null,
        email_verified: !!r.email_verified_at,
      })),
    });
  } catch (err) {
    console.error("[admin-dashboard] stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

module.exports = router;
