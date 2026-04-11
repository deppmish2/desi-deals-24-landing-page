import test from "node:test";
import assert from "node:assert/strict";

import weightParser from "../../crawler/utils/weight-parser.js";

const { parseWeight } = weightParser;

// --- existing behaviour we must not break ---

test("parseWeight handles plain gm suffix", () => {
  assert.deepEqual(parseWeight("Knorr Bouillon 400gm"), {
    raw: "400gm",
    value: 400,
    unit: "g",
  });
});

test("parseWeight handles kg", () => {
  assert.deepEqual(parseWeight("Aashirvaad Atta 5kg"), {
    raw: "5kg",
    value: 5,
    unit: "kg",
  });
});

test("parseWeight handles NxMg multi-pack (g unit, no pc)", () => {
  const result = parseWeight("6 x 500g Tins");
  assert.equal(result.value, 500);
  assert.equal(result.unit, "g");
});

// --- Bug 2: multi-pack "Npc x Mgm) Tgm" picks per-unit instead of total ---

test("parseWeight picks total weight when title has (Npc x Mgm) Tgm pattern", () => {
  // "48pc x 10gm" per-unit, "480gm" total — must return total
  assert.deepEqual(
    parseWeight("Jumbo Bouillon Cubes - Chicken (48pc x 10gm) 480gm"),
    { raw: "480gm", value: 480, unit: "g" },
  );
});

test("parseWeight picks total weight for shorter Npc x Mgm) Tgm variant", () => {
  assert.deepEqual(parseWeight("Cubes (24pc x 10gm) 240gm"), {
    raw: "240gm",
    value: 240,
    unit: "g",
  });
});

test("parseWeight still returns last gm match when no pc-prefix present", () => {
  // two gm values with no multi-pack context — last wins
  assert.deepEqual(parseWeight("Product 10gm 480gm"), {
    raw: "480gm",
    value: 480,
    unit: "g",
  });
});
