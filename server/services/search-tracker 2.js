"use strict";

const crypto = require("crypto");

function normalizeSearchQuery(query) {
  return String(query || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

async function trackSearchQuery(db, options = {}) {
  const query = String(options.query || "")
    .trim()
    .replace(/\s+/g, " ");
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return false;

  const userId =
    options.userId == null ? null : String(options.userId).trim() || null;
  const userEmail =
    options.userEmail == null
      ? null
      : String(options.userEmail).trim().toLowerCase() || null;
  const sessionId =
    options.sessionId == null
      ? null
      : String(options.sessionId).trim().slice(0, 128) || null;
  const route =
    options.route == null ? null : String(options.route).trim() || null;
  const resultCount = Number.isFinite(Number(options.resultCount))
    ? Number(options.resultCount)
    : null;

  try {
    await db
      .prepare(
        `INSERT INTO search_queries
          (id, query, normalized_query, user_id, user_email, session_id, route, result_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        query,
        normalizedQuery,
        userId,
        userEmail,
        sessionId,
        route,
        resultCount,
      );
    return true;
  } catch (error) {
    console.warn("[search] track failed:", error.message);
    return false;
  }
}

module.exports = {
  normalizeSearchQuery,
  trackSearchQuery,
};
