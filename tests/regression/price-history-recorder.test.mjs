import test from "node:test";
import assert from "node:assert/strict";

import recorderModule from "../../server/services/price-history-recorder.js";

const { recordStoreHistory } = recorderModule;

// Stub DB that captures INSERT params for inspection
function makeDb() {
  const rows = [];
  return {
    rows,
    execute: async (sql, params) => {
      if (/INSERT OR IGNORE INTO price_history/i.test(sql)) rows.push(params);
      return { rows: [] };
    },
  };
}

const BASE_OPTS = {
  crawlRunId: "run-1",
  crawlDate: "2026-04-11",
  crawlTimestamp: "2026-04-11T10:00:00.000Z",
  storeId: "jamoona",
};

// is_deal is the last element (index 21) of the INSERT param array
const IS_DEAL_IDX = 21;

// --- existing behaviour: explicit is_deal field is respected ---

test("recordStoreHistory respects explicit is_deal=1", async () => {
  const db = makeDb();
  await recordStoreHistory(db, {
    ...BASE_OPTS,
    deals: [{ sale_price: 2.99, product_url: "https://a.com/p", is_deal: 1 }],
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0][IS_DEAL_IDX], 1);
});

test("recordStoreHistory respects explicit is_deal=0", async () => {
  const db = makeDb();
  await recordStoreHistory(db, {
    ...BASE_OPTS,
    deals: [{ sale_price: 2.99, product_url: "https://a.com/p", is_deal: 0 }],
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0][IS_DEAL_IDX], 0);
});

test("recordStoreHistory infers is_deal=1 from compare_at_price > sale_price", async () => {
  const db = makeDb();
  await recordStoreHistory(db, {
    ...BASE_OPTS,
    deals: [
      {
        sale_price: 1.99,
        original_price: 3.49,
        product_url: "https://a.com/p",
      },
    ],
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0][IS_DEAL_IDX], 1);
});

// --- Bug 3: Pass-2 products without compare_at_price default to is_deal=0 ---

test("recordStoreHistory defaults to is_deal=0 for no-compare-price deal (old behaviour)", async () => {
  const db = makeDb();
  await recordStoreHistory(db, {
    ...BASE_OPTS,
    // No original_price, no explicit is_deal — old buggy path
    deals: [{ sale_price: 2.99, product_url: "https://a.com/p" }],
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0][IS_DEAL_IDX], 0); // old default
});

test("recordStoreHistory uses defaultIsDeal=1 for Pass-2 crawls without compare price", async () => {
  const db = makeDb();
  await recordStoreHistory(db, {
    ...BASE_OPTS,
    defaultIsDeal: 1,
    // No original_price, no explicit is_deal — should use defaultIsDeal
    deals: [{ sale_price: 2.99, product_url: "https://a.com/p" }],
  });
  assert.equal(db.rows.length, 1);
  assert.equal(
    db.rows[0][IS_DEAL_IDX],
    1,
    "Pass-2 deal without compare_at_price should be is_deal=1",
  );
});

test("defaultIsDeal does not override explicit is_deal=0", async () => {
  const db = makeDb();
  await recordStoreHistory(db, {
    ...BASE_OPTS,
    defaultIsDeal: 1,
    deals: [{ sale_price: 2.99, product_url: "https://a.com/p", is_deal: 0 }],
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0][IS_DEAL_IDX], 0, "explicit is_deal=0 must win over defaultIsDeal");
});
