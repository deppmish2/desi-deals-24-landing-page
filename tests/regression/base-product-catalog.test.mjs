import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { resolveBaseProduct } = require("../../server/services/base-product-catalog.js");

test("resolveBaseProduct: fresh paneer resolves to base_key paneer", () => {
  const result = resolveBaseProduct("Ayurveda Indian Paneer 500g");
  assert.ok(result, "should resolve to a catalog entry");
  assert.equal(result.base_key, "paneer");
});

test("resolveBaseProduct: MDH Karahi Paneer Masala does NOT resolve to base_key paneer", () => {
  const result = resolveBaseProduct("MDH Karahi Paneer Masala");
  // Must resolve to a spice entry — NOT the paneer dairy entry.
  // If this fails, remove the 'Paneer Masala' row added to the CSV catalog.
  if (result) {
    assert.notEqual(result.base_key, "paneer",
      `'MDH Karahi Paneer Masala' must not resolve to base_key 'paneer' — ` +
      `it incorrectly collides with fresh paneer products. Add a Paneer Masala row to the CSV.`);
  }
  // null is also acceptable (no match better than wrong match)
});

test("resolveBaseProduct: toor dal resolves to toor dal", () => {
  const result = resolveBaseProduct("Schani Toor Dal 2kg");
  assert.ok(result);
  assert.equal(result.base_key, "toor dal");
});

test("resolveBaseProduct: fresh produce returns null (Fresh prefix guard)", () => {
  assert.equal(resolveBaseProduct("Fresh Green Chilli"), null);
  assert.equal(resolveBaseProduct("Fresh Coriander"), null);
});
