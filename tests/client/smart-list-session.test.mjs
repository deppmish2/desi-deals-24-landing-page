import test from "node:test";
import assert from "node:assert/strict";

import {
  countSmartListItems,
  normalizeRequestedSmartListItems,
} from "../../client/src/utils/smartListSession.js";

test("normalizeRequestedSmartListItems converts explicit pack size and count into total quantity", () => {
  const [item] = normalizeRequestedSmartListItems([
    {
      raw_item_text: "Schani - Toor Dal",
      quantity: "1",
      quantity_unit: "kg",
      item_count: 3,
    },
  ]);

  assert.deepEqual(item, {
    raw_item_text: "Schani - Toor Dal",
    quantity: 3,
    quantity_unit: "kg",
    item_count: 1,
  });
});

test("normalizeRequestedSmartListItems leaves already-total explicit quantities stable", () => {
  const [item] = normalizeRequestedSmartListItems([
    {
      raw_item_text: "Schani - Toor Dal",
      quantity: 3,
      quantity_unit: "kg",
      item_count: 1,
    },
  ]);

  assert.deepEqual(item, {
    raw_item_text: "Schani - Toor Dal",
    quantity: 3,
    quantity_unit: "kg",
    item_count: 1,
  });
});

test("countSmartListItems uses pack count instead of mass quantity", () => {
  const total = countSmartListItems([
    {
      raw_item_text: "Schani - Toor Dal",
      quantity: 1,
      quantity_unit: "kg",
      item_count: 3,
    },
    {
      raw_item_text: "Basmati Rice",
      quantity: 5,
      quantity_unit: "kg",
      item_count: 1,
    },
  ]);

  assert.equal(total, 4);
});
