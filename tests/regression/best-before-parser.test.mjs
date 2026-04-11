import test from "node:test";
import assert from "node:assert/strict";

import bestBeforeParser from "../../crawler/utils/best-before-parser.js";

const { parseBestBefore } = bestBeforeParser;

test("parseBestBefore detects plain Exp dates used by Yogi Mart titles", () => {
  assert.equal(
    parseBestBefore("Heera Mulethi Whole (Liquorice) 100g - Exp 28.02.2026"),
    "2026-02",
  );
});

test("parseBestBefore detects plain Expiry dates used by Spicelands product pages", () => {
  assert.equal(
    parseBestBefore(
      "PediaSure Health & Nutrition Drink Chocolate Jar 400g Expiry 27.11.2024",
    ),
    "2024-11",
  );
});

test("parseBestBefore keeps working for slash-separated Spicelands expiry strings", () => {
  assert.equal(
    parseBestBefore(
      "PediaSure Health & Nutrition Drink Vanilla Jar 400g Expiry 01.01/25.01.2025",
    ),
    "2025-01",
  );
});
