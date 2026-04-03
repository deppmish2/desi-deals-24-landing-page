import test from "node:test";
import assert from "node:assert/strict";

import helpers from "../integration/helpers.js";
import searchTracker from "../../server/services/search-tracker.js";

const { createTestDb } = helpers;
const { normalizeSearchQuery, trackSearchQuery } = searchTracker;

test("normalizeSearchQuery trims, collapses spaces, and lowercases terms", () => {
  assert.equal(normalizeSearchQuery("  Toor   Dal  "), "toor dal");
  assert.equal(normalizeSearchQuery(""), "");
});

test("trackSearchQuery stores user email when available", async () => {
  const db = createTestDb();

  try {
    db.prepare(
      "INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)",
    ).run("user-1", "buyer@example.com", "10115");

    const inserted = await trackSearchQuery(db, {
      query: "  ghee  ",
      userId: "user-1",
      userEmail: "Buyer@Example.com",
      route: "/deals?q=ghee",
      resultCount: 12,
    });

    assert.equal(inserted, true);

    const row = db
      .prepare(
        "SELECT normalized_query, user_id, user_email, session_id, route, result_count FROM search_queries LIMIT 1",
      )
      .get();

    assert.deepEqual({ ...row }, {
      normalized_query: "ghee",
      user_id: "user-1",
      user_email: "buyer@example.com",
      session_id: null,
      route: "/deals?q=ghee",
      result_count: 12,
    });
  } finally {
    db.close?.();
  }
});

test("trackSearchQuery stores anonymous session id when no user email exists", async () => {
  const db = createTestDb();

  try {
    const inserted = await trackSearchQuery(db, {
      query: "Basmati Rice",
      sessionId: "session-abc-123",
    });

    assert.equal(inserted, true);

    const row = db
      .prepare(
        "SELECT normalized_query, user_id, user_email, session_id, result_count FROM search_queries LIMIT 1",
      )
      .get();

    assert.deepEqual({ ...row }, {
      normalized_query: "basmati rice",
      user_id: null,
      user_email: null,
      session_id: "session-abc-123",
      result_count: null,
    });
  } finally {
    db.close?.();
  }
});
