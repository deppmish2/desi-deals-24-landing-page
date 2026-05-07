"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb } = require("./helpers");
const { cascadeCategoryChange } = require("../../server/services/category-cascade");

// Wrap sync SQLite in the async interface cascadeCategoryChange expects
function makeDb(sqlite) {
  return {
    prepare(sql) {
      return {
        get: (...args) => Promise.resolve(sqlite.prepare(sql).get(...args)),
        all: (...args) => Promise.resolve(sqlite.prepare(sql).all(...args)),
        run: (...args) => Promise.resolve(sqlite.prepare(sql).run(...args)),
      };
    },
    // loadPriorityCanonicals uses db.execute(sql) -> { rows }
    execute(sql) {
      return Promise.resolve({ rows: sqlite.prepare(sql).all() });
    },
  };
}

function seed(sqlite) {
  sqlite.exec(`
    INSERT INTO stores (id, name, url) VALUES ('s1', 'Test Store', 'https://test.com');
    INSERT INTO canonical_products (id, canonical_name, category, is_match_priority)
      VALUES ('canon-rice', 'Priya Poha Thick 500g', 'Rice & Grains', 1);
    INSERT INTO store_products
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, canonical_id, is_active, sale_price)
      VALUES
        ('sp-cross', 'run1', '2026-01-01', 's1', 'Priya Poha Thin 500g',
         'Rice & Grains', 'https://test.com/1', 'canon-rice', 1, 1.99),
        ('sp-other', 'run1', '2026-01-01', 's1', 'Priya Poha Thick 500g',
         'Other', 'https://test.com/2', 'canon-rice', 1, 2.49);
    INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence)
      VALUES ('sp-cross', 'canon-rice', 'slot_match', 0.9),
             ('sp-other', 'canon-rice', 'slot_match', 0.9);
  `);
}

test("cross-category product queued after category change", async () => {
  const sqlite = createTestDb();
  seed(sqlite);
  const db = makeDb(sqlite);

  const result = await cascadeCategoryChange(db, "canon-rice", "Ready Meals & Mixes");

  // canonical updated
  const canon = sqlite.prepare("SELECT category FROM canonical_products WHERE id = 'canon-rice'").get();
  assert.equal(canon.category, "Ready Meals & Mixes");

  // sp-cross mapping cleared
  const mapping = sqlite.prepare("SELECT * FROM store_product_mappings WHERE deal_id = 'sp-cross'").get();
  assert.equal(mapping, undefined);

  const sp = sqlite.prepare("SELECT canonical_id FROM store_products WHERE id = 'sp-cross'").get();
  assert.equal(sp.canonical_id, null);

  // sp-cross queued
  const queued = sqlite.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'sp-cross'").get();
  assert.ok(queued);
  assert.equal(queued.status, "pending");

  assert.deepEqual(result, { products_unchanged: 1, products_remapped: 0, products_queued: 1 });
});

test("product with product_category=Other stays unchanged", async () => {
  const sqlite = createTestDb();
  seed(sqlite);
  const db = makeDb(sqlite);

  await cascadeCategoryChange(db, "canon-rice", "Ready Meals & Mixes");

  // sp-other mapping preserved
  const mapping = sqlite.prepare("SELECT * FROM store_product_mappings WHERE deal_id = 'sp-other'").get();
  assert.ok(mapping, "mapping should still exist");
  assert.equal(mapping.canonical_id, "canon-rice");
});

test("no-op when category unchanged", async () => {
  const sqlite = createTestDb();
  seed(sqlite);
  const db = makeDb(sqlite);

  const result = await cascadeCategoryChange(db, "canon-rice", "Rice & Grains");
  assert.deepEqual(result, { products_unchanged: 0, products_remapped: 0, products_queued: 0 });
});
