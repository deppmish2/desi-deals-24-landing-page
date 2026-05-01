"use strict";
const test   = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, buildAppWithDb, startServer } = require("./helpers");

function seed(db) {
  db.prepare(`INSERT INTO stores (id, name, url, platform) VALUES
    ('s1','Jamoona','https://jamoona.de','shopify'),
    ('s2','Grocera','https://grocera.de','shopify')`).run();
  db.prepare(`INSERT INTO canonical_products (id, canonical_name, category, image_url) VALUES
    ('c1','Toor Dal 500g','Lentils & Pulses','https://img/c1.jpg'),
    ('c2','Basmati Rice 1kg','Rice & Grains','https://img/c2.jpg')`).run();
  db.prepare(`INSERT INTO store_products
    (id,crawl_run_id,crawl_timestamp,store_id,product_name,product_category,
     product_url,sale_price,original_price,discount_percent,price_per_kg,best_before,is_active)
    VALUES
    ('sp1','r1','2026-04-30T00:00:00Z','s1','Schani Toor Dal 500g','Lentils',
     'https://jamoona.de/p/toor',1.99,2.99,33.4,3.98,NULL,1),
    ('sp2','r1','2026-04-30T00:00:00Z','s2','Toor Dal 500g','Lentils',
     'https://grocera.de/p/toor',2.49,NULL,NULL,4.98,NULL,1),
    ('sp3','r1','2026-04-30T00:00:00Z','s1','India Gate Basmati 1kg','Rice',
     'https://jamoona.de/p/rice',3.49,4.99,30.1,3.49,NULL,1)`).run();
  db.prepare(`INSERT INTO store_product_mappings
    (deal_id,canonical_id,match_method,match_confidence) VALUES
    ('sp1','c1','exact',1.0),
    ('sp2','c1','exact',1.0),
    ('sp3','c2','exact',1.0)`).run();
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function registerUser(api) {
  process.env.JWT_SECRET         = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  const r = await api.request("/api/v1/auth/register", {
    method: "POST",
    body: { email: "user@test.com", password: "pass1234", postcode: "80331" },
  });
  return r.json.accessToken;
}

test("POST /api/v1/compare/cart returns ranked stores for cart items", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: {
      items: [
        { canonical_id: "c1", quantity: 1, any_brand: false },
        { canonical_id: "c2", quantity: 1, any_brand: false },
      ],
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.json.item_count, 2);
  assert.ok(Array.isArray(res.json.stores));
  assert.ok(res.json.stores.length >= 1);

  // Jamoona has both c1 and c2 — should be present
  const jamoona = res.json.stores.find(s => s.store.id === "s1");
  assert.ok(jamoona, "Jamoona should be in results");
  assert.ok(jamoona.confirmed_total > 0);
  assert.equal(jamoona.coverage_pct, 1); // has both items
});

test("POST /api/v1/compare/cart marks unavailable items correctly", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  // Grocera (s2) only has c1, not c2
  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: {
      items: [
        { canonical_id: "c1", quantity: 1, any_brand: false },
        { canonical_id: "c2", quantity: 1, any_brand: false },
      ],
    },
  });
  assert.equal(res.status, 200);

  const grocera = res.json.stores.find(s => s.store.id === "s2");
  assert.ok(grocera, "Grocera should be in results");
  assert.ok(grocera.coverage_pct < 1);

  const unavailable = (grocera.items || []).filter(i => i.status === "unavailable");
  assert.ok(unavailable.some(i => i.canonical_id === "c2"), "c2 should be unavailable at Grocera");
});

test("POST /api/v1/compare/cart returns 401 for unauthenticated request", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: { items: [{ canonical_id: "c1", quantity: 1, any_brand: false }] },
  });
  assert.equal(res.status, 401);
});

test("POST /api/v1/compare/cart returns 400 for missing items", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: {},
  });
  assert.equal(res.status, 400);
});

test("POST /api/v1/compare/cart respects quantity in total", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: {
      items: [{ canonical_id: "c1", quantity: 3, any_brand: false }],
    },
  });
  assert.equal(res.status, 200);

  const jamoona = res.json.stores.find(s => s.store.id === "s1");
  // 3 × 1.99 = 5.97
  assert.ok(Math.abs(jamoona.confirmed_total - 5.97) < 0.01);
});

test("POST /api/v1/compare/cart returns 400 for item missing canonical_id", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: { items: [{ quantity: 1 }] },
  });
  assert.equal(res.status, 400);
});

test("POST /api/v1/compare/cart returns stores sorted ascending by confirmed_total", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: {
      items: [
        { canonical_id: "c1", quantity: 1, any_brand: false },
        { canonical_id: "c2", quantity: 1, any_brand: false },
      ],
    },
  });
  assert.equal(res.status, 200);
  const totals = res.json.stores.map((s) => s.confirmed_total);
  for (let i = 1; i < totals.length; i++) {
    assert.ok(
      totals[i] >= totals[i - 1],
      `stores not sorted: ${totals[i - 1]} > ${totals[i]}`,
    );
  }
});

test("POST /api/v1/compare/cart excludes stores with no available items", async () => {
  const { db } = createTestDb();
  seed(db);
  db.prepare(
    `INSERT INTO stores (id, name, url, platform) VALUES ('s3','EmptyStore','https://empty.de','shopify')`,
  ).run();
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: { items: [{ canonical_id: "c1", quantity: 1, any_brand: false }] },
  });
  assert.equal(res.status, 200);
  const ids = res.json.stores.map((s) => s.store.id);
  assert.ok(!ids.includes("s3"), "EmptyStore should be excluded");
});
