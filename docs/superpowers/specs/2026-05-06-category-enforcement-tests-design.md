# Category Enforcement Regression Test Suite

**Date:** 2026-05-06
**Status:** Approved

## Problem

Cross-category matching bugs recurred multiple times in one session:
- T2/T3 product replacements returning spices for fresh paneer
- Cart compare recommender matching "Indian Paneer" to "MDH Karahi Paneer Masala"
- Root cause: no regression tests caught these before they reached production

## Scope

Regression tests for all four layers involved in category enforcement:

1. `item-matcher.js` — itemType assignment (paneer, dal, masala, etc.)
2. `base-product-catalog.js` — CSV-derived base_key resolution
3. `product-replacements.js` — T2/T3 cross-category guard
4. `recommender.js` — itemStoreDeals canonical category filter

Plus one prod smoke suite that runs the same assertions against the live DB.

## Architecture

### File layout

```
tests/regression/
  item-matcher.test.mjs
  base-product-catalog.test.mjs
  product-replacements.test.mjs
  recommender.test.mjs
  prod-smoke.test.mjs
```

### Test runner

`node --test` (existing runner). Added to `package.json`:

```json
"test:integration": "node --test tests/integration/**/*.test.js tests/regression/*.test.mjs"
```

Run manually before every push (same discipline as existing `npm run test:integration`).

### DB fixture pattern

DB-backed tests (`product-replacements`, `recommender`) use `createTestDb()` from `tests/helpers/db.js`. Minimal seed: 2 canonical products in different categories, 2 store listings, 2 `store_product_mappings`. Enough to trigger the failure mode; nothing more.

## Per-file pinned assertions

### `item-matcher.test.mjs` — pure function, no DB

```
parseItemIntent("paneer 500g")          → itemType === "paneer"
parseItemIntent("toor dal 1kg")         → itemType === "dal"
parseItemIntent("MDH Garam Masala 50g") → itemType === "masala"
parseItemIntent("basmati rice 5kg")     → itemType === "rice"
```

Failure here means `ITEM_TYPE_KEYWORDS` lost an entry.

### `base-product-catalog.test.mjs` — pure function, no DB

```
resolveBaseProduct("MDH Karahi Paneer Masala").base_key !== "paneer"
resolveBaseProduct("Ayurveda Indian Paneer 500g").base_key === "paneer"
resolveBaseProduct("MDH Karahi Paneer Masala").base_key === "paneer masala"  (or similar spice key)
```

Failure here means the CSV catalog rows were removed or the alias scoring changed.

### `product-replacements.test.mjs` — in-memory DB

Seed: canonical A ("Ayurveda Paneer 500g", category "Dairy & Paneer") + canonical B ("MDH Karahi Paneer Masala 50g", category "Spices & Masalas"), both active at the same store.

```
getReplacements(db, { canonicalId: A.id, storeId })
  → tiers contain no deal from canonical B
  → no tier.deals entry has product_category "Spices & Masalas"
```

Failure here means T2 or T3 lost the `sameCategory` guard.

### `recommender.test.mjs` — in-memory DB

Seed: list item mapped to canonical A ("paneer", category "Dairy & Paneer"), store has deal for canonical B ("paneer masala", category "Spices & Masalas").

```
recommendForList(db, listId, storeId)
  → item result contains no deal from "Spices & Masalas"
  → itemStoreDeals filter respected canonical_category
```

Failure here means the `itemStoreDeals` category filter was removed or the storeDeals SQL lost the canonical_products JOIN.

### `prod-smoke.test.mjs` — live DB via env

```js
import "dotenv/config"; // loads .env.local
const dbPath = process.env.DB_FILE;
if (!dbPath || !existsSync(dbPath)) skip("DB_FILE not set or file missing");
```

Runs the same 4 assertion groups against the real DB. Confirms CSV catalog rows survive any future backfill or migration. Skip-safe so CI (if added later) doesn't fail without the file.

## What this does NOT cover

- Full recommender output ranking
- Pagination or API-level behavior
- Performance

These are covered elsewhere or out of scope for this suite.

## Success criteria

All five files pass under `npm run test:integration`. Adding a new item type or modifying ITEM_TYPE_KEYWORDS without updating these tests causes a clear failure with a named layer in the output.
