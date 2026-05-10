import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parseItemIntent } = require("../../server/services/item-matcher.js");

test("parseItemIntent: paneer input gets itemType paneer", () => {
  const result = parseItemIntent("paneer 500g", null, null);
  assert.equal(result.itemType, "paneer",
    "ITEM_TYPE_KEYWORDS must contain [\"paneer\", \"paneer\"] — if missing, category filter has no type to match");
});

test("parseItemIntent: toor dal input gets itemType dal", () => {
  const result = parseItemIntent("toor dal 1kg", null, null);
  assert.equal(result.itemType, "dal");
});

test("parseItemIntent: masala input gets itemType masala", () => {
  const result = parseItemIntent("MDH Garam Masala 50g", null, null);
  assert.equal(result.itemType, "masala");
});

test("parseItemIntent: rice input gets itemType rice", () => {
  const result = parseItemIntent("basmati rice 5kg", null, null);
  assert.equal(result.itemType, "rice");
});

test("parseItemIntent: paneer with brand gets itemType paneer (not null)", () => {
  const result = parseItemIntent("Amul paneer", null, null);
  assert.equal(result.itemType, "paneer");
});

test("parseItemIntent: paneer masala gets itemType masala (not paneer)", () => {
  const result = parseItemIntent("MDH Karahi Paneer Masala", null, null);
  assert.equal(result.itemType, "masala",
    "paneer masala must not be classified as itemType paneer — check ITEM_TYPE_KEYWORDS ordering");
});
