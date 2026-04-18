# Brand Management + Admin-Triggered Remap

**Date:** 2026-04-12
**Status:** Approved for implementation

---

## Problem

The existing spec (`2026-04-12-admin-dashboard-tabs-canonical-stats-design.md`) stores known brands as a static JS file (`crawler/utils/known-brands.js`). Adding or removing a brand requires a code change and a redeploy. There is no way to manage brands or trigger re-mapping from the admin panel.

---

## Solution Overview

1. **Brands as data** — `known_brands` DB table replaces the static JS file. Seeded from the hardcoded list on first deploy.
2. **Brand Manager UI** — Canonical Stats tab in the admin dashboard includes an editable brand list. Admin can add, edit, and delete multiple brands before committing.
3. **Async remap** — "Save & Re-map" commits the brand list to DB, inserts a `brand_remap_jobs` row, returns a `jobId` immediately, then synchronously (within the Vercel 300s window): re-decomposes all canonicals, deletes canonicals with no brand match, re-maps only unmapped deals.
4. **Frontend polling** — client polls `/remap-status/:jobId` every 3s until the job completes or fails, then refreshes the Canonical Stats tab.

---

## Design Principle

Every canonical in `canonical_products` must have a recognised brand (`brand_slots IS NOT NULL`). A canonical with no matching brand is not useful for Real Savings and is deleted during remap (cascading to its `deal_mappings`). Those deals reappear as unmapped and are resolved by adding the brand.

---

## 1. Data Layer

### 1a. New tables (`server/db/schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS known_brands (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]'  -- JSON array of lowercase strings
);

CREATE TABLE IF NOT EXISTS brand_remap_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
  started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  stats       TEXT,   -- JSON: {canonicals_redecomposed, canonicals_deleted, newly_mapped, still_unmapped, duration_ms}
  error       TEXT
);
```

### 1b. Seed (`server/db/index.js`)

On startup, seed `known_brands` from the hardcoded list in the original spec using `INSERT OR IGNORE`. After the first deploy the DB is the source of truth.

### 1c. Static file removed

`crawler/utils/known-brands.js` is deleted. Nothing imports it after this change.

---

## 2. Core Logic Changes

### 2a. Decomposer (`crawler/utils/canonical-decomposer.js`)

Signature: `decomposeCanonical(name, aliases, brands)`

Brands are injected as a parameter — the function has no DB dependency.

Algorithm:
1. Strip BBD/expiry patterns from `name` before tokenising: "Best before", "Best By", "BB", "BBD", "Exp", "Exp.", "Expires", "MHD" followed by a date.
2. Extract and normalise weight → `weightValue`, `weightUnit`.
3. Strip weight, parentheticals, dashes from remaining name.
4. Lowercase and tokenise.
5. Scan ALL tokens for a match against any brand's `aliases`:
   - Match found → `brand_slots = [[name, ...aliases]]`; remove matched token from product token list.
   - No match → `brand_slots = null`.
6. `base_product_slots = [[token] for each remaining token]`
7. `productGroupId = remaining tokens joined by "-"`

When `brand_slots = null` the canonical is not slot-matchable and will be deleted during remap.

### 2b. Auto-mapper (`crawler/utils/auto-mapper.js`)

- Remove legacy brand-anchored substring fallback entirely.
- `matchesCanonical` returns `null` (no slots) → skip canonical, try next. No fallback path.
- `loadPriorityCanonicals` adds `WHERE brand_slots IS NOT NULL` to the query.
- `autoMapDeals(db, deals, canonicals)` — signature unchanged from caller's perspective (brands not needed; brand matching is already encoded in `brand_slots` stored on the canonical).

---

## 3. Backend API

All routes in `server/routes/admin-dashboard.js`, protected by `requireAdminAuth`.

### `GET /admin-dashboard/brands`
Returns the full brand list from `known_brands`.

```json
[{ "id": 1, "name": "Aashirvaad", "aliases": ["aashirvaad", "aashirwad", "ashirwad"] }]
```

### `POST /admin-dashboard/brands/remap`

Body: `{ brands: [{ name, aliases }] }`

Steps:
1. Replace entire `known_brands` table (DELETE all + INSERT submitted list).
2. Insert `brand_remap_jobs` row (`status: 'running'`).
3. Send `202` response with `{ jobId }`.
4. Continue synchronously within the same Vercel function (300s limit):
   a. Load fresh brands from `known_brands`.
   b. Load all canonicals from `canonical_products`.
   c. Re-decompose each canonical using updated brands:
      - `brand_slots` found → update `brand_slots`, `base_product_slots`, `product_group_id` in DB.
      - `brand_slots = null` → collect for deletion. Before deleting: `UPDATE deals SET canonical_id = NULL WHERE canonical_id = ?` (deals.canonical_id has no ON DELETE clause so must be cleared manually). Then DELETE the canonical (cascades to `deal_mappings` via ON DELETE CASCADE).
   d. Load active deals with no row in `deal_mappings` (unmapped only).
   e. Load all remaining canonicals (`brand_slots IS NOT NULL`).
   f. Run `autoMapDeals` for unmapped deals against updated canonicals.
   g. Insert new `deal_mappings` for matched deals.
   h. Update job row: `status: 'completed'`, `finished_at`, `stats`.
5. On any error: update job row to `status: 'failed'`, `error: message`.

### `GET /admin-dashboard/brands/remap-status/:jobId`

Returns `{ status, stats, error, started_at, finished_at }` from `brand_remap_jobs`.

---

## 4. Frontend

### 4a. API helpers (`client/src/utils/api.js`)

```js
export function fetchBrands() { ... }
export function triggerBrandRemap(brands) { ... }
export function fetchRemapStatus(jobId) { ... }
export function fetchCanonicalStats() { ... }
```

### 4b. Admin Dashboard — 3 Tabs

Tab state: `useState("crawl")` — values: `"crawl"` | `"user"` | `"canonical"`.

Tab bar below the existing top bar. Active tab: green underline + text. Inactive: slate.

**Crawl Stats tab** — existing crawl content (no change).

**User Stats tab** — existing user content (no change).

**Canonical Stats tab** — lazy-loaded on first click:

**KPI row (3 cards):**
- Total canonicals
- Deals mapped — count + "X% of N active" (green)
- Unmapped products — count (red)

**Mapping health bar** — green/red proportional bar (mapped vs unmapped share of active deals).

**Brand Manager:**
- Header: "Known Brands" + badge showing count (e.g. "16 brands").
- Editable table: Brand name | Aliases (comma-separated inline) | Delete button per row.
- Inline editing — click any cell to edit.
- "Add brand" button appends a blank row.
- Deleted rows: greyed out with strikethrough, undo button until save.
- "Save & Re-map" button — enabled only when there are pending changes (adds, edits, deletes).
- On click:
  - POST `/brands/remap` with full updated list.
  - Button becomes "Remapping…" (spinner, disabled).
  - Polls `/remap-status/:jobId` every 3s.
  - On completion: refresh entire Canonical Stats tab, show green toast with stats ("312 newly mapped · 89 still unmapped · 4 canonicals deleted").
  - On failure: show red error, re-enable button.

**Unmapped products table:**
- Columns: Product name | Store | Category | Price | Link (opens in new tab).
- Sorted by store then product name.
- Empty state: green "All active products are mapped".
- This table is the actionable target for the remap — these are exactly the deals the job will attempt to match.

---

## 5. Files Changed

| File | Change |
|---|---|
| `server/db/schema.sql` | Add `known_brands`, `brand_remap_jobs` tables |
| `server/db/index.js` | Seed `known_brands` on startup |
| `crawler/utils/known-brands.js` | **Deleted** |
| `crawler/utils/canonical-decomposer.js` | BBD strip, all-token brand scan, brands injected |
| `crawler/utils/auto-mapper.js` | Remove legacy fallback; filter `brand_slots IS NOT NULL` |
| `server/routes/admin-dashboard.js` | Add 3 new routes + remap job runner |
| `client/src/utils/api.js` | Add 4 API helpers |
| `client/src/landing/AdminPage.jsx` | 3-tab layout + full Canonical Stats tab |

---

## 6. What Does NOT Change

- `deal_mappings` schema — unchanged.
- `canonical_products` schema — unchanged.
- Real Savings computation — unchanged.
- Crawl flow — crawler still calls `loadPriorityCanonicals` + `autoMapDeals` after each store. No brands param needed at crawl time (brand matching is encoded in stored `brand_slots`).
- All other admin dashboard endpoints — unchanged.
