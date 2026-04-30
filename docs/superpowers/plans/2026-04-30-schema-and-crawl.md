# Schema Migrations + Crawl Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add missing schema columns, create the `product_alerts` table, rewrite `alert-evaluator.js` for the 2-type model, build Mode 2 (Shopify + WooCommerce full catalog) and Mode 3 (on-demand) crawlers, add FTS5 rebuild post-crawl, and wire a weekly GitHub Actions workflow for Mode 2.

**Architecture:** New columns on `store_products` and `shopping_lists` go into the `migrations` array in `server/db/index.js` (try/catch, idempotent). New tables go in `schema.sql` (CREATE TABLE IF NOT EXISTS). Mode 2 crawlers are generic (one per platform, not per store). Mode 3 is in-process async triggered from the lists route.

**Tech Stack:** Node.js (CommonJS), better-sqlite3, node-fetch v2, existing crawler pipeline (`crawler/index.js` → `canonicalizeDeals()`), GitHub Actions.

**DB:** Use `data/prod_local.db` (`DB_FILE=data/prod_local.db`). Ask before using any other DB.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/db/index.js` | Modify | Add new column migrations to `migrations[]` array |
| `server/db/schema.sql` | Modify | Add `product_alerts` table + indexes |
| `server/services/alert-evaluator.js` | Rewrite | 2-type (`price_below`, `back_in_stock`) one-shot model |
| `crawler/shopify-full-catalog.js` | Create | Mode 2 generic Shopify full catalog crawler |
| `crawler/woocommerce-full-catalog.js` | Create | Mode 2 generic WooCommerce full catalog crawler |
| `crawler/on-demand-crawl.js` | Create | Mode 3 on-demand crawl orchestrator |
| `crawler/fts-rebuild.js` | Create | FTS5 + suggest-index rebuild (called post-crawl) |
| `crawler/index.js` | Modify | Call `fts-rebuild.js` at end of Mode 1 crawl |
| `server/index.js` | Modify | Drain `pending_on_demand_crawls` on startup |
| `.github/workflows/weekly-catalog-crawl.yml` | Create | Mode 2 weekly GitHub Actions workflow |
| `tests/integration/crawl-modes.test.js` | Create | Integration tests for Mode 2/3 column writes |

---

### Task 1: Add new columns to store_products and shopping_lists

**Files:**
- Modify: `server/db/index.js` (migrations array, ~line 255)

- [ ] **Step 1: Locate the migrations array end**

```bash
grep -n "bookmarks_user\|idx_bookmarks" server/db/index.js
```
Expected: shows line ~310 (last entry before the closing bracket).

- [ ] **Step 2: Add new columns to the migrations array**

In `server/db/index.js`, append to the `migrations` array (before the closing `]`):

```js
    // store_products — crawl architecture columns
    "ALTER TABLE store_products ADD COLUMN crawl_mode TEXT DEFAULT 'deal'",
    "ALTER TABLE store_products ADD COLUMN is_on_deal INTEGER DEFAULT 1",
    "ALTER TABLE store_products ADD COLUMN external_product_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_sp_external_id ON store_products(store_id, external_product_id)",
    "CREATE INDEX IF NOT EXISTS idx_sp_crawl_mode ON store_products(crawl_mode, is_active)",
    // shopping_lists — order history tracking
    "ALTER TABLE shopping_lists ADD COLUMN last_compared_at DATETIME",
    "ALTER TABLE shopping_lists ADD COLUMN last_order_store_id TEXT REFERENCES stores(id)",
    "ALTER TABLE shopping_lists ADD COLUMN last_order_total REAL",
    "ALTER TABLE shopping_lists ADD COLUMN last_ordered_at DATETIME",
```

- [ ] **Step 3: Verify columns created**

```bash
DB_FILE=data/prod_local.db node -e "
const db = require('./server/db');
setTimeout(async () => {
  const sp = await db.prepare('PRAGMA table_info(store_products)').all();
  const cols = sp.map(r => r.name);
  console.log('crawl_mode:', cols.includes('crawl_mode'));
  console.log('is_on_deal:', cols.includes('is_on_deal'));
  console.log('external_product_id:', cols.includes('external_product_id'));
  const sl = await db.prepare('PRAGMA table_info(shopping_lists)').all();
  const slCols = sl.map(r => r.name);
  console.log('last_compared_at:', slCols.includes('last_compared_at'));
  process.exit(0);
}, 2000);
" 2>/dev/null
```
Expected: all `true`.

- [ ] **Step 4: Commit**

```bash
git add server/db/index.js
git commit -m "feat(schema): add crawl_mode/is_on_deal/external_product_id and order-tracking columns"
```

---

### Task 2: Add product_alerts table + migrate from price_alerts

**Files:**
- Modify: `server/db/schema.sql`
- Modify: `server/db/index.js` (alwaysMigrations array)

- [ ] **Step 1: Add product_alerts to schema.sql**

Append after the `brand_remap_jobs` index at the end of `server/db/schema.sql`:

```sql
-- New 2-type one-shot alert model replacing price_alerts
CREATE TABLE IF NOT EXISTS product_alerts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_id    TEXT NOT NULL REFERENCES canonical_products(id),
  store_id        TEXT REFERENCES stores(id),
  alert_type      TEXT NOT NULL CHECK (alert_type IN ('price_below', 'back_in_stock')),
  price_threshold REAL,
  created_at      TEXT NOT NULL,
  notified_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_alerts_user      ON product_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_product_alerts_canonical ON product_alerts(canonical_id, alert_type);
```

- [ ] **Step 2: Add to alwaysMigrations so Turso gets it too**

In `server/db/index.js`, add to the `alwaysMigrations` array:

```js
    `CREATE TABLE IF NOT EXISTS product_alerts (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      canonical_id    TEXT NOT NULL REFERENCES canonical_products(id),
      store_id        TEXT REFERENCES stores(id),
      alert_type      TEXT NOT NULL CHECK (alert_type IN ('price_below', 'back_in_stock')),
      price_threshold REAL,
      created_at      TEXT NOT NULL,
      notified_at     TEXT
    )`,
    "CREATE INDEX IF NOT EXISTS idx_product_alerts_user ON product_alerts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_alerts_canonical ON product_alerts(canonical_id, alert_type)",
```

- [ ] **Step 3: Verify table created**

```bash
DB_FILE=data/prod_local.db node -e "
const db = require('./server/db');
setTimeout(async () => {
  const r = await db.prepare(\"SELECT name FROM sqlite_master WHERE name='product_alerts'\").get();
  console.log('product_alerts:', r ? 'OK' : 'MISSING');
  process.exit(0);
}, 2000);
" 2>/dev/null
```
Expected: `product_alerts: OK`

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.sql server/db/index.js
git commit -m "feat(schema): add product_alerts table (2-type one-shot model)"
```

---

### Task 3: Rewrite alert-evaluator.js for product_alerts 2-type model

**Files:**
- Rewrite: `server/services/alert-evaluator.js`

- [ ] **Step 1: Read current alert-evaluator.js**

```bash
cat server/services/alert-evaluator.js
```

- [ ] **Step 2: Write test first**

Create `tests/integration/alert-evaluator.test.js`:

```js
"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

// Set test DB
process.env.DB_FILE = "data/prod_local.db";

const db = require("../../server/db");

describe("alert-evaluator", () => {
  let userId, canonicalId, alertId;

  before(async () => {
    await new Promise(r => setTimeout(r, 1500));
    // Use existing user + canonical from prod_local
    const user = await db.prepare("SELECT id FROM users LIMIT 1").get();
    const canonical = await db.prepare("SELECT id FROM canonical_products WHERE is_active = 1 LIMIT 1").get();
    assert.ok(user, "need at least one user in DB");
    assert.ok(canonical, "need at least one canonical in DB");
    userId = user.id;
    canonicalId = canonical.id;

    // Insert a test price_below alert
    alertId = require("crypto").randomUUID();
    await db.prepare(
      `INSERT INTO product_alerts (id, user_id, canonical_id, alert_type, price_threshold, created_at)
       VALUES (?, ?, ?, 'price_below', 99999.00, datetime('now'))`
    ).run(alertId, userId, canonicalId);
  });

  after(async () => {
    await db.prepare("DELETE FROM product_alerts WHERE id = ?").run(alertId);
  });

  it("evaluatePriceAlerts returns matches when sale_price < threshold", async () => {
    const { evaluatePriceAlerts } = require("../../server/services/alert-evaluator");
    const matches = await evaluatePriceAlerts();
    // Our alert has threshold 99999 so any active deal should match
    const found = matches.find(m => m.alert_id === alertId);
    assert.ok(found, "should find alert with high threshold");
    assert.equal(found.alert_type, "price_below");
  });
});
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/alert-evaluator.test.js --reporter=spec 2>&1 | tail -10
```
Expected: fails (evaluatePriceAlerts not a function or wrong table).

- [ ] **Step 4: Rewrite alert-evaluator.js**

Replace `server/services/alert-evaluator.js` entirely:

```js
"use strict";

const db = require("../db");

/**
 * Check price_below alerts. Returns array of matches:
 * { alert_id, user_id, canonical_id, canonical_name, alert_type, price_threshold,
 *   sale_price, store_id, store_name, store_url, product_url }
 */
async function evaluatePriceAlerts() {
  const rows = await db.prepare(`
    SELECT
      pa.id          AS alert_id,
      pa.user_id,
      pa.canonical_id,
      pa.price_threshold,
      pa.store_id    AS alert_store_id,
      cp.canonical_name,
      sp.sale_price,
      sp.store_id,
      sp.product_url,
      s.name         AS store_name,
      s.url          AS store_url
    FROM product_alerts pa
    JOIN canonical_products cp ON cp.id = pa.canonical_id
    JOIN store_products sp ON sp.canonical_id = pa.canonical_id AND sp.is_active = 1
    JOIN stores s ON s.id = sp.store_id
    WHERE pa.alert_type = 'price_below'
      AND sp.sale_price < pa.price_threshold
      AND (pa.store_id IS NULL OR pa.store_id = sp.store_id)
  `).all();

  // For store_id IS NULL: keep only cheapest match per alert
  const seen = new Map();
  const results = [];
  for (const row of rows) {
    const key = row.alert_id;
    if (!seen.has(key) || row.sale_price < seen.get(key).sale_price) {
      seen.set(key, { ...row, alert_type: "price_below" });
    }
  }
  for (const v of seen.values()) results.push(v);
  return results;
}

/**
 * Check back_in_stock alerts against a list of newly-activated deal IDs.
 * @param {string[]} newlyActiveDealIds
 */
async function evaluateBackInStockAlerts(newlyActiveDealIds) {
  if (!newlyActiveDealIds || newlyActiveDealIds.length === 0) return [];

  const placeholders = newlyActiveDealIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT
      pa.id          AS alert_id,
      pa.user_id,
      pa.canonical_id,
      pa.store_id    AS alert_store_id,
      cp.canonical_name,
      sp.sale_price,
      sp.store_id,
      sp.product_url,
      s.name         AS store_name,
      s.url          AS store_url
    FROM product_alerts pa
    JOIN canonical_products cp ON cp.id = pa.canonical_id
    JOIN store_products sp ON sp.canonical_id = pa.canonical_id AND sp.id IN (${placeholders})
    JOIN stores s ON s.id = sp.store_id
    WHERE pa.alert_type = 'back_in_stock'
      AND (pa.store_id IS NULL OR pa.store_id = sp.store_id)
  `).all(...newlyActiveDealIds).map(r => ({ ...r, alert_type: "back_in_stock" }));
}

/**
 * Mark alert as notified and delete it (one-shot lifecycle).
 * @param {string} alertId
 */
async function consumeAlert(alertId) {
  await db.prepare("DELETE FROM product_alerts WHERE id = ?").run(alertId);
}

module.exports = { evaluatePriceAlerts, evaluateBackInStockAlerts, consumeAlert };
```

- [ ] **Step 5: Run test — confirm passes**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/alert-evaluator.test.js --reporter=spec 2>&1 | tail -10
```
Expected: `pass 1`.

- [ ] **Step 6: Commit**

```bash
git add server/services/alert-evaluator.js tests/integration/alert-evaluator.test.js
git commit -m "feat: rewrite alert-evaluator for product_alerts 2-type one-shot model"
```

---

### Task 4: Shopify full catalog crawler (Mode 2)

**Files:**
- Create: `crawler/shopify-full-catalog.js`

- [ ] **Step 1: Write test**

Create `tests/integration/shopify-full-catalog.test.js`:

```js
"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildShopifyProductRow } = require("../../crawler/shopify-full-catalog");

describe("buildShopifyProductRow", () => {
  it("maps Shopify product to store_products row", () => {
    const product = {
      id: 12345,
      title: "TRS Toor Dal 500g",
      handle: "trs-toor-dal-500g",
      variants: [{ id: 99001, price: "3.29", compare_at_price: "3.99" }],
      images: [{ src: "https://cdn.shopify.com/trs-toor.jpg" }],
    };
    const row = buildShopifyProductRow("jamoona", "https://jamoona.de", product);
    assert.equal(row.store_id, "jamoona");
    assert.equal(row.sale_price, 3.29);
    assert.equal(row.original_price, 3.99);
    assert.equal(row.is_on_deal, 1);
    assert.equal(row.crawl_mode, "catalog");
    assert.equal(row.external_product_id, "12345");
    assert.ok(row.product_url.includes("trs-toor-dal-500g"));
  });

  it("is_on_deal=0 when no compare_at_price", () => {
    const product = {
      id: 12346,
      title: "Rice 1kg",
      handle: "rice-1kg",
      variants: [{ id: 99002, price: "2.00", compare_at_price: null }],
      images: [],
    };
    const row = buildShopifyProductRow("jamoona", "https://jamoona.de", product);
    assert.equal(row.is_on_deal, 0);
    assert.equal(row.sale_price, 2.00);
    assert.equal(row.original_price, null);
  });
});
```

- [ ] **Step 2: Run test to confirm fails**

```bash
node --test tests/integration/shopify-full-catalog.test.js --reporter=spec 2>&1 | tail -5
```

- [ ] **Step 3: Implement crawler/shopify-full-catalog.js**

```js
"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");

const DELAY_MS = 500;
const PAGE_SIZE = 250;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Map a Shopify product JSON object to a store_products insert row.
 */
function buildShopifyProductRow(storeId, storeUrl, product) {
  const variant = product.variants[0] || {};
  const salePrice = parseFloat(variant.price) || 0;
  const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;
  const isOnDeal = compareAt && compareAt > salePrice ? 1 : 0;
  const discountPct = isOnDeal ? Math.round((1 - salePrice / compareAt) * 100) : null;
  const imageUrl = (product.images[0] || {}).src || null;
  const productUrl = `${storeUrl.replace(/\/$/, "")}/products/${product.handle}`;

  return {
    id: crypto.randomUUID(),
    store_id: storeId,
    product_name: product.title,
    product_category: "Other",
    product_url: productUrl,
    image_url: imageUrl,
    sale_price: salePrice,
    original_price: compareAt,
    discount_percent: discountPct,
    currency: "EUR",
    is_active: 1,
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
    external_product_id: String(product.id),
    availability: "in_stock",
  };
}

/**
 * Crawl full Shopify product catalog for one store.
 * @param {{ storeId: string, storeUrl: string }} store
 * @returns {Promise<{rows: object[], cursor: string|null, error: string|null}>}
 */
async function crawlShopifyFullCatalog({ storeId, storeUrl }, fromCursor = null) {
  const rows = [];
  let cursor = fromCursor;

  while (true) {
    const url = cursor
      ? `${storeUrl}/products.json?limit=${PAGE_SIZE}&page_info=${cursor}`
      : `${storeUrl}/products.json?limit=${PAGE_SIZE}`;

    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": "DesiDeals24/1.0" } });
    } catch (err) {
      return { rows, cursor, error: err.message };
    }

    if (!res.ok) {
      return { rows, cursor, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const products = data.products || [];

    for (const p of products) {
      rows.push(buildShopifyProductRow(storeId, storeUrl, p));
    }

    // Parse Link header for next cursor
    const link = res.headers.get("link") || "";
    const nextMatch = link.match(/<[^>]+page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      cursor = nextMatch[1];
      await sleep(DELAY_MS);
    } else {
      cursor = null;
      break;
    }
  }

  return { rows, cursor: null, error: null };
}

module.exports = { crawlShopifyFullCatalog, buildShopifyProductRow };
```

- [ ] **Step 4: Run test — confirm passes**

```bash
node --test tests/integration/shopify-full-catalog.test.js --reporter=spec 2>&1 | tail -5
```
Expected: `pass 2`.

- [ ] **Step 5: Commit**

```bash
git add crawler/shopify-full-catalog.js tests/integration/shopify-full-catalog.test.js
git commit -m "feat(crawl): add Mode 2 Shopify full catalog crawler"
```

---

### Task 5: WooCommerce full catalog crawler (Mode 2)

**Files:**
- Create: `crawler/woocommerce-full-catalog.js`

- [ ] **Step 1: Write test**

Create `tests/integration/woocommerce-full-catalog.test.js`:

```js
"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildWooProductRow } = require("../../crawler/woocommerce-full-catalog");

describe("buildWooProductRow", () => {
  it("maps WooCommerce store/v1 product to row — divides minor-unit prices", () => {
    const product = {
      id: 777,
      name: "Aashirvaad Atta 1kg",
      permalink: "https://namma.de/product/aashirvaad-atta-1kg",
      images: [{ src: "https://namma.de/wp-content/atta.jpg" }],
      prices: {
        price: "299",
        regular_price: "349",
        sale_price: "299",
        currency_minor_unit: 2,
      },
    };
    const row = buildWooProductRow("namma-markt", product);
    assert.equal(row.store_id, "namma-markt");
    assert.equal(row.sale_price, 2.99);
    assert.equal(row.original_price, 3.49);
    assert.equal(row.is_on_deal, 1);
    assert.equal(row.crawl_mode, "catalog");
    assert.equal(row.external_product_id, "777");
  });

  it("is_on_deal=0 when sale_price equals regular_price", () => {
    const product = {
      id: 778,
      name: "Rice 1kg",
      permalink: "https://namma.de/product/rice-1kg",
      images: [],
      prices: {
        price: "199",
        regular_price: "199",
        sale_price: "199",
        currency_minor_unit: 2,
      },
    };
    const row = buildWooProductRow("namma-markt", product);
    assert.equal(row.is_on_deal, 0);
    assert.equal(row.sale_price, 1.99);
  });
});
```

- [ ] **Step 2: Run test to confirm fails**

```bash
node --test tests/integration/woocommerce-full-catalog.test.js --reporter=spec 2>&1 | tail -5
```

- [ ] **Step 3: Implement crawler/woocommerce-full-catalog.js**

```js
"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");

const DELAY_MS = 500;
const PAGE_SIZE = 100;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Map a wc/store/v1 product to a store_products insert row.
 * Prices from wc/store/v1 are integer strings in minor currency units (e.g. "329" = €3.29).
 */
function buildWooProductRow(storeId, product) {
  const minorUnit = product.prices?.currency_minor_unit ?? 2;
  const divisor = Math.pow(10, minorUnit);
  const salePrice = parseInt(product.prices?.sale_price || product.prices?.price || "0", 10) / divisor;
  const regularPrice = parseInt(product.prices?.regular_price || "0", 10) / divisor;
  const isOnDeal = salePrice < regularPrice ? 1 : 0;
  const discountPct = isOnDeal ? Math.round((1 - salePrice / regularPrice) * 100) : null;
  const imageUrl = (product.images?.[0] || {}).src || null;

  return {
    id: crypto.randomUUID(),
    store_id: storeId,
    product_name: product.name,
    product_category: "Other",
    product_url: product.permalink,
    image_url: imageUrl,
    sale_price: salePrice,
    original_price: isOnDeal ? regularPrice : null,
    discount_percent: discountPct,
    currency: "EUR",
    is_active: 1,
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
    external_product_id: String(product.id),
    availability: "in_stock",
  };
}

/**
 * Crawl full WooCommerce product catalog for one store via wc/store/v1.
 * Falls back to flagging store as sitemap-only in store_crawl_state on 404.
 */
async function crawlWooCommerceFullCatalog({ storeId, storeUrl }, fromPage = 1) {
  const rows = [];
  let page = fromPage;

  while (true) {
    const url = `${storeUrl}/wp-json/wc/store/v1/products?per_page=${PAGE_SIZE}&page=${page}`;

    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": "DesiDeals24/1.0" } });
    } catch (err) {
      return { rows, page, error: err.message, needsSitemapFallback: false };
    }

    if (res.status === 404) {
      return { rows, page, error: "wc/store/v1 unavailable", needsSitemapFallback: true };
    }

    if (!res.ok) {
      return { rows, page, error: `HTTP ${res.status}`, needsSitemapFallback: false };
    }

    const products = await res.json();
    if (!Array.isArray(products) || products.length === 0) break;

    for (const p of products) {
      rows.push(buildWooProductRow(storeId, p));
    }

    if (products.length < PAGE_SIZE) break;
    page += 1;
    await sleep(DELAY_MS);
  }

  return { rows, page: null, error: null, needsSitemapFallback: false };
}

module.exports = { crawlWooCommerceFullCatalog, buildWooProductRow };
```

- [ ] **Step 4: Run test — confirm passes**

```bash
node --test tests/integration/woocommerce-full-catalog.test.js --reporter=spec 2>&1 | tail -5
```
Expected: `pass 2`.

- [ ] **Step 5: Commit**

```bash
git add crawler/woocommerce-full-catalog.js tests/integration/woocommerce-full-catalog.test.js
git commit -m "feat(crawl): add Mode 2 WooCommerce full catalog crawler (wc/store/v1)"
```

---

### Task 6: Mode 3 on-demand crawl orchestrator

**Files:**
- Create: `crawler/on-demand-crawl.js`

- [ ] **Step 1: Write test**

Create `tests/integration/on-demand-crawl.test.js`:

```js
"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildOnDemandSearchUrl } = require("../../crawler/on-demand-crawl");

describe("buildOnDemandSearchUrl", () => {
  it("builds Shopify suggest URL from base_key tokens", () => {
    const url = buildOnDemandSearchUrl("shopify", "https://jamoona.de", "toor dal");
    assert.ok(url.includes("/search/suggest.json"));
    assert.ok(url.includes("toor%20dal") || url.includes("toor+dal") || url.includes("toor dal"));
  });

  it("builds WooCommerce search URL from base_key tokens", () => {
    const url = buildOnDemandSearchUrl("woocommerce", "https://namma.de", "basmati rice");
    assert.ok(url.includes("/wp-json/wc/store/v1/products"));
    assert.ok(url.includes("basmati"));
  });
});
```

- [ ] **Step 2: Run test to confirm fails**

```bash
node --test tests/integration/on-demand-crawl.test.js --reporter=spec 2>&1 | tail -5
```

- [ ] **Step 3: Implement crawler/on-demand-crawl.js**

```js
"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");
const db = require("../server/db");
const { buildShopifyProductRow } = require("./shopify-full-catalog");
const { buildWooProductRow } = require("./woocommerce-full-catalog");

const CONFIDENCE_THRESHOLD = 80;
const MAX_CONCURRENT = 5;
const INTER_STORE_DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildOnDemandSearchUrl(platform, storeUrl, baseKey) {
  const base = storeUrl.replace(/\/$/, "");
  const q = encodeURIComponent(baseKey);
  if (platform === "shopify") {
    return `${base}/search/suggest.json?q=${q}&resources[type]=product&resources[limit]=10`;
  }
  return `${base}/wp-json/wc/store/v1/products?search=${q}&per_page=10`;
}

async function searchStoreForCanonical(store, canonical) {
  const { id: storeId, url: storeUrl, platform } = store;
  const baseKey = canonical.base_key || canonical.canonical_name;

  // Mode 3a — direct fetch if product_url known for this store
  const existing = await db.prepare(
    `SELECT id, sale_price, product_url FROM store_products
     WHERE store_id = ? AND canonical_id = ? AND is_active = 1 LIMIT 1`
  ).get(storeId, canonical.id);

  if (existing) {
    return { storeId, found: true, mode: "3a", price: existing.sale_price, productUrl: existing.product_url };
  }

  // Mode 3b — search
  if (!["shopify", "woocommerce"].includes(platform)) {
    return { storeId, found: false, mode: "3b_unsupported" };
  }

  const searchUrl = buildOnDemandSearchUrl(platform, storeUrl, baseKey);
  let res;
  try {
    res = await fetch(searchUrl, { headers: { "User-Agent": "DesiDeals24/1.0" }, timeout: 10000 });
  } catch {
    return { storeId, found: false, mode: "3b_error" };
  }

  if (!res.ok) return { storeId, found: false, mode: "3b_error" };

  const data = await res.json();

  // Extract product list depending on platform
  let products = [];
  if (platform === "shopify") {
    products = data?.resources?.results?.products || [];
  } else {
    products = Array.isArray(data) ? data : [];
  }

  if (products.length === 0) return { storeId, found: false, mode: "3b_not_found" };

  // Simple confidence: check if canonical_name tokens appear in first result title
  const first = products[0];
  const title = (first.title || first.name || "").toLowerCase();
  const tokens = baseKey.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const matched = tokens.filter(t => title.includes(t)).length;
  const confidence = tokens.length > 0 ? Math.round((matched / tokens.length) * 100) : 0;

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { storeId, found: false, mode: "3b_low_confidence", confidence };
  }

  // Build row and upsert
  const row = platform === "shopify"
    ? buildShopifyProductRow(storeId, storeUrl, first)
    : buildWooProductRow(storeId, first);

  row.crawl_mode = "on_demand";
  row.canonical_id = canonical.id;

  await db.prepare(
    `INSERT INTO store_products
      (id, store_id, crawl_run_id, crawl_timestamp, product_name, product_category,
       product_url, image_url, sale_price, original_price, discount_percent,
       currency, is_active, is_on_deal, crawl_mode, external_product_id, canonical_id, availability)
     VALUES (?,?,?,datetime('now'),?,?,?,?,?,?,?,?,1,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  ).run(
    row.id, row.store_id, "on_demand_" + Date.now(),
    row.product_name, row.product_category, row.product_url,
    row.image_url, row.sale_price, row.original_price, row.discount_percent,
    row.currency, row.is_on_deal, row.crawl_mode,
    row.external_product_id, row.canonical_id, row.availability
  );

  return { storeId, found: true, mode: "3b", price: row.sale_price, productUrl: row.product_url };
}

/**
 * Run on-demand crawl for a canonical across all eligible stores.
 * Called as a fire-and-forget from lists route.
 * @param {string} canonicalId
 * @param {string} pendingRowId - row in pending_on_demand_crawls to delete on completion
 */
async function runOnDemandCrawl(canonicalId, pendingRowId) {
  const canonical = await db.prepare(
    "SELECT id, canonical_name, base_key FROM canonical_products WHERE id = ?"
  ).get(canonicalId);

  if (!canonical) {
    await db.prepare("DELETE FROM pending_on_demand_crawls WHERE id = ?").run(pendingRowId);
    return;
  }

  const stores = await db.prepare(
    "SELECT id, url, platform FROM stores WHERE platform IN ('shopify','woocommerce') ORDER BY id"
  ).all();

  // Process sequentially, max 5 concurrent per batch
  for (let i = 0; i < stores.length; i += MAX_CONCURRENT) {
    const batch = stores.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(s => searchStoreForCanonical(s, canonical)));
    if (i + MAX_CONCURRENT < stores.length) {
      await sleep(INTER_STORE_DELAY_MS);
    }
  }

  await db.prepare("DELETE FROM pending_on_demand_crawls WHERE id = ?").run(pendingRowId);
}

/**
 * Drain pending_on_demand_crawls rows left over from a server restart.
 * Called once on server startup.
 */
async function drainPendingCrawls() {
  const pending = await db.prepare(
    "SELECT id, canonical_id FROM pending_on_demand_crawls WHERE started_at IS NULL"
  ).all();

  for (const row of pending) {
    await db.prepare(
      "UPDATE pending_on_demand_crawls SET started_at = datetime('now') WHERE id = ?"
    ).run(row.id);
    runOnDemandCrawl(row.canonical_id, row.id).catch(() => {});
  }
}

module.exports = { runOnDemandCrawl, drainPendingCrawls, buildOnDemandSearchUrl };
```

- [ ] **Step 4: Run test — confirm passes**

```bash
node --test tests/integration/on-demand-crawl.test.js --reporter=spec 2>&1 | tail -5
```
Expected: `pass 2`.

- [ ] **Step 5: Wire drainPendingCrawls into server startup**

In `server/index.js`, after the existing `ready` block (find where app.listen is called), add:

```js
const { drainPendingCrawls } = require("../crawler/on-demand-crawl");
// After server starts listening:
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  drainPendingCrawls().catch(err => console.error("[startup] drainPendingCrawls error:", err));
});
```

- [ ] **Step 6: Wire runOnDemandCrawl into lists route**

In `server/routes/lists.js`, after inserting a list item, add:

```js
const { runOnDemandCrawl } = require("../../crawler/on-demand-crawl");

// After item insert, inside the POST /:id/items handler, if user is logged in:
if (req.user && resolvedCanonicalId) {
  const pendingId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO pending_on_demand_crawls (id, canonical_id, user_id, queued_at)
     VALUES (?, ?, ?, datetime('now'))`
  ).run(pendingId, resolvedCanonicalId, req.user.id);
  await db.prepare(
    `UPDATE pending_on_demand_crawls SET started_at = datetime('now') WHERE id = ?`
  ).run(pendingId);
  runOnDemandCrawl(resolvedCanonicalId, pendingId).catch(() => {});
}
```

- [ ] **Step 7: Commit**

```bash
git add crawler/on-demand-crawl.js tests/integration/on-demand-crawl.test.js server/index.js server/routes/lists.js
git commit -m "feat(crawl): add Mode 3 on-demand crawl orchestrator + startup drain"
```

---

### Task 7: FTS5 rebuild + suggest-index generation

**Files:**
- Create: `crawler/fts-rebuild.js`
- Modify: `crawler/index.js` (call after crawl completes)
- Modify: `server/routes/search.js` (add suggest-index endpoint)

- [ ] **Step 1: Write test**

Create `tests/integration/fts-rebuild.test.js`:

```js
"use strict";
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_FILE = "data/prod_local.db";
const db = require("../../server/db");

describe("fts-rebuild", () => {
  before(async () => { await new Promise(r => setTimeout(r, 1500)); });

  it("rebuildFtsIndex populates fts_canonicals", async () => {
    const { rebuildFtsIndex } = require("../../crawler/fts-rebuild");
    await rebuildFtsIndex();
    const count = (await db.prepare("SELECT COUNT(*) AS n FROM fts_canonicals").get()).n;
    assert.ok(count > 0, `fts_canonicals should have rows, got ${count}`);
  });

  it("generateSuggestIndex returns products/brands/categories", async () => {
    const { generateSuggestIndex } = require("../../crawler/fts-rebuild");
    const idx = await generateSuggestIndex();
    assert.ok(Array.isArray(idx.products), "products array");
    assert.ok(Array.isArray(idx.brands), "brands array");
    assert.ok(Array.isArray(idx.categories), "categories array");
    assert.ok(idx.products.length > 0, "has products");
  });
});
```

- [ ] **Step 2: Run test to confirm fails**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/fts-rebuild.test.js --reporter=spec 2>&1 | tail -5
```

- [ ] **Step 3: Implement crawler/fts-rebuild.js**

```js
"use strict";

const db = require("../server/db");

let cachedSuggestIndex = null;
let cachedAt = 0;
const CACHE_TTL_MS = 3600 * 1000;

async function rebuildFtsIndex() {
  await db.execute("DELETE FROM fts_canonicals");
  await db.execute(`
    INSERT INTO fts_canonicals (canonical_id, canonical_name, base_key, aliases_text, category, brands_text)
    SELECT
      cp.id,
      cp.canonical_name,
      COALESCE(cp.base_key, ''),
      COALESCE(cp.base_product_slots, ''),
      COALESCE(cp.category, ''),
      COALESCE(cp.brand_slots, '')
    FROM canonical_products cp
    WHERE EXISTS (
      SELECT 1 FROM store_products sp
      WHERE sp.canonical_id = cp.id AND sp.is_active = 1
    )
  `);
}

async function generateSuggestIndex() {
  const products = await db.prepare(`
    SELECT
      cp.id,
      cp.canonical_name AS name,
      COALESCE(cp.base_product_slots, '') AS aliases,
      COALESCE(cp.category, 'Other') AS category,
      COALESCE(cp.brand_slots, '') AS brand,
      MIN(sp.sale_price) AS cheapest_price,
      sp.image_url AS img
    FROM canonical_products cp
    JOIN store_products sp ON sp.canonical_id = cp.id AND sp.is_active = 1
    GROUP BY cp.id
    ORDER BY cp.canonical_name
  `).all();

  const brandMap = new Map();
  const categoryMap = new Map();

  for (const p of products) {
    if (p.brand) {
      const b = p.brand.replace(/["\[\]]/g, "").trim();
      if (b) brandMap.set(b, (brandMap.get(b) || 0) + 1);
    }
    if (p.category) {
      categoryMap.set(p.category, (categoryMap.get(p.category) || 0) + 1);
    }
  }

  return {
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      aliases: p.aliases ? p.aliases.split(/\s+/).filter(Boolean) : [],
      category: p.category,
      brand: p.brand,
      cheapest_price: p.cheapest_price,
      img: p.img,
    })),
    brands: [...brandMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    categories: [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  };
}

function getCachedSuggestIndex() { return cachedSuggestIndex; }

async function rebuildAll() {
  await rebuildFtsIndex();
  cachedSuggestIndex = await generateSuggestIndex();
  cachedAt = Date.now();
  console.log(`[fts] rebuilt: ${cachedSuggestIndex.products.length} products`);
}

module.exports = { rebuildFtsIndex, generateSuggestIndex, getCachedSuggestIndex, rebuildAll };
```

- [ ] **Step 4: Run test — confirm passes**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/fts-rebuild.test.js --reporter=spec 2>&1 | tail -5
```
Expected: `pass 2`.

- [ ] **Step 5: Add suggest-index endpoint to server/routes/search.js**

In `server/routes/search.js`, add:

```js
const { getCachedSuggestIndex, rebuildAll } = require("../../crawler/fts-rebuild");

router.get("/suggest-index", async (req, res, next) => {
  try {
    let index = getCachedSuggestIndex();
    if (!index) {
      index = await rebuildAll().then(() => getCachedSuggestIndex());
    }
    res
      .set("Cache-Control", "public, max-age=3600")
      .json(index);
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 6: Call rebuildAll at end of Mode 1 crawl**

In `crawler/index.js`, find where the crawl run is marked complete and add:

```js
const { rebuildAll } = require("./fts-rebuild");
// After crawl run update:
rebuildAll().catch(err => console.error("[fts] rebuild error:", err));
```

- [ ] **Step 7: Commit**

```bash
git add crawler/fts-rebuild.js tests/integration/fts-rebuild.test.js server/routes/search.js crawler/index.js
git commit -m "feat: FTS5 index rebuild + suggest-index generation post-crawl"
```

---

### Task 8: GitHub Actions Mode 2 weekly workflow

**Files:**
- Create: `.github/workflows/weekly-catalog-crawl.yml`
- Create: `scripts/mode2-crawl.js`

- [ ] **Step 1: Create Mode 2 crawl runner script**

Create `scripts/mode2-crawl.js`:

```js
#!/usr/bin/env node
"use strict";

const db = require("../server/db");
const { crawlShopifyFullCatalog } = require("../crawler/shopify-full-catalog");
const { crawlWooCommerceFullCatalog } = require("../crawler/woocommerce-full-catalog");
const { rebuildAll } = require("../crawler/fts-rebuild");

const INTER_STORE_DELAY_MS = 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function upsertRows(rows) {
  if (!rows.length) return;
  const stmt = db.prepare(`
    INSERT INTO store_products
      (id, store_id, crawl_run_id, crawl_timestamp, product_name, product_category,
       product_url, image_url, sale_price, original_price, discount_percent,
       currency, is_active, is_on_deal, crawl_mode, external_product_id, availability)
    VALUES (?,?,?,datetime('now'),?,?,?,?,?,?,?,?,1,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      sale_price = excluded.sale_price,
      original_price = excluded.original_price,
      is_on_deal = excluded.is_on_deal,
      is_active = 1,
      crawl_mode = 'catalog'
  `);
  const runId = "mode2_" + Date.now();
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run(
        r.id, r.store_id, runId, r.product_name, r.product_category,
        r.product_url, r.image_url, r.sale_price, r.original_price,
        r.discount_percent, r.currency, r.is_on_deal, r.crawl_mode,
        r.external_product_id, r.availability
      );
    }
  });
  tx(rows);
}

(async () => {
  await new Promise(r => setTimeout(r, 2000)); // wait for DB ready

  const stores = await db.prepare(
    "SELECT id, url, platform FROM stores WHERE platform IN ('shopify','woocommerce') ORDER BY platform, id"
  ).all();

  console.log(`[mode2] crawling ${stores.length} stores`);

  for (const store of stores) {
    console.log(`[mode2] ${store.id} (${store.platform})`);

    const state = await db.prepare(
      "SELECT catalog_cursor FROM store_crawl_state WHERE store_id = ?"
    ).get(store.id);

    let result;
    if (store.platform === "shopify") {
      result = await crawlShopifyFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor
      );
    } else {
      result = await crawlWooCommerceFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor ? parseInt(state.catalog_cursor) : 1
      );
    }

    if (result.rows.length) {
      await upsertRows(result.rows);
    }

    // Update crawl state
    await db.prepare(`
      INSERT INTO store_crawl_state (store_id, last_catalog_crawl, crawl_status, updated_at)
      VALUES (?, datetime('now'), ?, datetime('now'))
      ON CONFLICT(store_id) DO UPDATE SET
        last_catalog_crawl = datetime('now'),
        crawl_status = excluded.crawl_status,
        catalog_cursor = NULL,
        error_message = ?,
        updated_at = datetime('now')
    `).run(
      store.id,
      result.error ? "error" : "idle",
      result.error || null
    );

    console.log(`[mode2] ${store.id}: ${result.rows.length} products, ${result.error || "ok"}`);
    await sleep(INTER_STORE_DELAY_MS);
  }

  await rebuildAll();
  console.log("[mode2] done");
  process.exit(0);
})().catch(err => {
  console.error("[mode2] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to scripts:

```json
"crawl:mode2": "node scripts/mode2-crawl.js"
```

- [ ] **Step 3: Create GitHub Actions workflow**

Create `.github/workflows/weekly-catalog-crawl.yml`:

```yaml
name: Weekly Full Catalog Crawl

on:
  schedule:
    - cron: "0 1 * * 0"  # Sunday 01:00 UTC = ~02:00-03:00 Europe/Berlin
  workflow_dispatch:

concurrency:
  group: weekly-catalog-crawl
  cancel-in-progress: false

jobs:
  crawl:
    runs-on: ubuntu-latest
    timeout-minutes: 360

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run Mode 2 full catalog crawl into Turso
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          DESI_DEALS_DB_TURSO_DATABASE_URL: ${{ secrets.DESI_DEALS_DB_TURSO_DATABASE_URL }}
          DESI_DEALS_DB_TURSO_AUTH_TOKEN: ${{ secrets.DESI_DEALS_DB_TURSO_AUTH_TOKEN }}
          DB_BOOTSTRAP_ON_STARTUP: "true"
        run: npm run crawl:mode2
```

- [ ] **Step 4: Commit**

```bash
git add scripts/mode2-crawl.js .github/workflows/weekly-catalog-crawl.yml package.json
git commit -m "feat(crawl): add Mode 2 weekly full catalog script + GitHub Actions workflow"
```

---

### Task 9: Final integration test + schema verification

- [ ] **Step 1: Run all integration tests**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/*.test.js --reporter=spec 2>&1 | tail -20
```

- [ ] **Step 2: Verify new columns exist in prod_local.db**

```bash
DB_FILE=data/prod_local.db node -e "
const db = require('./server/db');
setTimeout(async () => {
  const checks = [
    db.prepare('PRAGMA table_info(store_products)').all().then(r => r.map(c=>c.name).includes('crawl_mode')),
    db.prepare('PRAGMA table_info(shopping_lists)').all().then(r => r.map(c=>c.name).includes('last_compared_at')),
    db.prepare(\"SELECT name FROM sqlite_master WHERE name='product_alerts'\").get().then(r => !!r),
    db.prepare(\"SELECT name FROM sqlite_master WHERE name='fts_canonicals'\").get().then(r => !!r),
  ];
  const results = await Promise.all(checks);
  results.forEach((r,i) => console.log(['crawl_mode','last_compared_at','product_alerts','fts_canonicals'][i]+':', r));
  process.exit(0);
}, 2000);
" 2>/dev/null
```

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -p
git commit -m "chore: schema and crawl architecture complete"
```
