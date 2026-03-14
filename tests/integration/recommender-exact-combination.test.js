"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const {
  recommendForList,
  searchStrictReplacementOptions,
} = require("../../server/services/recommender");

function insertStore(db, id, name = "Store") {
  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run(id, name, `https://${id}.example`, "shopify");
}

function insertUserAndList(db, { userId, listId }) {
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    userId,
    `${userId}@example.com`,
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run(listId, userId, "Weekly", nowIso());
}

function insertCanonical(db, canonicalId, name, category = "Lentils & Pulses") {
  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run(canonicalId, name, category);
}

function insertListItem(db, { listId, canonicalId, rawText, qty, unit, itemCount = 1 }) {
  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, resolved, unresolvable)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
  ).run(listId, canonicalId, rawText, qty, unit, itemCount);
}

function insertDeal(db, deal) {
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    deal.id,
    "run-1",
    nowIso(),
    deal.storeId,
    deal.canonicalId,
    deal.productName,
    deal.category || "Lentils & Pulses",
    deal.productUrl || `https://${deal.storeId}.example/products/${deal.id}`,
    deal.price,
    deal.weightValue,
    deal.weightUnit,
  );
}

test("recommendForList uses cheapest exact pack combination for requested quantity", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Combo Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertCanonical(db, "toor-dal", "toor dal");
  insertListItem(db, {
    listId: "l1",
    canonicalId: "toor-dal",
    rawText: "toor dal",
    qty: 2,
    unit: "kg",
  });

  insertDeal(db, {
    id: "d500",
    storeId: "s1",
    canonicalId: "toor-dal",
    productName: "Toor Dal 500g",
    price: 1.4,
    weightValue: 500,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "d1000",
    storeId: "s1",
    canonicalId: "toor-dal",
    productName: "Toor Dal 1kg",
    price: 2.8,
    weightValue: 1,
    weightUnit: "kg",
  });
  insertDeal(db, {
    id: "d2000",
    storeId: "s1",
    canonicalId: "toor-dal",
    productName: "Toor Dal 2kg",
    price: 5.8,
    weightValue: 2,
    weightUnit: "kg",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  assert.equal(result.winner?.matched_items?.length, 1);
  const row = result.winner.matched_items[0];
  assert.equal(row.effective_price, 5.6);
  assert.ok(Array.isArray(row.combination));
  const matchedTotal = row.combination.reduce((sum, part) => {
    const weight = Number(part.weight_value || 0);
    const unit = String(part.weight_unit || "").toLowerCase();
    const count = Number(part.count || 0);
    return sum + (unit === "kg" ? weight * 1000 : weight) * count;
  }, 0);
  assert.equal(matchedTotal, 2000);
  assert.ok(row.packs_needed >= 1);
});

test("recommendForList marks item unavailable when no exact quantity combination exists", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "No Exact Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertCanonical(db, "toor-dal", "toor dal");
  insertListItem(db, {
    listId: "l1",
    canonicalId: "toor-dal",
    rawText: "toor dal",
    qty: 1,
    unit: "kg",
  });

  insertDeal(db, {
    id: "d750",
    storeId: "s1",
    canonicalId: "toor-dal",
    productName: "Toor Dal 750g",
    price: 2.2,
    weightValue: 750,
    weightUnit: "g",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner, null);
  assert.equal(result.stores.length, 0);
  assert.equal(result.reason, "no_store_with_any_match");
});

test("recommendForList prefers exact combination even when non-exact single pack looks cheaper", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Strict Exact Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertCanonical(db, "toor-dal", "toor dal");
  insertListItem(db, {
    listId: "l1",
    canonicalId: "toor-dal",
    rawText: "toor dal",
    qty: 750,
    unit: "g",
  });

  insertDeal(db, {
    id: "d500",
    storeId: "s1",
    canonicalId: "toor-dal",
    productName: "Toor Dal 500g",
    price: 1,
    weightValue: 500,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "d250",
    storeId: "s1",
    canonicalId: "toor-dal",
    productName: "Toor Dal 250g",
    price: 2,
    weightValue: 250,
    weightUnit: "g",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  const row = result.winner.matched_items[0];
  assert.equal(row.effective_price, 3);
  assert.equal(row.packs_needed, 2);
  assert.ok(Array.isArray(row.combination));
  assert.equal(
    row.combination.reduce((sum, c) => sum + Number(c.count || 0), 0),
    2,
  );
});

test("recommendForList treats multipack titles as exact structured sizes", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Multipack Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertListItem(db, {
    listId: "l1",
    canonicalId: null,
    rawText: "Schani Toor Dal",
    qty: 1,
    unit: "kg",
  });

  insertDeal(db, {
    id: "bundle-2x500",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal Bundle 2 x 500g",
    price: 3.98,
    weightValue: 500,
    weightUnit: "g",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  const row = result.winner.matched_items[0];
  assert.equal(row.product_name, "Schani Toor Dal Bundle 2 x 500g");
  assert.equal(row.effective_price, 3.98);
  assert.equal(row.packs_needed, 1);
  assert.equal(row.matched_total_quantity, 1);
  assert.equal(String(row.matched_total_unit).toLowerCase(), "kg");
  assert.ok(Array.isArray(row.combination));
  assert.equal(row.combination[0].count, 1);
});

test("recommendForList falls back to same base product across brands when requested brand cannot satisfy exact quantity", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Fallback Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertListItem(db, {
    listId: "l1",
    canonicalId: null,
    rawText: "Schani Toor Dal",
    qty: 2,
    unit: "kg",
  });

  insertDeal(db, {
    id: "schani-750",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 750g",
    price: 2.4,
    weightValue: 750,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "trs-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "TRS Toor Dal 1kg",
    price: 2.6,
    weightValue: 1,
    weightUnit: "kg",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  const row = result.winner.matched_items[0];
  assert.equal(row.base_product, "Toor Dal");
  assert.equal(row.brand_status, "changed");
  assert.equal(row.effective_price, 5.2);
  assert.equal(row.packs_needed, 2);
});

test("recommendForList ignores stale size-mismatched canonical links and still finds the exact combination", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Canonical Guard Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertCanonical(db, "schani-2kg-toor-dal", "Schani - 2kg Toor Dal");
  insertListItem(db, {
    listId: "l1",
    canonicalId: "schani-2kg-toor-dal",
    rawText: "Schani Toor Dal",
    qty: 1,
    unit: "kg",
  });

  insertDeal(db, {
    id: "schani-2kg",
    storeId: "s1",
    canonicalId: "schani-2kg-toor-dal",
    productName: "Schani - 2kg Toor Dal",
    price: 6.49,
    weightValue: 2,
    weightUnit: "kg",
  });
  insertDeal(db, {
    id: "schani-500",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 500g",
    price: 1.99,
    weightValue: 500,
    weightUnit: "g",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  const row = result.winner?.matched_items?.[0];
  assert.ok(row);
  assert.equal(row.effective_price, 3.98);
  assert.equal(row.packs_needed, 2);
  assert.ok(Array.isArray(row.combination));
  assert.equal(row.combination[0].product_name, "Schani Toor Dal 500g");
  assert.equal(row.combination[0].count, 2);
});

test("recommendForList treats mass-volume quantity as total requested quantity even if stale item_count is present", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Total Quantity Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertListItem(db, {
    listId: "l1",
    canonicalId: null,
    rawText: "Schani Toor Dal",
    qty: 3,
    unit: "kg",
    itemCount: 3,
  });

  insertDeal(db, {
    id: "trs-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "TRS Toor Dal 1kg",
    price: 3.99,
    weightValue: 1,
    weightUnit: "kg",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  const row = result.winner?.matched_items?.[0];
  assert.ok(row);
  assert.equal(row.effective_price, 11.97);
  assert.equal(row.packs_needed, 3);
  assert.equal(row.matched_total_quantity, 3);
  assert.equal(String(row.matched_total_unit).toLowerCase(), "kg");
  assert.ok(Array.isArray(row.combination));
  assert.equal(row.combination[0].count, 3);
});

test("recommendForList does not substitute a different base product", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Strict Base Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertListItem(db, {
    listId: "l1",
    canonicalId: null,
    rawText: "Schani Toor Dal",
    qty: 1,
    unit: "kg",
  });

  insertDeal(db, {
    id: "schani-chana-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Chana Dal 1kg",
    price: 2.1,
    weightValue: 1,
    weightUnit: "kg",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner, null);
  assert.equal(result.stores.length, 0);
  assert.equal(result.reason, "no_store_with_any_match");
});

test("recommendForList requires CSV base-product resolution for mass/volume matching", async () => {
  const db = createTestDb();

  insertStore(db, "s1", "Unresolved Base Store");
  insertUserAndList(db, { userId: "u1", listId: "l1" });
  insertListItem(db, {
    listId: "l1",
    canonicalId: null,
    rawText: "Xyzz Dal",
    qty: 1,
    unit: "kg",
  });

  insertDeal(db, {
    id: "xyzz-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "Xyzz Dal 1kg",
    price: 2.9,
    weightValue: 1,
    weightUnit: "kg",
  });

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner, null);
  assert.equal(result.stores.length, 0);
  assert.equal(result.reason, "no_store_with_any_match");
});

test("searchStrictReplacementOptions follows brand-first then same-base fallback", () => {
  const db = createTestDb();

  insertStore(db, "s1", "Replacement Strict Store");
  insertDeal(db, {
    id: "schani-750",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 750g",
    price: 2.4,
    weightValue: 750,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "trs-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "TRS Toor Dal 1kg",
    price: 2.6,
    weightValue: 1,
    weightUnit: "kg",
  });

  const strict = searchStrictReplacementOptions(db, {
    storeId: "s1",
    listItem: {
      raw_item_text: "Schani Toor Dal",
      canonical_name: null,
      quantity: 2,
      quantity_unit: "kg",
      item_count: 1,
      brand_pref: null,
    },
    queryOverride: "Schani Toor Dal",
  });

  assert.equal(strict.stage, "base_fallback");
  assert.equal(strict.fallback_applied, true);
  assert.ok(Array.isArray(strict.results));
  assert.equal(strict.results[0].base_product, "Toor Dal");
  assert.equal(strict.results[0].brand_status, "changed");
  assert.equal(strict.results[0].effective_price, 5.2);
});

test("searchStrictReplacementOptions tolerates spelling variants and keeps original base product", () => {
  const db = createTestDb();

  insertStore(db, "s1", "Replacement Variant Store");
  insertDeal(db, {
    id: "schani-500",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 500g",
    price: 1.99,
    weightValue: 500,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "schani-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 1kg",
    price: 4.5,
    weightValue: 1,
    weightUnit: "kg",
  });

  const strict = searchStrictReplacementOptions(db, {
    storeId: "s1",
    listItem: {
      raw_item_text: "Schani Toor Dal",
      canonical_name: null,
      quantity: 1,
      quantity_unit: "kg",
      item_count: 1,
      brand_pref: null,
    },
    queryOverride: "schani toor daal",
  });

  assert.equal(strict.stage, "brand_strict");
  assert.equal(strict.fallback_applied, false);
  assert.equal(strict.base_product, "Toor Dal");
  assert.ok(Array.isArray(strict.results));
  assert.equal(strict.results[0].product_name, "Schani Toor Dal 500g");
  assert.equal(strict.results[0].effective_price, 3.98);
  assert.equal(strict.results[0].packs_needed, 2);
  assert.equal(strict.results[0].brand_status, "exact");
});

test("searchStrictReplacementOptions returns addable store candidates when only non-exact packs exist", () => {
  const db = createTestDb();

  insertStore(db, "s1", "Checked Candidate Store");
  insertDeal(db, {
    id: "schani-2kg",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 2kg",
    price: 6.49,
    weightValue: 2,
    weightUnit: "kg",
  });

  const strict = searchStrictReplacementOptions(db, {
    storeId: "s1",
    listItem: {
      raw_item_text: "Schani Toor Dal",
      canonical_name: null,
      quantity: 1,
      quantity_unit: "kg",
      item_count: 1,
      brand_pref: null,
    },
    queryOverride: "Schani Toor Dal",
  });

  assert.equal(strict.stage, "base_fallback");
  assert.equal(strict.results_mode, "available");
  assert.equal(strict.reason, "available_non_exact_matches");
  assert.equal(strict.results.length, 1);
  assert.equal(strict.results[0].product_name, "Schani Toor Dal 2kg");
  assert.equal(strict.results[0].candidate_total_quantity, 2);
  assert.equal(strict.results[0].candidate_total_unit, "kg");
  assert.equal(strict.results[0].exact_quantity, false);
  assert.equal(strict.results[0].packs_needed, 1);
  assert.ok(Array.isArray(strict.results[0].combination));
});

test("searchStrictReplacementOptions surfaces exact pack alternatives for the full requested quantity", () => {
  const db = createTestDb();

  insertStore(db, "s1", "Exact Pack Alternative Store");
  insertDeal(db, {
    id: "schani-500",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 500g",
    price: 1.99,
    weightValue: 500,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "schani-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 1kg",
    price: 4.0,
    weightValue: 1,
    weightUnit: "kg",
  });

  const strict = searchStrictReplacementOptions(db, {
    storeId: "s1",
    listItem: {
      raw_item_text: "Schani Toor Dal",
      canonical_name: null,
      quantity: 3,
      quantity_unit: "kg",
      item_count: 1,
      brand_pref: null,
    },
    queryOverride: "Schani Toor Dal",
  });

  assert.equal(strict.stage, "brand_strict");
  assert.equal(strict.results_mode, "exact");
  assert.equal(strict.requested_quantity, 3);
  assert.equal(strict.requested_unit, "kg");

  const comboSummaries = strict.results.map((row) =>
    row.combination
      .map((part) => `${part.product_name}:${part.count}`)
      .join("|"),
  );
  assert.ok(
    comboSummaries.includes("Schani Toor Dal 500g:6"),
    "expected 500g x 6 exact option",
  );
  assert.ok(
    comboSummaries.includes("Schani Toor Dal 1kg:3"),
    "expected 1kg x 3 exact option",
  );

  const exactRows = strict.results.filter(
    (row) =>
      row.matched_total_quantity === 3 &&
      String(row.matched_total_unit).toLowerCase() === "kg",
  );
  assert.ok(exactRows.length >= 2);

  for (const row of exactRows) {
    assert.equal(row.matched_total_quantity, 3);
    assert.equal(String(row.matched_total_unit).toLowerCase(), "kg");
  }
});

test("searchStrictReplacementOptions keeps exact matches first and appends broader same-base options", () => {
  const db = createTestDb();

  insertStore(db, "s1", "Expanded Replacement Store");
  insertDeal(db, {
    id: "schani-500",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 500g",
    price: 1.99,
    weightValue: 500,
    weightUnit: "g",
  });
  insertDeal(db, {
    id: "schani-1kg",
    storeId: "s1",
    canonicalId: null,
    productName: "Schani Toor Dal 1kg",
    price: 4.1,
    weightValue: 1,
    weightUnit: "kg",
  });
  insertDeal(db, {
    id: "trs-2kg",
    storeId: "s1",
    canonicalId: null,
    productName: "TRS Toor Dal 2kg",
    price: 6.49,
    weightValue: 2,
    weightUnit: "kg",
  });

  const strict = searchStrictReplacementOptions(db, {
    storeId: "s1",
    listItem: {
      raw_item_text: "Schani Toor Dal",
      canonical_name: null,
      quantity: 1,
      quantity_unit: "kg",
      item_count: 1,
      brand_pref: null,
    },
    queryOverride: "Schani Toor Dal",
    maxResults: 10,
  });

  assert.equal(strict.results_mode, "exact");
  assert.equal(strict.more_options_included, true);
  assert.equal(strict.results[0].matched_total_quantity, 1);
  assert.equal(String(strict.results[0].matched_total_unit).toLowerCase(), "kg");
  assert.ok(
    strict.results.some((row) => row.product_name === "TRS Toor Dal 2kg"),
    "expected broader same-base replacement options after exact matches",
  );
});
