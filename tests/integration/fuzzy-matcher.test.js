"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fuzzyMatch } = require("../../crawler/entity-resolution/fuzzy-matcher");

test("fuzzyMatch returns fuzzy for score >= 0.90", () => {
  // Same string → score 1.0
  const result = fuzzyMatch("toor dal", ["toor dal"]);
  assert.ok(result);
  assert.equal(result.method, "fuzzy");
  assert.ok(result.confidence >= 0.90);
});

test("fuzzyMatch returns null for score < 0.90 (chana dal vs toor dal)", () => {
  // Regression: "Lovely Chana Dal" must NOT match "Lovely Toor Dal" canonical
  const result = fuzzyMatch("lovely chana dal", ["lovely toor dal"]);
  assert.equal(result, null);
});

test("fuzzyMatch returns null for moderately similar strings", () => {
  const result = fuzzyMatch("aashirvaad atta 5kg", ["aashirvaad maida 5kg"]);
  assert.equal(result, null);
});

test("fuzzyMatch returns null when no candidates", () => {
  assert.equal(fuzzyMatch("anything", []), null);
  assert.equal(fuzzyMatch("", ["something"]), null);
});
