import test from "node:test";
import assert from "node:assert/strict";

import decomposerModule from "../../crawler/utils/canonical-decomposer.js";
const { decomposeCanonical } = decomposerModule;

// Shared brand list used across tests
const BRANDS = [
  { name: "Daawat",     aliases: ["daawat", "dawat"] },
  { name: "Heer",       aliases: ["heer"] },
  { name: "Knorr",      aliases: ["knorr"] },
  { name: "Aashirvaad", aliases: ["aashirvaad", "aashirwad", "ashirwad"] },
  { name: "Parachute",  aliases: ["parachute"] },
];

// ── Weight extraction ────────────────────────────────────────────────────────

test("extracts kg weight and normalises to grams", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.equal(r.weightValue, 5000);
  assert.equal(r.weightUnit, "g");
});

test("extracts g weight", () => {
  const r = decomposeCanonical("Heer Basmati Rice Extra Long 500g", [], BRANDS);
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "g");
});

test("extracts gm weight (Indian abbreviation)", () => {
  const r = decomposeCanonical("Knorr Bouillon Cubes Chicken 400gm", [], BRANDS);
  assert.equal(r.weightValue, 400);
  assert.equal(r.weightUnit, "g");
});

test("extracts ml weight", () => {
  const r = decomposeCanonical("Parachute Coconut Oil 500ml", [], BRANDS);
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "ml");
});

test("extracts l weight and normalises to ml", () => {
  const r = decomposeCanonical("Parachute Coconut Oil 1l", [], BRANDS);
  assert.equal(r.weightValue, 1000);
  assert.equal(r.weightUnit, "ml");
});

test("returns null weight when no weight in name", () => {
  const r = decomposeCanonical("Aashirvaad Chakki Atta", [], BRANDS);
  assert.equal(r.weightValue, null);
  assert.equal(r.weightUnit, null);
});

// ── Weight in middle of name ─────────────────────────────────────────────────

test("extracts weight correctly when weight sits between brand and product", () => {
  const r = decomposeCanonical("Heer 500g Basmati Rice Extra Long", [], BRANDS);
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "g");
  const allTokens = [
    ...( r.brandSlots || []).flat(),
    ...r.baseProductSlots.flat(),
    ...r.typeSlots.flat(),
  ];
  assert.ok(!allTokens.some((t) => /\d/.test(t)), "no numeric token in slots");
});

// ── Brand slot — known brand found ───────────────────────────────────────────

test("recognised brand gets brand slot with name and aliases (deduplicated)", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.deepEqual(r.brandSlots, [["daawat", "dawat"]]);
});

test("brand matching is case-insensitive (canonical lowercased before token compare)", () => {
  const r = decomposeCanonical("AASHIRVAAD Chakki Atta 5kg", [], BRANDS);
  assert.ok(r.brandSlots !== null, "should find brand");
  assert.ok(r.brandSlots[0].includes("aashirvaad"), "brand slot includes canonical alias");
});

test("brand is found even when not the first token", () => {
  const r = decomposeCanonical("Organic Daawat Basmati Rice 5kg", [], BRANDS);
  assert.ok(r.brandSlots !== null, "brand found in non-first position");
  assert.ok(r.brandSlots[0].includes("daawat"));
  // "organic" should be in baseProductSlots, not brandSlots
  assert.ok(r.baseProductSlots.flat().includes("organic"));
});

// ── Brand slot — unknown brand → null ────────────────────────────────────────

test("unrecognised brand returns brandSlots = null", () => {
  const r = decomposeCanonical("Generic Basmati Rice 5kg", [], BRANDS);
  assert.equal(r.brandSlots, null);
});

test("empty name returns brandSlots = null", () => {
  const r = decomposeCanonical("", [], BRANDS);
  assert.equal(r.brandSlots, null);
  assert.deepEqual(r.baseProductSlots, []);
});

test("no brands list → brandSlots always null", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg", [], []);
  assert.equal(r.brandSlots, null);
});

// ── BBD stripping ─────────────────────────────────────────────────────────────

test("strips 'Best before DATE' before tokenising", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg Best before 12/2025", [], BRANDS);
  const all = [...(r.brandSlots || []).flat(), ...r.baseProductSlots.flat()];
  assert.ok(!all.includes("best"), "best stripped");
  assert.ok(!all.includes("before"), "before stripped");
});

test("strips 'BBD DATE' before tokenising", () => {
  const r = decomposeCanonical("Knorr Bouillon Cubes 400gm BBD 2025", [], BRANDS);
  const all = [...(r.brandSlots || []).flat(), ...r.baseProductSlots.flat()];
  assert.ok(!all.includes("bbd"), "bbd stripped");
});

test("strips 'MHD DATE' before tokenising", () => {
  const r = decomposeCanonical("Heer Basmati Rice 500g MHD 12.2025", [], BRANDS);
  const all = [...(r.brandSlots || []).flat(), ...r.baseProductSlots.flat()];
  assert.ok(!all.includes("mhd"), "mhd stripped");
});

test("strips noise parenthetical with digits (pack size / BBD)", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg (BBD 2025)", [], BRANDS);
  const allTokens = r.baseProductSlots.flat();
  assert.ok(!allTokens.includes("bbd"), "BBD note should be stripped");
  assert.ok(!allTokens.includes("2025"), "year should be stripped");
});

test("strips noise parenthetical with logistics words (Export Pack)", () => {
  const r = decomposeCanonical("Aashirvaad Atta (Export Pack) 5kg", [], BRANDS);
  const allTokens = r.baseProductSlots.flat();
  assert.ok(!allTokens.includes("export"), "export stripped as noise");
  assert.ok(!allTokens.includes("pack"), "pack stripped as noise");
});

test("preserves signal parenthetical as required baseProductSlot", () => {
  const BRITANNIA = [{ name: "Britannia", aliases: ["britannia"] }];
  const r = decomposeCanonical("Britannia Good Day (Butter) 216g", [], BRITANNIA);
  const allTokens = r.baseProductSlots.flat();
  assert.ok(allTokens.includes("butter"), "butter from parens becomes a required slot");
});

test("different flavour canonicals do not share slots — Butter vs Pistachio", () => {
  const BRITANNIA = [{ name: "Britannia", aliases: ["britannia"] }];
  const butter    = decomposeCanonical("Britannia Good Day (Butter) 216g", [], BRITANNIA);
  const pistachio = decomposeCanonical("Britannia Good Day (Pistachio Almond) 216g", [], BRITANNIA);
  assert.ok(butter.baseProductSlots.flat().includes("butter"),       "butter canonical has butter slot");
  assert.ok(!butter.baseProductSlots.flat().includes("pistachio"),   "butter canonical has no pistachio slot");
  assert.ok(pistachio.baseProductSlots.flat().includes("pistachio"), "pistachio canonical has pistachio slot");
  assert.ok(!pistachio.baseProductSlots.flat().includes("butter"),   "pistachio canonical has no butter slot");
});

// ── Base product slots ────────────────────────────────────────────────────────

test("each remaining non-brand word becomes its own slot group", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.deepEqual(r.baseProductSlots, [
    ["basmati"],
    ["rice"],
    ["extra"],
    ["long"],
  ]);
});

test("strips dashes from canonical name", () => {
  const r = decomposeCanonical("Daawat - Basmati Rice 5kg", [], BRANDS);
  assert.ok(r.brandSlots !== null);
  assert.deepEqual(r.baseProductSlots, [["basmati"], ["rice"]]);
});

// ── typeSlots ────────────────────────────────────────────────────────────────

test("typeSlots is always empty from decomposer", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.deepEqual(r.typeSlots, []);
});

// ── productGroupId ────────────────────────────────────────────────────────────

test("productGroupId is slug of non-brand, non-weight words", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.equal(r.productGroupId, "basmati-rice-extra-long");
});

test("productGroupId is weight-agnostic", () => {
  const r5kg  = decomposeCanonical("Heer Basmati Rice Extra Long 5kg", [], BRANDS);
  const r500g = decomposeCanonical("Heer Basmati Rice Extra Long 500g", [], BRANDS);
  assert.equal(r5kg.productGroupId, r500g.productGroupId);
});
