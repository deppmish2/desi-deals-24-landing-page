# Ready-to-Eat Category Enforcement

**Date:** 2026-05-07  
**Status:** Approved for implementation

## Problem

"Ready to eat" / "Quick" / "Instant" grain products (e.g., "Priya Ready to Eat / Quick Pulihora Poha Bundle") are mis-categorized as "Rice & Grains" and mapped to plain grain canonicals. Two root causes:

1. `category-mapper.js` — first-match-wins ordering means "poha" fires (Rice & Grains) before "ready to eat" can fire (Canned & Packaged). Also, "Ready Meals & Mixes" is not an output category at all.
2. `auto-mapper.js` — `matchesCanonical()` is category-blind; it matches purely on slot/text overlap and accepts cross-category matches.

**Current scope:** 4 active products affected. But the same class of bug will recur for every new crawl that introduces ready-to-eat products with a grain word in the name.

## Goal

Prevent ready-to-eat products from being mapped to plain grain/lentil canonicals, both for new products (at crawl time) and for existing mis-mapped products (via migration). Apply fixes to `prod_local.db` and prod Turso.

## Architecture

Three changes, applied in order:

1. **Category-mapper** — Add "Ready Meals & Mixes" as a high-priority category with compound-signal detection
2. **Automapper** — Add category guard to `matchesCanonical()` so cross-category matches return `null`
3. **Migration** — Fix existing mis-mapped products by clearing wrong mappings and re-running the (now category-aware) automapper

## Section 1: Category-Mapper Change

**File:** `crawler/utils/category-mapper.js`

### Standalone signals → "Ready Meals & Mixes"

Add "Ready Meals & Mixes" as a named category entry placed **before** Noodles & Pasta and Canned & Packaged in the categories array:

```js
["Ready Meals & Mixes", ["ready to eat", "ready-to-eat", "ready meal", "ready-meal"]],
```

Remove "ready meal", "ready-meal", "ready to eat" from the "Canned & Packaged" entry. "packaged", "canned", "tin" remain in Canned & Packaged.

### Compound signals → "Ready Meals & Mixes"

Add a pre-check (parallel to the existing SNACK_PHRASES mechanism) before the main category loop. If the product name contains both a quick/instant token AND a ready-to-eat grain token, return "Ready Meals & Mixes" immediately:

```js
const RTE_QUICK_TOKENS = ["quick", "instant"];
const RTE_GRAIN_TOKENS = ["poha", "upma", "khichdi", "biryani", "pulao", "dosa", "idli", "rava", "semolina"];

// Pre-check: quick/instant + grain → Ready Meals & Mixes
const hasQuickInstant = RTE_QUICK_TOKENS.some(t => words.includes(t));
const hasRteGrain = RTE_GRAIN_TOKENS.some(t => words.includes(t));
if (hasQuickInstant && hasRteGrain) return "Ready Meals & Mixes";
```

Where `words` is the space-split lowercased product name (already computed for SNACK_PHRASES check).

**False positive guard:** "instant" alone does NOT trigger this path — it only fires when paired with a grain/meal token. "instant noodles" hits the noodle keyword first in Noodles & Pasta (which remains unchanged). "instant coffee" has no grain token so it skips this pre-check. "Quick Oats" → `hasRteGrain = false` (oats is not in RTE_GRAIN_TOKENS) → falls through to Rice & Grains as before.

## Section 2: Automapper Category Guard

**Files:** `crawler/utils/auto-mapper.js`, `scripts/run-automapper-all-store-products.js`

### `loadPriorityCanonicals` — add `category` to SELECT

```sql
SELECT id, canonical_name, category,
       brand_slots, base_product_slots, type_slots,
       weight_value, weight_unit
FROM canonical_products
WHERE is_match_priority = 1 ...
```

### `matchesCanonical` — add `dealCategory` param and first guard

```js
function matchesCanonical(normedTitle, dealWeightValue, dealWeightUnit, canon, dealCategory) {
  // Category guard: if both sides have a known category and they differ, reject.
  if (
    dealCategory && dealCategory !== "Other" &&
    canon.category && canon.category !== "Other" &&
    dealCategory !== canon.category
  ) return null;

  // ... existing slot-matching logic unchanged ...
}
```

Returning `null` (not `false`) signals "no slots defined / skip" — same semantics as before, so callers that check `!== true` are unaffected.

### `autoMapDeals` — pass `deal.product_category`

```js
if (matchesCanonical(normedName, dealWeightValue, dealWeightUnit, canon, deal.product_category) !== true) continue;
```

### `run-automapper-all-store-products.js` — add `product_category` to SELECT

```sql
SELECT id, product_url, product_name, weight_value, weight_unit, product_category
FROM store_products
WHERE is_active = 1
```

### Dry-run path (in run-automapper-all-store-products.js)

The dry-run loop also calls `matchesCanonical` with the fifth arg:
```js
matchesCanonical(norm(deal.product_name), deal.weight_value, deal.weight_unit, canon, deal.product_category)
```

## Section 3: Migration Script

**File:** `scripts/migrate-ready-to-eat-category.js` (extend existing)

Dual-mode: `DB_FILE` env → SQLite local; `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` → Turso prod. Dry-run by default, `--apply` to write.

### Phase 1 — Canonical category update (existing behaviour, extended)

Find canonical products where name or any alias contains a ready-to-eat signal (`ready to eat`, `ready-to-eat`, `quick` + grain, `instant` + grain) AND `category != "Ready Meals & Mixes"`. Update their `category` to "Ready Meals & Mixes".

### Phase 2 — Store product re-mapping

Find active store products where:
- `sp.product_name` contains a ready-to-eat signal, AND
- their mapped canonical's `category != "Ready Meals & Mixes"`

For each:
1. Delete rows from `store_product_mappings` where `deal_id = sp.id`
2. Set `sp.canonical_id = NULL`
3. Run `matchesCanonical()` (now category-aware) against all `is_match_priority = 1` canonicals whose `category = "Ready Meals & Mixes"`
4. If match found: insert into `store_product_mappings` (match_method = `slot_match`, match_confidence = 0.85) and set `sp.canonical_id`
5. If no match: insert into `entity_resolution_queue` for admin review

Dry-run output:
```json
{
  "canonicals_updated": [...],
  "products_remapped": [...],
  "products_sent_to_review": [...]
}
```

### Run order

```
# Local
DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js        # dry run
DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js --apply

# Prod Turso (comment out DB_FILE in .env.local first)
node scripts/migrate-ready-to-eat-category.js        # dry run
node scripts/migrate-ready-to-eat-category.js --apply
```

## Section 4: Testing

**New regression tests** (extend `tests/regression/`):

| Test | File | Assertion |
|---|---|---|
| "Priya Ready to Eat Quick Pulihora Poha" → "Ready Meals & Mixes" | category-mapper.test.mjs | `mapCategory(name) === "Ready Meals & Mixes"` |
| "Quick Oats" → "Rice & Grains" (no false positive) | category-mapper.test.mjs | `mapCategory("Quick Oats") === "Rice & Grains"` |
| "Maggi 2-Minute Instant Noodles" → "Noodles & Pasta" (unaffected) | category-mapper.test.mjs | `mapCategory(name) === "Noodles & Pasta"` |
| matchesCanonical rejects Ready Meals product against Rice & Grains canonical | auto-mapper.test.mjs | returns `null` when categories differ |
| matchesCanonical still matches when both categories are "Other" | auto-mapper.test.mjs | slot match still works |
| Audit: 0 ready-to-eat products mapped to wrong canonical category | prod-smoke.test.mjs | DB query returns 0 rows |

## Files Changed

| Action | File |
|---|---|
| Modify | `crawler/utils/category-mapper.js` |
| Modify | `crawler/utils/auto-mapper.js` |
| Modify | `scripts/run-automapper-all-store-products.js` |
| Modify/extend | `scripts/migrate-ready-to-eat-category.js` |
| Modify | `tests/regression/auto-mapper.test.mjs` |
| Create or modify | `tests/regression/category-mapper.test.mjs` |
| Modify | `tests/regression/prod-smoke.test.mjs` |

## What Does NOT Change

- Slot matching logic in `matchesCanonical` — only the category pre-check is added
- "Canned & Packaged" category — "packaged", "canned", "tin" stay; only "ready to eat"/"ready meal" move
- "Noodles & Pasta" — "instant" stays there; compound check only fires for grain tokens, not noodle tokens
- Admin review queue — products that fail re-mapping in Phase 2 go here unchanged
