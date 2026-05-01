"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_FILE = "data/prod_local.db";

const db = require("../../server/db");

describe("alert-evaluator", () => {
  let userId, canonicalId, alertId;

  before(async () => {
    await new Promise(r => setTimeout(r, 1500));
    const user = await db.prepare("SELECT id FROM users LIMIT 1").get();
    const canonical = await db.prepare(
      "SELECT canonical_id AS id FROM store_products WHERE canonical_id IS NOT NULL AND is_active = 1 LIMIT 1"
    ).get();
    assert.ok(user, "need at least one user in DB");
    assert.ok(canonical, "need at least one canonical in DB");
    userId = user.id;
    canonicalId = canonical.id;

    alertId = require("crypto").randomUUID();
    await db.prepare(
      `INSERT INTO product_alerts (id, user_id, canonical_id, alert_type, price_threshold, created_at)
       VALUES (?, ?, ?, 'price_below', 99999.00, datetime('now'))`
    ).run(alertId, userId, canonicalId);
  });

  after(async () => {
    await db.prepare("DELETE FROM product_alerts WHERE id = ?").run(alertId);
  });

  it("evaluatePriceAlerts returns matches when sale_price < threshold", async () => {
    const { evaluatePriceAlerts } = require("../../server/services/alert-evaluator");
    const matches = await evaluatePriceAlerts();
    const found = matches.find(m => m.alert_id === alertId);
    assert.ok(found, "should find alert with high threshold");
    assert.equal(found.alert_type, "price_below");
  });
});
