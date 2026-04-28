# Rename: `deals` → `store_products` — Implementation Spec

**Date:** 2026-04-28
**Branch:** `rename/deals-to-store-products` (cut from `compare-stores`)
**Status:** APPROVED
**Motivation:** The `deals` table now stores all store products (catalog items, non-deal prices, on-demand crawl results) — not just promotional deals. The name is actively misleading for every developer who reads it.

---

## Scope

**In scope:**
- Database table names
- Database index names
- SQL strings embedded in source files
- File names (routes, services, hooks, scripts) that contain "deal" in the name
- `require()`/`import` paths that reference renamed files
- API route path `/api/v1/deals` → `/api/v1/store-products` (client updated in lockstep)
- iCloud duplicate files (` 2.js`, ` 3.js`) — removed as pre-flight cleanup

**Out of scope (explicit):**
- JavaScript variable names (`deal`, `dealId`, `dealsRouter`, `getDeals`, `filterAndRankDealsByQuery`, etc.) — separate PR if ever
- React component names (`DealsPage`, `DealSharePage`) — separate PR if ever
- URL slugs visible to users (e.g. any `/deals` URL the frontend navigates to for UX purposes) — confirm none exist before merge
- The `deal_id` column in `deal_mappings`, `entity_resolution_queue`, and `price_history` — accepted naming drift (see Drift section)

---

## Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| `deal_mappings` table | Rename to `store_product_mappings` | Table name is in scope; column `deal_id` inside it is not |
| `deal_price_history` table | Rename to `price_history` | Redundant "deal" prefix; history is for all store products |
| `deal_id` column in `price_history` | Keep as-is | SQLite column rename requires table recreation; accepted drift |
| `deal_id` column in `store_product_mappings` | Keep as-is | Same reasoning |
| `deal_id` column in `entity_resolution_queue` | Keep as-is | Same reasoning |
| JS variable names | Not renamed | Separate PR; no semantic harm until then |
| Index rename strategy | Drop + recreate | SQLite has no `ALTER INDEX RENAME` |
| Migration atomicity | Wrapped in one transaction per phase | Rollback clean if anything fails mid-phase |
| Migration idempotency | `IF EXISTS` / `IF NOT EXISTS` guards on every statement | Script safe to re-run after partial failure |
| Per-phase commits | Yes — one commit per phase | Any phase can be reverted cleanly |

---

## Tables and Indexes Being Renamed

### Tables

| Old name | New name |
|---|---|
| `deals` | `store_products` |
| `deal_price_history` | `price_history` |
| `deal_mappings` | `store_product_mappings` |

### Indexes (all on `deals` / `deal_price_history`)

SQLite does not support `ALTER INDEX RENAME TO`. Each index must be **dropped then recreated** pointing to the new table name.

| Old index | New index | Table |
|---|---|---|
| `idx_deals_display_date_order` | `idx_store_products_display_date_order` | `store_products` |
| `idx_deals_active_display` | `idx_store_products_active_display` | `store_products` |
| `idx_deals_store_id` | `idx_store_products_store_id` | `store_products` |
| `idx_deals_name` | `idx_store_products_name` | `store_products` |
| `idx_deals_category` | `idx_store_products_category` | `store_products` |
| `idx_deals_is_active` | `idx_store_products_is_active` | `store_products` |
| `idx_deals_sale_price` | `idx_store_products_sale_price` | `store_products` |
| `idx_deals_discount` | `idx_store_products_discount` | `store_products` |
| `idx_deals_crawl_run` | `idx_store_products_crawl_run` | `store_products` |
| `idx_deals_canonical` | `idx_store_products_canonical` | `store_products` |
| `idx_deal_price_history_crawl_date` | `idx_price_history_crawl_date` | `price_history` |
| `idx_deal_price_history_store_date` | `idx_price_history_store_date` | `price_history` |
| `idx_deal_price_history_product_url` | `idx_price_history_product_url` | `price_history` |
| `idx_map_canonical` | `idx_map_canonical` (unchanged — on `store_product_mappings`) | `store_product_mappings` |

The `idx_map_canonical` name is acceptable without rename; it has no "deal" prefix. Recreate it on the renamed table.

### Accepted Drift (columns not renamed)

| Table | Column | Reason |
|---|---|---|
| `price_history` (formerly `deal_price_history`) | `deal_id` | SQLite column rename = full table recreation; not worth the risk |
| `store_product_mappings` (formerly `deal_mappings`) | `deal_id` | Same |
| `entity_resolution_queue` | `deal_id` | Same |

Document in `server/db/schema.sql` with a comment above each drifted column.

### Foreign Key Note

`deal_mappings.deal_id REFERENCES deals(id)` and `entity_resolution_queue.deal_id REFERENCES deals(id)` — these FK references must be updated to `REFERENCES store_products(id)` in `schema.sql`. In the live DB, `ALTER TABLE ... RENAME TO` in SQLite/libSQL automatically updates FK references in most cases, but `schema.sql` must be kept consistent as the authoritative source.

---

## Accepting Drift — Column-Level Documentation

Add this comment above the `deal_id` column in each affected table in `schema.sql`:

```sql
-- deal_id: references store_products(id). Column name not renamed (SQLite column rename
-- requires full table recreation). Accepted naming drift — semantically equivalent.
```

---

## Files Being Renamed

`git mv` preserves history. All five of these files have "deal" in the filename.

| Old path | New path |
|---|---|
| `server/routes/deals.js` | `server/routes/store-products.js` |
| `server/services/deal-search.js` | `server/services/store-product-search.js` |
| `server/services/deal-order.js` | `server/services/store-product-order.js` |
| `crawler/utils/shopify-deals-factory.js` | `crawler/utils/shopify-product-factory.js` |
| `client/src/hooks/useDeals.js` | `client/src/hooks/useStoreProducts.js` |
| `scripts/run-automapper-all-deals.js` | `scripts/run-automapper-all-store-products.js` |
| `scripts/backfill-unmapped-deals-local.js` | `scripts/backfill-unmapped-store-products-local.js` |
| `scripts/link-deals-by-name.js` | `scripts/link-store-products-by-name.js` |

---

## Import Paths Being Updated

After each file rename, every `require()` pointing to the old path must be updated.

| File containing the import | Old require | New require |
|---|---|---|
| `server/index.js:11` | `require("./routes/deals")` | `require("./routes/store-products")` |
| `server/routes/store-products.js:11` | `require("../services/deal-order")` | `require("../services/store-product-order")` |
| `server/routes/store-products.js:12` | `require("../services/deal-search")` | `require("../services/store-product-search")` |
| `server/services/phonetic-search.js:3` | `require("./deal-search")` | `require("./store-product-search")` |
| `crawler/index.js:22` | `require("../server/services/deal-order")` | `require("../server/services/store-product-order")` |
| `crawler/stores/bajwa-shop.js:3` | `require("../utils/shopify-deals-factory")` | `require("../utils/shopify-product-factory")` |
| `crawler/stores/indianspicebasket.js:3` | `require("../utils/shopify-deals-factory")` | `require("../utils/shopify-product-factory")` |
| `crawler/stores/transfoodlev.js:3` | `require("../utils/shopify-deals-factory")` | `require("../utils/shopify-product-factory")` |
| `crawler/stores/villagefoods.js:3` | `require("../utils/shopify-deals-factory")` | `require("../utils/shopify-product-factory")` |
| `client/src/pages/DealsPage.jsx:15` | `import useDeals from "../hooks/useDeals"` | `import useDeals from "../hooks/useStoreProducts"` |

Note: `DealsPage.jsx` imports the hook under the old variable name `useDeals`. The variable name is out of scope for this PR — only the import path changes.

---

## API Path Rename

| Location | Old value | New value |
|---|---|---|
| `server/index.js:52` | `app.use("/api/v1/deals", dealsRouter)` | `app.use("/api/v1/store-products", storeProductsRouter)` |
| `server/index.js:412` | `"/api/v1/deals?curated=daily_live_pool"` | `"/api/v1/store-products?curated=daily_live_pool"` |
| `server/index.js:480` | `http://localhost:${PORT}/api/v1/deals` | `http://localhost:${PORT}/api/v1/store-products` |
| `client/src/utils/api.js:135` | `request("/deals", params)` | `request("/store-products", params)` |
| `client/src/utils/api.js:139` | `request("/deals/stores", params)` | `request("/store-products/stores", params)` |
| `client/src/utils/api.js:143` | `request("/deals", { deal_id: dealId })` | `request("/store-products", { deal_id: dealId })` |
| `client/src/utils/api.js:388` | `request("/deals/replacements", ...)` | `request("/store-products/replacements", ...)` |
| `client/src/utils/api.js:396` | `request("/deals/same-product-other-stores", ...)` | `request("/store-products/same-product-other-stores", ...)` |

The `dealsRouter` variable in `server/index.js` is a JS variable — out of scope — but should be renamed for consistency with the new file name. Decision: rename `dealsRouter` → `storeProductsRouter` in `server/index.js` only (it's a one-file local binding, trivial, and avoids confusion at the mount point).

---

## SQL Strings in Source Files

All `FROM deals`, `INTO deals`, `UPDATE deals`, `JOIN deals` → `store_products`.
All `deal_price_history` → `price_history`.
All `deal_mappings` → `store_product_mappings`.

### `crawler/index.js`
Lines: 205, 218, 233, 260, 269, 329, 480, 490, 510
- `FROM deals` → `FROM store_products`
- `UPDATE deals` → `UPDATE store_products`
- `INSERT INTO deals` → `INSERT INTO store_products`
- `DELETE FROM deal_price_history` → `DELETE FROM price_history`
- `INSERT INTO deal_price_history` → `INSERT INTO price_history`
- `INSERT OR IGNORE INTO deal_price_history` → `INSERT OR IGNORE INTO price_history`

### `crawler/utils/pass1-fetcher.js`
Line: 126
- `JOIN deals d ON d.id = dm.deal_id` → `JOIN store_products d ON d.id = dm.deal_id`

Line: 125
- `FROM deal_mappings dm` → `FROM store_product_mappings dm`

### `scripts/backfill-base-keys-multi-store.js`
Lines: 46, 116
- `JOIN deals d` → `JOIN store_products d`

### `scripts/backfill-price-per-litre.js`
Lines: 32–37
- `FROM deals` → `FROM store_products`
- `UPDATE deals` → `UPDATE store_products`

### `scripts/backfill-unmapped-store-products-local.js` (renamed from `backfill-unmapped-deals-local.js`)
Lines: 37, 55, 90, 94, 96, 110
- `FROM deals` → `FROM store_products`
- `UPDATE deals` → `UPDATE store_products`
- `deal_mappings` → `store_product_mappings`

### `scripts/bootstrap-canonical-catalogue.js`
Lines: 264, 277, 341
- `FROM deals` → `FROM store_products`
- `JOIN deals d` → `JOIN store_products d`

### `scripts/import-openai-csv.js`
Lines: 121, 122
- `FROM deals d` → `FROM store_products d`
- `FROM deals d2` → `FROM store_products d2`

### `scripts/link-store-products-by-name.js` (renamed from `link-deals-by-name.js`)
Lines: 87, 176, 177, 194, 200, 213, 214
- `FROM deals` → `FROM store_products`
- `UPDATE deals` → `UPDATE store_products`
- `INSERT INTO deal_mappings` → `INSERT INTO store_product_mappings`

### `scripts/migrate-canonical-slots.js`
Line: 74
- `UPDATE deals SET canonical_id = NULL` → `UPDATE store_products SET canonical_id = NULL`

### `scripts/migrate-real-savings.js`
Lines: 44–47
- `deal_price_history` → `price_history` (table name in SQL strings and description strings)

### `scripts/perf-smoke.js`
Line: 73
- `INSERT INTO deals` → `INSERT INTO store_products`

### `scripts/promote-bootstrap-staging.js`
Lines: 160, 168, 203, 210, 248, 260, 266, 282, 285, 286
- `deals` → `store_products`
- `deal_mappings` → `store_product_mappings`

### `scripts/push-local-db-to-turso.js`
Lines: 26, 30
- `"deal_price_history"` → `"price_history"`
- `"deal_mappings"` → `"store_product_mappings"`

### `scripts/relink-promoted-canonicals.js`
Lines: 67, 71, 89, 97, 114, 146, 158, 164, 180, 183, 184
- `deals` → `store_products`
- `deal_mappings` → `store_product_mappings`

### `scripts/run-automapper-all-store-products.js` (renamed)
Lines: 31–36, 37, 53, 81, 85, 87
- `deals` → `store_products`
- `deal_mappings` → `store_product_mappings`

### `scripts/seed-priority-canonicals.js`
Lines: 282, 291, 298, 299
- `FROM deals` → `FROM store_products`
- `deal_mappings` → `store_product_mappings`

### `scripts/setup-real-savings-local.js`
Lines: 46, 47, 100, 112, 159
- `ALTER TABLE deals` → `ALTER TABLE store_products`
- `deal_price_history` → `price_history`

### `scripts/snapshot-prod.js`
Lines: 29, 31
- `"deal_price_history"` → `"price_history"`
- `"deal_mappings"` → `"store_product_mappings"`

### `scripts/wipe-old-canonicals.js`
Lines: 55, 57, 65, 81, 126, 129, 141, 149
- `deals` → `store_products`
- `deal_mappings` → `store_product_mappings`

### `server/db/index.js`
Lines: 169, 248–251, 307, 345, 396–401
- `ALTER TABLE deal_price_history` → `ALTER TABLE price_history`
- `ALTER TABLE deals` → `ALTER TABLE store_products`
- `CREATE TABLE IF NOT EXISTS deal_price_history` → `CREATE TABLE IF NOT EXISTS price_history`
- Index creation strings: old index names → new index names

### `server/index.js`
Lines: 219, 412, 480, 485
- `FROM deals d` → `FROM store_products d`
- `FROM deals WHERE` → `FROM store_products WHERE`
- API path strings (see API path section above)

### `server/routes/admin-dashboard.js`
Lines: 66–72, 104, 221, 250–272
- `FROM deals` → `FROM store_products`
- `JOIN deals` → `JOIN store_products`
- `UPDATE deals` → `UPDATE store_products`
- `deal_mappings` → `store_product_mappings`

### `server/routes/admin-review-queue.js`
Lines: 133, 143, 226, 236, 262, 272, 335, 337, 392, 394, 417, 429
- `UPDATE deals` → `UPDATE store_products`
- `FROM deals` → `FROM store_products`
- `deal_mappings` → `store_product_mappings`

### `server/routes/admin.js`
Lines: 101, 209, 260, 265
- `FROM deals` → `FROM store_products`
- `JOIN deals` → `JOIN store_products`
- `UPDATE deals` → `UPDATE store_products`
- `deal_mappings` → `store_product_mappings`

### `server/routes/bookmarks.js`
Line: 52
- `JOIN deals d ON d.id = b.deal_id` → `JOIN store_products d ON d.id = b.deal_id`

### `server/routes/store-products.js` (renamed from `deals.js`)
Lines: 142, 170, 359, 375, 682, 709
- All `FROM deals d` → `FROM store_products d`

### `server/services/alert-evaluator.js`
Line: 31
- `FROM deals d` → `FROM store_products d`

### `server/services/base-product-catalog.js`
Line: 328
- `JOIN deals d` → `JOIN store_products d`

### `server/services/canonicalizer.js`
Lines: 138, 150, 258, 265
- `INSERT INTO deal_mappings` → `INSERT INTO store_product_mappings`
- `UPDATE deals` → `UPDATE store_products`
- `deal_mappings dm` → `store_product_mappings dm`
- `FROM deals d` → `FROM store_products d`

### `server/services/price-history-recorder.js`
Lines: 32, 50, 106 (and comment lines 5, 9, 16)
- `DELETE FROM deal_price_history` → `DELETE FROM price_history`
- `INSERT OR IGNORE INTO deal_price_history` → `INSERT OR IGNORE INTO price_history`
- Comments referencing `deal_price_history` → `price_history`

### `server/services/product-replacements.js`
Line: 63
- `FROM deals d` → `FROM store_products d`

### `server/services/real-savings.js`
Lines: 64, 78, 85, 86, 87
- `FROM deals WHERE` → `FROM store_products WHERE`
- `FROM deal_price_history dph` → `FROM price_history dph`
- `JOIN deals d ON` → `JOIN store_products d ON`
- `deal_mappings dm` → `store_product_mappings dm`

### `server/routes/health.js`
Lines: 45, 57
- `FROM deals WHERE` → `FROM store_products WHERE`
- `FROM deal_price_history` → `FROM price_history`

### `crawler/utils/auto-mapper.js`
Lines: 12, 193, 214 (and comment text)
- `deal_mappings` → `store_product_mappings` in SQL and comments

### Tests (12 files)

These files create their own in-memory fixtures or assert against SQL strings — all must be updated in Phase 8.

**`tests/integration/mapped-products.test.js`**
- `INSERT INTO deals (...)` → `INSERT INTO store_products (...)`
- `JOIN deal_mappings dm` → `JOIN store_product_mappings dm`
- `INSERT INTO deal_mappings` → `INSERT INTO store_product_mappings`

**`tests/integration/product-replacements.test.js`**
- `CREATE TABLE deals (` → `CREATE TABLE store_products (`
- `INSERT INTO deals (...)` → `INSERT INTO store_products (...)`

**`tests/integration/recommender.test.js`** (~20 occurrences)
- All `INSERT INTO deals` → `INSERT INTO store_products`

**`tests/integration/recommender-exact-combination.test.js`**
- `INSERT INTO deals` → `INSERT INTO store_products`

**`tests/integration/review-queue.test.js`**
- `INSERT INTO deals (...)` → `INSERT INTO store_products (...)`

**`tests/integration/canonicalizer.test.js`**
- `INSERT INTO deals` → `INSERT INTO store_products`
- `FROM deal_mappings` → `FROM store_product_mappings`

**`tests/integration/alerts.test.js`**
- `INSERT INTO deals` → `INSERT INTO store_products`

**`tests/integration/share-meta.test.js`**
- `INSERT INTO deals (...)` → `INSERT INTO store_products (...)`

**`tests/regression/auto-mapper.test.mjs`**
- `INSERT INTO deal_mappings` string match → `INSERT INTO store_product_mappings`

**`tests/regression/slot-matching.test.mjs`**
- `INSERT INTO deal_mappings` string match → `INSERT INTO store_product_mappings`

**`tests/regression/price-history-recorder.test.mjs`**
- `INSERT OR IGNORE INTO deal_price_history` string match → `INSERT OR IGNORE INTO price_history`

**`tests/e2e/routes.e2e.test.js`**
- `INSERT INTO deals` → `INSERT INTO store_products` (fixture setup, ~10 occurrences)
- `/api/v1/deals` API path references (lines 523, 529, 533) → `/api/v1/store-products`

---

## Schema File Changes (`server/db/schema.sql`)

Full list of changes needed:

1. `CREATE TABLE IF NOT EXISTS deals` → `CREATE TABLE IF NOT EXISTS store_products`
2. `CREATE TABLE IF NOT EXISTS deal_price_history` → `CREATE TABLE IF NOT EXISTS price_history`
3. `CREATE TABLE IF NOT EXISTS deal_mappings` → `CREATE TABLE IF NOT EXISTS store_product_mappings`
4. FK in `deal_mappings`: `REFERENCES deals(id)` → `REFERENCES store_products(id)` (×2)
5. FK in `entity_resolution_queue`: `REFERENCES deals(id)` → `REFERENCES store_products(id)`
6. All 10 `idx_deals_*` index names → `idx_store_products_*` (with correct table reference)
7. All 3 `idx_deal_price_history_*` index names → `idx_price_history_*`
8. `idx_map_canonical ON deal_mappings` → `idx_map_canonical ON store_product_mappings`
9. Add drift comment above `deal_id` in `price_history`, `store_product_mappings`, `entity_resolution_queue`

---

## Migration Script

New file: `scripts/migrate-deals-to-store-products.js`

The migration must be **idempotent** — safe to run twice. Each step checks existence before acting.

```
Phase A — Tables (SQLite ALTER TABLE RENAME TO is atomic and updates FK refs)
  1. IF 'deals' table exists AND 'store_products' does not → ALTER TABLE deals RENAME TO store_products
  2. IF 'deal_price_history' exists AND 'price_history' does not → ALTER TABLE deal_price_history RENAME TO price_history
  3. IF 'deal_mappings' exists AND 'store_product_mappings' does not → ALTER TABLE deal_mappings RENAME TO store_product_mappings

Phase B — Drop old indexes (IF EXISTS — safe no-ops if already gone)
  DROP INDEX IF EXISTS idx_deals_display_date_order
  DROP INDEX IF EXISTS idx_deals_active_display
  DROP INDEX IF EXISTS idx_deals_store_id
  DROP INDEX IF EXISTS idx_deals_name
  DROP INDEX IF EXISTS idx_deals_category
  DROP INDEX IF EXISTS idx_deals_is_active
  DROP INDEX IF EXISTS idx_deals_sale_price
  DROP INDEX IF EXISTS idx_deals_discount
  DROP INDEX IF EXISTS idx_deals_crawl_run
  DROP INDEX IF EXISTS idx_deals_canonical
  DROP INDEX IF EXISTS idx_deal_price_history_crawl_date
  DROP INDEX IF EXISTS idx_deal_price_history_store_date
  DROP INDEX IF EXISTS idx_deal_price_history_product_url
  DROP INDEX IF EXISTS idx_map_canonical

Phase C — Recreate indexes on renamed tables (IF NOT EXISTS — safe no-ops if already created)
  CREATE INDEX IF NOT EXISTS idx_store_products_display_date_order ON store_products(...)
  ... (all 10 store_products indexes)
  CREATE INDEX IF NOT EXISTS idx_price_history_crawl_date ON price_history(crawl_date)
  CREATE INDEX IF NOT EXISTS idx_price_history_store_date ON price_history(store_id, crawl_date)
  CREATE INDEX IF NOT EXISTS idx_price_history_product_url ON price_history(product_url)
  CREATE INDEX IF NOT EXISTS idx_map_canonical ON store_product_mappings(canonical_id)
```

Migration must be run with `PRAGMA foreign_keys = OFF` during rename, then re-enabled after. SQLite `ALTER TABLE RENAME TO` does propagate FK references automatically in SQLite 3.26+ (libSQL / Turso qualifies), but FK enforcement must be off during the operation.

**Test the migration on a local DB copy before running on the real local DB.** Procedure:
```
cp data/prod_local.db data/prod_local.db.pre-rename
DB_FILE=data/prod_local.db.pre-rename node scripts/migrate-deals-to-store-products.js
DB_FILE=data/prod_local.db.pre-rename node scripts/migrate-deals-to-store-products.js  # idempotency check — must succeed cleanly
```

---

## Phase-by-Phase Execution Plan

Each phase is a separate git commit. If any phase fails, revert that commit and diagnose before continuing.

### Phase 0 — Pre-flight (no code changes)

1. Verify branch: `git branch --show-current` → must be `rename/deals-to-store-products`
2. Confirm clean baseline: `npm run test:integration && npm run test:regression && npm run test:e2e` — all must pass before any changes
3. Remove iCloud duplicate files. Two categories require different commands:

   **Tracked duplicates** (`" 2.*"` — 68+ files across `.js`, `.jsx`, `.mjs`, `.md`, `.png`, `.jpg`, etc.) — remove from git tracking and disk:
   ```sh
   git ls-files | grep ' 2\.' | xargs -I{} git rm "{}"
   ```

   **Untracked duplicates** (`" 3.*"` — not in git, disk-only) — delete from disk only:
   ```sh
   git ls-files --others --exclude-standard | grep ' [23]\.' | xargs -I{} rm "{}"
   ```

   Verify nothing remains: `find . -name "* 2.*" -o -name "* 3.*" | grep -v node_modules | grep -v ".git"` → zero hits.

4. Commit: `chore: remove iCloud duplicate files`
5. Verify test suite still passes
6. Back up local DB: `cp data/prod_local.db data/prod_local.db.pre-rename` (active DB per `DB_FILE` in `.env.local`)

### Phase 1 — `server/db/schema.sql` update

Update `schema.sql` with all renames per the Schema File Changes section above.
This is source-of-truth only — the live DB is not touched yet.

Commit: `schema: rename deals→store_products tables and indexes in schema.sql`

### Phase 2 — Migration script

Write `scripts/migrate-deals-to-store-products.js` per the Migration Script spec above.
Test it on `local.db.backup` (both the first run and the idempotency re-run).
Do not run it on the real local DB yet.

Commit: `chore: add idempotent migrate-deals-to-store-products migration script`

### Phase 3 — SQL strings in source files

Apply all SQL string changes per the "SQL Strings in Source Files" section.
Order: crawler files → script files → server files (least to most user-facing).

Commit: `refactor: update SQL strings deals→store_products, deal_price_history→price_history, deal_mappings→store_product_mappings`

**After this commit:** the code references the new table names, but the live DB still has the old names. The app will be broken until the migration runs (Phase 6). This is expected and acceptable — no users.

### Phase 4 — File renames

```
git mv server/routes/deals.js server/routes/store-products.js
git mv server/services/deal-search.js server/services/store-product-search.js
git mv server/services/deal-order.js server/services/store-product-order.js
git mv crawler/utils/shopify-deals-factory.js crawler/utils/shopify-product-factory.js
git mv client/src/hooks/useDeals.js client/src/hooks/useStoreProducts.js
git mv scripts/run-automapper-all-deals.js scripts/run-automapper-all-store-products.js
git mv scripts/backfill-unmapped-deals-local.js scripts/backfill-unmapped-store-products-local.js
git mv scripts/link-deals-by-name.js scripts/link-store-products-by-name.js
```

Commit: `refactor: rename deal-named files to store-product equivalents`

### Phase 5 — Import path updates

Update all `require()` / `import` paths per the "Import Paths Being Updated" section.
Also rename `dealsRouter` → `storeProductsRouter` in `server/index.js` (local variable, consistent with file rename).

Commit: `refactor: update import paths for renamed files`

### Phase 6 — API path rename

Update `/api/v1/deals` → `/api/v1/store-products` in:
- `server/index.js` (mount point + inline references)
- `client/src/utils/api.js` (all `/deals` request paths)
- `tests/e2e/routes.e2e.test.js` (lines 523, 529, 533)
- `.github/workflows/crawl.yml` ("Warm public deals cache" curl step)

Commit: `feat: rename API path /api/v1/deals → /api/v1/store-products`

### Phase 7 — Run migration on local DB

The active local DB is `data/prod_local.db` (set via `DB_FILE` in `.env.local`). Run:

```
DB_FILE=data/prod_local.db node scripts/migrate-deals-to-store-products.js
```

First test on the backup copy for safety:
```
DB_FILE=data/prod_local.db.pre-rename node scripts/migrate-deals-to-store-products.js
DB_FILE=data/prod_local.db.pre-rename node scripts/migrate-deals-to-store-products.js  # idempotency check
```

Then run on the real DB:
```
DB_FILE=data/prod_local.db node scripts/migrate-deals-to-store-products.js
```

Verify:
```
sqlite3 data/prod_local.db ".tables"  -- must show store_products, price_history, store_product_mappings; must NOT show deals, deal_price_history, deal_mappings
sqlite3 data/prod_local.db ".schema store_products"  -- confirm all indexes present with new names
```

This step does not produce a git commit (DB file not tracked).

### Phase 8 — Test suite

Apply all SQL string changes in the "Tests (12 files)" subsection of "SQL Strings in Source Files".
Run full test suite — `npm run test:integration && npm run test:regression && npm run test:e2e` — all must pass.

Commit: `test: update test fixtures and assertions for store_products rename`

### Phase 9 — Smoke test

1. Start server: `node server/index.js`
2. Hit product endpoint: `curl http://localhost:3000/api/v1/store-products?limit=5`
3. Confirm response contains data (not 500 / empty)
4. Trigger a real crawl or a dev-mode partial crawl
5. Query renamed table directly: `sqlite3 local.db "SELECT COUNT(*) FROM store_products"`

---

## Verification Gate (before merge)

All of the following must pass before the PR is merged to `compare-stores`:

1. **SQL string grep:** `grep -rn "\bdeals\b" --include="*.js" --include="*.mjs" --include="*.sql" --include="*.yml" server/ crawler/ client/ scripts/ tests/ .github/` — only intentional log messages / comments remain. Zero table-name references.

2. **History table grep:** `grep -rn "deal_price_history" --include="*.js" --include="*.mjs" --include="*.sql" server/ crawler/ client/ scripts/ tests/` — zero hits.

3. **Mappings table grep:** `grep -rn "deal_mappings" --include="*.js" --include="*.mjs" --include="*.sql" server/ crawler/ client/ scripts/ tests/` — zero hits.

4. **Old file check:** `ls server/routes/deals.js server/services/deal-search.js server/services/deal-order.js crawler/utils/shopify-deals-factory.js` — all must return "no such file".

5. **Schema consistency:** `sqlite3 local.db ".schema"` output must match `server/db/schema.sql` table and index definitions (diff manually or via script).

6. **Full test suite:** `npm run test:integration && npm run test:regression && npm run test:e2e` — all pass.

7. **Server smoke test:** Start + hit `/api/v1/store-products` — returns data.

8. **iCloud duplicates gone:** `find . -name "* 2.js" -o -name "* 3.js" | grep -v node_modules | grep -v ".git"` — zero hits.

---

## Known Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| SQLite FK propagation on `ALTER TABLE RENAME TO` | Low (libSQL 3.26+) | Verify before running: `SELECT sqlite_version()` on Turso DB — must be ≥ 3.26 |
| Missing SQL reference not caught by grep | Low | Grep verification gate + integration test run |
| Test fixtures referencing old table names | Medium | Run test suite in Phase 8; fix any failures before merge |
| Index column definitions in schema.sql contain old table reference in expression | Low | Check each index definition in schema.sql for ON clause pointing to correct table |
| `server/db/index.js` bootstrapStatements lines 402-405: two `CREATE INDEX … ON deals(…)` calls (`idx_deals_display_date_order`, `idx_deals_active_display`) are wrapped in try-catch — after rename they fail silently on fresh DB init | Low | Non-blocking: `schema.sql` (applied first) already creates correct `idx_store_products_*` equivalents. Log a warning; functionally safe. No code change required in this PR. |
| `server/db/index.js` line 311: `deal_id TEXT NOT NULL REFERENCES deals(id)` inside a `bookmarks` CREATE TABLE in bootstrapStatements — FK references old table name | Low | Non-blocking: SQLite does not enforce FK constraints by default. Semantic only. No code change required in this PR — sweep in a follow-up cleanup of `db/index.js` bootstrapStatements. |

---

## Out of Scope (this PR)

- JS variable names (`deal`, `dealId`, `dealsRouter`, `filterAndRankDealsByQuery`)
- React component names (`DealsPage`, `DealSharePage`, `DealSharePageContent`)
- User-facing URL slugs (confirm none exist — `client/src/` routing does not expose `/deals` as a public URL path)
- Turso remote DB migration (handled separately once local rename is proven)
- `docs/` and `README.md` — ~71 references to `/api/v1/deals` and `FROM deals`; sweep in a follow-up docs PR
