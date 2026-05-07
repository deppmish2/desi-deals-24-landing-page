# DB-First base_key Resolution

**Date:** 2026-05-07  
**Status:** Approved for implementation

## Problem

`resolveBaseProduct(text)` is a runtime CSV fuzzy-matcher that runs on every deal the recommender processes. It maps arbitrary product name strings → `base_key` for variant grouping. It predates proper canonical coverage and has caused cross-category bugs (e.g. instant poha cup matched to poha thick) because the fuzzy match has no category awareness at the call site.

`canonical_products.base_key` already exists in the schema (added May 4) but only ~20% of canonicals have it populated.

## Goal

Make `base_key` a write-once DB field resolved at query time via JOIN, so it can be admin-curated and is not re-derived from fuzzy text matching on every request. CSV still runs at runtime for `category` and `base_product` metadata — only `base_key` moves to DB authority. **Immediate behavioural change is small** (DB and CSV agree for backfilled products); the real payoff is enabling admin curation of `base_key` without CSV changes.

## Current State

| Metric | Local | Prod Turso |
|---|---|---|
| Total canonicals | 14,598 | 16,037 |
| With base_key | 2,928 (20%) | 3,159 (20%) |
| Active store products | 3,136 | — |
| Active with canonical mapping | 2,757 (88%) | — |
| Active with sp.canonical_id set | 864 (28%) | — |

Existing base_key values (the 20%) were written by `backfillBaseKeys` in `base-product-catalog.js`, which runs for canonicals mapped to 2+ stores. These are CSV-derived and consistent with what the new backfill script will produce — they are trusted; no validation pass is needed before use.

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
2. If no CSV hit: **leave base_key NULL**. Do not derive from `normalizeText`. Rationale: canonicals not in the CSV currently get no base_key → recommender uses other matching paths. A derived-but-over-specific key (e.g. `"priya poha thick 500g"`) would be treated as a real base_key by call sites that filter on it, silently breaking matches that currently work. NULL preserves current behaviour for unrecognised products.

**Script behaviour:**
- Dry run by default; `--apply` flag to write
- Dry run dumps proposed changes to `scripts/out/base-key-backfill-preview.json` as `[{id, canonical_name, old_base_key, proposed_base_key}]` for review before applying
- Batched in chunks of 500 with transactions
- Idempotent — skips rows where base_key already set
- Runs against SQLite (local) or Turso (prod) via env var, same dual-mode pattern as `migrate-schema-to-prod-20260504.js`

**Expected scope:** Only canonicals that get a CSV hit. Likely a fraction of the ~11,670 / ~12,878 with NULL base_key — exact count determined by dry-run preview.

**Run order:** local first → verify coverage → prod Turso.

## Section 2: sp.canonical_id Gap Fix

**Root cause:** `store_product_mappings` PRIMARY KEY is `(deal_id, canonical_id)` — one deal can have multiple canonical rows. The automapper syncs `sp.canonical_id` from spm using `LIMIT 1`. Canonicalizer and review-queue both write `sp.canonical_id` directly. The local DB gap (864 active with `sp.canonical_id` vs 2,757 in spm) is a snapshot artifact: the automapper nulls all active `sp.canonical_id` before re-syncing. No persistent bug in the pipeline.

**Fix:** One-time backfill in the backfill script. For active products with `sp.canonical_id IS NULL` that have a spm entry:

```sql
UPDATE store_products
SET canonical_id = (
  SELECT canonical_id FROM store_product_mappings
  WHERE deal_id = store_products.id
  ORDER BY match_confidence DESC
  LIMIT 1
)
WHERE canonical_id IS NULL
  AND EXISTS (SELECT 1 FROM store_product_mappings WHERE deal_id = store_products.id);
```

This keeps the existing JOIN pattern unchanged (`LEFT JOIN canonical_products cp ON cp.id = sp.canonical_id`). No COALESCE needed. Avoids the multiplicity problem: a plain `LEFT JOIN store_product_mappings` would multiply rows for the 1,311 deals that have 2+ spm entries.

**SELECT addition:** Once sp.canonical_id is complete, add `cp.base_key` to the deal queries that already do `LEFT JOIN canonical_products cp ON cp.id = sp.canonical_id`. No JOIN changes needed.

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

1. Implement backfill script (base_key + sp.canonical_id gap)
2. Dry run locally → review `scripts/out/base-key-backfill-preview.json`
3. Apply locally with `--apply`
4. Dry run against prod Turso → review output
5. Apply to prod Turso
6. Add `cp.base_key` to recommender deal queries (existing JOIN already covers sp.canonical_id)
7. Update `resolveBaseMetaCached` to accept `dbBaseKey`
8. Update recommender call sites to pass `deal.base_key`
9. Update other call sites (Section 4)
10. Add regression test: product with canonical + base_key in DB never falls through to `resolveBaseProduct`

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
