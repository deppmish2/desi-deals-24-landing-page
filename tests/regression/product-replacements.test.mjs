import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { getReplacements } = require("../../server/services/product-replacements.js");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE canonical_products (
      id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL,
      category TEXT, brand_slots TEXT, base_product_slots TEXT,
      base_key TEXT, weight_value REAL, weight_unit TEXT
    );
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL);
    CREATE TABLE store_products (
      id TEXT PRIMARY KEY, canonical_id TEXT, store_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      product_name TEXT, product_category TEXT, product_url TEXT,
      image_url TEXT, weight_raw TEXT, weight_value REAL, weight_unit TEXT,
      sale_price REAL, original_price REAL, discount_percent REAL,
      price_per_kg REAL, currency TEXT, availability TEXT,
      bulk_pricing TEXT, best_before TEXT, crawl_timestamp TEXT
    );
    INSERT INTO stores VALUES ('s1', 'Test Store', 'https://example.com');
  `);
  return db;
}

test("sameCategory guard: cross-category deal never appears in T2/T3/T4", async () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO canonical_products (id, canonical_name, category) VALUES
      ('cp-paneer', 'Amul Paneer 200g', 'Dairy & Paneer'),
      ('cp-masala', 'MDH Paneer Masala 100g', 'Spices & Masalas');
    INSERT INTO store_products
      (id, canonical_id, store_id, is_active, product_name, product_category, sale_price, weight_value)
    VALUES
      ('d-src',    'cp-paneer', 's1', 1, 'Amul Paneer 200g',       'Dairy & Paneer',   2.50, 200),
      ('d-masala', 'cp-masala', 's1', 1, 'MDH Paneer Masala 100g', 'Spices & Masalas', 1.99, 100);
  `);

  const result = await getReplacements(db, { canonicalId: "cp-paneer", storeId: "s1", dealId: "d-src" });

  assert.ok(result != null, "getReplacements must return a result");

  const allDeals = (result.tiers || []).flatMap((t) => t.deals || []);
  const contaminated = allDeals.some((d) => d.id === "d-masala");
  assert.ok(
    !contaminated,
    "cross-category 'Spices & Masalas' deal must not appear as replacement for 'Dairy & Paneer' product — check sameCategory guard in product-replacements.js"
  );
});

test("sameCategory guard: same-category deals still surface in T4", async () => {
  const db = makeDb();
  db.exec(`
    INSERT INTO canonical_products (id, canonical_name, category) VALUES
      ('cp-paneer',  'Amul Paneer 200g',        'Dairy & Paneer'),
      ('cp-cottage', 'Fresh Cottage Cheese 200g', 'Dairy & Paneer');
    INSERT INTO store_products
      (id, canonical_id, store_id, is_active, product_name, product_category, sale_price, weight_value)
    VALUES
      ('d-src',     'cp-paneer',  's1', 1, 'Amul Paneer 200g',         'Dairy & Paneer', 2.50, 200),
      ('d-cottage', 'cp-cottage', 's1', 1, 'Fresh Cottage Cheese 200g', 'Dairy & Paneer', 1.99, 200);
  `);

  const result = await getReplacements(db, { canonicalId: "cp-paneer", storeId: "s1", dealId: "d-src" });

  const allDeals = (result.tiers || []).flatMap((t) => t.deals || []);
  const found = allDeals.some((d) => d.id === "d-cottage");
  assert.ok(
    found,
    "same-category replacement must still appear — sameCategory guard is over-filtering"
  );
});
