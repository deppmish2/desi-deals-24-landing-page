import test from "node:test";
import assert from "node:assert/strict";

import dealOrder from "../../server/services/store-product-order.js";

const { buildStableDisplayOrder, dateSeed } = dealOrder;

test("buildStableDisplayOrder avoids adjacent same-store deals when enough stores exist", () => {
  const deals = [
    { id: "a1", store_id: "a" },
    { id: "a2", store_id: "a" },
    { id: "b1", store_id: "b" },
    { id: "b2", store_id: "b" },
    { id: "c1", store_id: "c" },
    { id: "c2", store_id: "c" },
  ];

  const ordered = buildStableDisplayOrder(deals, 20, dateSeed("2026-03-30"));

  assert.equal(ordered.length, deals.length);
  for (let i = 1; i < ordered.length; i += 1) {
    assert.notEqual(ordered[i - 1].store_id, ordered[i].store_id);
  }
});

test("buildStableDisplayOrder keeps all deals and respects page-level store cap when possible", () => {
  const deals = [
    { id: "a1", store_id: "a" },
    { id: "a2", store_id: "a" },
    { id: "a3", store_id: "a" },
    { id: "a4", store_id: "a" },
    { id: "b1", store_id: "b" },
    { id: "b2", store_id: "b" },
    { id: "c1", store_id: "c" },
    { id: "c2", store_id: "c" },
    { id: "d1", store_id: "d" },
    { id: "d2", store_id: "d" },
  ];

  const ordered = buildStableDisplayOrder(deals, 10, dateSeed("2026-03-30"));
  assert.equal(ordered.length, deals.length);

  const counts = ordered.reduce((acc, deal) => {
    acc[deal.store_id] = (acc[deal.store_id] || 0) + 1;
    return acc;
  }, {});

  assert.ok(counts.a <= 4);
  assert.ok(counts.b <= 2);
  assert.ok(counts.c <= 2);
  assert.ok(counts.d <= 2);
});
