# Testing Patterns

**Analysis Date:** 2026-05-04

## Test Framework

**Runner:**
- Node.js built-in `node:test` (no Jest, no Vitest, no Mocha)
- Node 20.x required (engines constraint in `package.json`)
- Config: no config file — invoked directly via `node --test <glob>`

**Assertion Library:**
- `node:assert/strict` — all assertions use the strict variant

**Run Commands:**
```bash
node --test tests/regression/*.test.mjs   # Regression: pure unit tests for crawler utils
node --test tests/integration/*.test.js  # Integration: services + DB with in-memory SQLite
node --test tests/e2e/*.test.js          # E2E: full HTTP stack with real Express + in-memory SQLite
node --test tests/client/*.test.mjs      # Client: browser utility functions, no DOM
```

npm scripts:
```bash
npm run test:regression    # regression suite
npm run test:integration   # integration suite
npm run test:e2e           # e2e suite
```

Note: `--reporter=spec` is recommended when running manually to reduce TAP noise (per CLAUDE.md). Not baked into npm scripts.

## Test File Organization

**Location:** Separate `tests/` directory at repo root. Not co-located with source.

**Directory layout:**
```
tests/
├── regression/    # *.test.mjs  — crawler utils, client utils, pure logic
├── integration/   # *.test.js   — server services with real DB schema
├── e2e/           # *.test.js   — full HTTP routes + auth + DB
├── client/        # *.test.mjs  — client-side utility functions
└── e2e/helpers.js             — shared HTTP test harness
    integration/helpers.js     — shared createTestDb + nowIso
```

**Naming:** `<subject>.<type>.test.[mjs|js]`
- `weight-parser.test.mjs`, `canonicalizer.test.js`, `routes.e2e.test.js`
- Regression and client tests use `.mjs` (ESM) to match source modules under `client/src/utils/*.mjs`
- Integration and E2E use `.js` (CommonJS) matching the backend

## Test Structure

**No describe blocks.** All tests are flat top-level `test()` calls:

```js
// Integration pattern (CommonJS)
const test   = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb } = require("./helpers");
const { canonicalizeDeals } = require("../../server/services/canonicalizer");

test("canonicalizeDeals queues no-match deals instead of creating canonical products", async () => {
  const db = createTestDb();
  // seed data inline...
  const stats = await canonicalizeDeals(db, { runId: "run-1" });
  assert.equal(stats.scanned, 1);
  assert.equal(stats.manual_review, 1);
});
```

```mjs
// Regression pattern (ESM)
import test from "node:test";
import assert from "node:assert/strict";
import weightParser from "../../crawler/utils/weight-parser.js";
const { parseWeight } = weightParser;

test("parseWeight handles plain gm suffix", () => {
  assert.deepEqual(parseWeight("Knorr Bouillon 400gm"), {
    raw: "400gm", value: 400, unit: "g",
  });
});
```

**Each test is self-contained.** DB is created fresh per test. No shared state between tests.

## In-Memory Database Setup

**Integration tests** use `tests/integration/helpers.js`:
```js
const { DatabaseSync } = require("node:sqlite");
function createTestDb() {
  const db = new DatabaseSync(":memory:");
  const schema = fs.readFileSync("server/db/schema.sql", "utf8");
  db.exec(schema);
  return db;  // plain DatabaseSync instance
}
```

**E2E tests** use `tests/e2e/helpers.js` which wraps `DatabaseSync` in an async-compatible shim:
```js
// createSqliteWrapper wraps DatabaseSync to match libsql Promises interface
function createSqliteWrapper(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        async run(...a) { return stmt.run(...a); },
        async get(...a) { return stmt.get(...a); },
        async all(...a) { return stmt.all(...a); },
      };
    },
    transaction(fn) { /* BEGIN/COMMIT/ROLLBACK wrapper */ },
  };
}
function createTestDb() {
  const raw = new DatabaseSync(":memory:");
  // Strip CREATE VIRTUAL TABLE ... USING fts5 — not available in node:sqlite
  const schema = fs.readFileSync("server/db/schema.sql", "utf8")
    .replace(/CREATE VIRTUAL TABLE[\s\S]*?USING fts5[\s\S]*?\);/gi, "");
  raw.exec(schema);
  return { raw, db: createSqliteWrapper(raw) };
}
```

**Important:** FTS5 virtual tables are stripped from the schema in all test environments. Tests must not rely on full-text search.

**Orders tests** apply additional `ALTER TABLE` migrations inline (columns added post-schema) inside their own `createTestDb`:
```js
for (const sql of migrations) {
  try { raw.exec(sql); } catch { /* already exists */ }
}
```

## E2E HTTP Harness

`tests/e2e/helpers.js` provides a full in-process HTTP harness:

```js
function buildAppWithDb(dbMock) {
  // Injects dbMock into require.cache for server/db
  // Purges and re-requires all route and service modules
  // Returns configured Express app
}

async function startServer(app) {
  // Returns api object with:
  //   api.request(path, { method, headers, body }) → { status, json }
  // Uses MockSocket (Duplex stream) to simulate HTTP without binding a port
}
```

Typical E2E test:
```js
test("POST /api/v1/compare/cart returns ranked stores", async () => {
  const { db } = createTestDb();
  seed(db);                          // insert stores, products, mappings
  const app = buildAppWithDb(db);
  const api = await startServer(app);
  const token = await registerUser(api);

  const res = await api.request("/api/v1/compare/cart", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: { items: [{ canonical_id: "c1", quantity: 1 }] },
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.stores);
});
```

## Mocking

**No mock library.** Mocking is manual:

**DB injection (E2E):** `require.cache` manipulation in `buildAppWithDb` — replaces the `server/db` module export with the test DB wrapper. All route and service modules are purged from cache and re-required to pick up the injected DB.

**DB stubs (regression):** Minimal in-memory objects with just the methods needed:
```js
function makeDb() {
  const inserts = [];
  return {
    inserts,
    execute: async (sql, params) => {
      if (/INSERT INTO store_product_mappings/i.test(sql)) inserts.push(params);
      return { rows: [] };
    },
    batch: async (stmts) => { /* capture inserts */ },
  };
}
```

**Environment variables:** Set directly on `process.env` at the start of each test that needs them:
```js
process.env.JWT_SECRET = "test-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.ADMIN_SECRET = "test-admin-secret";
delete process.env.ANTHROPIC_API_KEY;
```

**What to mock:** External HTTP calls (fetch), env vars, DB when testing pure logic.
**What NOT to mock:** Database layer in integration/e2e tests — use real `node:sqlite` in-memory DB with full schema.

## Fixtures and Seed Data

No fixture files. All test data is seeded inline via `db.prepare(...).run(...)` calls within each test or in a local `seed(db)` function at the top of the test file:

```js
function seed(db) {
  db.prepare(`INSERT INTO stores (id, name, url, platform) VALUES
    ('s1','Jamoona','https://jamoona.de','shopify'),
    ('s2','Grocera','https://grocera.de','shopify')`).run();
  db.prepare(`INSERT INTO canonical_products ...`).run();
  db.prepare(`INSERT INTO store_products ...`).run();
  db.prepare(`INSERT INTO store_product_mappings ...`).run();
}
```

Multi-row inserts use multi-value `VALUES (…),(…)` syntax for brevity.

## Coverage

**Requirements:** None enforced. No coverage threshold configured.

No coverage command in `package.json`. Run manually with:
```bash
node --test --experimental-test-coverage tests/integration/*.test.js
```

## Test Types

**Regression tests** (`tests/regression/*.test.mjs`):
- Pure unit tests for crawler utilities and client-side logic.
- No DB, no HTTP, no network.
- Target: `crawler/utils/` functions (`weight-parser`, `category-mapper`, `auto-mapper`) and `client/src/utils/` functions (`dealsViewState`, `defaultDealsCache`, `smartListSession`).
- Regression focus: specific bug fixes that must not regress. Test names often reference the bug.

**Integration tests** (`tests/integration/*.test.js`):
- Test server services (`server/services/`) against real in-memory SQLite.
- No HTTP layer — call service functions directly.
- Target: `canonicalizer`, `cart-comparator`, `recommender`, `alert-evaluator`, `product-replacements`, `orders`, `fuzzy-matcher`, `normaliser`.
- Use `tests/integration/helpers.js` for `createTestDb()`.

**E2E tests** (`tests/e2e/*.test.js`):
- Test full HTTP routes via in-process Express with injected DB.
- Cover auth flow, route shapes, status codes, and JSON response structure.
- Files: `routes.e2e.test.js` (core routes + auth), `platform-v1-cart-compare.e2e.test.js`, `platform-v1-catalog.e2e.test.js`, `platform-v1-orders.e2e.test.js`.
- Use `tests/e2e/helpers.js` for `createTestDb`, `buildAppWithDb`, `startServer`.

**Client tests** (`tests/client/*.test.mjs`):
- Test browser-side utility functions that have no DOM dependency.
- No browser/jsdom — pure logic only.
- Files: `smart-list-session.test.mjs`, `combination-display.test.mjs`.

## Common Patterns

**Async testing:**
```js
test("description", async () => {
  const result = await serviceFunction(db, args);
  assert.equal(result.field, expected);
});
```

**Error / negative case testing:**
```js
test("returns null when no match", async () => {
  const resolved = await resolveQueryToCanonicalId(db, "unknown product", "Snacks", { createIfMissing: false });
  assert.equal(resolved.canonical_id, null);
});
```

**Shape assertions:** Use `assert.deepEqual` for exact object shape, `assert.equal` for scalar values, `assert.ok` for truthy checks, `assert.ok(queued, "message")` for truthiness with diagnostic message.

**HTTP status assertions (E2E):**
```js
assert.equal(res.status, 200);
assert.equal(res.status, 201);
assert.equal(res.status, 400);
assert.ok(res.json.accessToken);
```

---

*Testing analysis: 2026-05-04*
