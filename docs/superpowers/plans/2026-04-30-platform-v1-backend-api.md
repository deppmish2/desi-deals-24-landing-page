# Platform v1 Backend API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and integration-test the 5 new backend API endpoints required by Platform v1: canonical product catalog, search auto-suggest, direct cart comparison, and order history.

**Architecture:** Three new route files (`catalog.js`, `compare.js`, `orders.js`) and one new service (`cart-comparator.js`). Each is independently testable. DB migration adds 3 columns to `shopping_lists` for order history. All tests use the existing `node:test` + in-memory SQLite pattern from `tests/e2e/helpers.js`.

**Tech Stack:** Node.js (CommonJS), Express, better-sqlite3 (prod) / node:sqlite (tests), node:test + node:assert/strict

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `server/routes/catalog.js` | `GET /api/v1/catalog` and `GET /api/v1/catalog/suggest` |
| Create | `server/routes/compare.js` | `POST /api/v1/compare/cart` |
| Create | `server/routes/orders.js` | `GET /api/v1/orders` and `PATCH /api/v1/orders/:id/complete` |
| Create | `server/services/cart-comparator.js` | Pure comparison logic — takes cart items + db, returns ranked stores |
| Modify | `server/db/index.js` | Add migration: status/completed columns on `shopping_lists` |
| Modify | `server/index.js` | Mount 3 new routers |
| Modify | `tests/e2e/helpers.js` | Add 3 new routes to `buildAppWithDb` |
| Create | `tests/e2e/platform-v1-catalog.e2e.test.js` | Tests for catalog + suggest |
| Create | `tests/e2e/platform-v1-cart-compare.e2e.test.js` | Tests for cart comparison |
| Create | `tests/e2e/platform-v1-orders.e2e.test.js` | Tests for order history |

---

## Shared Test Seed Helper

All 3 test files use the same seed pattern. Each file defines its own `seed(db)` function inline — do not extract to a shared file (test files should be self-contained and readable out of order).

Seed pattern used throughout:

```js
function seed(db) {
  db.prepare(`INSERT INTO stores (id, name, url, platform) VALUES
    ('s1', 'Jamoona', 'https://jamoona.de', 'shopify'),
    ('s2', 'Grocera', 'https://grocera.de', 'shopify')`).run();

  db.prepare(`INSERT INTO canonical_products (id, canonical_name, category, image_url) VALUES
    ('c1', 'Toor Dal 500g',   'Lentils & Pulses', 'https://img/c1.jpg'),
    ('c2', 'Basmati Rice 1kg','Rice & Grains',    'https://img/c2.jpg')`).run();

  // c1: s1 has it cheapest (1.99), s2 also has it (2.49)
  // c2: only s1 has it (3.49, discounted from 4.99)
  db.prepare(`INSERT INTO store_products
    (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
     product_url, sale_price, original_price, discount_percent, price_per_kg,
     best_before, is_active)
    VALUES
    ('sp1','r1','2026-04-30T00:00:00Z','s1','Schani Toor Dal 500g','Lentils',
     'https://jamoona.de/p/toor','1.99','2.99','33.4','3.98',NULL,1),
    ('sp2','r1','2026-04-30T00:00:00Z','s2','Toor Dal 500g','Lentils',
     'https://grocera.de/p/toor','2.49',NULL,NULL,'4.98',NULL,1),
    ('sp3','r1','2026-04-30T00:00:00Z','s1','India Gate Basmati 1kg','Rice',
     'https://jamoona.de/p/rice','3.49','4.99','30.1','3.49',NULL,1)`).run();

  db.prepare(`INSERT INTO store_product_mappings
    (deal_id, canonical_id, match_method, match_confidence) VALUES
    ('sp1','c1','exact',1.0),
    ('sp2','c1','exact',1.0),
    ('sp3','c2','exact',1.0)`).run();
}
```

---

## Task 1: DB Migration — Order History Columns

**Why two places:** `schema.sql` is loaded fresh for every test's in-memory DB via `createTestDb()` — runtime migrations in `db/index.js` never run against it. Both files must be updated: `schema.sql` for tests, `db/index.js` for existing prod DBs.

**Files:**
- Modify: `server/db/schema.sql`
- Modify: `server/db/index.js`

- [ ] **Step 1: Add columns to `server/db/schema.sql`**

  Find the `CREATE TABLE IF NOT EXISTS shopping_lists` block (around line 205). Add 3 columns before the closing `);`:

  ```sql
  CREATE TABLE IF NOT EXISTS shopping_lists (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                  TEXT NOT NULL,
    raw_input             TEXT,
    input_method          TEXT,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at          DATETIME,
    reorder_reminder_days INTEGER,
    status                TEXT DEFAULT 'pending',
    completed_store_id    TEXT REFERENCES stores(id),
    completed_at          DATETIME
  );
  ```

- [ ] **Step 2: Add runtime migrations to `server/db/index.js`**

  Find the `migrations` array (around line 297). Append to the end of it:

  ```js
  "ALTER TABLE shopping_lists ADD COLUMN status TEXT DEFAULT 'pending'",
  "ALTER TABLE shopping_lists ADD COLUMN completed_store_id TEXT",
  "ALTER TABLE shopping_lists ADD COLUMN completed_at DATETIME",
  ```

  These are wrapped in try/catch by the existing migration runner — no extra wrapping needed.

- [ ] **Step 3: Verify migration runs cleanly**

  ```bash
  node -e "require('./server/db')" && echo "OK"
  ```
  Expected: `OK` (no errors)

- [ ] **Step 4: Commit**

  ```bash
  git add server/db/schema.sql server/db/index.js
  git commit -m "feat(db): add order status columns to shopping_lists"
  ```

---

## Task 2: Catalog Route + Tests

### 2a — Write failing tests

**Files:**
- Create: `tests/e2e/platform-v1-catalog.e2e.test.js`

- [ ] **Step 1: Create test file**

  ```js
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
    const app = buildAppWithDb(db);
    const api = await startServer(app);

    // sp1 (c1) has discount_percent=33.4, sp3 (c2) has 30.1; sp2 (c1) has no discount
    // Both c1 and c2 have at least one discounted listing
    const res = await api.request("/api/v1/catalog?is_discounted=1");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.length, 2);
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
  ```

- [ ] **Step 2: Run to confirm all tests fail**

  ```bash
  node --test tests/e2e/platform-v1-catalog.e2e.test.js 2>&1 | grep -E "FAIL|Error|not found" | head -10
  ```
  Expected: failures because `/api/v1/catalog` route doesn't exist yet.

### 2b — Implement catalog route

**Files:**
- Create: `server/routes/catalog.js`

- [ ] **Step 3: Create the catalog route**

  ```js
  "use strict";
  const express = require("express");
  const db      = require("../db");
  const router  = express.Router();

  const CATALOG_SQL = `
    WITH ranked AS (
      SELECT
        spm.canonical_id,
        sp.sale_price,
        sp.original_price,
        sp.discount_percent,
        sp.price_per_kg,
        sp.best_before,
        sp.store_id
      FROM store_product_mappings spm
      JOIN store_products sp ON sp.id = spm.deal_id AND sp.is_active = 1
    ),
    cheapest AS (
      SELECT r.*
      FROM ranked r
      WHERE r.sale_price = (
        SELECT MIN(r2.sale_price) FROM ranked r2 WHERE r2.canonical_id = r.canonical_id
      )
      GROUP BY r.canonical_id
    ),
    counts AS (
      SELECT canonical_id, COUNT(DISTINCT store_id) AS store_count
      FROM ranked
      GROUP BY canonical_id
    )
    SELECT
      cp.id           AS canonical_id,
      cp.canonical_name,
      cp.image_url,
      cp.category,
      c.sale_price    AS cheapest_price,
      c.original_price,
      c.discount_percent AS discount_pct,
      c.price_per_kg,
      c.best_before,
      c.store_id      AS cheapest_store_id,
      s.name          AS cheapest_store_name,
      ct.store_count
    FROM canonical_products cp
    JOIN cheapest c  ON c.canonical_id = cp.id
    JOIN stores   s  ON s.id = c.store_id
    JOIN counts   ct ON ct.canonical_id = cp.id
  `;

  router.get("/", (req, res) => {
    const page     = Math.max(1, parseInt(req.query.page  || "1",  10) || 1);
    const limit    = Math.max(1, Math.min(100, parseInt(req.query.limit || "24", 10) || 24));
    const offset   = (page - 1) * limit;
    const q        = String(req.query.q        || "").trim();
    const category = String(req.query.category || "").trim();
    const store    = String(req.query.store    || "").trim();
    const isDiscounted = req.query.is_discounted === "1";
    const minDiscount  = parseFloat(req.query.min_discount || "0") || 0;
    const hideExpired  = req.query.hide_expired === "1";

    const conditions = [];
    const params     = [];

    if (q) {
      conditions.push("cp.canonical_name LIKE '%' || ? || '%'");
      params.push(q);
    }
    if (category) {
      conditions.push("cp.category = ?");
      params.push(category);
    }
    if (store) {
      conditions.push(`EXISTS (
        SELECT 1 FROM store_product_mappings spm2
        JOIN store_products sp2 ON sp2.id = spm2.deal_id AND sp2.is_active = 1
        WHERE spm2.canonical_id = cp.id AND sp2.store_id = ?
      )`);
      params.push(store);
    }
    if (isDiscounted) {
      conditions.push("c.discount_percent > 0");
    }
    if (minDiscount > 0) {
      conditions.push("c.discount_percent >= ?");
      params.push(minDiscount);
    }
    if (hideExpired) {
      conditions.push("(c.best_before IS NULL OR c.best_before >= date('now'))");
    }

    const whereClause = conditions.length
      ? "WHERE " + conditions.join(" AND ")
      : "";

    const countRow = db.prepare(
      `SELECT COUNT(*) AS n FROM (${CATALOG_SQL} ${whereClause})`
    ).get(...params);
    const total = countRow?.n ?? 0;

    const rows = db.prepare(
      `${CATALOG_SQL} ${whereClause} ORDER BY c.sale_price ASC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  });

  module.exports = router;
  ```

- [ ] **Step 4: Mount route in `server/index.js`**

  Add after the existing route mounts (around line 77):

  ```js
  const catalogRouter = require("./routes/catalog");
  // ...
  app.use("/api/v1/catalog", catalogRouter);
  ```

- [ ] **Step 5: Add catalog route to `tests/e2e/helpers.js`**

  In `buildAppWithDb`, add to the `routeModules` array:
  ```js
  "../../server/routes/catalog",
  ```

  And after the existing `require` calls, add:
  ```js
  const catalogRouter = require("../../server/routes/catalog");
  ```

  And mount it:
  ```js
  app.use("/api/v1/catalog", catalogRouter);
  ```

- [ ] **Step 6: Run catalog tests**

  ```bash
  node --test tests/e2e/platform-v1-catalog.e2e.test.js --reporter=spec 2>&1
  ```
  Expected: all 5 tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add server/routes/catalog.js server/index.js tests/e2e/helpers.js \
          tests/e2e/platform-v1-catalog.e2e.test.js
  git commit -m "feat(api): add GET /api/v1/catalog with filters and pagination"
  ```

---

## Task 3: Suggest Route + Tests

**Files:**
- Modify: `server/routes/catalog.js`
- Modify: `tests/e2e/platform-v1-catalog.e2e.test.js`

- [ ] **Step 1: Add suggest tests to the existing catalog test file**

  Append to `tests/e2e/platform-v1-catalog.e2e.test.js`:

  ```js
  test("GET /api/v1/catalog/suggest returns products, categories, stores grouped", async () => {
    const { db } = createTestDb();
    seed(db);
    const app = buildAppWithDb(db);
    const api = await startServer(app);

    const res = await api.request("/api/v1/catalog/suggest?q=toor");
    assert.equal(res.status, 200);

    const { products, categories, stores } = res.json;
    assert.ok(Array.isArray(products));
    assert.ok(Array.isArray(categories));
    assert.ok(Array.isArray(stores));

    // "Toor Dal 500g" matches query "toor"
    assert.ok(products.some(p => p.canonical_id === "c1"));
    // "Lentils & Pulses" does not match "toor" — no category match expected
    assert.equal(categories.length, 0);
    // no store name contains "toor"
    assert.equal(stores.length, 0);

    // max 3 per group
    assert.ok(products.length <= 3);
  });

  test("GET /api/v1/catalog/suggest matches categories and stores", async () => {
    const { db } = createTestDb();
    seed(db);
    const app = buildAppWithDb(db);
    const api = await startServer(app);

    // "rice" matches canonical_name "Basmati Rice 1kg", category "Rice & Grains", no store
    const res = await api.request("/api/v1/catalog/suggest?q=rice");
    assert.equal(res.status, 200);
    assert.ok(res.json.products.some(p => p.canonical_id === "c2"));
    assert.ok(res.json.categories.some(c => c.name === "Rice & Grains"));
  });

  test("GET /api/v1/catalog/suggest returns empty groups for no match", async () => {
    const { db } = createTestDb();
    seed(db);
    const app = buildAppWithDb(db);
    const api = await startServer(app);

    const res = await api.request("/api/v1/catalog/suggest?q=zzznomatch");
    assert.equal(res.status, 200);
    assert.equal(res.json.products.length, 0);
    assert.equal(res.json.categories.length, 0);
    assert.equal(res.json.stores.length, 0);
  });

  test("GET /api/v1/catalog/suggest returns 400 without q param", async () => {
    const { db } = createTestDb();
    seed(db);
    const app = buildAppWithDb(db);
    const api = await startServer(app);

    const res = await api.request("/api/v1/catalog/suggest");
    assert.equal(res.status, 400);
  });
  ```

- [ ] **Step 2: Run to confirm new tests fail**

  ```bash
  node --test tests/e2e/platform-v1-catalog.e2e.test.js --reporter=spec 2>&1 | grep -E "suggest|FAIL"
  ```
  Expected: suggest tests fail (route doesn't exist yet).

- [ ] **Step 3: Add suggest route to `server/routes/catalog.js`**

  Add before `module.exports`:

  ```js
  router.get("/suggest", (req, res) => {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q is required" });

    const like = `%${q}%`;

    const products = db.prepare(`
      SELECT cp.id AS canonical_id, cp.canonical_name
      FROM canonical_products cp
      WHERE cp.canonical_name LIKE ?
        AND EXISTS (
          SELECT 1 FROM store_product_mappings spm
          JOIN store_products sp ON sp.id = spm.deal_id AND sp.is_active = 1
          WHERE spm.canonical_id = cp.id
        )
      LIMIT 3
    `).all(like);

    const categories = db.prepare(`
      SELECT DISTINCT cp.category AS name
      FROM canonical_products cp
      WHERE cp.category LIKE ?
        AND cp.category IS NOT NULL
      LIMIT 3
    `).all(like);

    const stores = db.prepare(`
      SELECT id AS store_id, name
      FROM stores
      WHERE name LIKE ?
      LIMIT 3
    `).all(like);

    res.json({ products, categories, stores });
  });
  ```

- [ ] **Step 4: Run all catalog tests**

  ```bash
  node --test tests/e2e/platform-v1-catalog.e2e.test.js --reporter=spec 2>&1
  ```
  Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

  ```bash
  git add server/routes/catalog.js tests/e2e/platform-v1-catalog.e2e.test.js
  git commit -m "feat(api): add GET /api/v1/catalog/suggest returning products, categories, stores"
  ```

---

## Task 4: Cart Compare Service + Route + Tests

**Files:**
- Create: `server/services/cart-comparator.js`
- Create: `server/routes/compare.js`
- Modify: `server/index.js`
- Modify: `tests/e2e/helpers.js`
- Create: `tests/e2e/platform-v1-cart-compare.e2e.test.js`

### 4a — Write failing tests

- [ ] **Step 1: Create compare test file**

  ```js
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
  ```

- [ ] **Step 2: Run to confirm tests fail**

  ```bash
  node --test tests/e2e/platform-v1-cart-compare.e2e.test.js --reporter=spec 2>&1 | grep -E "FAIL|404|Error" | head -5
  ```
  Expected: failures (route doesn't exist).

### 4b — Implement cart comparator service

- [ ] **Step 3: Create `server/services/cart-comparator.js`**

  ```js
  "use strict";

  /**
   * Compares a cart of canonical items across all stores.
   * Returns ranked store results with confirmed totals, coverage, and per-item status.
   *
   * @param {object} db  - better-sqlite3 db instance
   * @param {Array}  items - [{ canonical_id, quantity, any_brand }]
   * @returns {object} { stores: [...], item_count: N }
   */
  function compareCart(db, items) {
    if (!items || items.length === 0) return { stores: [], item_count: 0 };

    // Get all stores that have at least one item in the cart
    const placeholders = items.map(() => "?").join(",");
    const canonicalIds = items.map(i => i.canonical_id);

    const allStores = db.prepare("SELECT id, name, url, platform FROM stores").all();

    const results = [];

    for (const store of allStores) {
      const storeItems = [];
      let confirmedTotal = 0;
      let availableCount = 0;

      for (const cartItem of items) {
        const qty = cartItem.quantity || 1;

        // Find cheapest active listing for this canonical at this store
        const listing = db.prepare(`
          SELECT sp.id, sp.product_name, sp.sale_price, sp.original_price,
                 sp.discount_percent, sp.price_per_kg
          FROM store_product_mappings spm
          JOIN store_products sp ON sp.id = spm.deal_id
          WHERE spm.canonical_id = ?
            AND sp.store_id = ?
            AND sp.is_active = 1
          ORDER BY sp.sale_price ASC
          LIMIT 1
        `).get(cartItem.canonical_id, store.id);

        if (listing) {
          availableCount++;
          confirmedTotal += listing.sale_price * qty;
          storeItems.push({
            canonical_id: cartItem.canonical_id,
            name: listing.product_name,
            price: listing.sale_price,
            quantity: qty,
            store_product_id: listing.id,
            status: "confirmed",
          });
        } else {
          storeItems.push({
            canonical_id: cartItem.canonical_id,
            name: null,
            price: null,
            quantity: qty,
            store_product_id: null,
            status: "unavailable",
          });
        }
      }

      // Skip stores with no items available
      if (availableCount === 0) continue;

      const coveragePct = availableCount / items.length;

      results.push({
        store: { id: store.id, name: store.name },
        confirmed_total: Math.round(confirmedTotal * 100) / 100,
        estimated_total: null, // market price estimation is aspirational
        shipping_cost: 0,
        coverage_pct: coveragePct,
        items: storeItems,
      });
    }

    // Sort by confirmed_total ascending
    results.sort((a, b) => a.confirmed_total - b.confirmed_total);

    return { stores: results, item_count: items.length };
  }

  module.exports = { compareCart };
  ```

### 4c — Implement compare route

- [ ] **Step 4: Create `server/routes/compare.js`**

  ```js
  "use strict";
  const express          = require("express");
  const requireUserAuth  = require("../middleware/user-auth");
  const { compareCart }  = require("../services/cart-comparator");
  const db               = require("../db");

  const router = express.Router();

  router.post("/cart", requireUserAuth, (req, res) => {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required and must not be empty" });
    }

    for (const item of items) {
      if (!item.canonical_id) {
        return res.status(400).json({ error: "each item must have canonical_id" });
      }
    }

    const result = compareCart(db, items);
    res.json(result);
  });

  module.exports = router;
  ```

- [ ] **Step 5: Mount in `server/index.js`**

  ```js
  const compareRouter = require("./routes/compare");
  // ...
  app.use("/api/v1/compare", compareRouter);
  ```

- [ ] **Step 6: Add to `tests/e2e/helpers.js`**

  In `routeModules`:
  ```js
  "../../server/routes/compare",
  ```

  In the `require` block:
  ```js
  const compareRouter = require("../../server/routes/compare");
  ```

  Mount:
  ```js
  app.use("/api/v1/compare", compareRouter);
  ```

  Also add `cart-comparator` to `serviceModules`:
  ```js
  "../../server/services/cart-comparator",
  ```

- [ ] **Step 7: Run cart compare tests**

  ```bash
  node --test tests/e2e/platform-v1-cart-compare.e2e.test.js --reporter=spec 2>&1
  ```
  Expected: all 5 tests pass.

- [ ] **Step 8: Commit**

  ```bash
  git add server/services/cart-comparator.js server/routes/compare.js \
          server/index.js tests/e2e/helpers.js \
          tests/e2e/platform-v1-cart-compare.e2e.test.js
  git commit -m "feat(api): add POST /api/v1/compare/cart — direct cart comparison"
  ```

---

## Task 5: Order History Route + Tests

**Files:**
- Create: `server/routes/orders.js`
- Modify: `server/index.js`
- Modify: `tests/e2e/helpers.js`
- Create: `tests/e2e/platform-v1-orders.e2e.test.js`

### 5a — Write failing tests

- [ ] **Step 1: Create orders test file**

  ```js
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

    // Get the user's ID from profile
    const me = await api.request("/api/v1/me", { headers: authHeader(token) });
    const userId = me.json.data.id;

    db.prepare("INSERT INTO stores (id, name, url) VALUES ('s1','Jamoona','https://jamoona.de')").run();
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

    db.prepare("INSERT INTO stores (id, name, url) VALUES ('s1','Jamoona','https://jamoona.de')").run();
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

    db.prepare("INSERT INTO stores (id, name, url) VALUES ('s1','Jamoona','https://jamoona.de')").run();
    seedList(db, "alice-list", aliceId, "pending", null);

    // Bob tries to complete Alice's list
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
  ```

- [ ] **Step 2: Run to confirm tests fail**

  ```bash
  node --test tests/e2e/platform-v1-orders.e2e.test.js --reporter=spec 2>&1 | grep -E "FAIL|Error" | head -5
  ```
  Expected: failures.

### 5b — Implement orders route

- [ ] **Step 3: Create `server/routes/orders.js`**

  ```js
  "use strict";
  const express         = require("express");
  const requireUserAuth = require("../middleware/user-auth");
  const db              = require("../db");

  const router = express.Router();

  // GET /api/v1/orders — user's order history
  router.get("/", requireUserAuth, (req, res) => {
    const userId = req.user.id;

    const lists = db.prepare(`
      SELECT
        sl.id,
        sl.name,
        sl.status,
        sl.completed_store_id,
        sl.completed_at,
        sl.created_at,
        s.name AS completed_store_name
      FROM shopping_lists sl
      LEFT JOIN stores s ON s.id = sl.completed_store_id
      WHERE sl.user_id = ?
      ORDER BY sl.created_at DESC
    `).all(userId);

    const result = lists.map(list => {
      const items = db.prepare(`
        SELECT id, raw_item_text, quantity, quantity_unit, item_count
        FROM list_items
        WHERE list_id = ?
      `).all(list.id);
      return { ...list, items };
    });

    res.json({ data: result });
  });

  // PATCH /api/v1/orders/:id/complete — mark order completed
  router.patch("/:id/complete", requireUserAuth, (req, res) => {
    const userId  = req.user.id;
    const listId  = req.params.id;
    const { store_id } = req.body || {};

    if (!store_id) {
      return res.status(400).json({ error: "store_id is required" });
    }

    const list = db.prepare(
      "SELECT id, user_id, status FROM shopping_lists WHERE id = ? AND user_id = ?"
    ).get(listId, userId);

    if (!list) return res.status(404).json({ error: "Order not found" });

    const completedAt = new Date().toISOString();
    db.prepare(`
      UPDATE shopping_lists
      SET status = 'completed', completed_store_id = ?, completed_at = ?
      WHERE id = ? AND user_id = ?
    `).run(store_id, completedAt, listId, userId);

    const updated = db.prepare(
      "SELECT id, status, completed_store_id, completed_at FROM shopping_lists WHERE id = ?"
    ).get(listId);

    res.json({ data: updated });
  });

  module.exports = router;
  ```

- [ ] **Step 4: Mount in `server/index.js`**

  ```js
  const ordersRouter = require("./routes/orders");
  // ...
  app.use("/api/v1/orders", ordersRouter);
  ```

- [ ] **Step 5: Add to `tests/e2e/helpers.js`**

  In `routeModules`:
  ```js
  "../../server/routes/orders",
  ```

  Require and mount:
  ```js
  const ordersRouter = require("../../server/routes/orders");
  // ...
  app.use("/api/v1/orders", ordersRouter);
  ```

- [ ] **Step 6: Run orders tests**

  ```bash
  node --test tests/e2e/platform-v1-orders.e2e.test.js --reporter=spec 2>&1
  ```
  Expected: all 5 tests pass.

- [ ] **Step 7: Commit**

  ```bash
  git add server/routes/orders.js server/index.js tests/e2e/helpers.js \
          tests/e2e/platform-v1-orders.e2e.test.js
  git commit -m "feat(api): add GET /api/v1/orders and PATCH /api/v1/orders/:id/complete"
  ```

---

## Task 6: Full Integration Run

- [ ] **Step 1: Run all new e2e tests together**

  ```bash
  node --test \
    tests/e2e/platform-v1-catalog.e2e.test.js \
    tests/e2e/platform-v1-cart-compare.e2e.test.js \
    tests/e2e/platform-v1-orders.e2e.test.js \
    --reporter=spec 2>&1
  ```
  Expected: all tests pass.

- [ ] **Step 2: Run existing e2e test to check no regressions**

  ```bash
  node --test tests/e2e/routes.e2e.test.js --reporter=spec 2>&1
  ```
  Expected: all pass.

- [ ] **Step 3: Final commit if any fixes were made**

  ```bash
  git add -A
  git commit -m "test: verify platform v1 backend API integration suite passes"
  ```
