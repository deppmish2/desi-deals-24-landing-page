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

test("GET /api/v1/catalog returns canonical products with cheapest price and store count", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  const res = await api.request("/api/v1/catalog");
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.data));
  assert.equal(res.json.data.length, 2);

  const toorDal = res.json.data.find(p => p.canonical_id === "c1");
  assert.ok(toorDal, "c1 should be in results");
  assert.equal(toorDal.canonical_name, "Toor Dal 500g");
  assert.equal(toorDal.cheapest_price, 1.99);
  assert.equal(toorDal.cheapest_store_name, "Jamoona");
  assert.equal(toorDal.store_count, 2);
  assert.equal(toorDal.category, "Lentils & Pulses");
  assert.equal(toorDal.image_url, "https://img/c1.jpg");
});

test("GET /api/v1/catalog filters by category", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  const res = await api.request("/api/v1/catalog?category=Rice+%26+Grains");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);
  assert.equal(res.json.data[0].canonical_id, "c2");
});

test("GET /api/v1/catalog filters by store", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  // s2 (Grocera) only has c1
  const res = await api.request("/api/v1/catalog?store=s2");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);
  assert.equal(res.json.data[0].canonical_id, "c1");
});

test("GET /api/v1/catalog?is_discounted=1 returns only discounted products", async () => {
  const { db } = createTestDb();
  seed(db);
  // Add a canonical whose ONLY listing has no discount
  db.prepare(`INSERT INTO canonical_products (id, canonical_name, category) VALUES
    ('c3','Plain Salt 1kg','Other')`).run();
  db.prepare(`INSERT INTO store_products
    (id,crawl_run_id,crawl_timestamp,store_id,product_name,product_category,
     product_url,sale_price,original_price,discount_percent,price_per_kg,best_before,is_active)
    VALUES ('sp4','r1','2026-04-30T00:00:00Z','s1','Salt 1kg','Other',
     'https://jamoona.de/p/salt',0.99,NULL,NULL,NULL,NULL,1)`).run();
  db.prepare(`INSERT INTO store_product_mappings (deal_id,canonical_id,match_method,match_confidence)
    VALUES ('sp4','c3','exact',1.0)`).run();

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  // Without filter: all 3 canonical products appear
  const resAll = await api.request("/api/v1/catalog");
  assert.equal(resAll.json.data.length, 3);

  // With filter: only c1 and c2 (have discount_percent > 0 on cheapest listing)
  const res = await api.request("/api/v1/catalog?is_discounted=1");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 2);
  assert.ok(!res.json.data.find(p => p.canonical_id === "c3"), "non-discounted product must be excluded");
});

test("GET /api/v1/catalog?hide_expired=1 excludes products with past best_before", async () => {
  const { db } = createTestDb();
  seed(db);
  // Add an expired listing for a new canonical
  db.prepare(`INSERT INTO canonical_products (id, canonical_name, category) VALUES
    ('c3','Expired Ghee','Oils & Ghee')`).run();
  db.prepare(`INSERT INTO store_products
    (id,crawl_run_id,crawl_timestamp,store_id,product_name,product_category,
     product_url,sale_price,best_before,is_active)
    VALUES ('sp4','r1','2026-04-30T00:00:00Z','s1','Old Ghee','Oils',
     'https://jamoona.de/p/ghee',2.99,'2026-01-01',1)`).run();
  db.prepare(`INSERT INTO store_product_mappings (deal_id,canonical_id,match_method,match_confidence)
    VALUES ('sp4','c3','exact',1.0)`).run();

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  const resAll = await api.request("/api/v1/catalog");
  assert.equal(resAll.json.data.length, 3); // c1, c2, c3

  const resHide = await api.request("/api/v1/catalog?hide_expired=1");
  assert.equal(resHide.json.data.length, 2); // c3 excluded
  assert.ok(!resHide.json.data.find(p => p.canonical_id === "c3"));
});

test("GET /api/v1/catalog paginates correctly", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  const res = await api.request("/api/v1/catalog?limit=1&page=1");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);
  assert.ok(res.json.pagination);
  assert.equal(res.json.pagination.total, 2);
  assert.equal(res.json.pagination.total_pages, 2);
});

test("GET /api/v1/catalog?q= filters by product name", async () => {
  const { db } = createTestDb();
  seed(db);
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  const res = await api.request("/api/v1/catalog?q=Toor");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);
  assert.equal(res.json.data[0].canonical_id, "c1");
});
