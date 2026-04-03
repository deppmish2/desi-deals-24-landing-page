import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseDiscountBadge } = require("../../crawler/utils/discount-badge");

test("parseDiscountBadge extracts percent values from common badge text", () => {
  assert.equal(parseDiscountBadge("-20%"), 20);
  assert.equal(parseDiscountBadge("Sale 17%"), 17);
  assert.equal(parseDiscountBadge("75% off"), 75);
  assert.equal(parseDiscountBadge("Save 12,5 %"), 12.5);
});

test("parseDiscountBadge returns null when no percent is present", () => {
  assert.equal(parseDiscountBadge("Sale item"), null);
  assert.equal(parseDiscountBadge(""), null);
  assert.equal(parseDiscountBadge(null), null);
});
