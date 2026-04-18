"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const {
  canonicalizeDeals,
  resolveQueryToCanonicalId,
} = require("../../server/services/canonicalizer");

test("canonicalizeDeals queues no-match deals instead of creating canonical products", async () => {
  const db = createTestDb();

  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)").run(
    "jamoona",
    "Jamoona",
    "https://jamoona.com",
  );
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url,
       sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "jamoona",
    "Arhar Dal Premium 1kg",
    "Lentils & Pulses",
    "https://jamoona.com/p/arhar-dal",
    2.49,
  );

  const stats = await canonicalizeDeals(db, { runId: "run-1" });
  assert.equal(stats.scanned, 1);
  assert.equal(stats.mapped, 0);
  assert.equal(stats.created, 0);
  assert.equal(stats.manual_review, 1);

  const canonical = db
    .prepare("SELECT * FROM canonical_products LIMIT 1")
    .get();
  assert.equal(canonical, undefined, "no canonical should be auto-created for no-match deals");

  const queued = db
    .prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'd1'")
    .get();
  assert.ok(queued, "no-match deal should be in review queue");
  assert.equal(queued.status, "pending");
});

test("resolveQueryToCanonicalId reuses existing canonical records", async () => {
  const db = createTestDb();

  db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, common_aliases)
     VALUES (?, ?, ?, ?)`,
  ).run("toor-dal", "toor dal", "Lentils & Pulses", "[]");

  const resolved = await resolveQueryToCanonicalId(
    db,
    "arhar dal",
    "Lentils & Pulses",
    { createIfMissing: false },
  );
  assert.equal(resolved.canonical_id, "toor-dal");
  assert.equal(resolved.resolved, true);
});

test("resolveQueryToCanonicalId does not create canonical when createIfMissing is false", async () => {
  const db = createTestDb();

  const resolved = await resolveQueryToCanonicalId(
    db,
    "maggie 5 packet of 500 gm",
    "Snacks",
    { createIfMissing: false },
  );
  assert.equal(resolved.canonical_id, null);
  assert.equal(resolved.resolved, false);

  const count = db
    .prepare("SELECT COUNT(*) AS c FROM canonical_products")
    .get().c;
  assert.equal(count, 0);
});

test("canonicalizeDeals queues sub-threshold deals without creating canonicals", async () => {
  const db = createTestDb();

  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)").run(
    "s1",
    "TestStore",
    "https://test.com",
  );

  // Seed one canonical — "toor dal"
  db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, common_aliases)
     VALUES (?, ?, ?, ?)`,
  ).run("toor-dal", "toor dal", "Lentils & Pulses", "[]");

  // Deal: "urid dal" — similar to "toor dal" but below 0.90 fuzzy threshold
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url,
       sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    "urid dal",
    "Lentils & Pulses",
    "https://test.com/urid-dal",
    1.99,
  );

  const stats = await canonicalizeDeals(db, { unmappedOnly: true });

  assert.equal(stats.scanned, 1);
  // No-match or sub-threshold: must be queued, not mapped, no new canonical
  assert.equal(stats.mapped, 0, "sub-threshold deal must NOT be mapped");

  const mapping = db
    .prepare("SELECT * FROM deal_mappings WHERE deal_id = ?")
    .get("d1");
  assert.equal(mapping, undefined, "sub-threshold deal must NOT be in deal_mappings");

  const canonCount = db
    .prepare("SELECT COUNT(*) AS c FROM canonical_products")
    .get().c;
  assert.equal(canonCount, 1, "sub-threshold must NOT create a new canonical");

  const queueItem = db
    .prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = ?")
    .get("d1");
  assert.ok(queueItem, "sub-threshold deal must appear in entity_resolution_queue");
  assert.equal(stats.manual_review, 1);
});
