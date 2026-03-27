"use strict";

/**
 * crisp_run spec — integration tests
 *
 * Covers the key production-readiness requirements from crisp_run.spec:
 *   1. Deals API returns correct structure + CDN cache headers
 *   2. Deals are served from the pre-built pool, not from a live crawl
 *   3. Stale (yesterday's) pool is NOT cached under today's key
 *   4. When today's pool exists, it is cached and served correctly
 *   5. Pool with 0 entries serves an empty array (not a crash)
 *   6. API handles no-pool-at-all gracefully (404 → empty data, not 500)
 *   7. Cache-Control header is present and correct on deals response
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createTestDb, isoNow } = require("./helpers");
const { getCurrentPoolDate } = require("../../server/services/daily-deals-pool");
const express = require("express");
const { Readable, Duplex } = require("stream");

// Minimal app builder — only mounts the deals route (the only one we need)
function buildDealsApp(dbMock) {
  const dbPath = require.resolve("../../server/db");
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: dbMock };
  try {
    // Purge deals route so it picks up the mock db
    const dealsPath = require.resolve("../../server/routes/deals");
    delete require.cache[dealsPath];
    // Also purge services that close over db
    [
      "../../server/services/daily-deals-pool",
      "../../server/services/deals-seed-loader",
      "../../server/services/event-tracker",
      "../../crawler/utils/snapshot",
    ].forEach(r => { try { delete require.cache[require.resolve(r)]; } catch {} });

    const dealsRouter = require("../../server/routes/deals");
    const app = express();
    app.use(express.json());
    app.use("/api/v1/deals", dealsRouter);
    return app;
  } finally {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  }
}

// Minimal in-process request dispatcher (no network)
async function dispatch(app, pathname, opts = {}) {
  const { method = "GET", body } = opts;
  class MockSocket extends Duplex {
    constructor() { super(); this.remoteAddress = "127.0.0.1"; this.encrypted = false; }
    _read() {} _write(_c, _e, cb) { cb(); }
    setTimeout() {} setNoDelay() {} setKeepAlive() {}
  }
  const payload = body != null ? JSON.stringify(body) : null;
  let sent = false;
  const req = new Readable({ read() { if (sent) { this.push(null); return; } sent = true; if (payload) this.push(Buffer.from(payload)); this.push(null); } });
  req.url = pathname; req.method = method;
  req.headers = { "content-type": "application/json", "content-length": payload ? String(Buffer.byteLength(payload)) : "0" };
  req.httpVersion = "1.1";
  const sock = new MockSocket();
  req.connection = sock; req.socket = sock;

  const chunks = [];
  const res = new Readable({ read() {} });
  res.statusCode = 200; res.headers = {}; res.locals = {};
  res.setHeader = (n, v) => { res.headers[String(n).toLowerCase()] = v; };
  res.getHeader = (n) => res.headers[String(n).toLowerCase()];
  res.getHeaders = () => ({ ...res.headers });
  res.removeHeader = (n) => { delete res.headers[String(n).toLowerCase()]; };
  res.write = (c) => { if (c != null) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.write(c); res.body = Buffer.concat(chunks).toString("utf8"); res.finished = true; res.emit("finish"); };

  await new Promise((resolve, reject) => {
    res.on("finish", resolve);
    app.handle(req, res, reject);
  });
  let json = null;
  try { if (res.body) json = JSON.parse(res.body); } catch { json = { raw: res.body }; }
  return { status: res.statusCode, json, headers: { ...res.headers } };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function sig(url) {
  return crypto.createHash("md5").update(url).digest("hex");
}

function seedStore(db, id = "store-a") {
  db.prepare(
    `INSERT OR IGNORE INTO stores (id, name, url) VALUES (?, ?, ?)`,
  ).run(id, `Store ${id}`, `https://${id}.example.com`);
}

function seedDeal(db, opts = {}) {
  const id = opts.id || crypto.randomUUID();
  const storeId = opts.store_id || "store-a";
  const url = opts.url || `https://${storeId}.example.com/p/${id}`;
  db.prepare(`
    INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, original_price, discount_percent, availability, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "run-1",
    isoNow(),
    storeId,
    opts.name || `Product ${id}`,
    opts.category || "Spices & Masalas",
    url,
    opts.sale_price ?? 2.99,
    opts.original_price ?? 4.99,
    opts.discount_percent ?? 40,
    opts.availability ?? "in_stock",
    opts.is_active ?? 1,
  );
  return { id, url };
}

function seedPoolEntry(db, poolDate, slotIndex, dealId, storeId, productUrl) {
  db.prepare(`
    INSERT OR IGNORE INTO daily_deal_pool_entries
      (pool_date, slot_index, deal_id, store_id, base_key, product_signature, category, product_name_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    poolDate,
    slotIndex,
    dealId,
    storeId,
    productUrl,
    sig(productUrl),
    "Spices & Masalas",
    `Snapshot ${slotIndex}`,
    isoNow(),
  );
}

function todayDate() {
  return getCurrentPoolDate();
}

function yesterdayDate() {
  const today = getCurrentPoolDate();
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) - 86400_000);
  return dt.toISOString().slice(0, 10);
}

// ── tests ─────────────────────────────────────────────────────────────────────

test("crisp-run: GET /api/v1/deals returns 200 with data + pagination", async () => {
  const { db } = createTestDb();
  seedStore(db);
  const today = todayDate();

  // Seed 3 deals + pool entries for today
  for (let i = 0; i < 3; i++) {
    const { id, url } = seedDeal(db, { store_id: "store-a" });
    seedPoolEntry(db, today, i + 1, id, "store-a", url);
  }

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res = await dispatch(app, "/api/v1/deals");
  assert.equal(res.status, 200, "status should be 200");
  assert.ok(Array.isArray(res.json.data), "data should be an array");
  assert.equal(res.json.data.length, 3, "should return 3 deals");
  assert.ok(res.json.pagination, "pagination should be present");
  assert.ok(res.json.pagination.total >= 3, "pagination.total >= 3");
});

test("crisp-run: deals response has Cache-Control header for CDN caching", async () => {
  const { db } = createTestDb();
  seedStore(db);
  const today = todayDate();

  const { id, url } = seedDeal(db, { store_id: "store-a" });
  seedPoolEntry(db, today, 1, id, "store-a", url);

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res = await dispatch(app, "/api/v1/deals");
  assert.equal(res.status, 200);
  const cc = res.headers["cache-control"] || "";
  assert.ok(cc.includes("s-maxage"), `Cache-Control should include s-maxage, got: "${cc}"`);
  assert.ok(cc.includes("stale-while-revalidate"), `Cache-Control should include stale-while-revalidate`);
});

test("crisp-run: deals API returns all active deals (open browsing, no pool)", async () => {
  const { db } = createTestDb();
  seedStore(db);
  seedStore(db, "store-b");

  // 5 active deals across two stores — all should be returned
  for (let i = 0; i < 5; i++) {
    seedDeal(db, { id: `deal-${i}`, store_id: i % 2 === 0 ? "store-a" : "store-b", url: `https://store-a.example.com/p/${i}` });
  }

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res = await dispatch(app, "/api/v1/deals");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 5, "all active deals should be returned");
  const returnedIds = res.json.data.map((d) => d.id);
  for (let i = 0; i < 5; i++) {
    assert.ok(returnedIds.includes(`deal-${i}`), `deal-${i} should be present`);
  }
});

test("crisp-run: inactive deals in pool are excluded (materialization filter)", async () => {
  const { db } = createTestDb();
  seedStore(db);
  const today = todayDate();

  // 2 deals in pool: 1 active, 1 inactive
  seedDeal(db, { id: "deal-active", store_id: "store-a", url: "https://store-a.example.com/active", is_active: 1 });
  seedDeal(db, { id: "deal-inactive", store_id: "store-a", url: "https://store-a.example.com/inactive", is_active: 0 });
  seedPoolEntry(db, today, 1, "deal-active", "store-a", "https://store-a.example.com/active");
  seedPoolEntry(db, today, 2, "deal-inactive", "store-a", "https://store-a.example.com/inactive");

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res = await dispatch(app, "/api/v1/deals");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1, "only active pool deals should materialize");
  assert.equal(res.json.data[0].id, "deal-active");
});

test("crisp-run: new active deals appear immediately (no stale pool)", async () => {
  // The system no longer uses a daily pool — newly crawled deals (is_active=1)
  // are immediately visible on the next request after the memory cache expires.
  const { db } = createTestDb();
  seedStore(db);

  // Start with 1 active deal
  const { id: id1, url: url1 } = seedDeal(db, {
    store_id: "store-a",
    name: "Existing Deal",
    url: "https://store-a.example.com/existing",
  });

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res1 = await dispatch(app, "/api/v1/deals");
  assert.equal(res1.status, 200);
  assert.equal(res1.json.data.length, 1);
  assert.equal(res1.json.data[0].id, id1);

  // Add a second deal — it's immediately active
  const { id: id2 } = seedDeal(db, {
    store_id: "store-a",
    name: "Brand New Deal",
    url: "https://store-a.example.com/new",
  });

  // A fresh app instance (no mem-cache) must see both deals
  const freshApp = buildDealsApp(db);
  const res2 = await dispatch(freshApp, "/api/v1/deals");
  assert.equal(res2.status, 200);
  assert.equal(res2.json.data.length, 2, "both deals should appear");
  const names = res2.json.data.map((d) => d.product_name);
  assert.ok(names.includes("Existing Deal"), "existing deal should be present");
  assert.ok(names.includes("Brand New Deal"), "new deal should be present");
});

test("crisp-run: deals response includes required fields per deal", async () => {
  const { db } = createTestDb();
  seedStore(db);
  const today = todayDate();

  const { id, url } = seedDeal(db, {
    store_id: "store-a",
    name: "Shan Biryani Masala",
    sale_price: 1.99,
    original_price: 3.49,
    discount_percent: 43,
  });
  seedPoolEntry(db, today, 1, id, "store-a", url);

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res = await dispatch(app, "/api/v1/deals");
  assert.equal(res.status, 200);
  assert.equal(res.json.data.length, 1);

  const deal = res.json.data[0];
  // Required fields per spec
  assert.ok(deal.id, "id required");
  assert.ok(deal.store, "store required");
  assert.ok(deal.store.id, "store.id required");
  assert.ok(deal.store.name, "store.name required");
  assert.ok(deal.product_name, "product_name required");
  assert.ok(deal.product_url, "product_url required");
  assert.equal(deal.sale_price, 1.99, "sale_price should match");
  assert.equal(deal.original_price, 3.49, "original_price should match");
  assert.equal(deal.discount_percent, 43, "discount_percent should match");
  assert.ok(deal.currency, "currency required");
});

test("crisp-run: empty pool returns empty data array (not 500)", async () => {
  const { db } = createTestDb();
  // No stores, no deals, no pool
  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const res = await dispatch(app, "/api/v1/deals");
  assert.equal(res.status, 200, "should not 500 on empty pool");
  assert.ok(Array.isArray(res.json.data), "data should still be an array");
  assert.equal(res.json.data.length, 0, "empty pool → empty data");
});

test("crisp-run: pagination works correctly on pool", async () => {
  const { db } = createTestDb();
  seedStore(db);
  const today = todayDate();

  for (let i = 0; i < 10; i++) {
    const id = `deal-${i}`;
    const url = `https://store-a.example.com/p/${i}`;
    seedDeal(db, { id, store_id: "store-a", url });
    seedPoolEntry(db, today, i + 1, id, "store-a", url);
  }

  db.ready = Promise.resolve();
  const app = buildDealsApp(db);

  const page1 = await dispatch(app, "/api/v1/deals?page=1&limit=4");
  assert.equal(page1.status, 200);
  assert.equal(page1.json.data.length, 4, "page 1 should have 4 items");
  assert.equal(page1.json.pagination.page, 1);

  const page2 = await dispatch(app, "/api/v1/deals?page=2&limit=4");
  assert.equal(page2.status, 200);
  assert.equal(page2.json.data.length, 4, "page 2 should have 4 items");
  assert.equal(page2.json.pagination.page, 2);

  const page3 = await dispatch(app, "/api/v1/deals?page=3&limit=4");
  assert.equal(page3.status, 200);
  assert.equal(page3.json.data.length, 2, "page 3 should have remaining 2 items");

  // No overlap between pages
  const ids1 = new Set(page1.json.data.map((d) => d.id));
  const ids2 = new Set(page2.json.data.map((d) => d.id));
  for (const id of ids2) {
    assert.ok(!ids1.has(id), `deal ${id} appeared on both page 1 and page 2`);
  }
});
