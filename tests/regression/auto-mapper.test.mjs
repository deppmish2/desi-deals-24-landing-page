import test from "node:test";
import assert from "node:assert/strict";

// We only test the pure matching logic; we don't need a real DB.
// autoMapDeals accepts a db object with an `execute` stub.
import autoMapperModule from "../../crawler/utils/auto-mapper.js";

const { autoMapDeals } = autoMapperModule;

// Minimal stub DB that records upserted (deal_id, canonical_id) pairs
function makeDb() {
  const inserts = [];
  return {
    inserts,
    execute: async (sql, params) => {
      if (/INSERT INTO deal_mappings/i.test(sql)) inserts.push(params);
      return { rows: [] };
    },
  };
}

const KNORR_CANONICAL = {
  id: "canon-knorr",
  canonical_name: "Knorr Bouillon Cubes Chicken 400gm",
  normed: "knorr bouillon cubes chicken 400gm",
  // alias lacks brand — this is what caused the bug
  aliases: ["bouillon cubes chicken"],
};

// --- Bug 1: alias without brand matches wrong-brand products ---

test("autoMapDeals does NOT match Jumbo deal to Knorr canonical via brand-free alias", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-jumbo",
      product_url: "https://example.com/jumbo-bouillon",
      product_name: "Jumbo Bouillon Cubes - Chicken (48pc x 10gm) 480gm",
    },
  ];
  await autoMapDeals(db, deals, [KNORR_CANONICAL]);
  // Must NOT create a mapping
  assert.equal(db.inserts.length, 0, "Jumbo deal should not match Knorr canonical");
});

// --- Correct-brand deal still matches ---

test("autoMapDeals matches Knorr deal to Knorr canonical via canonical name", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-knorr",
      product_url: "https://example.com/knorr-bouillon",
      product_name: "Knorr Bouillon Cubes Chicken 400gm",
    },
  ];
  await autoMapDeals(db, deals, [KNORR_CANONICAL]);
  assert.equal(db.inserts.length, 1, "Knorr deal should match Knorr canonical");
  assert.equal(db.inserts[0][1], "canon-knorr");
});

test("autoMapDeals matches Knorr deal via alias when brand anchor is present", async () => {
  const db = makeDb();
  const deals = [
    {
      id: "deal-knorr2",
      product_url: "https://example.com/knorr-cubes",
      // different word order from canonical_name so canonical_name won't match;
      // alias is "knorr chicken bouillon cubes" which IS a substring
      product_name: "Knorr Chicken Bouillon Cubes 480g",
    },
  ];
  // alias that includes brand and matches the deal's word order
  const canonWithBrandAlias = {
    ...KNORR_CANONICAL,
    aliases: ["knorr chicken bouillon cubes"],
  };
  await autoMapDeals(db, deals, [canonWithBrandAlias]);
  assert.equal(db.inserts.length, 1, "Knorr deal should match via brand-anchored alias");
});
