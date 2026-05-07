# DB-First base_key Resolution

**Date:** 2026-05-07  
**Status:** Approved for implementation

## Problem

`resolveBaseProduct(text)` is a runtime CSV fuzzy-matcher that runs on every deal the recommender processes. It maps arbitrary product name strings → `base_key` for variant grouping. It predates proper canonical coverage and has caused cross-category bugs (e.g. instant poha cup matched to poha thick) because the fuzzy match has no category awareness at the call site.

`canonical_products.base_key` already exists in the schema (added May 4) but only ~20% of canonicals have it populated.

## Goal

Make `base_key` a write-once DB field. Resolve it at query time via JOIN. CSV stays as startup-loaded fallback for the ~30% of products with no canonical mapping — not a runtime hot path.

## Current State

| Metric | Local | Prod Turso |
|---|---|---|
| Total canonicals | 14,598 | 16,037 |
| With base_key | 2,928 (20%) | 3,159 (20%) |
| Active store products | 3,136 | — |
| Active with canonical mapping | 2,757 (88%) | — |
| Active with sp.canonical_id set | 864 (28%) | — |

Key gap: active (newly crawled) products have `sp.canonical_id = NULL` but exist in `store_product_mappings`. The recommender JOINs on `sp.canonical_id` only, so active products never get `cp.base_key` from the query.

## Architecture

Convert `resolveBaseProduct` from runtime to write-time:

1. **Backfill script** — populate `canonical_products.base_key` for all canonicals
2. **Query fix** — add `spm` JOIN so active products can resolve `cp.base_key`
3. **resolveBaseMetaCached change** — DB base_key wins when available; CSV is fallback
4. **Other call sites** — use DB base_key directly (they already have canonical context)

## Section 1: Backfill Script

**File:** `scripts/backfill-base-keys-all-canonicals.js`

For each canonical with `base_key IS NULL OR base_key = ''`:
1. `resolveBaseProduct(canonical_name)` → if match, use `result.base_key`
2. Fallback: `normalizeText(canonical_name)` (lowercase, strip punctuation) → use as base_key. Does NOT strip brand or weight — produces over-specific keys (e.g. `"priya poha thick 500g"` instead of `"poha thick"`). Intentional — conservative, no false cross-category matches. Products not in CSV won't group with brand variants; that is acceptable.

**Script behaviour:**
- Dry run by default; `--apply` flag to write
- Batched in chunks of 500 with transactions
- Idempotent — skips rows where base_key already set
- Runs against SQLite (local) or Turso (prod) via env var, same dual-mode pattern as `migrate-schema-to-prod-20260504.js`

**Expected scope:** ~11,670 local + ~12,878 prod canonicals get base_key written.

**Run order:** local first → verify coverage → prod Turso.

## Section 2: Query Fix (sp.canonical_id gap)

Active products have `sp.canonical_id = NULL` — they were mapped via `store_product_mappings`, not by writing `sp.canonical_id` directly.

Fix in deal queries that need base_key:

```sql
-- Before
LEFT JOIN canonical_products cp ON cp.id = sp.canonical_id

-- After
LEFT JOIN store_product_mappings spm2 ON spm2.deal_id = sp.id
LEFT JOIN canonical_products cp ON cp.id = COALESCE(sp.canonical_id, spm2.canonical_id)
```

Add `cp.base_key` to the SELECT. Alias `spm2` avoids conflict with existing `spm` joins in the recommender.

Affects: main deal-fetch query (~line 1639 in `recommender.js`) and any other query that currently uses `sp.canonical_id` for canonical resolution.

## Section 3: resolveBaseMetaCached Change

`server/services/recommender.js`

Add optional third arg `dbBaseKey`:

```js
function resolveBaseMetaCached(cache, text, dbBaseKey) {
  // CSV lookup always runs — recommender consumes baseMeta.category and
  // baseMeta.base_product downstream, not just base_key.
  // When dbBaseKey is present, it overrides the CSV-derived base_key only.
  const resolved = resolveBaseProduct(text);
  const meta = resolved || { base_key: null, category: null, base_product: null };
  return dbBaseKey ? { ...meta, base_key: dbBaseKey } : meta;
}
```

Call sites that have `deal.base_key` from the fixed query:
```js
resolveBaseMetaCached(baseCache, deal.product_name, deal.base_key || null)
```

Call sites without DB context (chained fallback at lines 2334–2339 for raw query text) stay unchanged.

**Conflict rule:** DB base_key wins over CSV. Backfill used CSV to write DB values — they should agree. If they diverge post-backfill (admin edited the DB value), DB is the curated authority.

## Section 4: Other Call Sites

| File | Lines | Fix |
|---|---|---|
| `server/services/product-replacements.js` | 127, 160 | deal objects — pass `deal.base_key` after query fix |
| `server/services/canonicalizer.js` | 90 | has canonical object — read `canonical.base_key` if set; CSV fallback if null |
| `server/routes/admin-review-queue.js` | 190, 310 | has canonical_id — `SELECT base_key FROM canonical_products WHERE id = ?`; CSV fallback |
| `server/routes/admin-dashboard.js` | 234 | has canonical object — same as canonicalizer |

CSV stays loaded at startup. No change to how `base-product-catalog.js` initialises. Fewer runtime calls, same fallback contract.

## Migration Order

1. Implement + test backfill script locally
2. Verify local base_key coverage ≥ 95% of canonicals
3. Apply to prod Turso
4. Fix recommender deal queries (spm2 JOIN + `cp.base_key` in SELECT)
5. Update `resolveBaseMetaCached` to accept `dbBaseKey`
6. Update recommender call sites to pass `deal.base_key`
7. Update other call sites (Section 4)
8. Add regression test: product with canonical + base_key in DB never falls through to `resolveBaseProduct`

## What Does NOT Change

- CSV file stays and loads at startup
- `resolveBaseProduct` function stays — used as fallback and by backfill script
- `canonical_products.base_key` column — already exists, no schema migration needed
- Prod Turso schema — already has base_key column (from migrate-schema-to-prod-20260504.js)

## Testing

- Unit: backfill script dry-run produces expected base_key for known canonicals
- Regression: extend existing recommender regression tests to assert `deal.base_key` is used when present
- Smoke: run integration suite before and after — 193 passing tests must stay green
- Manual: verify "Priya Quick Millet Poha Cup" resolves to `instant-poha-cup` base_key (not `poha-thick`) via DB path
