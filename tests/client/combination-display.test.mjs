import test from "node:test";
import assert from "node:assert/strict";

import {
  formatCombinationSummary,
  getCombinationTotal,
} from "../../client/src/utils/combinationDisplay.js";

test("formatCombinationSummary expands bundle sizes for display", () => {
  const summary = formatCombinationSummary([
    {
      product_name: "Tirupati Toor Dal Plain / Pigeon Peas (Bundle of 2 x 1kg)",
      weight_value: 1,
      weight_unit: "kg",
      count: 1,
    },
    {
      product_name: "Tirupati Toor Dal Plain / Pigeon Peas (1kg)",
      weight_value: 1,
      weight_unit: "kg",
      count: 1,
    },
  ]);

  assert.equal(summary, "2kg x 1 + 1kg x 1");
});

test("getCombinationTotal sums bundle rows to the true matched total", () => {
  const total = getCombinationTotal([
    {
      product_name: "Tirupati Toor Dal Plain / Pigeon Peas (Bundle of 2 x 1kg)",
      weight_value: 1,
      weight_unit: "kg",
      count: 1,
    },
    {
      product_name: "Tirupati Toor Dal Plain / Pigeon Peas (1kg)",
      weight_value: 1,
      weight_unit: "kg",
      count: 1,
    },
  ]);

  assert.deepEqual(total, { value: 3, unit: "kg" });
});
