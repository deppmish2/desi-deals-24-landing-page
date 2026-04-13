import test from "node:test";
import assert from "node:assert/strict";

import autoMapperModule from "../../crawler/utils/auto-mapper.js";

const { matchesCanonical, autoMapDeals } = autoMapperModule;

// ── matchesCanonical: slot-based matching ─────────────────────────────────────

// Helper: build a minimal canonical object with slots
function canon(overrides = {}) {
  return {
    id: "test-canon",
    canonical_name: "Daawat Basmati Rice Extra Long 5kg",
    normed: "daawat basmati rice extra long 5kg",
    aliases: [],
    brandSlots: [["daawat", "dawat"]],
    baseProductSlots: [["basmati", "basmatireis"], ["rice", "reis"], ["extra"], ["long", "lang"]],
    typeSlots: [],
    weightValue: 5000,
    weightUnit: "g",
    ...overrides,
  };
}

// --- Basic slot match ---

test("matchesCanonical: all slots match + correct weight → MATCH", () => {
  assert.ok(
    matchesCanonical("daawat 5kg basmati rice extra long", 5000, "g", canon()),
    "should match",
  );
});

test("matchesCanonical: weight in middle of title does not prevent slot match", () => {
  // German-format title: weight sits between brand and product
  assert.ok(
    matchesCanonical("daawat 5kg basmati reis extra lang", 5000, "g", canon()),
    "German-format title should still match",
  );
});

test("matchesCanonical: German language variants match via slot variants", () => {
  // "basmatireis" and "reis" and "lang" are variants in the slot arrays
  assert.ok(
    matchesCanonical("daawat basmatireis extra lang", 5000, "g", canon()),
    "German variants should match",
  );
});

test("matchesCanonical: brand misspelling variant matches", () => {
  // "dawat" is a variant in brandSlots[0]
  assert.ok(
    matchesCanonical("dawat basmati rice extra long", 5000, "g", canon()),
    "brand misspelling variant should match",
  );
});

// --- Brand mismatch ---

test("matchesCanonical: brand mismatch → NO MATCH", () => {
  assert.ok(
    !matchesCanonical("heer basmati rice extra long", 5000, "g", canon()),
    "different brand should not match",
  );
});

// --- Missing product slot ---

test("matchesCanonical: missing required product slot → NO MATCH", () => {
  // "extra" is a required slot; this title has no "extra"
  assert.ok(
    !matchesCanonical("daawat basmati rice long", 5000, "g", canon()),
    "missing slot token should not match",
  );
});

// --- Weight checks ---

test("matchesCanonical: wrong weight (500g vs 5000g) → NO MATCH", () => {
  assert.ok(
    !matchesCanonical("daawat basmati rice extra long", 500, "g", canon()),
    "500g deal should not match 5kg canonical",
  );
});

test("matchesCanonical: weight within ±10% tolerance → MATCH", () => {
  // 5040g is within 10% of 5000g
  assert.ok(
    matchesCanonical("daawat basmati rice extra long", 5040, "g", canon()),
    "weight within tolerance should match",
  );
});

test("matchesCanonical: weight just outside ±10% → NO MATCH", () => {
  // 4499g is outside 10% of 5000g
  assert.ok(
    !matchesCanonical("daawat basmati rice extra long", 4499, "g", canon()),
    "weight outside tolerance should not match",
  );
});

test("matchesCanonical: null deal weight skips weight check → MATCH", () => {
  assert.ok(
    matchesCanonical("daawat basmati rice extra long", null, null, canon()),
    "no deal weight should skip check and match on slots alone",
  );
});

test("matchesCanonical: null canonical weight skips weight check → MATCH", () => {
  const noWeightCanon = canon({ weightValue: null, weightUnit: null });
  assert.ok(
    matchesCanonical("daawat basmati rice extra long", 5000, "g", noWeightCanon),
    "no canonical weight should skip check and match on slots alone",
  );
});

test("matchesCanonical: mismatched units (g vs ml) skips weight check → MATCH", () => {
  // Can't compare grams vs millilitres; weight check should be skipped
  assert.ok(
    matchesCanonical("daawat basmati rice extra long", 5000, "ml", canon()),
    "incompatible units should skip weight check",
  );
});

// --- Canonical with NULL slots falls back to legacy alias matching ---

test("matchesCanonical: canonical with null slots → returns null (caller uses legacy)", () => {
  const legacyCanon = canon({ brandSlots: null, baseProductSlots: null });
  // matchesCanonical returns null when slots are absent → caller falls back to legacy
  assert.equal(
    matchesCanonical("daawat basmati rice extra long", 5000, "g", legacyCanon),
    null,
  );
});

// ── autoMapDeals: slot-based canonicals are matched ──────────────────────────

// Stub DB that records upserted (deal_id, canonical_id) pairs
function makeDb() {
  const inserts = [];
  return {
    inserts,
    execute: async (sql, params) => {
      if (/INSERT INTO deal_mappings/i.test(sql)) inserts.push(params);
      return { rows: [] };
    },
    batch: async (stmts) => {
      for (const { sql, args } of stmts) {
        if (/INSERT INTO deal_mappings/i.test(sql)) inserts.push(args);
      }
    },
  };
}

// Canonical with slot columns set (new-style)
const DAAWAT_CANON = {
  id: "canon-daawat-5kg",
  canonical_name: "Daawat Basmati Rice Extra Long 5kg",
  normed: "daawat basmati rice extra long 5kg",
  aliases: [],
  brandSlots: [["daawat", "dawat"]],
  baseProductSlots: [["basmati", "basmatireis"], ["rice", "reis"], ["extra"], ["long", "lang"]],
  typeSlots: [],
  weightValue: 5000,
  weightUnit: "g",
};

const HEER_500G_CANON = {
  id: "canon-heer-500g",
  canonical_name: "Heer Basmati Rice Extra Long 500g",
  normed: "heer basmati rice extra long 500g",
  aliases: [],
  brandSlots: [["heer"]],
  baseProductSlots: [["basmati", "basmatireis"], ["rice", "reis"], ["extra"], ["long", "lang"]],
  typeSlots: [],
  weightValue: 500,
  weightUnit: "g",
};

test("autoMapDeals maps German-format deal title to correct canonical via slots", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-daawat-5kg",
      product_url: "https://jamoona.com/daawat-5kg",
      product_name: "Daawat - 5kg Basmati Reis extra lang",
      weight_value: 5000,
      weight_unit: "g",
    },
  ];
  await autoMapDeals(db, deals, [DAAWAT_CANON, HEER_500G_CANON]);
  assert.equal(db.inserts.length, 1);
  assert.equal(db.inserts[0][1], "canon-daawat-5kg");
});

test("autoMapDeals routes 500g deal to 500g canonical, not 5kg canonical", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-heer-500g",
      product_url: "https://jamoona.com/heer-500g",
      product_name: "Heer Basmati Rice Extra Long 500g",
      weight_value: 500,
      weight_unit: "g",
    },
  ];
  await autoMapDeals(db, deals, [DAAWAT_CANON, HEER_500G_CANON]);
  assert.equal(db.inserts.length, 1, "should map to exactly one canonical");
  assert.equal(db.inserts[0][1], "canon-heer-500g", "should map to 500g canonical, not 5kg");
});

test("autoMapDeals does NOT cross-match brands via slots", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-heer-5kg",
      product_url: "https://example.com/heer-5kg",
      product_name: "Heer Basmati Rice Extra Long 5kg",
      weight_value: 5000,
      weight_unit: "g",
    },
  ];
  // DAAWAT_CANON has brand_slots = [["daawat","dawat"]]; "heer" is not in it
  await autoMapDeals(db, deals, [DAAWAT_CANON]);
  assert.equal(db.inserts.length, 0, "Heer deal should NOT match Daawat canonical");
});

// Existing regression: brand-free alias must not match wrong brand
const KNORR_CANON_LEGACY = {
  id: "canon-knorr",
  canonical_name: "Knorr Bouillon Cubes Chicken 400gm",
  normed: "knorr bouillon cubes chicken 400gm",
  aliases: ["bouillon cubes chicken"],
  brandSlots: null,  // legacy canonical — no slots yet
  baseProductSlots: null,
  typeSlots: null,
  weightValue: null,
  weightUnit: null,
};

test("autoMapDeals legacy fallback: brand-free alias still does not match wrong brand", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-jumbo",
      product_url: "https://example.com/jumbo-bouillon",
      product_name: "Jumbo Bouillon Cubes - Chicken (48pc x 10gm) 480gm",
      weight_value: 480,
      weight_unit: "g",
    },
  ];
  await autoMapDeals(db, deals, [KNORR_CANON_LEGACY]);
  assert.equal(db.inserts.length, 0, "brand-free alias should still require brand anchor in legacy path");
});
