import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { mapCategory } = require("../../crawler/utils/category-mapper.js");

test("mapCategory: 'Priya Ready to Eat Quick Pulihora Poha Bundle' → Ready Meals & Mixes", () => {
  assert.equal(
    mapCategory("Priya Ready to Eat Quick Pulihora Poha Bundle"),
    "Ready Meals & Mixes",
  );
});

test("mapCategory: 'Quick Oats' → Rice & Grains (no false positive — oats not a grain trigger)", () => {
  assert.equal(mapCategory("Quick Oats"), "Rice & Grains");
});

test("mapCategory: 'Maggi 2-Minute Instant Noodles' → Noodles & Pasta (instant + noodle, not grain)", () => {
  assert.equal(mapCategory("Maggi 2-Minute Instant Noodles"), "Noodles & Pasta");
});

test("mapCategory: 'MTR Ready to Eat Upma' → Ready Meals & Mixes (no quick/instant — standalone phrase)", () => {
  assert.equal(mapCategory("MTR Ready to Eat Upma"), "Ready Meals & Mixes");
});

test("mapCategory: 'Instant-Upma Cup' → Ready Meals & Mixes (hyphenated compound token)", () => {
  assert.equal(mapCategory("Instant-Upma Cup"), "Ready Meals & Mixes");
});
