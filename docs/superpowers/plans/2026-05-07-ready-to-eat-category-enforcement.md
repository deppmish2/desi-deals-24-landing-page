# Ready-to-Eat Category Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent ready-to-eat products from matching plain grain/lentil canonicals by adding a "Ready Meals & Mixes" category with compound detection in category-mapper, a category guard in auto-mapper, and a migration that fixes existing mis-mapped products in both local and prod Turso DBs.

**Architecture:** Three layered changes applied in order: (1) category-mapper gets a new "Ready Meals & Mixes" category with a compound token pre-check ("quick"/"instant" + grain word), so new crawls categorize RTE products correctly; (2) auto-mapper's `matchesCanonical` rejects cross-category slot matches, so no RTE product can ever be mapped to a rice/grain canonical; (3) a migration script fixes the 4 existing mis-mapped products in prod_local.db and prod Turso. All changes are TDD — tests written before implementation.

**Tech Stack:** Node.js CommonJS, `@libsql/client` (dual-mode SQLite/Turso), `node:test`, `better-sqlite3` (prod-smoke test only)

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `tests/regression/category-mapper.test.mjs` | 3 tests for RTE categorization (positive + 2 false-positive guards) |
| Modify | `crawler/utils/category-mapper.js` | Add RTE constants, compound pre-check, new category entry, remove RTE keywords from Canned & Packaged |
| Modify | `tests/regression/auto-mapper.test.mjs` | Add 2 tests for category guard (cross-category null, Other-Other pass) |
| Modify | `crawler/utils/auto-mapper.js` | Add `dealCategory` param + guard to `matchesCanonical`; add `category` to `loadPriorityCanonicals` SELECT; pass `deal.product_category` in `autoMapDeals` |
| Modify | `scripts/run-automapper-all-store-products.js` | Add `product_category` to SELECT; pass to `matchesCanonical` in dry-run loop |
| Replace | `scripts/migrate-ready-to-eat-category.js` | Full rewrite: dual-mode (SQLite/Turso), `--apply` flag, Phase 1 canonical category fix, Phase 2 store product re-mapping |
| Modify | `tests/regression/prod-smoke.test.mjs` | Add 1 DB audit test: 0 active RTE products in wrong canonical category |

---

## Task 1: Category-Mapper — "Ready Meals & Mixes" + Compound Pre-Check (TDD)

**Files:**
- Create: `tests/regression/category-mapper.test.mjs`
- Modify: `crawler/utils/category-mapper.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/regression/category-mapper.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// category-mapper.js is CommonJS
const { mapCategory } = require("../../crawler/utils/category-mapper.js");

test("mapCategory: 'Priya Ready to Eat Quick Pulihora Poha Bundle' → Ready Meals & Mixes", () => {
  assert.equal(
    mapCategory("Priya Ready to Eat Quick Pulihora Poha Bundle"),
    "Ready Meals & Mixes",
  );
});

test("mapCategory: 'Quick Oats' → Rice & Grains (no false positive — oats not a grain trigger)", () => {
  assert.equal(mapCategory("Quick Oats"), "Rice & Grains");
});

test("mapCategory: 'Maggi 2-Minute Instant Noodles' → Noodles & Pasta (instant + noodle, not grain)", () => {
  assert.equal(mapCategory("Maggi 2-Minute Instant Noodles"), "Noodles & Pasta");
});
```

- [ ] **Step 2: Run tests — verify all three fail**

```bash
node --test tests/regression/category-mapper.test.mjs --reporter=spec
```

Expected: 3 failures. "Ready Meals & Mixes" doesn't exist yet, "Quick Oats" currently maps correctly (will still need to verify after changes).

- [ ] **Step 3: Add RTE constants to category-mapper.js**

In `crawler/utils/category-mapper.js`, after the closing `];` of `SNACK_PHRASES` (around line 10), add:

```js
const RTE_QUICK_TOKENS = ["quick", "instant"];
const RTE_GRAIN_TOKENS = ["poha", "upma", "khichdi", "biryani", "pulao", "dosa", "idli", "rava", "semolina"];
```

- [ ] **Step 4: Add "Ready Meals & Mixes" entry to CATEGORIES array**

In `crawler/utils/category-mapper.js`, insert BEFORE the `["Noodles & Pasta", ...]` entry (currently the 12th entry):

```js
  [
    "Ready Meals & Mixes",
    ["ready to eat", "ready-to-eat", "ready meal", "ready-meal"],
  ],
```

- [ ] **Step 5: Remove RTE keywords from "Canned & Packaged"**

Find the line (currently line 152–153):
```js
  [
    "Canned & Packaged",
    ["canned", "tin", "ready meal", "ready-meal", "ready to eat", "packaged"],
  ],
```

Replace with:
```js
  [
    "Canned & Packaged",
    ["canned", "tin", "packaged"],
  ],
```

- [ ] **Step 6: Add compound pre-check inside mapCategory**

In `crawler/utils/category-mapper.js`, the `mapCategory` function currently reads:

```js
function mapCategory(productName) {
  if (!productName) return "Other";
  const lower = productName.toLowerCase();
  if (SNACK_PHRASES.some((phrase) => lower.includes(phrase))) return "Snacks & Sweets";
  for (const [category, keywords] of CATEGORIES) {
```

Replace with:

```js
function mapCategory(productName) {
  if (!productName) return "Other";
  const lower = productName.toLowerCase();
  const words = lower.split(/\s+/);
  const hasQuickInstant = RTE_QUICK_TOKENS.some((t) => words.includes(t));
  const hasRteGrain = RTE_GRAIN_TOKENS.some((t) => words.includes(t));
  if (hasQuickInstant && hasRteGrain) return "Ready Meals & Mixes";
  if (SNACK_PHRASES.some((phrase) => lower.includes(phrase))) return "Snacks & Sweets";
  for (const [category, keywords] of CATEGORIES) {
```

- [ ] **Step 7: Export mapCategory (verify it already is)**

Check the last line of `crawler/utils/category-mapper.js`. It should already export:
```js
module.exports = { mapCategory };
```
If not, add it.

- [ ] **Step 8: Run tests — verify all three pass**

```bash
node --test tests/regression/category-mapper.test.mjs --reporter=spec
```

Expected:
```
✓ mapCategory: 'Priya Ready to Eat Quick Pulihora Poha Bundle' → Ready Meals & Mixes
✓ mapCategory: 'Quick Oats' → Rice & Grains (no false positive — oats not a grain trigger)
✓ mapCategory: 'Maggi 2-Minute Instant Noodles' → Noodles & Pasta (instant + noodle, not grain)
3 tests passed
```

- [ ] **Step 9: Run full regression suite**

```bash
npm run test:regression 2>&1 | tail -20
```

Expected: same pass count as before (154 pass, 2 pre-existing failures in search-tracker). The new 3 tests should now be part of the suite.

- [ ] **Step 10: Commit**

```bash
git add tests/regression/category-mapper.test.mjs crawler/utils/category-mapper.js
git commit -m "feat(category-mapper): add Ready Meals & Mixes category with compound RTE pre-check"
```

---

## Task 2: Auto-Mapper — Category Guard in matchesCanonical (TDD)

**Files:**
- Modify: `tests/regression/auto-mapper.test.mjs`
- Modify: `crawler/utils/auto-mapper.js`
- Modify: `scripts/run-automapper-all-store-products.js`

- [ ] **Step 1: Add failing tests to auto-mapper.test.mjs**

Open `tests/regression/auto-mapper.test.mjs`. The file ends after the last `autoMapDeals` test. Append these two tests:

```js
// ── Category guard ───────────────────────────────────────────────────────────

test("matchesCanonical returns null when dealCategory differs from canon.category (cross-category guard)", () => {
  const rteCanon = { ...KNORR, category: "Ready Meals & Mixes" };
  const result = matchesCanonical(
    "knorr bouillon cubes chicken 400gm",
    400, "g",
    rteCanon,
    "Rice & Grains",
  );
  assert.equal(result, null, "cross-category match must return null, not false");
});

test("matchesCanonical still matches when both dealCategory and canon.category are 'Other'", () => {
  const otherCanon = { ...KNORR, category: "Other" };
  const result = matchesCanonical(
    "knorr bouillon cubes chicken 400gm",
    400, "g",
    otherCanon,
    "Other",
  );
  assert.equal(result, true, "Other vs Other must not block slot match");
});
```

- [ ] **Step 2: Run tests — verify both new tests fail**

```bash
node --test tests/regression/auto-mapper.test.mjs --reporter=spec
```

Expected: 7 pass (existing), 2 fail (the new ones — `matchesCanonical` ignores 5th arg currently).

- [ ] **Step 3: Add dealCategory param + category guard to matchesCanonical**

In `crawler/utils/auto-mapper.js`, find (line ~67):

```js
function matchesCanonical(normedTitle, dealWeightValue, dealWeightUnit, canon) {
  const brandSlots = parseSlots(canon.brandSlots);
  const baseProductSlots = parseSlots(canon.baseProductSlots);
  const typeSlots = parseSlots(canon.typeSlots) || [];

  if (!brandSlots && !baseProductSlots) return null;
```

Replace with:

```js
function matchesCanonical(normedTitle, dealWeightValue, dealWeightUnit, canon, dealCategory) {
  const brandSlots = parseSlots(canon.brandSlots);
  const baseProductSlots = parseSlots(canon.baseProductSlots);
  const typeSlots = parseSlots(canon.typeSlots) || [];

  if (!brandSlots && !baseProductSlots) return null;

  if (
    dealCategory && dealCategory !== "Other" &&
    canon.category && canon.category !== "Other" &&
    dealCategory !== canon.category
  ) return null;
```

- [ ] **Step 4: Add category to loadPriorityCanonicals SELECT (primary query)**

In `crawler/utils/auto-mapper.js`, find the primary SELECT inside `loadPriorityCanonicals` (line ~126):

```js
      `SELECT id, canonical_name,
              brand_slots, base_product_slots, type_slots,
              weight_value, weight_unit
       FROM canonical_products
       WHERE is_match_priority = 1
         AND brand_slots IS NOT NULL
         AND brand_slots != 'null'
         AND brand_slots != '[]'`,
```

Replace with:

```js
      `SELECT id, canonical_name, category,
              brand_slots, base_product_slots, type_slots,
              weight_value, weight_unit
       FROM canonical_products
       WHERE is_match_priority = 1
         AND brand_slots IS NOT NULL
         AND brand_slots != 'null'
         AND brand_slots != '[]'`,
```

- [ ] **Step 5: Add category to loadPriorityCanonicals SELECT (fallback query)**

Find the fallback SELECT (line ~141, inside the `catch` for `is_priority`):

```js
          `SELECT id, canonical_name,
                  brand_slots, base_product_slots, type_slots,
                  weight_value, weight_unit
           FROM canonical_products
           WHERE is_priority = 1
             AND brand_slots IS NOT NULL
             AND brand_slots != 'null'
             AND brand_slots != '[]'`,
```

Replace with:

```js
          `SELECT id, canonical_name, category,
                  brand_slots, base_product_slots, type_slots,
                  weight_value, weight_unit
           FROM canonical_products
           WHERE is_priority = 1
             AND brand_slots IS NOT NULL
             AND brand_slots != 'null'
             AND brand_slots != '[]'`,
```

- [ ] **Step 6: Add category to the returned object in loadPriorityCanonicals**

In the `rows.map(...)` block, find the returned object (after the `slotRegexes` helper):

```js
    return {
      id: r.id,
      canonical_name: r.canonical_name,
      brandSlots,
```

Replace with:

```js
    return {
      id: r.id,
      canonical_name: r.canonical_name,
      category: r.category ?? null,
      brandSlots,
```

- [ ] **Step 7: Pass deal.product_category to matchesCanonical in autoMapDeals**

In `crawler/utils/auto-mapper.js`, inside `autoMapDeals`, find (line ~212):

```js
      if (matchesCanonical(normedName, dealWeightValue, dealWeightUnit, canon) !== true) continue;
```

Replace with:

```js
      if (matchesCanonical(normedName, dealWeightValue, dealWeightUnit, canon, deal.product_category ?? null) !== true) continue;
```

- [ ] **Step 8: Add product_category to run-automapper SELECT**

In `scripts/run-automapper-all-store-products.js`, find (line ~52):

```js
    `SELECT id, product_url, product_name, weight_value, weight_unit
     FROM store_products
     WHERE is_active = 1`,
```

Replace with:

```js
    `SELECT id, product_url, product_name, weight_value, weight_unit, product_category
     FROM store_products
     WHERE is_active = 1`,
```

- [ ] **Step 9: Pass deal.product_category in run-automapper dry-run loop**

In `scripts/run-automapper-all-store-products.js`, inside the DRY_RUN block, find:

```js
        const result = matchesCanonical(
          norm(deal.product_name),
          deal.weight_value,
          deal.weight_unit,
          canon,
        );
```

Replace with:

```js
        const result = matchesCanonical(
          norm(deal.product_name),
          deal.weight_value,
          deal.weight_unit,
          canon,
          deal.product_category ?? null,
        );
```

- [ ] **Step 10: Run tests — verify all 9 auto-mapper tests pass**

```bash
node --test tests/regression/auto-mapper.test.mjs --reporter=spec
```

Expected: 9 pass, 0 fail.

- [ ] **Step 11: Run full regression suite**

```bash
npm run test:regression 2>&1 | tail -20
```

Expected: same or better pass count (157+ pass, 2 pre-existing failures).

- [ ] **Step 12: Commit**

```bash
git add tests/regression/auto-mapper.test.mjs crawler/utils/auto-mapper.js scripts/run-automapper-all-store-products.js
git commit -m "feat(auto-mapper): category guard in matchesCanonical — reject cross-category slot matches"
```

---

## Task 3: Migration Script — Full Rewrite + Apply to Local DB

**Files:**
- Replace: `scripts/migrate-ready-to-eat-category.js`

- [ ] **Step 1: Replace the migration script**

Overwrite `scripts/migrate-ready-to-eat-category.js` entirely with:

```js
#!/usr/bin/env node
"use strict";
/**
 * Fixes Ready Meals & Mixes category mis-mappings in two phases.
 *
 * Phase 1: Update canonical_products.category to "Ready Meals & Mixes"
 *          for canonicals with RTE signals in their name.
 * Phase 2: Clear wrong store_product_mappings for mis-mapped RTE store
 *          products, re-run slot matching against RTE canonicals, and
 *          send unmatched products to entity_resolution_queue.
 *
 * Dry run (default):
 *   DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js
 *   node scripts/migrate-ready-to-eat-category.js          # prod Turso
 *
 * Apply:
 *   DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js --apply
 *   node scripts/migrate-ready-to-eat-category.js --apply  # prod Turso
 *
 * For prod Turso: comment out DB_FILE in .env.local first.
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { createClient } = require("@libsql/client");
const { matchesCanonical, norm } = require("../crawler/utils/auto-mapper");

const APPLY = process.argv.includes("--apply");
const TARGET_CATEGORY = "Ready Meals & Mixes";

const RTE_STANDALONE = ["ready to eat", "ready-to-eat", "ready meal", "ready-meal"];
const RTE_QUICK_TOKENS = ["quick", "instant"];
const RTE_GRAIN_TOKENS = ["poha", "upma", "khichdi", "biryani", "pulao", "dosa", "idli", "rava", "semolina"];

function hasRteSignal(name) {
  const lower = (name || "").toLowerCase();
  if (RTE_STANDALONE.some((s) => lower.includes(s))) return true;
  const words = lower.split(/\s+/);
  return (
    RTE_QUICK_TOKENS.some((t) => words.includes(t)) &&
    RTE_GRAIN_TOKENS.some((t) => words.includes(t))
  );
}

function parseSlots(json) {
  if (!json || json === "null" || json === "[]") return null;
  try { return JSON.parse(json); } catch { return null; }
}

const dbFile    = process.env.DB_FILE;
const tursoUrl  = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN  || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;

if (!dbFile && !tursoUrl) {
  console.error("Error: set DB_FILE (local) or TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (prod)");
  process.exit(1);
}

const client = dbFile
  ? createClient({ url: `file:${dbFile}` })
  : createClient({ url: tursoUrl, authToken: tursoToken });

async function query(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}

async function main() {
  console.log(`[migrate-rte] mode=${APPLY ? "APPLY" : "DRY RUN"} target=${dbFile ?? tursoUrl}`);

  // ── Phase 1: Canonical category updates ──────────────────────────────────
  const allCanonicals = await query(
    `SELECT id, canonical_name, category FROM canonical_products`
  );

  const toUpdateCat = allCanonicals.filter(
    (r) => hasRteSignal(r.canonical_name) && r.category !== TARGET_CATEGORY
  );

  console.log(`\n[Phase 1] ${toUpdateCat.length} canonical(s) to move to '${TARGET_CATEGORY}':`);
  for (const r of toUpdateCat) {
    console.log(`  ${(r.category || "null").padEnd(25)} → ${TARGET_CATEGORY}  |  ${r.canonical_name}`);
  }

  if (APPLY && toUpdateCat.length > 0) {
    await client.batch(
      toUpdateCat.map((r) => ({
        sql: `UPDATE canonical_products SET category = ? WHERE id = ?`,
        args: [TARGET_CATEGORY, r.id],
      })),
      "write"
    );
    console.log(`[Phase 1] Updated ${toUpdateCat.length} canonical(s).`);
  }

  // ── Phase 2: Store product re-mapping ────────────────────────────────────
  const misMapped = await query(
    `SELECT sp.id, sp.product_name, sp.canonical_id,
            sp.weight_value, sp.weight_unit, sp.store_id,
            cp.category AS canonical_category
     FROM store_products sp
     JOIN canonical_products cp ON cp.id = sp.canonical_id
     WHERE sp.is_active = 1
       AND cp.category != ?`,
    [TARGET_CATEGORY]
  );

  const rteProducts = misMapped.filter((r) => hasRteSignal(r.product_name));

  console.log(`\n[Phase 2] ${rteProducts.length} active RTE product(s) mapped to wrong canonical category:`);
  for (const r of rteProducts) {
    console.log(`  [${r.canonical_category}]  ${r.product_name}`);
  }

  if (!APPLY || rteProducts.length === 0) {
    if (!APPLY) console.log("\n[migrate-rte] DRY RUN — no writes. Re-run with --apply to commit.");
    return;
  }

  // Load RTE canonicals for re-mapping.
  // Phase 1 has already updated canonical categories, so RTE canonicals now
  // have category = "Ready Meals & Mixes".
  const rteCanonicalRows = await query(
    `SELECT id, canonical_name, category,
            brand_slots, base_product_slots, type_slots,
            weight_value, weight_unit
     FROM canonical_products
     WHERE is_match_priority = 1
       AND category = ?
       AND brand_slots IS NOT NULL
       AND brand_slots != 'null'
       AND brand_slots != '[]'`,
    [TARGET_CATEGORY]
  );

  const rteCanonicalsForMatch = rteCanonicalRows.map((r) => ({
    id: r.id,
    canonical_name: r.canonical_name,
    category: TARGET_CATEGORY,
    brandSlots: parseSlots(r.brand_slots),
    baseProductSlots: parseSlots(r.base_product_slots),
    typeSlots: parseSlots(r.type_slots) || [],
    weightValue: r.weight_value ?? null,
    weightUnit:  r.weight_unit  ?? null,
  }));

  console.log(`[Phase 2] ${rteCanonicalsForMatch.length} RTE canonical(s) available for re-mapping`);

  const remapped = [];
  const sentToReview = [];
  const stmts = [];

  for (const sp of rteProducts) {
    stmts.push({
      sql: `DELETE FROM store_product_mappings WHERE deal_id = ?`,
      args: [sp.id],
    });
    stmts.push({
      sql: `UPDATE store_products SET canonical_id = NULL WHERE id = ?`,
      args: [sp.id],
    });

    const normedName = norm(sp.product_name);
    let matched = null;
    for (const canon of rteCanonicalsForMatch) {
      if (matchesCanonical(normedName, sp.weight_value, sp.weight_unit, canon, TARGET_CATEGORY) === true) {
        matched = canon;
        break;
      }
    }

    if (matched) {
      stmts.push({
        sql: `INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence)
              VALUES (?, ?, 'slot_match', 0.85)
              ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
                match_method = 'slot_match', match_confidence = 0.85`,
        args: [sp.id, matched.id],
      });
      stmts.push({
        sql: `UPDATE store_products SET canonical_id = ? WHERE id = ?`,
        args: [matched.id, sp.id],
      });
      remapped.push({ product_name: sp.product_name, canonical_name: matched.canonical_name });
    } else {
      stmts.push({
        sql: `INSERT OR IGNORE INTO entity_resolution_queue
              (deal_id, raw_name, normalised_name, status, store_id, category)
              VALUES (?, ?, ?, 'pending', ?, ?)`,
        args: [sp.id, sp.product_name, normedName, sp.store_id, TARGET_CATEGORY],
      });
      sentToReview.push({ product_name: sp.product_name });
    }
  }

  await client.batch(stmts, "write");

  console.log(`\n[Phase 2] Remapped: ${remapped.length}, sent to review: ${sentToReview.length}`);
  for (const r of remapped) console.log(`  ✓ ${r.product_name} → ${r.canonical_name}`);
  for (const r of sentToReview) console.log(`  ⚠ ${r.product_name} → entity_resolution_queue`);
}

main().catch((e) => {
  console.error("[migrate-rte] Fatal:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against local DB**

```bash
DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js
```

Expected output: lists canonicals to be moved to "Ready Meals & Mixes" (Phase 1), then lists 4 store products mapped to wrong category (Phase 2). No writes occur.

- [ ] **Step 3: Apply to local DB**

```bash
DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js --apply
```

Expected output: Phase 1 shows N canonicals updated. Phase 2 shows N products remapped or sent to review.

- [ ] **Step 4: Verify with DB query**

```bash
DB_FILE=data/prod_local.db node -e "
const { createClient } = require('@libsql/client');
require('dotenv').config({ path: '.env.local', override: true });
const db = createClient({ url: 'file:data/prod_local.db' });
db.execute(\`
  SELECT sp.product_name, cp.category
  FROM store_products sp
  JOIN canonical_products cp ON cp.id = sp.canonical_id
  WHERE sp.is_active = 1
    AND (lower(sp.product_name) LIKE '%ready to eat%'
      OR lower(sp.product_name) LIKE '%quick%' AND lower(sp.product_name) LIKE '%poha%')
\`).then(r => console.log(JSON.stringify(r.rows, null, 2)));
"
```

Expected: all returned rows have `category = "Ready Meals & Mixes"`.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/migrate-ready-to-eat-category.js
git commit -m "feat(migration): rewrite migrate-ready-to-eat-category for dual-mode + Phase 2 re-mapping"
```

---

## Task 4: Prod-Smoke Test — RTE Audit

**Files:**
- Modify: `tests/regression/prod-smoke.test.mjs`

- [ ] **Step 1: Append RTE audit test to prod-smoke.test.mjs**

Open `tests/regression/prod-smoke.test.mjs`. The file ends after the last `dbTest(...)` call. Append:

```js
dbTest(
  "prod DB: 0 active ready-to-eat products mapped to wrong canonical category",
  () => {
    const contaminated = db
      .prepare(
        `SELECT sp.product_name, cp.category, cp.canonical_name
         FROM store_products sp
         JOIN canonical_products cp ON cp.id = sp.canonical_id
         WHERE sp.is_active = 1
           AND cp.category != 'Ready Meals & Mixes'
           AND (
             LOWER(sp.product_name) LIKE '%ready to eat%'
             OR LOWER(sp.product_name) LIKE '%ready-to-eat%'
             OR LOWER(sp.product_name) LIKE '%ready meal%'
             OR (
               (LOWER(sp.product_name) LIKE '% quick %' OR LOWER(sp.product_name) LIKE 'quick %')
               AND (
                 LOWER(sp.product_name) LIKE '%poha%'
                 OR LOWER(sp.product_name) LIKE '%upma%'
                 OR LOWER(sp.product_name) LIKE '%khichdi%'
                 OR LOWER(sp.product_name) LIKE '%biryani%'
                 OR LOWER(sp.product_name) LIKE '%pulao%'
                 OR LOWER(sp.product_name) LIKE '%dosa%'
                 OR LOWER(sp.product_name) LIKE '%idli%'
                 OR LOWER(sp.product_name) LIKE '%rava%'
                 OR LOWER(sp.product_name) LIKE '%semolina%'
               )
             )
             OR (
               LOWER(sp.product_name) LIKE '% instant %'
               AND (
                 LOWER(sp.product_name) LIKE '%poha%'
                 OR LOWER(sp.product_name) LIKE '%upma%'
                 OR LOWER(sp.product_name) LIKE '%khichdi%'
                 OR LOWER(sp.product_name) LIKE '%biryani%'
                 OR LOWER(sp.product_name) LIKE '%pulao%'
                 OR LOWER(sp.product_name) LIKE '%dosa%'
                 OR LOWER(sp.product_name) LIKE '%idli%'
                 OR LOWER(sp.product_name) LIKE '%rava%'
                 OR LOWER(sp.product_name) LIKE '%semolina%'
               )
             )
           )
         LIMIT 5`
      )
      .all();
    assert.equal(
      contaminated.length,
      0,
      `Found ${contaminated.length} RTE products in wrong canonical category: ${JSON.stringify(contaminated.map((r) => r.product_name))}`
    );
  }
);
```

- [ ] **Step 2: Run prod-smoke tests against local DB to verify the new test passes**

```bash
DB_FILE=data/prod_local.db node --test tests/regression/prod-smoke.test.mjs --reporter=spec
```

Expected: all tests pass (migration was applied in Task 3, so 0 contaminated rows).

- [ ] **Step 3: Run full regression suite**

```bash
npm run test:regression 2>&1 | tail -20
```

Expected: same or better pass count.

- [ ] **Step 4: Commit**

```bash
git add tests/regression/prod-smoke.test.mjs
git commit -m "test(regression): audit 0 ready-to-eat products in wrong canonical category"
```

---

## Task 5: Apply Migration to Prod Turso

**No code changes — DB operations only.**

- [ ] **Step 1: Comment out DB_FILE in .env.local**

Open `.env.local`. Find the line `DB_FILE=data/prod_local.db` and comment it out:

```
# DB_FILE=data/prod_local.db
```

Save the file.

- [ ] **Step 2: Dry-run against prod Turso**

```bash
node scripts/migrate-ready-to-eat-category.js
```

Expected: same output shape as local dry-run. Verify the products listed are the expected 4 RTE mis-mapped products.

- [ ] **Step 3: Apply to prod Turso**

```bash
node scripts/migrate-ready-to-eat-category.js --apply
```

Expected: Phase 1 shows canonicals updated. Phase 2 shows products remapped or queued.

- [ ] **Step 4: Verify against prod Turso**

```bash
node -e "
require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const { createClient } = require('@libsql/client');
const url = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const token = process.env.TURSO_AUTH_TOKEN || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;
const db = createClient({ url, authToken: token });
db.execute(\`
  SELECT sp.product_name, cp.category
  FROM store_products sp
  JOIN canonical_products cp ON cp.id = sp.canonical_id
  WHERE sp.is_active = 1
    AND (lower(sp.product_name) LIKE '%ready to eat%'
      OR (lower(sp.product_name) LIKE '%quick%' AND lower(sp.product_name) LIKE '%poha%'))
\`).then(r => { console.log(JSON.stringify(r.rows, null, 2)); process.exit(0); });
"
```

Expected: all rows show `category = "Ready Meals & Mixes"`.

- [ ] **Step 5: Restore DB_FILE in .env.local**

Uncomment the line in `.env.local`:

```
DB_FILE=data/prod_local.db
```

Save. No commit needed (`.env.local` is gitignored).
