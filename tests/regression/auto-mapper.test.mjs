import test from "node:test";
import assert from "node:assert/strict";

import autoMapperModule from "../../crawler/utils/auto-mapper.js";
const { autoMapDeals, matchesCanonical } = autoMapperModule;

function makeDb() {
  const inserts = [];
  return {
    inserts,
    execute: async (sql, params) => {
      if (/INSERT INTO store_product_mappings/i.test(sql)) inserts.push(params);
      return { rows: [] };
    },
    batch: async (stmts) => {
      for (const { sql, args } of stmts) {
        if (/INSERT INTO store_product_mappings/i.test(sql)) inserts.push(args);
      }
    },
  };
}

// A properly slotted Knorr canonical
const KNORR = {
  id: "canon-knorr",
  canonical_name: "Knorr Bouillon Cubes Chicken 400gm",
  normed: "knorr bouillon cubes chicken 400gm",
  aliases: [],
  brandSlots:       [["knorr"]],
  baseProductSlots: [["bouillon"], ["cubes"], ["chicken"]],
  typeSlots:        [],
  weightValue: 400,
  weightUnit: "g",
};

// ── matchesCanonical ─────────────────────────────────────────────────────────

test("matchesCanonical returns true when all slots present and weight matches", () => {
  const result = matchesCanonical(
    "knorr bouillon cubes chicken 400gm",
    400, "g",
    KNORR,
  );
  assert.equal(result, true);
});

test("matchesCanonical returns false when brand slot missing", () => {
  const result = matchesCanonical(
    "jumbo bouillon cubes chicken 400gm",
    400, "g",
    KNORR,
  );
  assert.equal(result, false);
});

test("matchesCanonical returns false when weight differs by > 10%", () => {
  // 480 / 400 = 1.2 — outside ±10% tolerance
  const result = matchesCanonical(
    "knorr bouillon cubes chicken 480gm",
    480, "g",
    KNORR,
  );
  assert.equal(result, false);
});

test("matchesCanonical returns null when canonical has no slots", () => {
  const noSlots = { ...KNORR, brandSlots: null, baseProductSlots: null };
  const result = matchesCanonical("knorr bouillon cubes chicken", null, null, noSlots);
  assert.equal(result, null);
});

// ── autoMapDeals — no legacy fallback ────────────────────────────────────────

test("autoMapDeals skips canonical with no slots (no legacy fallback)", async () => {
  const db = makeDb();
  const noSlots = { ...KNORR, brandSlots: null, baseProductSlots: null };
  const deals = [{
    id: "deal-knorr",
    product_url: "https://example.com/knorr",
    product_name: "Knorr Bouillon Cubes Chicken 400gm",
    weight_value: 400,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [noSlots]);
  assert.equal(db.inserts.length, 0, "no-slot canonical must be skipped entirely");
});

test("autoMapDeals matches Knorr deal to slotted Knorr canonical", async () => {
  const db = makeDb();
  const deals = [{
    id: "deal-knorr",
    product_url: "https://example.com/knorr",
    product_name: "Knorr Bouillon Cubes Chicken 400gm",
    weight_value: 400,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [KNORR]);
  assert.equal(db.inserts.length, 1, "Knorr deal should match slotted canonical");
  assert.equal(db.inserts[0][1], "canon-knorr");
});

test("autoMapDeals does NOT match Jumbo deal to Knorr canonical", async () => {
  const db = makeDb();
  const deals = [{
    id: "deal-jumbo",
    product_url: "https://example.com/jumbo",
    product_name: "Jumbo Bouillon Cubes Chicken 400g",
    weight_value: 400,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [KNORR]);
  assert.equal(db.inserts.length, 0, "Jumbo deal should not match Knorr canonical");
});

test("autoMapDeals does NOT match Knorr deal when weight differs by > 10%", async () => {
  const db = makeDb();
  const deals = [{
    id: "deal-knorr-480",
    product_url: "https://example.com/knorr-480",
    product_name: "Knorr Bouillon Cubes Chicken 480g",
    weight_value: 480,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [KNORR]);
  assert.equal(db.inserts.length, 0, "480g deal should not match 400g canonical");
});
