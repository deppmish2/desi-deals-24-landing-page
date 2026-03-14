"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveBaseProduct,
  detectBrandForBase,
} = require("../../server/services/base-product-catalog");

test("resolveBaseProduct maps grocery text to CSV-backed canonical base product", () => {
  const resolved = resolveBaseProduct("Schani Toor Dal 2kg");
  assert.ok(resolved);
  assert.equal(resolved.base_product, "Toor Dal");
  assert.equal(resolved.base_key, "toor dal");
});

test("resolveBaseProduct handles common spelling variants like daal", () => {
  const resolved = resolveBaseProduct("Schani Toor Daal 1kg");
  assert.ok(resolved);
  assert.equal(resolved.base_product, "Toor Dal");
  assert.equal(resolved.base_key, "toor dal");
});

test("detectBrandForBase finds known CSV brand for a base product", () => {
  const resolved = resolveBaseProduct("Toor Dal");
  assert.ok(resolved);
  const brand = detectBrandForBase("TRS Toor Dal 1kg", resolved.base_key);
  assert.equal(brand, "TRS");
});
