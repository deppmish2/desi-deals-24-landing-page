# Canonical Pipeline Improvements — 2026-04-25

## Summary

Three changes shipped today to improve canonical matching accuracy and coverage, plus a first-pass population of the `is_priority` flag on `canonical_products`.

---

## 1. Fixed: auto-mapper case-sensitivity bug

**File:** `crawler/utils/auto-mapper.js`

### Problem

The `norm()` function lowercased product titles before slot matching. Slot values stored in `brand_slots` and `base_product_slots` are capitalised (e.g. `[["Schani"]]`, `[["Tata"]]`). The pre-compiled slot regexes were built without the `i` (case-insensitive) flag, and the fallback `includes()` check compared against un-lowercased slot values.

Result: `new RegExp("Schani").test("schani coriander powder")` → `false`. The auto-mapper had never successfully produced a `slot_match` mapping since it was written — confirmed by zero `slot_match` entries in `deal_mappings`.

### Fix

1. Added `"i"` flag to all slot regexes built in `loadPriorityCanonicals()`.
2. Added `.toLowerCase()` to slot values in the fallback `includes()` path.
3. Added `WEIGHT_RE` and `BRACKET_RE` to `norm()` to strip weight values and parenthetical content from product titles before comparison.

### Weight normalisation detail

Two title formats that were breaking string matching:

| Format | Example | After norm() |
|---|---|---|
| `"Brand - Xg Name"` | `"Schani - 100g Coriander Powder (Dhaniya)"` | `"schani coriander powder"` |
| `"Name Xg"` | `"Heera Mamra 200g"` | `"heera mamra"` |

`WEIGHT_RE` handles: `kg`, `kilo`, `gram`, `gramm`, `g`, `gm`, `ml`, `ltr`, `litre`, `liter`, `oz`, `lb`, `l`, and multi-pack formats like `2x250g`.

`BRACKET_RE` handles both `(parenthetical)` and `[bracketed]` content (e.g. `[Best Before: End Oct 2025]`).

---

## 2. New script: backfill-unmapped-deals-local.js

**File:** `scripts/backfill-unmapped-deals-local.js`

Runs the fixed slot-based auto-mapper against all currently unmapped active deals in `prod_local.db`. Safety-first design:

- Hardcodes `DB_FILE=data/prod_local.db` and deletes Turso env vars before connecting — cannot accidentally write to remote DB.
- Loads only `canonical_id IS NULL` deals, not the full active deal set.
- Supports `--dry-run` flag with sample match output before any writes.
- Syncs `deals.canonical_id` from new `deal_mappings` entries after mapping.
- Prints before/after counts and recovery rate.

### Result on first run

| Metric | Value |
|---|---|
| Active deals | 3,229 |
| Previously unmapped | 22 |
| Resolved | 18 (81.8%) |
| Still unmapped | 4 |

Remaining 4 unmapped are genuine catalog gaps (Bird's Custard Powder, Fair & Lovely Face Wash, Heera Lapsi Fine, Heera Linseed) — not pipeline failures.

---

## 3. New script: seed-is-priority-from-csv.js

**File:** `scripts/seed-is-priority-from-csv.js`

Populates `is_priority = 1` on `canonical_products` using the curated list at:
`data/Most Popular Indian Groceries - indian_grocery_1000_items.csv`

### CSV structure

| Column | Used for |
|---|---|
| Base Product | Primary match term |
| Search Variations | Secondary match terms |
| Misspellings/Regional | Tertiary match terms |
| Popularity Index (1-100) | Available for future threshold filtering |
| Popular Brands | Available for future brand-level priority |

### Matching logic

For each CSV row, all terms from Base Product, Search Variations, and Misspellings/Regional are normalised and tested against each canonical's `canonical_name` and `common_aliases`. A canonical is marked priority if any term appears in its normalised name or aliases.

### Result

| Metric | Value |
|---|---|
| CSV rows | 999 |
| CSV rows matched | 999 (100%) |
| Canonicals marked `is_priority = 1` | 3,000 (20.5% of catalog) |

The `is_priority` flag is now usable for:
- Prioritised quality review of the canonical catalog
- Boosted ranking in search results
- Seed set for the canonical accuracy verification workflow

---

## Root cause analysis: why 84% of unmapped deals had matching canonicals

Investigation of 13,943 unmapped deals (across all crawl history, not just active) revealed:

- **84% (11,787)** — canonical existed but auto-mapper never matched due to the case-sensitivity bug
- **11%** — unknown brand, no canonical exists
- **3%** — fresh/frozen products with no canonical
- **2%** — alcohol products with no canonical (now in scope per product decision 2026-04-25)

The case-sensitivity bug was the dominant cause. The weight-format normalisation (`"Brand - Xg Name"` and `"Name Xg"`) would have recovered an additional ~47% of historical unmapped deals had the bug not been present.

---

## Product decisions recorded 2026-04-25

| Decision | Resolution |
|---|---|
| Alcohol in scope for price comparison? | **Yes** |
| Fresh produce in scope? | **Yes** |
| German-titled products (e.g. "MDH Madras Curry Pulver")? | **Ignore for now** — handle in future translation pass |
| Weight and base_unit missing from canonical_products? | **By design** — weight lives at the `deals` (SKU) level, not canonical level |
| 57% of canonicals with no deal mappings? | **Expected** — canonical catalog is a superset; scrapers only crawl deals sections |
