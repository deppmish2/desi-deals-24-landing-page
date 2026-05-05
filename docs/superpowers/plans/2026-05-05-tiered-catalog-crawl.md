# Tiered Mode 2 Catalog Crawl Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the weekly full catalog crawl across 7 days (~2 stores/day) to avoid rate limits.

**Architecture:** Add a `DAY_GROUPS` config to `mode2-crawl.js` that maps Berlin weekday (0-6) to store IDs. The script auto-detects the current day and crawls only that group. GitHub Actions workflow changes from Sunday-only to daily. A platform backfill ensures the stores table has correct platform values.

**Tech Stack:** Node.js (CommonJS), libsql/Turso, GitHub Actions

---

### Task 1: Backfill stores.platform in schema seed

**Files:**
- Modify: `server/db/index.js` (add platform UPDATE statements to `alwaysMigrations` or seed logic)

- [ ] **Step 1: Find the seed/migration insertion point**

In `server/db/index.js`, locate where stores are seeded. The platform backfill should run after store rows exist.

- [ ] **Step 2: Add platform UPDATE statements**

Add this to the `alwaysMigrations` array (or equivalent idempotent migration block):

```javascript
// Backfill stores.platform
`UPDATE stores SET platform = 'shopify' WHERE id IN ('jamoona','dookan','namma-markt','globalfoodhub','indiansupermarkt','desigros','md-store','sairas','anuhita-groceries','bajwa-shop','indianspicebasket','transfoodlev','villagefoods','zora-supermarkt') AND platform = 'unknown'`,
`UPDATE stores SET platform = 'cheerio' WHERE id IN ('annachi','asiangrocerystore','asiatischer-lebensmittelladen','barkatfood','desistore','india-express-food','india-store','indische-lebensmittel-online','indianfoodstore','little-india','masimpex','namastedeutschland','spicelands','swadesh','yogimart','zakiasianfoods') AND platform = 'unknown'`,
`UPDATE stores SET platform = 'custom-api' WHERE id = 'grocera' AND platform = 'unknown'`,
```

- [ ] **Step 3: Verify locally**

Run:
```bash
DB_FILE=data/prod_local.db node -e "require('./server/db')" && sqlite3 data/prod_local.db "SELECT id, platform FROM stores ORDER BY platform, id;"
```

Expected: stores show correct platforms (shopify/cheerio/custom-api).

- [ ] **Step 4: Commit**

```bash
git add server/db/index.js
git commit -m "chore(db): backfill stores.platform with actual values"
```

---

### Task 2: Rewrite mode2-crawl.js with day-of-week tiering

**Files:**
- Modify: `scripts/mode2-crawl.js`

- [ ] **Step 1: Replace the full script content**

```javascript
#!/usr/bin/env node
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { crawlShopifyFullCatalog } = require("../crawler/shopify-full-catalog");
const { crawlWooCommerceFullCatalog } = require("../crawler/woocommerce-full-catalog");
const { rebuildAll } = require("../crawler/fts-rebuild");
const { getZonedParts, BERLIN_TIME_ZONE } = require("../server/services/berlin-time");

const INTER_STORE_DELAY_MS = 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Day 0 = Sunday, 1 = Monday, ..., 6 = Saturday
const DAY_GROUPS = {
  0: ["anuhita-groceries", "zora-supermarkt"],
  1: ["dookan", "sairas"],
  2: ["globalfoodhub", "md-store"],
  3: ["indiansupermarkt", "bajwa-shop"],
  4: ["namma-markt", "indianspicebasket"],
  5: ["jamoona", "transfoodlev"],
  6: ["desigros", "villagefoods"],
};

function getBerlinWeekday() {
  const parts = getZonedParts(new Date(), BERLIN_TIME_ZONE);
  // Reconstruct a date in Berlin to get the weekday
  const berlinDate = new Date(`${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T12:00:00`);
  return berlinDate.getDay();
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--all")) return { mode: "all" };
  const dayIdx = args.indexOf("--day");
  if (dayIdx !== -1 && args[dayIdx + 1] != null) {
    const day = parseInt(args[dayIdx + 1], 10);
    if (day >= 0 && day <= 6) return { mode: "day", day };
    console.error("Error: --day must be 0-6");
    process.exit(1);
  }
  return { mode: "day", day: getBerlinWeekday() };
}

async function upsertRows(rows, runId) {
  for (const r of rows) {
    await db.prepare(`
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
    `).run(
      r.id, r.store_id, runId, r.product_name, r.product_category,
      r.product_url, r.image_url, r.sale_price, r.original_price,
      r.discount_percent, r.currency, r.is_on_deal, r.crawl_mode,
      r.external_product_id, r.availability
    );
  }
}

(async () => {
  await new Promise(r => setTimeout(r, 2000));

  const opts = parseArgs();
  let storeIds;

  if (opts.mode === "all") {
    storeIds = Object.values(DAY_GROUPS).flat();
    console.log(`[mode2] --all: crawling all ${storeIds.length} stores`);
  } else {
    storeIds = DAY_GROUPS[opts.day] || [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    console.log(`[mode2] day=${opts.day} (${dayNames[opts.day]}): crawling ${storeIds.length} stores: ${storeIds.join(", ")}`);
  }

  if (storeIds.length === 0) {
    console.log("[mode2] no stores for today, exiting");
    process.exit(0);
  }

  const placeholders = storeIds.map(() => "?").join(",");
  const stores = await db.prepare(
    `SELECT id, url, platform FROM stores WHERE id IN (${placeholders}) ORDER BY id`
  ).all(...storeIds);

  if (stores.length === 0) {
    console.log("[mode2] no matching stores found in DB (check stores.platform or store IDs)");
    process.exit(0);
  }

  const runId = "mode2_" + Date.now();

  for (const store of stores) {
    console.log(`[mode2] ${store.id} (${store.platform})`);

    const state = await db.prepare(
      "SELECT catalog_cursor FROM store_crawl_state WHERE store_id = ?"
    ).get(store.id);

    let result;
    if (store.platform === "shopify") {
      result = await crawlShopifyFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor || null
      );
    } else if (store.platform === "woocommerce") {
      result = await crawlWooCommerceFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor ? parseInt(state.catalog_cursor, 10) : 1
      );
    } else {
      console.log(`[mode2] ${store.id}: skipping (platform=${store.platform}, no catalog crawler)`);
      continue;
    }

    if (result.rows.length) {
      await upsertRows(result.rows, runId);
    }

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

    if (stores.indexOf(store) < stores.length - 1) {
      await sleep(INTER_STORE_DELAY_MS);
    }
  }

  await rebuildAll();
  console.log("[mode2] done");
  process.exit(0);
})().catch(err => {
  console.error("[mode2] fatal:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Test locally with --day flag**

Run:
```bash
node scripts/mode2-crawl.js --day 1
```

Expected: prints `[mode2] day=1 (Mon): crawling 2 stores: dookan, sairas` then attempts to crawl those stores (may fail on network if not connected, but logic should work).

- [ ] **Step 3: Test --all flag**

Run:
```bash
node scripts/mode2-crawl.js --all 2>&1 | head -3
```

Expected: prints `[mode2] --all: crawling 14 stores`

- [ ] **Step 4: Test auto-detect (no flags)**

Run:
```bash
node scripts/mode2-crawl.js 2>&1 | head -3
```

Expected: prints today's day group (depends on current Berlin weekday).

- [ ] **Step 5: Commit**

```bash
git add scripts/mode2-crawl.js
git commit -m "feat(crawl): tier Mode 2 catalog crawl across 7 days by Berlin weekday"
```

---

### Task 3: Update GitHub Actions workflow to daily

**Files:**
- Modify: `.github/workflows/weekly-catalog-crawl.yml`

- [ ] **Step 1: Update the workflow file**

```yaml
name: Daily Catalog Crawl (Mode 2)

on:
  schedule:
    - cron: "0 1 * * *"  # Daily at 01:00 UTC
  workflow_dispatch:

concurrency:
  group: daily-catalog-crawl
  cancel-in-progress: false

jobs:
  crawl:
    runs-on: ubuntu-latest
    timeout-minutes: 60

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

      - name: Run Mode 2 tiered catalog crawl into Turso
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          DESI_DEALS_DB_TURSO_DATABASE_URL: ${{ secrets.DESI_DEALS_DB_TURSO_DATABASE_URL }}
          DESI_DEALS_DB_TURSO_AUTH_TOKEN: ${{ secrets.DESI_DEALS_DB_TURSO_AUTH_TOKEN }}
          DB_BOOTSTRAP_ON_STARTUP: "true"
        run: npm run crawl:mode2
```

- [ ] **Step 2: Rename the file**

```bash
git mv .github/workflows/weekly-catalog-crawl.yml .github/workflows/daily-catalog-crawl.yml
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-catalog-crawl.yml
git commit -m "ci: change Mode 2 catalog crawl from weekly to daily (tiered by weekday)"
```

---

### Task 4: Run platform backfill against production Turso

**Files:** None (operational step)

- [ ] **Step 1: Run platform backfill SQL against production**

```bash
node -e "
require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const { createClient } = require('@libsql/client');
const url = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;
const client = createClient({ url, authToken });
(async () => {
  await client.execute(\"UPDATE stores SET platform = 'shopify' WHERE id IN ('jamoona','dookan','namma-markt','globalfoodhub','indiansupermarkt','desigros','md-store','sairas','anuhita-groceries','bajwa-shop','indianspicebasket','transfoodlev','villagefoods','zora-supermarkt') AND platform = 'unknown'\");
  await client.execute(\"UPDATE stores SET platform = 'cheerio' WHERE id IN ('annachi','asiangrocerystore','asiatischer-lebensmittelladen','barkatfood','desistore','india-express-food','india-store','indische-lebensmittel-online','indianfoodstore','little-india','masimpex','namastedeutschland','spicelands','swadesh','yogimart','zakiasianfoods') AND platform = 'unknown'\");
  await client.execute(\"UPDATE stores SET platform = 'custom-api' WHERE id = 'grocera' AND platform = 'unknown'\");
  const rows = await client.execute('SELECT id, platform FROM stores ORDER BY platform, id');
  console.log(rows.rows.map(r => r.id + ' -> ' + r.platform).join('\\n'));
  console.log('Done');
})().catch(e => { console.error(e); process.exit(1); });
"
```

Expected: all 32 stores show their correct platform.

- [ ] **Step 2: Verify**

Check that Shopify stores are correctly tagged:
```bash
node -e "
require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const { createClient } = require('@libsql/client');
const url = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;
const client = createClient({ url, authToken });
client.execute(\"SELECT platform, COUNT(*) as cnt FROM stores GROUP BY platform\").then(r => console.log(r.rows));
"
```

Expected: `shopify: 14, cheerio: 17, custom-api: 1`

- [ ] **Step 3: No commit needed** (operational, not code)
