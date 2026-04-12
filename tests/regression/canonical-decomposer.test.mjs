import test from "node:test";
import assert from "node:assert/strict";

// canonical-decomposer is CommonJS; ESM can import CJS modules directly
import decomposerModule from "../../crawler/utils/canonical-decomposer.js";

const { decomposeCanonical } = decomposerModule;

// ── Weight extraction ────────────────────────────────────────────────────────

test("extracts kg weight and normalises to grams", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg");
  assert.equal(r.weightValue, 5000);
  assert.equal(r.weightUnit, "g");
});

test("extracts g weight", () => {
  const r = decomposeCanonical("Heer Basmati Rice Extra Long 500g");
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "g");
});

test("extracts gm weight (Indian abbreviation)", () => {
  const r = decomposeCanonical("Knorr Bouillon Cubes Chicken 400gm");
  assert.equal(r.weightValue, 400);
  assert.equal(r.weightUnit, "g");
});

test("extracts ml weight", () => {
  const r = decomposeCanonical("Parachute Coconut Oil 500ml");
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "ml");
});

test("extracts l weight and normalises to ml", () => {
  const r = decomposeCanonical("Parachute Coconut Oil 1l");
  assert.equal(r.weightValue, 1000);
  assert.equal(r.weightUnit, "ml");
});

test("returns null weight when no weight in name", () => {
  const r = decomposeCanonical("Aashirvaad Chakki Atta");
  assert.equal(r.weightValue, null);
  assert.equal(r.weightUnit, null);
});

// ── Weight in middle of name (German store format) ───────────────────────────

test("extracts weight correctly when weight sits between brand and product", () => {
  const r = decomposeCanonical("Heer 500g Basmati Rice Extra Long");
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "g");
  // Slots should NOT contain the weight token
  const allTokens = [
    ...r.brandSlots.flat(),
    ...r.baseProductSlots.flat(),
    ...r.typeSlots.flat(),
  ];
  assert.ok(!allTokens.some((t) => /\d/.test(t)), "no numeric token in slots");
});

// ── Brand slot ───────────────────────────────────────────────────────────────

test("first token becomes brand slot", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg");
  assert.deepEqual(r.brandSlots, [["daawat"]]);
});

test("brand slot is lowercased", () => {
  const r = decomposeCanonical("AASHIRVAAD Chakki Atta 5kg");
  assert.deepEqual(r.brandSlots, [["aashirvaad"]]);
});

// ── Base product slots ────────────────────────────────────────────────────────

test("each remaining word becomes its own slot group", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg");
  // brand=daawat, weight stripped → remaining: basmati rice extra long
  assert.deepEqual(r.baseProductSlots, [
    ["basmati"],
    ["rice"],
    ["extra"],
    ["long"],
  ]);
});

test("strips weight from middle before building slots", () => {
  const r = decomposeCanonical("Heer 500g Basmati Rice Extra Long");
  assert.deepEqual(r.baseProductSlots, [
    ["basmati"],
    ["rice"],
    ["extra"],
    ["long"],
  ]);
});

test("strips dashes from canonical name", () => {
  const r = decomposeCanonical("Daawat - Basmati Rice 5kg");
  assert.deepEqual(r.brandSlots, [["daawat"]]);
  assert.deepEqual(r.baseProductSlots, [["basmati"], ["rice"]]);
});

test("strips parenthetical notes from canonical name", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg (BBD 2025)");
  const allTokens = r.baseProductSlots.flat();
  assert.ok(!allTokens.includes("bbd"), "BBD note should be stripped");
});

// ── type_slots ───────────────────────────────────────────────────────────────

test("typeSlots is always empty from decomposer (populated by seeder)", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg");
  assert.deepEqual(r.typeSlots, []);
});

// ── product_group_id ─────────────────────────────────────────────────────────

test("productGroupId is slug of product words without brand or weight", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg");
  assert.equal(r.productGroupId, "basmati-rice-extra-long");
});

test("productGroupId is weight-agnostic — same for 5kg and 500g variants", () => {
  const r5kg = decomposeCanonical("Heer Basmati Rice Extra Long 5kg");
  const r500g = decomposeCanonical("Heer Basmati Rice Extra Long 500g");
  assert.equal(r5kg.productGroupId, r500g.productGroupId);
});

test("productGroupId for no-weight canonical", () => {
  const r = decomposeCanonical("Aashirvaad Chakki Atta");
  assert.equal(r.productGroupId, "chakki-atta");
});

// ── Edge cases ────────────────────────────────────────────────────────────────

test("handles single-word name gracefully", () => {
  const r = decomposeCanonical("Rice");
  assert.deepEqual(r.brandSlots, [["rice"]]);
  assert.deepEqual(r.baseProductSlots, []);
});

test("returns empty slots for empty string without throwing", () => {
  const r = decomposeCanonical("");
  assert.deepEqual(r.brandSlots, []);
  assert.deepEqual(r.baseProductSlots, []);
  assert.equal(r.weightValue, null);
});
