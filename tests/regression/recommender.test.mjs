import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { recommendForList } = require("../../server/services/recommender.js");

function nowIso() {
  return new Date().toISOString();
}

// createTestDb strips the FTS5 virtual table which node:sqlite's bundled SQLite
// does not support (no fts5 extension compiled in).
function createTestDb() {
  const schemaPath = path.join(__dirname, "../../server/db/schema.sql");
  let schema = fs.readFileSync(schemaPath, "utf8");
  // Strip CREATE VIRTUAL TABLE ... USING fts5(...); blocks
  schema = schema.replace(/CREATE VIRTUAL TABLE[^;]+USING fts5\([^)]+\);/gs, "");
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  return db;
}

test("itemStoreDeals category filter: cross-category store produces winner=null", async () => {
  const db = createTestDb();

  // Store: only carries spice products
  db.prepare("INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)").run(
    "s1", "Spice Shop", "https://s1.example", "shopify"
  );

  // User + list
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1", "u1@example.com", "80331"
  );
  db.prepare("INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    "l1", "u1", "Weekly", nowIso()
  );

  // Canonical: paneer (Dairy & Paneer) — what the user wants
  db.prepare("INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)").run(
    "cp-paneer", "paneer", "Dairy & Paneer"
  );

  // List item: paneer, with canonical_id=NULL so text-based matching runs
  db.prepare(
    "INSERT INTO list_items (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, resolved, unresolvable) VALUES (?, ?, ?, ?, ?, ?, 1, 0)"
  ).run("l1", null, "paneer", 1, null, 1);

  // Canonical: paneer masala (Spices & Masalas) — what the store has
  db.prepare("INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)").run(
    "cp-masala", "paneer masala", "Spices & Masalas"
  );

  // Deal at s1: a spice product, NOT dairy
  db.prepare(
    "INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category, product_url, sale_price, currency, availability, is_active, weight_value, weight_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)"
  ).run(
    "d1", "run-1", nowIso(),
    "s1", "cp-masala",
    "MDH Paneer Masala 100g", "Spices & Masalas",
    "https://s1.example/products/d1",
    1.99, 100, "g"
  );

  const result = await recommendForList(db, {
    user: { id: "u1", postcode: "80331" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "standard",
  });

  assert.equal(
    result.winner,
    null,
    "store with only 'Spices & Masalas' deals must not match 'Dairy & Paneer' list item — check itemStoreDeals category filter in recommender.js"
  );
  assert.equal(
    result.summary.stores_considered,
    0,
    "no store should be in ranked results when cross-category filter eliminates all deals"
  );
});

test("itemStoreDealsIds guard: findBestDealForItemAtStore cross-category match rejected", async () => {
  const db = createTestDb();

  db.prepare("INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)").run(
    "s1", "Ready Meal Shop", "https://s1.example", "shopify"
  );
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1", "u1@example.com", "80331"
  );
  db.prepare("INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)").run(
    "l1", "u1", "Weekly", nowIso()
  );

  // What the user wants: plain poha (Rice & Grains)
  db.prepare("INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)").run(
    "cp-poha-grain", "poha", "Rice & Grains"
  );
  db.prepare(
    "INSERT INTO list_items (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, resolved, unresolvable) VALUES (?, ?, ?, ?, ?, ?, 1, 0)"
  ).run("l1", "cp-poha-grain", "poha", 1, null, 1);

  // What the store has: Ready-to-Eat poha cup (Ready Meals & Mixes) — wrong category
  db.prepare("INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)").run(
    "cp-poha-rte", "Priya Quick Poha Cup", "Ready Meals & Mixes"
  );
  db.prepare(
    "INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category, product_url, sale_price, currency, availability, is_active, weight_value, weight_unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)"
  ).run("d1", "run-1", nowIso(), "s1", "cp-poha-rte", "Priya Quick Poha Cup 80g", "Ready Meals & Mixes",
    "https://s1.example/products/d1", 1.49, 80, "g");

  // Stale canonical mapping: links the grain poha canonical to the RTE cup deal.
  // This forces findBestDealForItemAtStore to find d1 via the canonical path —
  // the itemStoreDealsIds guard must reject it before it becomes a match.
  db.prepare("INSERT INTO store_product_mappings (canonical_id, deal_id, match_method) VALUES (?, ?, ?)").run(
    "cp-poha-grain", "d1", "exact"
  );

  const result = await recommendForList(db, {
    user: { id: "u1", postcode: "80331" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "standard",
  });

  assert.equal(
    result.winner,
    null,
    "'Ready Meals & Mixes' poha cup must not match a 'Rice & Grains' poha list item — check itemStoreDealsIds guard in recommender.js"
  );
  assert.equal(
    result.summary.stores_considered,
    0,
    "store must not rank when its only poha deal is in the wrong category"
  );
});

test("deal query returns cp.base_key from joined canonical", async () => {
  const src = fs.readFileSync(
    new URL("../../server/services/recommender.js", import.meta.url),
    "utf8"
  );
  // The deal pool query must SELECT cp.base_key
  assert.ok(
    src.includes("cp.base_key"),
    "recommender deal SELECT must include cp.base_key"
  );
});

test("resolveBaseMetaCached uses DB base_key without calling CSV when dbBaseKey provided", () => {
  const recommenderSrc = fs.readFileSync(
    new URL("../../server/services/recommender.js", import.meta.url),
    "utf8"
  );
  // Verify the signature includes dbBaseKey
  assert.ok(
    recommenderSrc.includes("resolveBaseMetaCached(cache, text, dbBaseKey)"),
    "resolveBaseMetaCached must accept dbBaseKey as third arg"
  );
  // Verify call sites pass deal.base_key
  assert.ok(
    recommenderSrc.includes("deal.base_key || null"),
    "recommender call sites must pass deal.base_key to resolveBaseMetaCached"
  );
});
