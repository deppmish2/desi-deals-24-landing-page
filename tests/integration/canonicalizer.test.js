"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const {
  canonicalizeDeals,
  resolveQueryToCanonicalId,
} = require("../../server/services/canonicalizer");

test("canonicalizeDeals maps active deals into canonical products", async () => {
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
  assert.equal(stats.mapped, 1);

  const canonical = db
    .prepare("SELECT * FROM canonical_products LIMIT 1")
    .get();
  assert.ok(canonical);

  const deal = db
    .prepare("SELECT canonical_id FROM deals WHERE id = ?")
    .get("d1");
  assert.equal(deal.canonical_id, canonical.id);

  const mapping = db
    .prepare("SELECT * FROM deal_mappings WHERE deal_id = ?")
    .get("d1");
  assert.equal(mapping.canonical_id, canonical.id);
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
