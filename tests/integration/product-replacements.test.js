"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { getReplacements } = require("../../server/services/product-replacements");

const STORE = "s1";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE canonical_products (
      id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL,
      category TEXT, brand_slots TEXT, base_product_slots TEXT,
      base_key TEXT, weight_value REAL, weight_unit TEXT
    );
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL);
    CREATE TABLE deals (
      id TEXT PRIMARY KEY, canonical_id TEXT, store_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      product_name TEXT, product_category TEXT, product_url TEXT,
      image_url TEXT, weight_raw TEXT, weight_value REAL, weight_unit TEXT,
      sale_price REAL, original_price REAL, discount_percent REAL,
      price_per_kg REAL, currency TEXT, availability TEXT,
      bulk_pricing TEXT, best_before TEXT, crawl_timestamp TEXT
    );
    INSERT INTO stores VALUES ('${STORE}', 'Test Store', 'https://example.com');
  `);
  return db;
}

function cp(db, { id, name, category = "Lentils & Pulses", brandSlots = null, baseSlots = null, weight = null }) {
  db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, brand_slots, base_product_slots, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, 'g')`
  ).run(
    id, name, category,
    brandSlots ? JSON.stringify(brandSlots) : null,
    baseSlots  ? JSON.stringify(baseSlots)  : null,
    weight
  );
}

function deal(db, { id, canonicalId, name, weight = null, price = 5.00, origPrice = null, discount = null, ppkg = null }) {
  db.prepare(
    `INSERT INTO deals (id, canonical_id, store_id, is_active, product_name, weight_value, weight_unit,
                        sale_price, original_price, discount_percent, price_per_kg, currency)
     VALUES (?, ?, ?, 1, ?, ?, 'g', ?, ?, ?, ?, 'EUR')`
  ).run(id, canonicalId, STORE, name, weight, price, origPrice, discount, ppkg);
}

// ─── Task 1: sort ────────────────────────────────────────────────────────────

test("T2 ranks by price_per_kg ascending, not discount_percent descending", async () => {
  const db = makeDb();

  cp(db, { id: "src", name: "Xyzbrand Toor Dal 1kg",
           brandSlots: [["Xyzbrand"]], baseSlots: [["toor"],["dal"]], weight: 1000 });
  deal(db, { id: "d-src", canonicalId: "src", name: "Xyzbrand Toor Dal 1kg",
             weight: 1000, price: 4.00, ppkg: 4.00 });

  // Candidate A — high discount (30%) but more expensive per kg (3.50)
  cp(db, { id: "ca", name: "Abcbrand Toor Dal 1kg",
           brandSlots: [["Abcbrand"]], baseSlots: [["toor"],["dal"]], weight: 1000 });
  deal(db, { id: "d-a", canonicalId: "ca", name: "Abcbrand Toor Dal 1kg",
             weight: 1000, price: 3.50, origPrice: 5.00, discount: 30, ppkg: 3.50 });

  // Candidate B — low discount (7%) but cheaper per kg (2.80) — better value
  cp(db, { id: "cb", name: "Schani Toor Dal 1kg",
           brandSlots: [["Schani"]], baseSlots: [["toor"],["dal"]], weight: 1000 });
  deal(db, { id: "d-b", canonicalId: "cb", name: "Schani Toor Dal 1kg",
             weight: 1000, price: 2.80, origPrice: 3.00, discount: 7, ppkg: 2.80 });

  const result = await getReplacements(db, { canonicalId: "src", storeId: STORE, dealId: "d-src" });
  const t2 = result.tiers.find(t => t.type === "same_spec");
  assert.ok(t2, "T2 same_spec tier must exist");
  assert.equal(t2.deals[0].id, "d-b", "cheaper per-kg deal must rank first");
  assert.equal(t2.deals[1].id, "d-a");
});

// ─── Task 2: T4 larger packs ─────────────────────────────────────────────────

test("T4 includes larger-pack candidates from same category", async () => {
  const db = makeDb();

  // Source: 500g, no brand/slots → only category matching possible
  cp(db, { id: "src-t4", name: "Generic Dal 500g", category: "Lentils & Pulses", weight: 500 });
  deal(db, { id: "d-src-t4", canonicalId: "src-t4", name: "Generic Dal 500g",
             weight: 500, price: 2.50, ppkg: 5.00 });

  // Candidate: 1000g same category — blocked by current sizeCompatible (1000 > 500)
  cp(db, { id: "cand-t4", name: "Other Dal 1kg", category: "Lentils & Pulses", weight: 1000 });
  deal(db, { id: "d-cand-t4", canonicalId: "cand-t4", name: "Other Dal 1kg",
             weight: 1000, price: 4.00, ppkg: 4.00 });

  const result = await getReplacements(db, { canonicalId: "src-t4", storeId: STORE, dealId: "d-src-t4" });
  const t4 = result.tiers.find(t => t.type === "same_category");
  assert.ok(t4, "T4 same_category tier must exist");
  assert.ok(t4.deals.some(d => d.id === "d-cand-t4"), "1kg candidate must appear in T4");
});
