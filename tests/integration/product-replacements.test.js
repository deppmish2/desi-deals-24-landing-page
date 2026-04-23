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

// ─── Task 3: T2 brand guard ───────────────────────────────────────────────────

test("T2 excludes same-brand candidates; includes different-brand candidates", async () => {
  const db = makeDb();

  // Source: Xyzbrand, 1000g
  cp(db, { id: "src-t2b", name: "Xyzbrand Urid Dal 1kg",
           brandSlots: [["Xyzbrand"]], baseSlots: [["urid"],["dal"]], weight: 1000 });
  deal(db, { id: "d-src-t2b", canonicalId: "src-t2b", name: "Xyzbrand Urid Dal 1kg",
             weight: 1000, price: 3.00, ppkg: 3.00 });

  // Same brand, same weight, same spec — different canonical.
  // T1 fails: parseWeight(1000) === srcWeightValue(1000) (same size → not a size variant).
  // Without brand guard, falls into T2. Must NOT appear there after fix.
  cp(db, { id: "dup-t2b", name: "Xyzbrand Urid Dal Premium 1kg",
           brandSlots: [["Xyzbrand"]], baseSlots: [["urid"],["dal"]], weight: 1000 });
  deal(db, { id: "d-dup-t2b", canonicalId: "dup-t2b", name: "Xyzbrand Urid Dal 1kg",
             weight: 1000, price: 3.10, ppkg: 3.10 });

  // Different brand, same spec — MUST appear in T2
  cp(db, { id: "other-t2b", name: "Abcbrand Urid Dal 1kg",
           brandSlots: [["Abcbrand"]], baseSlots: [["urid"],["dal"]], weight: 1000 });
  deal(db, { id: "d-other-t2b", canonicalId: "other-t2b", name: "Abcbrand Urid Dal 1kg",
             weight: 1000, price: 2.80, ppkg: 2.80 });

  const result = await getReplacements(db, { canonicalId: "src-t2b", storeId: STORE, dealId: "d-src-t2b" });
  const t2 = result.tiers.find(t => t.type === "same_spec");
  assert.ok(t2, "T2 tier must exist");
  const ids = t2.deals.map(d => d.id);
  assert.ok(!ids.includes("d-dup-t2b"), "same-brand duplicate must NOT be in T2");
  assert.ok(ids.includes("d-other-t2b"), "different-brand candidate must be in T2");
});

// ─── Task 4: fake-deal filter ─────────────────────────────────────────────────

test("fake deals (stated discount far above arithmetic discount) excluded from all tiers", async () => {
  const db = makeDb();

  // Source: no brand/slots → only T4 category match possible
  cp(db, { id: "src-fk", name: "Generic Flour 1kg", category: "Flours & Baking", weight: 1000 });
  deal(db, { id: "d-src-fk", canonicalId: "src-fk", name: "Generic Flour 1kg",
             weight: 1000, price: 3.00, ppkg: 3.00 });

  // Fake: claims 60% off, but (10-9.5)/10*100 = 5% real → gap = 55pp > 10pp → must be excluded
  cp(db, { id: "cand-fk", name: "Fake Flour 1kg", category: "Flours & Baking", weight: 1000 });
  deal(db, { id: "d-fake", canonicalId: "cand-fk", name: "Fake Flour 1kg",
             weight: 1000, price: 9.50, origPrice: 10.00, discount: 60, ppkg: 9.50 });

  // Legit: claims 25% off, real = (5-3.75)/5*100 = 25% → gap = 0pp → must appear
  cp(db, { id: "cand-ok", name: "Good Flour 1kg", category: "Flours & Baking", weight: 1000 });
  deal(db, { id: "d-legit", canonicalId: "cand-ok", name: "Good Flour 1kg",
             weight: 1000, price: 3.75, origPrice: 5.00, discount: 25, ppkg: 3.75 });

  const result = await getReplacements(db, { canonicalId: "src-fk", storeId: STORE, dealId: "d-src-fk" });
  const allDeals = result.tiers.flatMap(t => t.deals).map(d => d.id);
  assert.ok(!allDeals.includes("d-fake"),  "fake deal must not appear in any tier");
  assert.ok(allDeals.includes("d-legit"), "legit deal must appear");
});
