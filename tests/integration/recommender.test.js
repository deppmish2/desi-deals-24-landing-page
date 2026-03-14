"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const { recommendForList } = require("../../server/services/recommender");

test("recommendForList returns cheapest winner and cart transfer method", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Shopify Store", "https://shop1.example", "shopify");
  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s2", "Other Store", "https://shop2.example", "custom");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run("toor-dal", "toor dal", "Lentils & Pulses");

  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l1", "u1", "Weekly", nowIso());
  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, quantity, quantity_unit, resolved, unresolvable)
     VALUES (?, ?, ?, ?, ?, 1, 0)`,
  ).run("l1", "toor-dal", "toor dal", 1, "kg");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    "toor-dal",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://shop1.example/products/toor?variant=123456",
    2.1,
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d2",
    "run-1",
    nowIso(),
    "s2",
    "toor-dal",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://shop2.example/p/toor-dal",
    2.6,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l1",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner.store.id, "s1");
  assert.equal(result.winner.cart_transfer_method, "shopify_permalink");
  assert.match(result.winner.cart_url, /\/cart\//);
  assert.ok(Array.isArray(result.stores));
  assert.equal(result.stores.length, 1);
});

test("recommendForList prioritizes coverage over subtotal", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Store One", "https://s1.example", "shopify");
  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s2", "Store Two", "https://s2.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l2", "u1", "Weekly", nowIso());

  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run("toor-dal", "toor dal", "Lentils & Pulses");
  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run("garam-masala", "garam masala", "Spices");

  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, resolved, unresolvable)
     VALUES (?, ?, ?, 1, 0)`,
  ).run("l2", "toor-dal", "toor dal");
  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, resolved, unresolvable)
     VALUES (?, ?, ?, 1, 0)`,
  ).run("l2", "garam-masala", "garam masala");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    "toor-dal",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://s1.example/products/toor?variant=1001",
    1.5,
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d2",
    "run-1",
    nowIso(),
    "s2",
    "toor-dal",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://s2.example/products/toor?variant=2001",
    2.4,
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d3",
    "run-1",
    nowIso(),
    "s2",
    "garam-masala",
    "Garam Masala 200g",
    "Spices",
    "https://s2.example/products/garam?variant=2002",
    2.4,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l2",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner.store.id, "s2");
  assert.equal(result.winner.items_matched, 2);
  assert.equal(result.winner.items_total, 2);
  assert.equal(result.stores[0].store.id, "s2");
});

test("recommendForList token fallback matches noisy item text", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Store One", "https://s1.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l3", "u1", "Weekly", nowIso());

  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, resolved, unresolvable)
     VALUES (?, NULL, ?, 0, 1)`,
  ).run("l3", "maggie 5 packet of 500 gm");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Maggi Instant Noodles 560g",
    "Snacks",
    "https://s1.example/products/maggi?variant=3001",
    1.99,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l3",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner.store.id, "s1");
  assert.equal(result.winner.items_matched, 1);
  assert.equal(result.winner.items_total, 1);
});

test("recommendForList exposes transfer payload for each ranked store", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Store One", "https://s1.example", "shopify");
  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s2", "Store Two", "https://s2.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l4", "u1", "Weekly", nowIso());

  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, resolved, unresolvable)
     VALUES (?, NULL, ?, 0, 1)`,
  ).run("l4", "basmati rice");
  db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, resolved, unresolvable)
     VALUES (?, NULL, ?, 0, 1)`,
  ).run("l4", "toor dal");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Basmati Rice 1kg",
    "Rice",
    "https://s1.example/products/rice?variant=4001",
    2.2,
  );
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d2",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Toor Dal 1kg",
    "Lentils",
    "https://s1.example/products/toor?variant=4002",
    2.3,
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d3",
    "run-1",
    nowIso(),
    "s2",
    null,
    "Basmati Rice 1kg",
    "Rice",
    "https://s2.example/products/rice?variant=5001",
    2.4,
  );
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d4",
    "run-1",
    nowIso(),
    "s2",
    null,
    "Toor Dal 1kg",
    "Lentils",
    "https://s2.example/products/toor?variant=5002",
    2.1,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l4",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.stores.length, 2);
  for (const row of result.stores) {
    assert.ok(row.cart_url);
    assert.match(row.cart_url, /\/cart\//);
  }
});

test("recommendForList rejects match when requested brand differs", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Brand Store", "https://brand.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l5", "u1", "Brand Test", nowIso());
  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, brand_pref, resolved, unresolvable)
       VALUES (?, NULL, ?, ?, 0, 1)`,
  ).run("l5", "toor dal", "Annam");

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "TRS Toor Dal 1kg",
    "Lentils",
    "https://brand.example/products/toor?variant=7001",
    2.8,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l5",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner, null);
  assert.equal(result.stores.length, 0);
  assert.equal(result.reason, "no_store_with_any_match_and_auto_cart");
});

test("recommendForList rejects lowercase requested brand when matched brand differs", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Brand Store", "https://brand.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l6", "u1", "Brand Lowercase", nowIso());
  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, brand_pref, resolved, unresolvable)
       VALUES (?, NULL, ?, NULL, 0, 1)`,
  ).run("l6", "annam toor dal");

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Schani Toor Dal 1kg",
    "Lentils",
    "https://brand.example/products/toor?variant=7101",
    2.8,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l6",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner, null);
  assert.equal(result.stores.length, 0);
  assert.equal(result.reason, "no_store_with_any_match_and_auto_cart");
});

test("recommendForList treats 'brandA or brandB' as exact when either brand is matched", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run(
    "s1",
    "Brand Options Store",
    "https://brand-options.example",
    "shopify",
  );
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l7", "u1", "Brand Option Test", nowIso());
  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, brand_pref, resolved, unresolvable)
       VALUES (?, NULL, ?, NULL, 0, 1)`,
  ).run("l7", "everest or mdh garam masala");

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "MDH Garam Masala 100g",
    "Spices",
    "https://brand-options.example/products/garam?variant=7201",
    2.49,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l7",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner.store.id, "s1");
  assert.equal(result.winner.brand_info.length, 0);
  assert.equal(result.winner.matched_items.length, 1);
  assert.equal(result.winner.matched_items[0].match_quality, "exact");
  assert.ok(
    !result.winner.matched_items[0].warnings.some((warning) =>
      warning.startsWith("brand_differs:"),
    ),
  );
});

test("recommendForList rejects rice snack and wrong-brand rice for 'annam idly rice'", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Strict Match Store", "https://strict.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l9", "u1", "Strict Rice", nowIso());
  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, brand_pref, resolved, unresolvable)
       VALUES (?, NULL, ?, NULL, 0, 1)`,
  ).run("l9", "annam idly rice");

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Eco Life Organic Sona Masoori Rice 10kg",
    "Rice & Grains",
    "https://strict.example/products/eco-rice?variant=9001",
    15.99,
  );

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d2",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Annam Rice Murukku (Hot) 200gm",
    "Rice & Grains",
    "https://strict.example/products/annam-murukku?variant=9002",
    2.49,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l9",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner, null);
  assert.equal(result.stores.length, 0);
  assert.equal(result.reason, "no_store_with_any_match_and_auto_cart");
});

test("recommendForList snaps near-250g dal requests to practical 250g/500g packs", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Quarter Pack Store", "https://s1.example", "shopify");
  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s2", "Half Pack Store", "https://s2.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l8", "u1", "Practical Weight", nowIso());
  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, quantity, quantity_unit, resolved, unresolvable)
       VALUES (?, NULL, ?, ?, ?, 0, 1)`,
  ).run("l8", "toor dal", 252, "g");

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Toor Dal 250g",
    "Lentils",
    "https://s1.example/products/toor-250?variant=8101",
    2.8,
    250,
    "g",
  );
  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "d2",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Toor Dal 500g",
    "Lentils",
    "https://s1.example/products/toor-500?variant=8102",
    3.2,
    500,
    "g",
  );

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "d3",
    "run-1",
    nowIso(),
    "s2",
    null,
    "Toor Dal 500g",
    "Lentils",
    "https://s2.example/products/toor-500?variant=8201",
    2.2,
    500,
    "g",
  );
  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "d4",
    "run-1",
    nowIso(),
    "s2",
    null,
    "Toor Dal 1kg",
    "Lentils",
    "https://s2.example/products/toor-1000?variant=8202",
    1.9,
    1,
    "kg",
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l8",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  const byStore = new Map(result.stores.map((row) => [row.store.id, row]));
  const s1 = byStore.get("s1");
  const s2 = byStore.get("s2");
  assert.ok(s1);
  assert.ok(s2);

  assert.equal(Number(s1.matched_items[0].weight_value), 250);
  assert.equal(s1.matched_items[0].weight_unit, "g");
  assert.equal(s1.matched_items[0].packs_needed, 1);

  assert.equal(Number(s2.matched_items[0].weight_value), 500);
  assert.equal(s2.matched_items[0].weight_unit, "g");
  assert.equal(s2.matched_items[0].packs_needed, 1);
});

test("recommendForList returns partial match diagnostics when no store has full cart", async () => {
  const db = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform) VALUES (?, ?, ?, ?)",
  ).run("s1", "Single Match Store", "https://s1.example", "shopify");
  db.prepare("INSERT INTO users (id, email, postcode) VALUES (?, ?, ?)").run(
    "u1",
    "u1@example.com",
    "80331",
  );
  db.prepare(
    "INSERT INTO shopping_lists (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
  ).run("l9", "u1", "Partial Result", nowIso());

  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, resolved, unresolvable)
       VALUES (?, NULL, ?, 0, 1)`,
  ).run("l9", "basmati rice");
  db.prepare(
    `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, resolved, unresolvable)
       VALUES (?, NULL, ?, 0, 1)`,
  ).run("l9", "toor dal");

  db.prepare(
    `INSERT INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
         product_url, sale_price, currency, availability, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    nowIso(),
    "s1",
    null,
    "Basmati Rice 1kg",
    "Rice",
    "https://s1.example/products/rice?variant=9101",
    2.7,
  );

  const result = await recommendForList(db, {
    user: { id: "u1" },
    listId: "l9",
    postcode: "80331",
    deliveryPreference: "cheapest",
  });

  assert.equal(result.winner?.store?.id, "s1");
  assert.equal(result.winner?.items_matched, 1);
  assert.equal(result.winner?.items_total, 2);
  assert.ok(result.winner?.items_not_found.includes("toor dal"));
  assert.equal(result.stores.length, 1);
  assert.ok(Array.isArray(result.partial_matches));
  assert.equal(result.partial_matches.length, 1);
  assert.equal(result.partial_matches[0].items_matched, 1);
  assert.equal(result.partial_matches[0].items_total, 2);
  assert.ok(result.partial_matches[0].items_not_found.includes("toor dal"));
  assert.deepEqual(result.requested_items, ["basmati rice", "toor dal"]);
});
