"use strict";

const test    = require("node:test");
const assert  = require("node:assert/strict");
const express = require("express");
const http    = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const fs      = require("fs");
const path    = require("path");

const { signJwt } = require("../../server/utils/jwt");
const createOrdersRouter = require("../../server/routes/orders");

const JWT_SECRET = "test-secret";
const USER_ID    = "user-test-001";
const STORE_ID   = "jamoona";

// Wrap DatabaseSync to look async (matches libsql interface used by routes)
function wrapDb(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        async run(...a) { return stmt.run(...a); },
        async get(...a) { return stmt.get(...a); },
        async all(...a) { return stmt.all(...a); },
      };
    },
  };
}

function createTestDb() {
  const raw = new DatabaseSync(":memory:");
  const schema = fs.readFileSync(
    path.join(__dirname, "../../server/db/schema.sql"),
    "utf8"
  );
  // node:sqlite does not support fts5; strip the virtual table before exec
  const schemaNoFts = schema.replace(
    /CREATE VIRTUAL TABLE[\s\S]*?USING fts5[\s\S]*?;/g,
    ""
  );
  raw.exec(schemaNoFts);
  // Apply orders migration columns (alwaysMigrations not run in test env)
  const migrations = [
    "ALTER TABLE shopping_lists ADD COLUMN order_status TEXT DEFAULT 'pending'",
    "ALTER TABLE shopping_lists ADD COLUMN savings_eur REAL",
    "ALTER TABLE shopping_lists ADD COLUMN total_eur REAL",
    "ALTER TABLE shopping_lists ADD COLUMN rating INTEGER",
    "ALTER TABLE shopping_lists ADD COLUMN eta_date TEXT",
    "ALTER TABLE shopping_lists ADD COLUMN issue_text TEXT",
    "ALTER TABLE shopping_lists ADD COLUMN tracking_url TEXT",
  ];
  for (const sql of migrations) {
    try { raw.exec(sql); } catch { /* already exists */ }
  }
  return raw;
}

function makeToken(userId = USER_ID) {
  return signJwt({ sub: userId, email: "test@example.com", type: "access" }, JWT_SECRET, 3600);
}

async function startApp(db) {
  // Stub requireUserAuth using the real JWT verifier but with test secret
  process.env.JWT_SECRET = JWT_SECRET;
  const router = createOrdersRouter(wrapDb(db));
  const app = express();
  app.use(express.json());
  app.use("/", router);
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function req(server, method, path, body, token) {
  const port = server.address().port;
  const url = `http://127.0.0.1:${port}${path}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, opts);
  const json = await res.json();
  return { status: res.status, body: json };
}

function seedData(db) {
  db.exec(`INSERT INTO users (id, email, postcode) VALUES ('${USER_ID}', 'test@example.com', '10115')`);
  db.exec(`INSERT INTO stores (id, name, url) VALUES ('${STORE_ID}', 'Jamoona', 'https://jamoona.de')`);
  db.exec(`
    INSERT INTO shopping_lists (id, user_id, name, status, completed_store_id, completed_at, order_status)
    VALUES
      ('list-completed-1', '${USER_ID}', 'List 1', 'completed', '${STORE_ID}', '2026-05-01T10:00:00Z', 'pending'),
      ('list-completed-2', '${USER_ID}', 'List 2', 'completed', '${STORE_ID}', '2026-05-02T10:00:00Z', 'delivered'),
      ('list-active-1',    '${USER_ID}', 'Active', 'pending',   NULL,          NULL,                   'pending')
  `);
  db.exec(`
    INSERT INTO list_items (list_id, raw_item_text, item_count)
    VALUES ('list-completed-1', 'Basmati Rice 5kg', 1), ('list-completed-1', 'Jeera 200g', 2)
  `);
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("GET /orders returns only completed lists with items", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status, body } = await req(server, "GET", "/", null, makeToken());
  assert.equal(status, 200);
  assert.equal(body.data.length, 2);
  assert.ok(body.data.every(o => o.status === "completed"));
  const list1 = body.data.find(o => o.id === "list-completed-1");
  assert.equal(list1.items.length, 2);
});

test("GET /orders returns 401 without token", async (t) => {
  const raw = createTestDb();
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status } = await req(server, "GET", "/");
  assert.equal(status, 401);
});

test("PATCH /handoff sets order_status=pending and status=completed", async (t) => {
  const raw = createTestDb();
  raw.exec(`INSERT INTO users (id, email, postcode) VALUES ('${USER_ID}', 'test@example.com', '10115')`);
  raw.exec(`INSERT INTO stores (id, name, url) VALUES ('${STORE_ID}', 'Jamoona', 'https://jamoona.de')`);
  raw.exec(`INSERT INTO shopping_lists (id, user_id, name, status) VALUES ('list-new', '${USER_ID}', 'My List', 'pending')`);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status, body } = await req(server, "PATCH", "/list-new/handoff",
    { store_id: STORE_ID, savings_eur: 3.5, total_eur: 22.0 }, makeToken());
  assert.equal(status, 200);
  assert.equal(body.data.status, "completed");
  assert.equal(body.data.order_status, "pending");
  assert.equal(body.data.savings_eur, 3.5);
});

test("PATCH /confirm advances pending → placed", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status, body } = await req(server, "PATCH", "/list-completed-1/confirm", {}, makeToken());
  assert.equal(status, 200);
  assert.equal(body.data.order_status, "placed");
});

test("PATCH /confirm rejects non-pending orders", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  // list-completed-2 has order_status='delivered'
  const { status } = await req(server, "PATCH", "/list-completed-2/confirm", {}, makeToken());
  assert.equal(status, 400);
});

test("DELETE /orders/:id removes the list", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status, body } = await req(server, "DELETE", "/list-completed-1", null, makeToken());
  assert.equal(status, 200);
  assert.equal(body.data.deleted, true);

  const remaining = raw.prepare("SELECT id FROM shopping_lists WHERE id = 'list-completed-1'").get();
  assert.equal(remaining, undefined);
});

test("PATCH /rating stores 1-5 rating", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status, body } = await req(server, "PATCH", "/list-completed-1/rating", { rating: 4 }, makeToken());
  assert.equal(status, 200);
  assert.equal(body.data.rating, 4);
});

test("PATCH /rating rejects out-of-range values", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status } = await req(server, "PATCH", "/list-completed-1/rating", { rating: 6 }, makeToken());
  assert.equal(status, 400);
});

test("PATCH /status advances order_status", async (t) => {
  const raw = createTestDb();
  seedData(raw);
  const server = await startApp(raw);
  t.after(() => server.close());

  const { status, body } = await req(server, "PATCH", "/list-completed-1/status",
    { order_status: "shipped", tracking_url: "https://track.example.com/123" }, makeToken());
  assert.equal(status, 200);
  assert.equal(body.data.order_status, "shipped");
});
