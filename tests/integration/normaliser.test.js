"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalise } = require("../../crawler/entity-resolution/normaliser");

test("normaliser: strips 'best before' phrase", () => {
  const result = normalise("Nanak - (Best Before 15/03/2026) 454g Rasmalai");
  assert.ok(!result.includes("best before"), `expected no 'best before' in: ${result}`);
});

test("normaliser: strips BBD shorthand", () => {
  const result = normalise("Daawat 10kg Chakki Atta BBD September 2026");
  assert.ok(!result.includes("bbd"), `expected no 'bbd' in: ${result}`);
});

test("normaliser: strips 4-digit year", () => {
  const a = normalise("MDH - (Best Before 31/01/2026) 100g Chutney Masala Podina");
  const b = normalise("MDH - (Best Before 31/01/2027) 100g Chutney Masala Podina");
  assert.equal(a, b, "same product with different year should normalise identically");
});

test("normaliser: same product different BBD year produces same normalised form", () => {
  const v1 = normalise("Schani - (Best Before 30/04/2026) 500g Basmati Rice");
  const v2 = normalise("Schani - (Best Before 30/04/2027) 500g Basmati Rice");
  assert.equal(v1, v2);
});

test("normaliser: strips 'use by' phrase", () => {
  const result = normalise("TRS Use By 2026 Coriander Seeds 100g");
  assert.ok(!result.includes("use by"), `expected no 'use by' in: ${result}`);
  assert.ok(!result.includes("2026"), `expected no year in: ${result}`);
});

test("normaliser: preserves brand and product name after BBD stripping", () => {
  const result = normalise("Nanak - (Best Before 15/03/2026) 454g Rasmalai 8 Pieces");
  assert.ok(result.includes("nanak"), `expected brand in: ${result}`);
  assert.ok(result.includes("rasmalai"), `expected product in: ${result}`);
});

test("normaliser: non-BBD product name unchanged by BBD rules", () => {
  const result = normalise("TRS Cinnamon Sticks 50g");
  assert.equal(result, "trs cinnamon sticks 50g");
});
