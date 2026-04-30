"use strict";
const test   = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, buildAppWithDb, startServer } = require("./helpers");

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

async function registerAndGetToken(api) {
  process.env.JWT_SECRET         = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  const r = await api.request("/api/v1/auth/register", {
    method: "POST",
    body: { email: "user@test.com", password: "pass1234", postcode: "80331" },
  });
  return { token: r.json.accessToken, userId: r.json.userId };
}

function seedList(db, listId, userId, status = "pending", storeId = null) {
  db.prepare(`INSERT INTO shopping_lists
    (id, user_id, name, status, completed_store_id)
    VALUES (?, ?, 'My Cart', ?, ?)`
  ).run(listId, userId, status, storeId);
  db.prepare(`INSERT INTO list_items
    (list_id, raw_item_text, quantity, item_count)
    VALUES (?, 'Toor Dal', 1, 1)`
  ).run(listId);
}

test("GET /api/v1/orders returns user's order history", async () => {
  const { db } = createTestDb();
  const app    = buildAppWithDb(db);
  const api    = await startServer(app);
  const { token } = await registerAndGetToken(api);

  const me = await api.request("/api/v1/me", { headers: authHeader(token) });
  const userId = me.json.data.id;

  db.prepare("INSERT INTO stores (id, name, url, platform) VALUES ('s1','Jamoona','https://jamoona.de','shopify')").run();
  seedList(db, "list-1", userId, "completed", "s1");
  seedList(db, "list-2", userId, "pending", null);

  const res = await api.request("/api/v1/orders", { headers: authHeader(token) });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.data));
  assert.equal(res.json.data.length, 2);

  const completed = res.json.data.find(o => o.id === "list-1");
  assert.equal(completed.status, "completed");
  assert.equal(completed.completed_store_id, "s1");

  const pending = res.json.data.find(o => o.id === "list-2");
  assert.equal(pending.status, "pending");
});

test("GET /api/v1/orders returns 401 for unauthenticated request", async () => {
  const { db } = createTestDb();
  const app    = buildAppWithDb(db);
  const api    = await startServer(app);

  const res = await api.request("/api/v1/orders");
  assert.equal(res.status, 401);
});

test("PATCH /api/v1/orders/:id/complete marks order completed with store", async () => {
  const { db } = createTestDb();
  const app    = buildAppWithDb(db);
  const api    = await startServer(app);
  const { token } = await registerAndGetToken(api);

  const me = await api.request("/api/v1/me", { headers: authHeader(token) });
  const userId = me.json.data.id;

  db.prepare("INSERT INTO stores (id, name, url, platform) VALUES ('s1','Jamoona','https://jamoona.de','shopify')").run();
  seedList(db, "list-1", userId, "pending", null);

  const res = await api.request("/api/v1/orders/list-1/complete", {
    method: "PATCH",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: { store_id: "s1" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.status, "completed");
  assert.equal(res.json.data.completed_store_id, "s1");
  assert.ok(res.json.data.completed_at);
});

test("PATCH /api/v1/orders/:id/complete returns 404 for another user's list", async () => {
  const { db } = createTestDb();
  const app    = buildAppWithDb(db);
  const api    = await startServer(app);

  process.env.JWT_SECRET         = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

  const r1 = await api.request("/api/v1/auth/register", {
    method: "POST",
    body: { email: "alice@test.com", password: "pass1234", postcode: "80331" },
  });
  const r2 = await api.request("/api/v1/auth/register", {
    method: "POST",
    body: { email: "bob@test.com", password: "pass1234", postcode: "80331" },
  });

  const aliceMe = await api.request("/api/v1/me", {
    headers: { Authorization: `Bearer ${r1.json.accessToken}` },
  });
  const aliceId = aliceMe.json.data.id;

  db.prepare("INSERT INTO stores (id, name, url, platform) VALUES ('s1','Jamoona','https://jamoona.de','shopify')").run();
  seedList(db, "alice-list", aliceId, "pending", null);

  const res = await api.request("/api/v1/orders/alice-list/complete", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${r2.json.accessToken}`, "Content-Type": "application/json" },
    body: { store_id: "s1" },
  });
  assert.equal(res.status, 404);
});

test("PATCH /api/v1/orders/:id/complete returns 400 when store_id missing", async () => {
  const { db } = createTestDb();
  const app    = buildAppWithDb(db);
  const api    = await startServer(app);
  const { token } = await registerAndGetToken(api);

  const me = await api.request("/api/v1/me", { headers: authHeader(token) });
  const userId = me.json.data.id;
  seedList(db, "list-1", userId);

  const res = await api.request("/api/v1/orders/list-1/complete", {
    method: "PATCH",
    headers: { ...authHeader(token), "Content-Type": "application/json" },
    body: {},
  });
  assert.equal(res.status, 400);
});
