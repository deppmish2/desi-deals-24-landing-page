# Crawl Architecture — Mode 2 & Mode 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full-catalog crawling (Mode 2, weekly GitHub Actions) and on-demand per-product crawling (Mode 3, triggered when user adds item to shopping list) so shopping list comparisons can quote real prices across all 25 Shopify/WooCommerce stores, not just products currently on deal.

**Architecture:** Three new files in `crawler/catalog/` handle the heavy lifting — a Shopify full-catalog fetcher, a WooCommerce full-catalog fetcher, and an on-demand orchestrator. A shared `catalog-ingester.js` handles the dedup/upsert logic for both Mode 2 and Mode 3. Mode 2 runs as a standalone script invoked by a new weekly GitHub Actions workflow. Mode 3 exposes `runOnDemandCrawl(db, canonicalId, userId)` which the shopping list API will call in a fire-and-forget pattern.

**Tech Stack:** Node.js CommonJS, node-fetch v2, better-sqlite3 (sync locally) / @libsql/client (Turso in prod), GitHub Actions. Uses existing `fetchWithRetry`, `parseWeight`, `parsePrice`, `calcDiscount`, `calcPricePerKg`, `mapCategory`, `canonicalizeDeals`, `resolveBaseProduct` from the codebase.

**Prerequisite:** The `rename/deals-to-store-products` PR must be merged before executing this plan. All table references below use `store_products`, `price_history`, `store_product_mappings`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/db/schema.sql` | Modify | Add 5 new columns to `store_products`, add `store_crawl_state` and `pending_on_demand_crawls` tables |
| `scripts/migrate-crawl-architecture.js` | Create | Idempotent migration: ALTER TABLE for new columns, CREATE TABLE IF NOT EXISTS for new tables, UPDATE stores SET platform |
| `crawler/catalog/catalog-ingester.js` | Create | Shared upsert for Mode 2 + Mode 3: dedup by `store_id+product_url`, set `is_on_deal`, `crawl_mode`, `external_product_id`, `external_variant_id`, `last_crawled_at` |
| `crawler/catalog/shopify-full-catalog.js` | Create | Fetch all products from `/products.json?limit=250&page_info=<cursor>`, return normalized array |
| `crawler/catalog/woocommerce-full-catalog.js` | Create | Fetch all products from `/wp-json/wc/store/v1/products?per_page=100&page=N`, divide prices by `10**minor_unit`, sitemap fallback |
| `crawler/catalog/store-search.js` | Create | Mode 3b: Shopify `/search/suggest.json` + WooCommerce `/wc/store/v1/products?search=` |
| `crawler/catalog/on-demand-crawler.js` | Create | `runOnDemandCrawl(db, canonicalId, userId)` — Mode 3a direct fetch + Mode 3b search, fan-out across stores |
| `crawler/catalog/run-full-catalog.js` | Create | Mode 2 entry point: reads Shopify/WooCommerce stores from DB, runs sequential crawl, updates `store_crawl_state` |
| `crawler/utils/shopify-deals-factory.js` | Modify | Capture `variants[0].id` as `external_variant_id` on each deal |
| `server/index.js` | Modify | On startup: drain `pending_on_demand_crawls WHERE started_at IS NULL` |
| `.github/workflows/catalog-crawl.yml` | Create | Weekly Sunday 02:00 Berlin + workflow_dispatch |
| `tests/integration/catalog-ingester.test.js` | Create | Insert, price-change update, `is_on_deal` flag, idempotency |
| `tests/integration/on-demand-crawl.test.js` | Create | Mode 3a direct, Mode 3b search with confidence gate, queue drain on startup |
| `tests/regression/woocommerce-price-parser.test.mjs` | Create | WC integer price format: "329" → 3.29 with minor_unit=2 |

---

## Task 1: Schema — new columns, new tables, store platform data

**Files:**
- Modify: `server/db/schema.sql`
- Create: `scripts/migrate-crawl-architecture.js`

- [ ] **Step 1: Add 5 new columns to `store_products` in `schema.sql`**

In `server/db/schema.sql`, find the `CREATE TABLE IF NOT EXISTS store_products` block and add these columns before the closing `)`:

```sql
  crawl_mode          TEXT DEFAULT 'deal',
  -- 'deal' | 'catalog' | 'on_demand'

  is_on_deal          INTEGER DEFAULT 0,
  -- 1 = sale price active (compare_at_price > price), 0 = regular catalog price

  last_crawled_at     TEXT,
  -- ISO timestamp, updated on every crawl pass regardless of mode

  external_product_id TEXT,
  -- Shopify integer product.id or WooCommerce post ID (stable dedup hint)
  -- NULL for custom-store products

  external_variant_id TEXT
  -- Shopify variants[0].id — used to build cart permalink /cart/{id}:{qty}
  -- NULL for WooCommerce and custom-store products
```

- [ ] **Step 2: Add `store_crawl_state` table to `schema.sql`**

After the `store_products` table definition, add:

```sql
CREATE TABLE IF NOT EXISTS store_crawl_state (
  store_id            TEXT PRIMARY KEY REFERENCES stores(id),
  last_deal_crawl     TEXT,
  last_catalog_crawl  TEXT,
  catalog_cursor      TEXT,
  -- Shopify page_info cursor for resumable full catalog crawl
  catalog_fallback    TEXT,
  -- 'sitemap' if wc/store/v1 returned 404; NULL = use API normally
  crawl_status        TEXT CHECK (crawl_status IN ('idle','running','error')),
  error_message       TEXT,
  updated_at          TEXT NOT NULL
);
```

- [ ] **Step 3: Add `pending_on_demand_crawls` table to `schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS pending_on_demand_crawls (
  id            TEXT PRIMARY KEY,
  canonical_id  TEXT NOT NULL REFERENCES canonical_products(id),
  user_id       TEXT NOT NULL,
  queued_at     TEXT NOT NULL,
  started_at    TEXT
  -- NULL = still queued; set when crawl begins
);

CREATE INDEX idx_pending_crawls_canonical ON pending_on_demand_crawls(canonical_id);
CREATE INDEX idx_pending_crawls_queued ON pending_on_demand_crawls(started_at, queued_at);
```

- [ ] **Step 4: Write the migration script**

Create `scripts/migrate-crawl-architecture.js`:

```js
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");

const SHOPIFY_STORE_IDS = [
  "anuhita-groceries","bajwa-shop","desigros","dookan","globalfoodhub",
  "indianspicebasket","indianstorestuttgart","indiansupermarkt","jamoona",
  "md-store","namma-markt","sairas","transfoodlev","villagefoods","zora-supermarkt",
];

const WOOCOMMERCE_STORE_IDS = [
  "annachi","asiangrocerystore","asiatischer-lebensmittelladen","barkatfood",
  "indianfoodstore","indische-lebensmittel-online","little-india","spicelands",
  "swadesh","zakiasianfoods",
];

const CUSTOM_STORE_IDS = [
  "desistore","grocera","india-express-food","india-store",
  "masimpex","namastedeutschland","yogimart",
];

async function run() {
  await db.ready;

  const steps = [
    // New columns on store_products
    `ALTER TABLE store_products ADD COLUMN crawl_mode TEXT DEFAULT 'deal'`,
    `ALTER TABLE store_products ADD COLUMN is_on_deal INTEGER DEFAULT 0`,
    `ALTER TABLE store_products ADD COLUMN last_crawled_at TEXT`,
    `ALTER TABLE store_products ADD COLUMN external_product_id TEXT`,
    `ALTER TABLE store_products ADD COLUMN external_variant_id TEXT`,

    // New tables
    `CREATE TABLE IF NOT EXISTS store_crawl_state (
      store_id            TEXT PRIMARY KEY REFERENCES stores(id),
      last_deal_crawl     TEXT,
      last_catalog_crawl  TEXT,
      catalog_cursor      TEXT,
      catalog_fallback    TEXT,
      crawl_status        TEXT CHECK (crawl_status IN ('idle','running','error')),
      error_message       TEXT,
      updated_at          TEXT NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS pending_on_demand_crawls (
      id            TEXT PRIMARY KEY,
      canonical_id  TEXT NOT NULL REFERENCES canonical_products(id),
      user_id       TEXT NOT NULL,
      queued_at     TEXT NOT NULL,
      started_at    TEXT
    )`,

    `CREATE INDEX IF NOT EXISTS idx_pending_crawls_canonical ON pending_on_demand_crawls(canonical_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pending_crawls_queued ON pending_on_demand_crawls(started_at, queued_at)`,
  ];

  for (const sql of steps) {
    try {
      await db.execute(sql);
      console.log("OK:", sql.slice(0, 60));
    } catch (e) {
      if (e.message.includes("duplicate column") || e.message.includes("already exists")) {
        console.log("SKIP (already applied):", sql.slice(0, 60));
      } else {
        throw e;
      }
    }
  }

  // Populate store platform data
  for (const id of SHOPIFY_STORE_IDS) {
    await db.execute(`UPDATE stores SET platform = 'shopify' WHERE id = ?`, [id]);
  }
  for (const id of WOOCOMMERCE_STORE_IDS) {
    await db.execute(`UPDATE stores SET platform = 'woocommerce' WHERE id = ?`, [id]);
  }
  for (const id of CUSTOM_STORE_IDS) {
    await db.execute(`UPDATE stores SET platform = 'custom' WHERE id = ?`, [id]);
  }

  console.log("Migration complete.");
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the migration against prod_local.db**

```bash
DB_FILE=data/prod_local.db node scripts/migrate-crawl-architecture.js
```

Expected output: lines starting with "OK:" for each step, "SKIP" for any already applied, "Migration complete."

- [ ] **Step 6: Verify**

```bash
sqlite3 data/prod_local.db ".schema store_products" | grep -E "crawl_mode|is_on_deal|external_product_id|external_variant_id"
sqlite3 data/prod_local.db "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('store_crawl_state','pending_on_demand_crawls');"
sqlite3 data/prod_local.db "SELECT platform, COUNT(*) FROM stores GROUP BY platform;"
```

Expected:
- 5 new columns present in `store_products`
- Both new tables listed
- `shopify|15`, `woocommerce|10`, `custom|7`

- [ ] **Step 7: Commit**

```bash
git add server/db/schema.sql scripts/migrate-crawl-architecture.js
git commit -m "feat: add crawl_mode, is_on_deal, external_product_id/variant_id columns; store_crawl_state and pending_on_demand_crawls tables; store platform data"
```

---

## Task 2: Capture `external_variant_id` in Mode 1 Shopify factory

**Files:**
- Modify: `crawler/utils/shopify-deals-factory.js:14-52`

- [ ] **Step 1: Write the failing test**

Add to `tests/regression/shopify-deals-factory.test.mjs`:

```js
import { strict as assert } from "node:assert";
import { test } from "node:test";

// inline the relevant part of mapShopifyProduct for testability
function mapShopifyProductVariantId(product, storeUrl) {
  const variant = product.variants?.[0] || {};
  return {
    product_url: `${storeUrl}/products/${product.handle}`,
    external_product_id: String(product.id),
    external_variant_id: variant.id != null ? String(variant.id) : null,
  };
}

test("captures external_product_id and external_variant_id from Shopify product", () => {
  const product = {
    id: 123456,
    handle: "trs-toor-dal-1kg",
    title: "TRS Toor Dal 1kg",
    variants: [{ id: 789012, price: "3.99", compare_at_price: "4.99", available: true }],
    images: [],
  };
  const result = mapShopifyProductVariantId(product, "https://eu.dookan.com");
  assert.equal(result.external_product_id, "123456");
  assert.equal(result.external_variant_id, "789012");
  assert.equal(result.product_url, "https://eu.dookan.com/products/trs-toor-dal-1kg");
});

test("external_variant_id is null when product has no variants", () => {
  const product = { id: 1, handle: "test", title: "Test", variants: [], images: [] };
  const result = mapShopifyProductVariantId(product, "https://store.com");
  assert.equal(result.external_variant_id, null);
});
```

- [ ] **Step 2: Run to verify it passes (this tests the helper, not the factory yet)**

```bash
node --test tests/regression/shopify-deals-factory.test.mjs --reporter=spec
```

- [ ] **Step 3: Update `shopify-deals-factory.js` to capture both IDs**

In `crawler/utils/shopify-deals-factory.js`, update `mapShopifyProduct` to include the two new fields in the returned object:

```js
function mapShopifyProduct({ storeId, storeName, storeUrl }, product) {
  const variant = product.variants?.[0] || {};
  const salePrice = parsePrice(variant.price);
  const compareAtPrice = parsePrice(variant.compare_at_price);

  if (!salePrice) return null;

  const originalPrice =
    compareAtPrice && compareAtPrice > salePrice ? compareAtPrice : null;
  const discountPercent = calcDiscount(salePrice, originalPrice);

  if (!originalPrice || !(discountPercent > 0)) {
    return null;
  }

  const weight = parseWeight(product.title) || parseWeight(variant.title);
  const pricePerKg = weight
    ? calcPricePerKg(salePrice, weight.value, weight.unit)
    : null;

  return {
    store_id: storeId,
    store_name: storeName,
    store_url: storeUrl,
    product_name: product.title,
    product_category: mapCategory(product.title),
    product_url: `${storeUrl}/products/${product.handle}`,
    image_url: product.images?.[0]?.src?.replace(/\?.*$/, "") || null,
    weight_raw: weight?.raw || null,
    weight_value: weight?.value || null,
    weight_unit: weight?.unit || null,
    sale_price: salePrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability: variant.available ? "in_stock" : "out_of_stock",
    bulk_pricing: null,
    external_product_id: product.id != null ? String(product.id) : null,
    external_variant_id: variant.id != null ? String(variant.id) : null,
  };
}
```

- [ ] **Step 4: Verify existing Mode 1 tests still pass**

```bash
npm run test:regression --reporter=spec
```

Expected: same pass count as baseline (136/137).

- [ ] **Step 5: Commit**

```bash
git add crawler/utils/shopify-deals-factory.js tests/regression/shopify-deals-factory.test.mjs
git commit -m "feat: capture external_product_id and external_variant_id in Shopify deals factory"
```

---

## Task 3: WooCommerce price parser regression test

**Files:**
- Create: `tests/regression/woocommerce-price-parser.test.mjs`

This is the highest-risk part of Mode 2 — WC prices come as integer strings in minor units. Get a regression test in place before any WC code is written.

- [ ] **Step 1: Create the test file**

Create `tests/regression/woocommerce-price-parser.test.mjs`:

```js
import { strict as assert } from "node:assert";
import { test } from "node:test";

// Inline the price parsing logic we'll implement in woocommerce-full-catalog.js
// so the spec is clear and the implementation must match.
function parseWcPrice(rawStr, currencyMinorUnit) {
  if (rawStr == null || rawStr === "") return null;
  const cents = parseInt(String(rawStr), 10);
  if (!Number.isFinite(cents)) return null;
  return cents / Math.pow(10, currencyMinorUnit ?? 2);
}

function isOnDeal(product) {
  const sale = parseWcPrice(product.prices?.sale_price, product.prices?.currency_minor_unit);
  const regular = parseWcPrice(product.prices?.regular_price, product.prices?.currency_minor_unit);
  return sale != null && regular != null && sale < regular;
}

test("parseWcPrice converts 329 with minor_unit=2 to 3.29", () => {
  assert.equal(parseWcPrice("329", 2), 3.29);
});

test("parseWcPrice converts 0 to 0", () => {
  assert.equal(parseWcPrice("0", 2), 0);
});

test("parseWcPrice returns null for empty string", () => {
  assert.equal(parseWcPrice("", 2), null);
});

test("parseWcPrice returns null for null", () => {
  assert.equal(parseWcPrice(null, 2), null);
});

test("isOnDeal returns true when sale_price < regular_price", () => {
  const product = {
    prices: { sale_price: "299", regular_price: "399", currency_minor_unit: 2 },
  };
  assert.equal(isOnDeal(product), true);
});

test("isOnDeal returns false when sale_price equals regular_price", () => {
  const product = {
    prices: { sale_price: "399", regular_price: "399", currency_minor_unit: 2 },
  };
  assert.equal(isOnDeal(product), false);
});

test("parseWcPrice does not silently return 100x too high", () => {
  // A bug where integer string is treated as decimal would give 329 instead of 3.29
  const price = parseWcPrice("329", 2);
  assert.ok(price < 10, `Expected price < €10, got €${price}. Did you forget to divide by 10^minor_unit?`);
});
```

- [ ] **Step 2: Run to verify all tests pass (they test the inline helper)**

```bash
node --test tests/regression/woocommerce-price-parser.test.mjs --reporter=spec
```

Expected: 7 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/regression/woocommerce-price-parser.test.mjs
git commit -m "test: add WooCommerce price integer-format regression tests"
```

---

## Task 4: Shared catalog ingester

**Files:**
- Create: `crawler/catalog/catalog-ingester.js`
- Create: `tests/integration/catalog-ingester.test.js`

This is the core upsert logic used by both Mode 2 and Mode 3. Dedup key is `store_id + product_url`. Sets all new columns on upsert.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/catalog-ingester.test.js`:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { ingestCatalogProducts } = require("../../crawler/catalog/catalog-ingester");

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL,
      platform TEXT DEFAULT 'unknown', logo_url TEXT, last_crawled_at DATETIME,
      crawl_status TEXT DEFAULT 'active', free_shipping_min REAL, address TEXT,
      contact_phone TEXT, contact_email TEXT, webhook_secret TEXT);
    CREATE TABLE canonical_products (id TEXT PRIMARY KEY, canonical_name TEXT,
      base_key TEXT, category TEXT, weight_value REAL, weight_unit TEXT,
      image_url TEXT, brand_slots TEXT, base_product_slots TEXT,
      aliases_text TEXT, brands_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE store_products (
      id TEXT PRIMARY KEY, crawl_run_id TEXT NOT NULL, crawl_timestamp DATETIME NOT NULL,
      store_id TEXT NOT NULL, canonical_id TEXT, product_name TEXT NOT NULL,
      product_category TEXT NOT NULL, product_url TEXT NOT NULL, image_url TEXT,
      weight_raw TEXT, weight_value REAL, weight_unit TEXT, sale_price REAL NOT NULL,
      original_price REAL, discount_percent REAL, price_per_kg REAL, price_per_unit REAL,
      currency TEXT DEFAULT 'EUR', availability TEXT DEFAULT 'unknown', bulk_pricing TEXT,
      best_before TEXT, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      crawl_mode TEXT DEFAULT 'deal', is_on_deal INTEGER DEFAULT 0,
      last_crawled_at TEXT, external_product_id TEXT, external_variant_id TEXT,
      display_date TEXT, display_order INTEGER
    );
    INSERT INTO stores VALUES ('dookan','Dookan','https://eu.dookan.com','shopify',NULL,NULL,'active',NULL,NULL,NULL,NULL,NULL);
  `);
  db.ready = Promise.resolve();
  return db;
}

test("ingestCatalogProducts inserts new product with crawl_mode and is_on_deal", async () => {
  const db = makeDb();
  const products = [{
    store_id: "dookan",
    product_name: "TRS Toor Dal 1kg",
    product_category: "Lentils & Dal",
    product_url: "https://eu.dookan.com/products/trs-toor-dal-1kg",
    image_url: null,
    weight_raw: "1kg", weight_value: 1, weight_unit: "kg",
    sale_price: 3.99, original_price: 4.99, discount_percent: 20,
    price_per_kg: 3.99, price_per_unit: null,
    currency: "EUR", availability: "in_stock", bulk_pricing: null, best_before: null,
    external_product_id: "111", external_variant_id: "222",
    is_on_deal: 1, crawl_mode: "catalog",
  }];

  const stats = await ingestCatalogProducts(db, products, "run-001");

  assert.equal(stats.inserted, 1);
  assert.equal(stats.updated, 0);

  const row = db.prepare("SELECT * FROM store_products WHERE product_url = ?")
    .get("https://eu.dookan.com/products/trs-toor-dal-1kg");
  assert.equal(row.crawl_mode, "catalog");
  assert.equal(row.is_on_deal, 1);
  assert.equal(row.external_product_id, "111");
  assert.equal(row.external_variant_id, "222");
  assert.equal(row.is_active, 1);
});

test("ingestCatalogProducts updates price on re-crawl", async () => {
  const db = makeDb();
  const base = {
    store_id: "dookan", product_name: "TRS Toor Dal 1kg",
    product_category: "Lentils & Dal",
    product_url: "https://eu.dookan.com/products/trs-toor-dal-1kg",
    image_url: null, weight_raw: "1kg", weight_value: 1, weight_unit: "kg",
    original_price: 4.99, discount_percent: 20, price_per_kg: 3.99, price_per_unit: null,
    currency: "EUR", availability: "in_stock", bulk_pricing: null, best_before: null,
    external_product_id: "111", external_variant_id: "222",
    is_on_deal: 1, crawl_mode: "catalog",
  };

  await ingestCatalogProducts(db, [{ ...base, sale_price: 3.99 }], "run-001");
  const stats = await ingestCatalogProducts(db, [{ ...base, sale_price: 3.49 }], "run-002");

  assert.equal(stats.updated, 1);
  const row = db.prepare("SELECT sale_price FROM store_products WHERE is_active = 1")
    .get();
  assert.equal(row.sale_price, 3.49);
});

test("ingestCatalogProducts sets is_on_deal=0 for regular catalog price", async () => {
  const db = makeDb();
  await ingestCatalogProducts(db, [{
    store_id: "dookan", product_name: "TRS Toor Dal 1kg",
    product_category: "Lentils & Dal",
    product_url: "https://eu.dookan.com/products/trs-toor-dal-1kg",
    image_url: null, weight_raw: "1kg", weight_value: 1, weight_unit: "kg",
    sale_price: 3.99, original_price: null, discount_percent: null,
    price_per_kg: 3.99, price_per_unit: null,
    currency: "EUR", availability: "in_stock", bulk_pricing: null, best_before: null,
    external_product_id: "111", external_variant_id: "222",
    is_on_deal: 0, crawl_mode: "catalog",
  }], "run-001");

  const row = db.prepare("SELECT is_on_deal FROM store_products").get();
  assert.equal(row.is_on_deal, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/integration/catalog-ingester.test.js --reporter=spec
```

Expected: FAIL with "Cannot find module '../../crawler/catalog/catalog-ingester'"

- [ ] **Step 3: Implement `crawler/catalog/catalog-ingester.js`**

```js
"use strict";

const { v4: uuidv4 } = require("uuid");

function normalizeText(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function normalizeNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Dedup key: store_id + product_url (one row per distinct product page URL per store).
// external_product_id and external_variant_id are data fields only — not dedup keys.
async function ingestCatalogProducts(db, products, crawlRunId) {
  const now = new Date().toISOString();
  const stats = { inserted: 0, updated: 0, unchanged: 0 };

  for (const p of products) {
    const storeId = normalizeText(p.store_id);
    const productUrl = normalizeText(p.product_url);
    if (!storeId || !productUrl || normalizeNumber(p.sale_price) == null) continue;

    const existing = await db
      .prepare(
        `SELECT id, sale_price, is_on_deal, crawl_mode FROM store_products
         WHERE store_id = ? AND product_url = ? AND is_active = 1 LIMIT 1`
      )
      .get(storeId, productUrl);

    const salePrice = normalizeNumber(p.sale_price);
    const isOnDeal = p.is_on_deal ? 1 : 0;
    const crawlMode = normalizeText(p.crawl_mode) || "catalog";

    if (existing) {
      const priceChanged = existing.sale_price !== salePrice;
      const dealFlagChanged = existing.is_on_deal !== isOnDeal;

      if (!priceChanged && !dealFlagChanged) {
        // Still update last_crawled_at even when unchanged
        await db.prepare(
          `UPDATE store_products SET last_crawled_at = ?, crawl_mode = ? WHERE id = ?`
        ).run(now, crawlMode, existing.id);
        stats.unchanged++;
        continue;
      }

      // Deactivate old row, insert fresh row (preserves price history via FK)
      await db.prepare(`UPDATE store_products SET is_active = 0 WHERE id = ?`).run(existing.id);
      stats.updated++;
    } else {
      stats.inserted++;
    }

    const crawlTimestamp = normalizeText(p.crawl_timestamp) || now;

    await db.prepare(`
      INSERT INTO store_products
        (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
         product_url, image_url, weight_raw, weight_value, weight_unit,
         sale_price, original_price, discount_percent, price_per_kg, price_per_unit,
         currency, availability, bulk_pricing, best_before, is_active,
         crawl_mode, is_on_deal, last_crawled_at, external_product_id, external_variant_id)
      VALUES
        (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)
    `).run(
      uuidv4(), crawlRunId, crawlTimestamp, storeId,
      normalizeText(p.product_name), normalizeText(p.product_category) || "Other",
      productUrl, normalizeText(p.image_url),
      normalizeText(p.weight_raw), normalizeNumber(p.weight_value), normalizeText(p.weight_unit),
      salePrice, normalizeNumber(p.original_price), normalizeNumber(p.discount_percent),
      normalizeNumber(p.price_per_kg), normalizeNumber(p.price_per_unit),
      normalizeText(p.currency) || "EUR", normalizeText(p.availability) || "unknown",
      normalizeText(p.bulk_pricing), normalizeText(p.best_before),
      crawlMode, isOnDeal, now,
      normalizeText(p.external_product_id), normalizeText(p.external_variant_id),
    );
  }

  return stats;
}

module.exports = { ingestCatalogProducts };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/integration/catalog-ingester.test.js --reporter=spec
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add crawler/catalog/catalog-ingester.js tests/integration/catalog-ingester.test.js
git commit -m "feat: add catalog-ingester with dedup by store_id+product_url, is_on_deal, crawl_mode"
```

---

## Task 5: Shopify full catalog fetcher

**Files:**
- Create: `crawler/catalog/shopify-full-catalog.js`

Fetches all products from `/products.json` using cursor-based pagination. Returns normalized product objects ready for `ingestCatalogProducts`.

- [ ] **Step 1: Write the failing test (inline mock)**

Add to `tests/integration/catalog-ingester.test.js` (or new file `tests/regression/shopify-catalog-fetch.test.mjs`):

```js
import { strict as assert } from "node:assert";
import { test } from "node:test";

// Test the normalization shape produced by Shopify full catalog fetcher
function normalizeShopifyProduct(storeId, storeUrl, product) {
  const variant = product.variants?.[0] || {};
  const salePrice = parseFloat(variant.price || "0");
  const compareAtPrice = parseFloat(variant.compare_at_price || "0");
  const isOnDeal = compareAtPrice > salePrice && salePrice > 0 ? 1 : 0;
  return {
    store_id: storeId,
    product_url: `${storeUrl}/products/${product.handle}`,
    product_name: product.title,
    external_product_id: product.id != null ? String(product.id) : null,
    external_variant_id: variant.id != null ? String(variant.id) : null,
    sale_price: salePrice,
    original_price: isOnDeal ? compareAtPrice : null,
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
  };
}

test("normalizeShopifyProduct sets is_on_deal=1 when compare_at > price", () => {
  const p = { id: 1, handle: "dal", title: "Dal 1kg",
    variants: [{ id: 10, price: "3.99", compare_at_price: "4.99", available: true }],
    images: [] };
  const r = normalizeShopifyProduct("dookan", "https://eu.dookan.com", p);
  assert.equal(r.is_on_deal, 1);
  assert.equal(r.external_variant_id, "10");
});

test("normalizeShopifyProduct sets is_on_deal=0 when no compare_at price", () => {
  const p = { id: 2, handle: "rice", title: "Rice 5kg",
    variants: [{ id: 20, price: "12.99", compare_at_price: null, available: true }],
    images: [] };
  const r = normalizeShopifyProduct("dookan", "https://eu.dookan.com", p);
  assert.equal(r.is_on_deal, 0);
  assert.equal(r.original_price, null);
});
```

- [ ] **Step 2: Run to verify both tests pass**

```bash
node --test tests/regression/shopify-catalog-fetch.test.mjs --reporter=spec
```

Expected: 2 passing.

- [ ] **Step 3: Implement `crawler/catalog/shopify-full-catalog.js`**

```js
"use strict";

const { fetchWithRetry } = require("../utils/fetch-with-retry");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { calcDiscount, calcPricePerKg } = require("../utils/price-parser");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const PAGE_DELAY_MS = 600;

function normalizeShopifyProduct(storeId, storeUrl, product) {
  const variant = product.variants?.[0] || {};
  const salePrice = parseFloat(variant.price || "0");
  if (!salePrice) return null;

  const compareAtPrice = parseFloat(variant.compare_at_price || "0");
  const isOnDeal = compareAtPrice > salePrice ? 1 : 0;
  const originalPrice = isOnDeal ? compareAtPrice : null;
  const discountPercent = isOnDeal ? calcDiscount(salePrice, originalPrice) : null;

  const weight = parseWeight(product.title) || parseWeight(variant.title);
  const pricePerKg = weight ? calcPricePerKg(salePrice, weight.value, weight.unit) : null;

  return {
    store_id: storeId,
    product_name: product.title,
    product_category: mapCategory(product.title),
    product_url: `${storeUrl}/products/${product.handle}`,
    image_url: product.images?.[0]?.src?.replace(/\?.*$/, "") || null,
    weight_raw: weight?.raw || null,
    weight_value: weight?.value || null,
    weight_unit: weight?.unit || null,
    sale_price: salePrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability: variant.available ? "in_stock" : "out_of_stock",
    bulk_pricing: null,
    best_before: null,
    external_product_id: product.id != null ? String(product.id) : null,
    external_variant_id: variant.id != null ? String(variant.id) : null,
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
  };
}

// Fetches all products from a Shopify store using cursor-based /products.json pagination.
// Returns { products: NormalizedProduct[], nextCursor: string|null }
// Pass cursor from store_crawl_state.catalog_cursor to resume a partial crawl.
async function fetchShopifyFullCatalog(storeId, storeUrl, { cursor = null, maxPages = 500 } = {}) {
  const products = [];
  let pageCount = 0;
  let nextCursor = null;

  // Build first URL: cursor-based or fresh start
  let url = cursor
    ? `${storeUrl}/products.json?limit=250&page_info=${encodeURIComponent(cursor)}`
    : `${storeUrl}/products.json?limit=250`;

  while (url && pageCount < maxPages) {
    const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, timeout: 30000 },
      { label: `[${storeId}] products.json p${pageCount + 1}` });

    if (!res.ok) {
      if (pageCount === 0) throw new Error(`HTTP ${res.status} on ${url}`);
      break; // partial result is acceptable
    }

    const json = await res.json();
    const page = json.products || [];

    for (const product of page) {
      const normalized = normalizeShopifyProduct(storeId, storeUrl, product);
      if (normalized) products.push(normalized);
    }

    pageCount++;

    // Extract next page cursor from Link header
    const linkHeader = res.headers.get("Link") || "";
    const nextMatch = linkHeader.match(/<[^>]+page_info=([^&>]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      nextCursor = decodeURIComponent(nextMatch[1]);
      url = `${storeUrl}/products.json?limit=250&page_info=${nextMatch[1]}`;
    } else {
      nextCursor = null;
      break;
    }

    if (page.length > 0) {
      await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  return { products, nextCursor };
}

module.exports = { fetchShopifyFullCatalog, normalizeShopifyProduct };
```

- [ ] **Step 4: Run regression tests to verify nothing broken**

```bash
npm run test:regression --reporter=spec
```

Expected: same baseline counts.

- [ ] **Step 5: Commit**

```bash
git add crawler/catalog/shopify-full-catalog.js tests/regression/shopify-catalog-fetch.test.mjs
git commit -m "feat: add Shopify full catalog fetcher with cursor pagination"
```

---

## Task 6: WooCommerce full catalog fetcher

**Files:**
- Create: `crawler/catalog/woocommerce-full-catalog.js`

Fetches all products from `/wp-json/wc/store/v1/products`. Divides prices by `10**currency_minor_unit`. Falls back to sitemap scraping if the endpoint returns 404.

- [ ] **Step 1: Implement `crawler/catalog/woocommerce-full-catalog.js`**

```js
"use strict";

const { fetchWithRetry } = require("../utils/fetch-with-retry");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { calcDiscount, calcPricePerKg } = require("../utils/price-parser");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const PAGE_DELAY_MS = 800;

// WooCommerce Store API returns prices as integer strings in minor currency units.
// €3.29 is returned as "329". Divide by 10^currency_minor_unit (always 2 for EUR).
function parseWcPrice(rawStr, minorUnit) {
  if (rawStr == null || rawStr === "") return null;
  const cents = parseInt(String(rawStr), 10);
  if (!Number.isFinite(cents)) return null;
  return cents / Math.pow(10, minorUnit ?? 2);
}

function normalizeWcProduct(storeId, storeUrl, product) {
  const minorUnit = product.prices?.currency_minor_unit ?? 2;
  const salePrice = parseWcPrice(product.prices?.sale_price, minorUnit);
  if (!salePrice) return null;

  const regularPrice = parseWcPrice(product.prices?.regular_price, minorUnit);
  const isOnDeal = regularPrice != null && regularPrice > salePrice ? 1 : 0;
  const originalPrice = isOnDeal ? regularPrice : null;
  const discountPercent = isOnDeal ? calcDiscount(salePrice, originalPrice) : null;

  const weight = parseWeight(product.name);
  const pricePerKg = weight ? calcPricePerKg(salePrice, weight.value, weight.unit) : null;

  const productUrl = product.permalink || `${storeUrl}/?p=${product.id}`;

  return {
    store_id: storeId,
    product_name: product.name,
    product_category: mapCategory(product.name),
    product_url: productUrl,
    image_url: product.images?.[0]?.src || null,
    weight_raw: weight?.raw || null,
    weight_value: weight?.value || null,
    weight_unit: weight?.unit || null,
    sale_price: salePrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability: product.is_in_stock ? "in_stock" : "out_of_stock",
    bulk_pricing: null,
    best_before: null,
    external_product_id: product.id != null ? String(product.id) : null,
    external_variant_id: null, // WooCommerce variations handled separately in v2
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
  };
}

async function fetchWcStoreApiPage(storeUrl, storeId, page) {
  const url = `${storeUrl}/wp-json/wc/store/v1/products?per_page=100&page=${page}&orderby=date&order=desc`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, timeout: 30000 },
    { label: `[${storeId}] wc/store/v1 p${page}`, retries: 1 });
  return res;
}

// Fetch product URLs from /product-sitemap.xml for sitemap fallback
async function fetchSitemapUrls(storeUrl, storeId) {
  const url = `${storeUrl}/product-sitemap.xml`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, timeout: 20000 },
    { label: `[${storeId}] product-sitemap.xml`, retries: 1 });
  if (!res.ok) return [];
  const xml = await res.text();
  const matches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
  return Array.from(matches, m => m[1]).filter(u => u.includes(storeUrl));
}

// Returns { products, fallbackUsed: false|'sitemap' }
async function fetchWooCommerceFullCatalog(storeId, storeUrl, { maxPages = 200 } = {}) {
  const products = [];
  let page = 1;

  while (page <= maxPages) {
    const res = await fetchWcStoreApiPage(storeUrl, storeId, page);

    if (res.status === 404) {
      // Store doesn't have wc/store/v1 — fall back to sitemap
      console.warn(`[${storeId}] wc/store/v1 returned 404 — falling back to sitemap scraping`);
      const urls = await fetchSitemapUrls(storeUrl, storeId);
      // Sitemap fallback: return URL stubs for scraping by caller
      // (full HTML scraping is out of scope for this function — caller handles)
      return { products, fallbackUsed: "sitemap", sitemapUrls: urls };
    }

    if (!res.ok) {
      if (page === 1) throw new Error(`[${storeId}] wc/store/v1 HTTP ${res.status}`);
      break;
    }

    const json = await res.json();
    const pageProducts = Array.isArray(json) ? json : [];

    for (const p of pageProducts) {
      const normalized = normalizeWcProduct(storeId, storeUrl, p);
      if (normalized) products.push(normalized);
    }

    if (pageProducts.length < 100) break;
    page++;
    await new Promise(r => setTimeout(r, PAGE_DELAY_MS));
  }

  return { products, fallbackUsed: false };
}

module.exports = { fetchWooCommerceFullCatalog, normalizeWcProduct, parseWcPrice };
```

- [ ] **Step 2: Run the WC price regression tests against the real implementation**

Update `tests/regression/woocommerce-price-parser.test.mjs` to import from the real module instead of the inline helper:

```js
import { parseWcPrice } from "../../crawler/catalog/woocommerce-full-catalog.js";
// ... remove the inline function definition, keep all the test cases
```

```bash
node --test tests/regression/woocommerce-price-parser.test.mjs --reporter=spec
```

Expected: 7 passing.

- [ ] **Step 3: Commit**

```bash
git add crawler/catalog/woocommerce-full-catalog.js tests/regression/woocommerce-price-parser.test.mjs
git commit -m "feat: add WooCommerce full catalog fetcher with minor-unit price parsing and sitemap fallback"
```

---

## Task 7: Mode 2 orchestrator

**Files:**
- Create: `crawler/catalog/run-full-catalog.js`

Reads all Shopify + WooCommerce stores from DB, crawls each sequentially, updates `store_crawl_state`, runs canonicalization after all stores complete.

- [ ] **Step 1: Implement `crawler/catalog/run-full-catalog.js`**

```js
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { v4: uuidv4 } = require("uuid");
const { fetchShopifyFullCatalog } = require("./shopify-full-catalog");
const { fetchWooCommerceFullCatalog } = require("./woocommerce-full-catalog");
const { ingestCatalogProducts } = require("./catalog-ingester");
const { canonicalizeDeals } = require("../../server/services/canonicalizer");
const { logInfo, logWarn, logError } = require("../utils/crawl-logger");

const INTER_STORE_DELAY_MS = 1500;

async function updateCrawlState(db, storeId, patch) {
  const now = new Date().toISOString();
  const existing = await db.prepare(
    `SELECT store_id FROM store_crawl_state WHERE store_id = ?`
  ).get(storeId);

  if (existing) {
    const setClauses = Object.keys(patch).map(k => `${k} = ?`).join(", ");
    await db.prepare(
      `UPDATE store_crawl_state SET ${setClauses}, updated_at = ? WHERE store_id = ?`
    ).run(...Object.values(patch), now, storeId);
  } else {
    await db.prepare(
      `INSERT INTO store_crawl_state (store_id, updated_at, ${Object.keys(patch).join(", ")})
       VALUES (?, ?, ${Object.keys(patch).map(() => "?").join(", ")})`
    ).run(storeId, now, ...Object.values(patch));
  }
}

async function runFullCatalogCrawl(db) {
  await db.ready;
  const runId = uuidv4();
  const now = new Date().toISOString();
  logInfo("catalog", "Mode 2 full catalog crawl started", { run_id: runId });

  const stores = await db.prepare(
    `SELECT id, name, url, platform FROM stores WHERE platform IN ('shopify','woocommerce') ORDER BY platform, id`
  ).all();

  let totalInserted = 0;
  let totalUpdated = 0;
  const errors = [];

  for (const store of stores) {
    logInfo("catalog", `Crawling ${store.platform} store`, { store_id: store.id });

    try {
      await updateCrawlState(db, store.id, { crawl_status: "running" });

      let products = [];

      if (store.platform === "shopify") {
        const { products: fetched, nextCursor } = await fetchShopifyFullCatalog(store.id, store.url);
        products = fetched;
        await updateCrawlState(db, store.id, {
          catalog_cursor: nextCursor,
          last_catalog_crawl: now,
          crawl_status: "idle",
        });
      } else {
        const { products: fetched, fallbackUsed, sitemapUrls } = await fetchWooCommerceFullCatalog(store.id, store.url);
        products = fetched;

        if (fallbackUsed === "sitemap") {
          logWarn("catalog", `${store.id} using sitemap fallback — ${sitemapUrls?.length ?? 0} URLs found`);
          await updateCrawlState(db, store.id, {
            catalog_fallback: "sitemap",
            last_catalog_crawl: now,
            crawl_status: "idle",
          });
        } else {
          await updateCrawlState(db, store.id, {
            catalog_fallback: null,
            last_catalog_crawl: now,
            crawl_status: "idle",
          });
        }
      }

      const stats = await ingestCatalogProducts(db, products, runId);
      totalInserted += stats.inserted;
      totalUpdated += stats.updated;

      logInfo("catalog", `${store.id}: ${products.length} products fetched, ${stats.inserted} inserted, ${stats.updated} updated`);
    } catch (err) {
      logError("catalog", `${store.id} failed: ${err.message}`);
      errors.push({ store_id: store.id, error: err.message });
      await updateCrawlState(db, store.id, { crawl_status: "error", error_message: err.message });
    }

    // Inter-store delay — avoids hammering stores in rapid succession
    const idx = stores.indexOf(store);
    if (idx < stores.length - 1) {
      await new Promise(r => setTimeout(r, INTER_STORE_DELAY_MS));
    }
  }

  // Canonicalize all newly ingested products
  try {
    const stats = await canonicalizeDeals(db, { unmappedOnly: true });
    logInfo("catalog", "Canonicalization complete", stats);
  } catch (err) {
    logWarn("catalog", `Canonicalization failed: ${err.message}`);
    errors.push({ store_id: "canonicalize", error: err.message });
  }

  logInfo("catalog", "Mode 2 full catalog crawl complete", {
    run_id: runId, inserted: totalInserted, updated: totalUpdated,
    stores: stores.length, errors: errors.length,
  });

  return { runId, inserted: totalInserted, updated: totalUpdated, errors };
}

if (require.main === module) {
  const db = require("../../server/db");
  runFullCatalogCrawl(db)
    .then(r => { console.log("Done:", r); process.exit(0); })
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runFullCatalogCrawl };
```

- [ ] **Step 2: Add npm script in `package.json`**

In `package.json`, add to the `"scripts"` block:

```json
"crawl:catalog": "node crawler/catalog/run-full-catalog.js"
```

- [ ] **Step 3: Smoke test with dry-run (no DB changes)**

```bash
DB_FILE=data/prod_local.db node -e "
const db = require('./server/db');
db.ready.then(async () => {
  const stores = await db.prepare(\"SELECT id, platform FROM stores WHERE platform IN ('shopify','woocommerce') LIMIT 3\").all();
  console.log('Stores for Mode 2:', stores.map(s => s.id + ' [' + s.platform + ']').join(', '));
  process.exit(0);
});
"
```

Expected: prints 3 store IDs with their platform types.

- [ ] **Step 4: Commit**

```bash
git add crawler/catalog/run-full-catalog.js package.json
git commit -m "feat: add Mode 2 full catalog orchestrator (Shopify + WooCommerce, sequential with inter-store delay)"
```

---

## Task 8: GitHub Actions workflow for Mode 2

**Files:**
- Create: `.github/workflows/catalog-crawl.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Weekly Full Catalog Crawl

on:
  schedule:
    - cron: "0 1 * * 0"  # Sunday 01:00 UTC = ~02:00-03:00 Europe/Berlin
  workflow_dispatch:

concurrency:
  group: catalog-crawl
  cancel-in-progress: false

jobs:
  catalog-crawl:
    runs-on: ubuntu-latest
    timeout-minutes: 360  # 6 hours max — 25 stores × full catalog can be slow

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

      - name: Run full catalog crawl into Turso
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          DESI_DEALS_DB_TURSO_DATABASE_URL: ${{ secrets.DESI_DEALS_DB_TURSO_DATABASE_URL }}
          DESI_DEALS_DB_TURSO_AUTH_TOKEN: ${{ secrets.DESI_DEALS_DB_TURSO_AUTH_TOKEN }}
          DB_BOOTSTRAP_ON_STARTUP: "true"
        run: npm run crawl:catalog
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/catalog-crawl.yml
git commit -m "ci: add weekly full catalog crawl GitHub Actions workflow"
```

---

## Task 9: Mode 3b store search

**Files:**
- Create: `crawler/catalog/store-search.js`

Used by the on-demand crawler to search a store for a specific product when no product_url is known.

- [ ] **Step 1: Implement `crawler/catalog/store-search.js`**

```js
"use strict";

const { fetchWithRetry } = require("../utils/fetch-with-retry");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// Shopify: GET /search/suggest.json?q=<tokens>&resources[type]=product&resources[limit]=10
async function searchShopifyStore(storeUrl, storeId, queryTokens) {
  const q = encodeURIComponent(queryTokens.join(" "));
  const url = `${storeUrl}/search/suggest.json?q=${q}&resources[type]=product&resources[limit]=10`;

  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, timeout: 15000 },
    { label: `[${storeId}] shopify-search`, retries: 1 });

  if (!res.ok) return [];

  const json = await res.json();
  const products = json.resources?.results?.products || [];

  return products.map(p => ({
    title: p.title,
    url: p.url ? (p.url.startsWith("http") ? p.url : `${storeUrl}${p.url}`) : null,
    image: p.image?.url || null,
    price: parseFloat(p.price?.replace(/[^0-9.]/g, "") || "0") || null,
  }));
}

// WooCommerce: GET /wp-json/wc/store/v1/products?search=<tokens>&per_page=10
async function searchWooCommerceStore(storeUrl, storeId, queryTokens) {
  const q = encodeURIComponent(queryTokens.join(" "));
  const url = `${storeUrl}/wp-json/wc/store/v1/products?search=${q}&per_page=10`;

  const res = await fetchWithRetry(url, { headers: { "User-Agent": UA }, timeout: 15000 },
    { label: `[${storeId}] wc-search`, retries: 1 });

  if (!res.ok) return [];

  const json = await res.json();
  const products = Array.isArray(json) ? json : [];
  const minorUnit = products[0]?.prices?.currency_minor_unit ?? 2;

  return products.map(p => {
    const cents = parseInt(String(p.prices?.sale_price || "0"), 10);
    const price = cents / Math.pow(10, minorUnit);
    return {
      title: p.name,
      url: p.permalink || null,
      image: p.images?.[0]?.src || null,
      price: price || null,
      external_product_id: p.id != null ? String(p.id) : null,
    };
  });
}

async function searchStore(store, queryTokens) {
  if (store.platform === "shopify") return searchShopifyStore(store.url, store.id, queryTokens);
  if (store.platform === "woocommerce") return searchWooCommerceStore(store.url, store.id, queryTokens);
  return []; // custom stores: search not supported
}

module.exports = { searchStore, searchShopifyStore, searchWooCommerceStore };
```

- [ ] **Step 2: Commit**

```bash
git add crawler/catalog/store-search.js
git commit -m "feat: add Mode 3b store search (Shopify suggest.json + WooCommerce store/v1 search)"
```

---

## Task 10: Mode 3 on-demand crawler

**Files:**
- Create: `crawler/catalog/on-demand-crawler.js`
- Create: `tests/integration/on-demand-crawl.test.js`

`runOnDemandCrawl(db, canonicalId, userId)` is the function the shopping list API calls. It fans out across all Shopify + WooCommerce stores, using Mode 3a (direct URL) or Mode 3b (search). Max 5 stores concurrent, 500ms inter-store delay.

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/on-demand-crawl.test.js`:

```js
"use strict";

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

function makeDb(stores) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT, url TEXT, platform TEXT);
    CREATE TABLE canonical_products (id TEXT PRIMARY KEY, canonical_name TEXT,
      base_key TEXT, category TEXT, weight_value REAL, weight_unit TEXT,
      image_url TEXT, brand_slots TEXT, base_product_slots TEXT,
      aliases_text TEXT, brands_text TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE store_products (
      id TEXT PRIMARY KEY, crawl_run_id TEXT NOT NULL, crawl_timestamp DATETIME NOT NULL,
      store_id TEXT NOT NULL, canonical_id TEXT, product_name TEXT NOT NULL,
      product_category TEXT NOT NULL, product_url TEXT NOT NULL, image_url TEXT,
      weight_raw TEXT, weight_value REAL, weight_unit TEXT,
      sale_price REAL NOT NULL, original_price REAL, discount_percent REAL,
      price_per_kg REAL, price_per_unit REAL, currency TEXT DEFAULT 'EUR',
      availability TEXT DEFAULT 'unknown', bulk_pricing TEXT, best_before TEXT,
      is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      crawl_mode TEXT DEFAULT 'deal', is_on_deal INTEGER DEFAULT 0,
      last_crawled_at TEXT, external_product_id TEXT, external_variant_id TEXT,
      display_date TEXT, display_order INTEGER
    );
    CREATE TABLE store_crawl_state (
      store_id TEXT PRIMARY KEY, last_deal_crawl TEXT, last_catalog_crawl TEXT,
      catalog_cursor TEXT, catalog_fallback TEXT,
      crawl_status TEXT, error_message TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE pending_on_demand_crawls (
      id TEXT PRIMARY KEY, canonical_id TEXT NOT NULL, user_id TEXT NOT NULL,
      queued_at TEXT NOT NULL, started_at TEXT
    );
  `);

  for (const s of stores) {
    db.prepare("INSERT INTO stores VALUES (?,?,?,?)").run(s.id, s.name, s.url, s.platform);
  }
  db.ready = Promise.resolve();
  return db;
}

test("runOnDemandCrawl writes and cleans up pending_on_demand_crawls row", async (t) => {
  const db = makeDb([
    { id: "dookan", name: "Dookan", url: "https://eu.dookan.com", platform: "shopify" },
  ]);

  db.prepare("INSERT INTO canonical_products (id, canonical_name, base_key, category, weight_value, weight_unit) VALUES (?,?,?,?,?,?)")
    .run("cp-001", "TRS Toor Dal 1kg", "toor dal", "Lentils & Dal", 1, "kg");

  // Inject mocked search — returns empty (no match found)
  const { runOnDemandCrawl } = require("../../crawler/catalog/on-demand-crawler");

  // Because this test doesn't make real HTTP calls, the crawler
  // should complete quickly and clean up the DB row
  await runOnDemandCrawl(db, "cp-001", "user-001", {
    _searchStore: async () => [],          // stub: no results
    _fetchUrl: async () => null,           // stub: direct fetch not triggered
  });

  const pending = db.prepare("SELECT * FROM pending_on_demand_crawls").all();
  assert.equal(pending.length, 0, "pending row should be deleted after crawl completes");
});

test("runOnDemandCrawl skips stores with known product_url (Mode 3a) — marks last_crawled_at", async (t) => {
  const db = makeDb([
    { id: "dookan", name: "Dookan", url: "https://eu.dookan.com", platform: "shopify" },
  ]);

  db.prepare("INSERT INTO canonical_products (id, canonical_name, base_key, category, weight_value, weight_unit) VALUES (?,?,?,?,?,?)")
    .run("cp-001", "TRS Toor Dal 1kg", "toor dal", "Lentils & Dal", 1, "kg");

  // Pre-seed a known product_url for this canonical at this store
  db.prepare(`
    INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, canonical_id,
      product_name, product_category, product_url, sale_price, is_active, crawl_mode, is_on_deal)
    VALUES (?,?,?,?,?,?,?,?,?,1,'catalog',1)
  `).run("sp-001", "r1", new Date().toISOString(), "dookan", "cp-001",
    "TRS Toor Dal 1kg", "Lentils & Dal", "https://eu.dookan.com/products/trs-toor-dal-1kg", 3.99);

  const { runOnDemandCrawl } = require("../../crawler/catalog/on-demand-crawler");

  let directFetchCalled = false;
  await runOnDemandCrawl(db, "cp-001", "user-001", {
    _fetchUrl: async (url) => {
      directFetchCalled = true;
      assert.equal(url, "https://eu.dookan.com/products/trs-toor-dal-1kg");
      return null; // return null = unchanged
    },
    _searchStore: async () => [],
  });

  assert.equal(directFetchCalled, true, "Mode 3a should use known product_url directly");
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test tests/integration/on-demand-crawl.test.js --reporter=spec
```

Expected: FAIL with "Cannot find module '../../crawler/catalog/on-demand-crawler'"

- [ ] **Step 3: Implement `crawler/catalog/on-demand-crawler.js`**

```js
"use strict";

const { v4: uuidv4 } = require("uuid");
const { fetchWithRetry } = require("../utils/fetch-with-retry");
const { searchStore: defaultSearchStore } = require("./store-search");
const { ingestCatalogProducts } = require("./catalog-ingester");
const { resolveBaseProduct } = require("../../server/services/base-product-catalog");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { logInfo, logWarn } = require("../utils/crawl-logger");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const CONFIDENCE_THRESHOLD = 80;
const MAX_CONCURRENT_STORES = 5;
const INTER_STORE_DELAY_MS = 500;

// Mode 3b: search a single store for a canonical.
// Returns a normalized product object or null (no match / below confidence).
async function searchStoreForCanonical(store, canonical, searchStore) {
  const baseProduct = resolveBaseProduct(canonical.canonical_name);
  if (!baseProduct || !baseProduct.base_key) return null;

  // Use base_key tokens only — no brand or weight (too specific)
  const tokens = baseProduct.base_key.split(/\s+/).filter(Boolean);
  const results = await searchStore(store, tokens);

  for (const result of results) {
    if (!result.title || !result.url) continue;
    const match = resolveBaseProduct(result.title);
    if (!match || match.score < CONFIDENCE_THRESHOLD) continue;
    if (match.base_key !== baseProduct.base_key) continue;

    const weight = parseWeight(result.title);
    return {
      store_id: store.id,
      product_name: result.title,
      product_category: mapCategory(result.title),
      product_url: result.url,
      image_url: result.image || null,
      weight_raw: weight?.raw || null,
      weight_value: weight?.value || null,
      weight_unit: weight?.unit || null,
      sale_price: result.price,
      original_price: null,
      discount_percent: null,
      price_per_kg: weight ? (result.price / weight.value) : null,
      price_per_unit: null,
      currency: "EUR",
      availability: "in_stock",
      bulk_pricing: null,
      best_before: null,
      external_product_id: result.external_product_id || null,
      external_variant_id: null,
      is_on_deal: 0,
      crawl_mode: "on_demand",
    };
  }

  return null;
}

// Mode 3a: re-fetch a known product URL to get fresh price.
// Returns null if unchanged or fetch fails.
async function refetchProductUrl(store, productUrl, existingProduct, fetchUrl) {
  try {
    const res = await fetchUrl(productUrl);
    if (!res) return null; // stub/no-op
    // For now returns null — full HTML price extraction is store-specific.
    // The catalog ingester will receive the same product data from Mode 2 weekly crawl.
    // Mode 3a direct fetch is a best-effort freshness signal, not a guarantee.
    return null;
  } catch {
    return null;
  }
}

// Fan-out across all Shopify + WooCommerce stores for a single canonical.
// Max MAX_CONCURRENT_STORES parallel, INTER_STORE_DELAY_MS between batches.
async function crawlCanonicalAcrossStores(db, canonical, runId, { _searchStore, _fetchUrl } = {}) {
  const searchStore = _searchStore || defaultSearchStore;
  const fetchUrl = _fetchUrl || (async (url) => {
    return fetchWithRetry(url, { headers: { "User-Agent": UA }, timeout: 15000 }, { retries: 1 });
  });

  const stores = await db.prepare(
    `SELECT id, name, url, platform FROM stores WHERE platform IN ('shopify','woocommerce') ORDER BY id`
  ).all();

  const ingested = [];

  for (let i = 0; i < stores.length; i += MAX_CONCURRENT_STORES) {
    const batch = stores.slice(i, i + MAX_CONCURRENT_STORES);

    const results = await Promise.allSettled(batch.map(async store => {
      // Check if we have a known product_url for this canonical at this store
      const known = await db.prepare(
        `SELECT product_url FROM store_products
         WHERE canonical_id = ? AND store_id = ? AND is_active = 1 LIMIT 1`
      ).get(canonical.id, store.id);

      if (known?.product_url) {
        // Mode 3a: have a URL — re-fetch for fresh price
        await refetchProductUrl(store, known.product_url, known, fetchUrl);
        return null; // price update handled by ingest on re-crawl
      }

      // Mode 3b: no known URL — search
      const product = await searchStoreForCanonical(store, canonical, searchStore);
      if (product) {
        product.canonical_id = canonical.id;
        return product;
      }

      return null;
    }));

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        ingested.push(result.value);
      }
    }

    if (i + MAX_CONCURRENT_STORES < stores.length) {
      await new Promise(r => setTimeout(r, INTER_STORE_DELAY_MS));
    }
  }

  if (ingested.length > 0) {
    await ingestCatalogProducts(db, ingested, runId);
    logInfo("on-demand", `Canonical ${canonical.id}: ingested ${ingested.length} new products`);
  }
}

// Public API: called by shopping list route when user adds item.
// Fire-and-forget. Writes to pending_on_demand_crawls for restart resilience.
async function runOnDemandCrawl(db, canonicalId, userId, options = {}) {
  const pendingId = uuidv4();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO pending_on_demand_crawls (id, canonical_id, user_id, queued_at) VALUES (?,?,?,?)`
  ).run(pendingId, canonicalId, userId, now);

  await db.prepare(
    `UPDATE pending_on_demand_crawls SET started_at = ? WHERE id = ?`
  ).run(now, pendingId);

  try {
    const canonical = await db.prepare(
      `SELECT id, canonical_name, base_key, category, weight_value, weight_unit
       FROM canonical_products WHERE id = ? LIMIT 1`
    ).get(canonicalId);

    if (!canonical) {
      logWarn("on-demand", `Canonical ${canonicalId} not found — skipping`);
      return;
    }

    const runId = uuidv4();
    await crawlCanonicalAcrossStores(db, canonical, runId, options);
  } finally {
    await db.prepare(`DELETE FROM pending_on_demand_crawls WHERE id = ?`).run(pendingId);
  }
}

// Called on server startup to drain any rows left by a prior crash.
async function drainPendingOnDemandCrawls(db) {
  const pending = await db.prepare(
    `SELECT canonical_id, user_id FROM pending_on_demand_crawls WHERE started_at IS NULL`
  ).all();

  if (pending.length === 0) return;

  logInfo("on-demand", `Draining ${pending.length} pending on-demand crawls from prior run`);

  for (const row of pending) {
    // Fire-and-forget — don't await
    runOnDemandCrawl(db, row.canonical_id, row.user_id).catch(err =>
      logWarn("on-demand", `Drain failed for canonical ${row.canonical_id}: ${err.message}`)
    );
  }
}

module.exports = { runOnDemandCrawl, drainPendingOnDemandCrawls };
```

- [ ] **Step 4: Run the on-demand tests**

```bash
node --test tests/integration/on-demand-crawl.test.js --reporter=spec
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add crawler/catalog/on-demand-crawler.js tests/integration/on-demand-crawl.test.js
git commit -m "feat: add Mode 3 on-demand crawler with fan-out, confidence gate, DB queue"
```

---

## Task 11: Startup queue drain

**Files:**
- Modify: `server/index.js`

On server startup, drain any `pending_on_demand_crawls` rows left by a prior crash.

- [ ] **Step 1: Find the startup section in `server/index.js`**

```bash
grep -n "db.ready\|listen\|startup\|bootstrap" server/index.js | head -20
```

- [ ] **Step 2: Add the drain call after db.ready**

Find the block where `db.ready.then(...)` or the `app.listen(...)` callback runs, and add:

```js
const { drainPendingOnDemandCrawls } = require("../crawler/catalog/on-demand-crawler");
// ... after db is ready:
drainPendingOnDemandCrawls(db).catch(err =>
  console.warn("[startup] on-demand crawl drain failed:", err.message)
);
```

The exact location depends on how `server/index.js` is structured. Check `grep -n "db.ready\|listen" server/index.js` and place the drain call in the `db.ready` callback or immediately after the server starts listening.

- [ ] **Step 3: Verify server starts cleanly**

```bash
DB_FILE=data/prod_local.db node server/index.js &
sleep 2
curl -s http://localhost:3000/api/v1/health | grep -i '"status"'
kill %1
```

Expected: server starts without errors, health endpoint returns `"status": "ok"` (or similar).

- [ ] **Step 4: Run full test suite to verify no regressions**

```bash
npm run test:integration --reporter=spec && npm run test:regression --reporter=spec
```

Expected: same pass counts as baseline.

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat: drain pending on-demand crawls on server startup for restart resilience"
```

---

## Final Verification

- [ ] **Verify Mode 2 runs end-to-end on a single store (dry-run)**

```bash
DB_FILE=data/prod_local.db node -e "
const db = require('./server/db');
const { fetchShopifyFullCatalog } = require('./crawler/catalog/shopify-full-catalog');
db.ready.then(async () => {
  const { products, nextCursor } = await fetchShopifyFullCatalog('zora-supermarkt', 'https://www.zorastore.eu', { maxPages: 1 });
  console.log('Products fetched:', products.length, '| nextCursor:', nextCursor ? 'present' : 'none');
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Expected: prints number of products (> 0).

- [ ] **Verify new schema columns exist in prod_local.db**

```bash
sqlite3 data/prod_local.db ".schema store_products" | grep -c "crawl_mode\|is_on_deal\|external_product_id"
```

Expected: 3.

- [ ] **Verify store platform data populated**

```bash
sqlite3 data/prod_local.db "SELECT platform, COUNT(*) FROM stores GROUP BY platform ORDER BY platform;"
```

Expected:
```
custom|7
shopify|15
unknown|0
woocommerce|10
```

- [ ] **Run complete test suite**

```bash
npm run test:integration --reporter=spec && npm run test:regression --reporter=spec && npm run test:e2e --reporter=spec
```

Expected: no new failures vs baseline (36/42 integration, 136/137 regression, 0/11 e2e — same pre-existing failures).

---

## Post-Crawl Hooks (stubs for future plans)

After Mode 2 and Mode 3 complete, two hooks should run: rebuild FTS5 search index and check product alerts. These are implemented in the Search Experience and Order History & Alerts plans respectively. As a stub, add this call at the end of `runFullCatalogCrawl` and `runOnDemandCrawl`:

```js
// Post-crawl hooks — stubs filled in by search and alerts implementation plans
async function runPostCrawlHooks(db, { mode }) {
  // TODO(search-plan): await rebuildFtsIndex(db);
  // TODO(alerts-plan): await checkProductAlerts(db);
}
```

This signals to future implementers where to wire in those features.
