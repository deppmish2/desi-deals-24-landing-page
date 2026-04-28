"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const { canonicalizeDeals } = require("../../server/services/canonicalizer");

function seedStore(db) {
  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)").run(
    "jamoona", "Jamoona", "https://jamoona.com",
  );
}

function seedDeal(db, id, name, category = "Lentils & Pulses") {
  db.prepare(
    `INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(id, "run-1", nowIso(), "jamoona", name, category, `https://jamoona.com/p/${id}`, 2.49);
}

test("no-match deal is enqueued, not canonicalized", async () => {
  const db = createTestDb();
  seedStore(db);
  seedDeal(db, "d1", "Completely Unique Product XYZ 500g");

  const stats = await canonicalizeDeals(db, { runId: "run-1" });

  assert.equal(stats.scanned, 1);
  assert.equal(stats.mapped, 0);
  assert.equal(stats.created, 0);
  assert.equal(stats.manual_review, 1);

  const queued = db.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
  assert.ok(queued, "deal should be in review queue");
  assert.equal(queued.status, "pending");
  assert.equal(queued.store_id, "jamoona");
  assert.equal(queued.category, "Lentils & Pulses");

  const canonical = db.prepare("SELECT * FROM canonical_products LIMIT 1").get();
  assert.equal(canonical, undefined, "no canonical should be created for no-match deals");
});

test("high-confidence match deal is mapped, not queued", async () => {
  const db = createTestDb();
  seedStore(db);

  db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, common_aliases)
     VALUES (?, ?, ?, ?)`,
  ).run("toor-dal", "Toor Dal", "Lentils & Pulses", "[]");

  // Deal whose name normalises to an exact match
  seedDeal(db, "d1", "Toor Dal");

  const stats = await canonicalizeDeals(db, { runId: "run-1" });

  assert.equal(stats.mapped, 1);
  assert.equal(stats.manual_review, 0);

  const queued = db.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
  assert.equal(queued, undefined, "mapped deal should not be queued");
});

test("no-match deal is not queued again if already pending", async () => {
  const db = createTestDb();
  seedStore(db);
  seedDeal(db, "d1", "Completely Unique Product XYZ 500g");

  await canonicalizeDeals(db, { runId: "run-1" });
  await canonicalizeDeals(db, {});

  const count = db.prepare("SELECT COUNT(*) as c FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
  assert.equal(count.c, 1, "should not enqueue duplicate pending rows");
});
