"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const {
  evaluateAlertsAfterCrawl,
} = require("../../server/services/alert-evaluator");

test("evaluateAlertsAfterCrawl triggers matching price alerts and writes audit", async () => {
  const db = createTestDb();

  delete process.env.SMTP_HOST;

  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "user@example.com",
    "80331",
  );
  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)").run(
    "s1",
    "Store 1",
    "https://store1.example",
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://store1.example/p/toor",
    2.4,
  );

  db.prepare(
    `INSERT INTO price_alerts
      (user_id, product_query, alert_type, target_price, is_active)
     VALUES (?, ?, 'price', ?, 1)`,
  ).run("u1", "toor dal", 2.5);

  const out = await evaluateAlertsAfterCrawl(db, { runId: "run-1" });
  assert.equal(out.triggered, 1);

  const alert = db
    .prepare("SELECT triggered, last_triggered_at FROM price_alerts LIMIT 1")
    .get();
  assert.equal(alert.triggered, 1);
  assert.ok(alert.last_triggered_at);

  const notification = db
    .prepare("SELECT sent_status FROM alert_notifications LIMIT 1")
    .get();
  assert.equal(notification.sent_status, "logged");
});
