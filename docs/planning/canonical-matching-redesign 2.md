# Canonical Matching Redesign — Developer Review Document

**Status:** Awaiting approval before execution  
**Date:** 2026-04-12  
**Scope:** `crawler/utils/auto-mapper.js`, `scripts/seed-priority-canonicals.js`,
`server/db/schema.sql`, `server/db/index.js`, `server/services/canonicalizer.js`,
`crawler/utils/canonical-decomposer.js` (new), `scripts/migrate-canonical-slots.js` (new),
`scripts/run-automapper-all-deals.js` (new)

---

## 1. Problem with the current system

### How matching works today

After each crawl, the auto-mapper tries to link each scraped deal to a
canonical product. It does this by checking whether the deal's product name
contains one of the canonical's alias strings as a **substring**.

Example canonical: `"Aashirvaad Chakki Atta"`  
Aliases: `["aashirvaad chakki atta", "aashirvaad wheat flour", ...]`  
Deal title: `"Aashirvaad 2kg Chakki Atta"` → normed: `"aashirvaad 2kg chakki atta"`  
Match? `"aashirvaad chakki atta"` ← NOT a substring (2kg breaks the sequence)

### The four root failures

**A — Word-order and weight placement sensitivity**  
Jamoona and other German-language stores format titles as `"Brand - Xkg Product
Name"`. The weight spec sits between the brand and the product name, breaking
every brand-prefixed alias match. `"daawat basmati reis extra lang"` is never a
substring of `"daawat 5kg basmati reis extra lang"`.

**B — No German or regional language variants**  
The existing alias list is English-only. German stores use `"Basmatireis"`,
`"Reisflocken"`, `"Reismehl"`, `"Kurkuma"`. None of these appear in any
canonical's alias list, so deals from Jamoona or Little India are never matched.

**C — Matching scope is effectively broken**  
Only 8 of 1,337 canonical_products rows have `is_priority = 1`. The auto-mapper
only loads priority canonicals — so 1,329 canonicals are completely invisible to
the matcher. Additionally, all 8 current priority canonicals have NULL
`common_aliases`, making even those 8 unmatchable. Real Savings falls back to
Layer 2 (store-reported `compare_at_price`) for almost every deal.

**D — Weight variants are not separate canonicals**  
"Heer Basmati Rice Extra Long 5kg" and "Heer Basmati Rice Extra Long 500g" are
different products with meaningfully different per-unit economics (bulk discount,
minimum spend requirements). Collapsing them into one canonical conflates their
`price_per_kg` reference pools and prevents accurate cross-store comparison for a
customer who specifically needs the 5kg pack.

---

## 2. Proposed solution

### Token-slot matching (replaces substring alias matching)

Each canonical is described by three independent sets of token slots:

```
brand_slots:        [ ["daawat", "dawat"] ]
base_product_slots: [ ["basmati", "basmatireis"], ["rice", "reis"] ]
type_slots:         [ ["extra"], ["long", "lang", "extralang"] ]
```

A deal matches a canonical if:
1. The deal title contains **at least one variant from every slot group** (word
   order does not matter; weight specs in the title are ignored during slot
   matching), AND
2. The deal's parsed `weight_value` matches the canonical's `weight_value` within
   ±10% (rounding tolerance). If either side has no weight, the weight check is
   skipped.

Example — deal `"Daawat - 5kg Basmati Reis extra lang"`:

| Slot group | Variants | Found in title? |
|---|---|---|
| brand_slots[0] | daawat, dawat | "daawat" ✓ |
| base_product_slots[0] | basmati, basmatireis | "basmati" ✓ |
| base_product_slots[1] | rice, reis | "reis" ✓ |
| type_slots[0] | extra | "extra" ✓ |
| type_slots[1] | long, lang, extralang | "lang" ✓ |

Result: **MATCH** — regardless of where `"5kg"` sits in the title.

Same deal against `"Heer Basmati Rice Extra Long"` (brand_slots[0] = ["heer"]):
→ `"daawat"` not found in brand slot → **NO MATCH** ✓

### Two new flags (replacing overloaded `is_priority`)

| Flag | Purpose |
|---|---|
| `is_match_priority` | Loads this canonical into the auto-mapper on every crawl |
| `is_priority` (unchanged) | Triggers Pass 1 non-deal price fetching (kept small, curated only) |

This separation keeps Pass 1 bounded while allowing all 1,337 canonicals to
participate in deal matching.

### Weight as canonical identity

Each weight variant of a product is a separate canonical row:

```
canonical_products:
  "Heer Basmati Rice Extra Long 5kg"   weight_value=5000 weight_unit=g
  "Heer Basmati Rice Extra Long 500g"  weight_value=500  weight_unit=g
```

Both rows share the same `brand_slots`, `base_product_slots`, and `type_slots`.
The auto-mapper's weight check routes each deal to exactly the right canonical.
Real Savings Layer 1 uses only that canonical's own `deal_price_history` pool —
a 5kg deal is compared against 5kg reference prices only, never against 500g
prices (which would inflate savings because bulk is cheaper per-kg).

### Substitution suggestions (data model only — UI deferred)

The `product_group_id` on `canonical_products` is brand-agnostic and
weight-agnostic (e.g., `"basmati-rice-extra-long"`). This allows querying
weight-sibling canonicals for the same brand:

```sql
SELECT * FROM canonical_products
WHERE product_group_id = ?
  AND brand_slots LIKE ?   -- same brand
  AND weight_value != ?    -- different weight
ORDER BY weight_value
```

Example output for a 5kg deal:
> "Buying 10 × Heer Basmati Rice Extra Long 500g (€X total, €Y/kg) is cheaper
> than 1 × 5kg (€Z) — save €W"

No new schema is needed beyond `product_group_id` + `weight_value` +
`weight_unit` on `canonical_products`.

### New `product_groups` table

Groups canonicals across brands for the same base product type. Enables future
cross-brand Real Savings and price alerts per product type.

```
product_groups: basmati-rice-extra-long  (brand-agnostic, weight-agnostic)
  ├── Daawat Basmati Rice Extra Long 5kg
  ├── Daawat Basmati Rice Extra Long 1kg
  ├── Heer Basmati Rice Extra Long 5kg
  ├── Heer Basmati Rice Extra Long 500g
  └── (any future brand/size)
```

---

## 3. Execution plan

Seven steps in strict order. Each step is independently deployable and
reversible before the next step begins.

### Step 1 — Schema: additive column additions
**Files:** `server/db/schema.sql`, `server/db/index.js`

Add to the existing migrations array in `server/db/index.js` (the try-catch
pattern that already handles "column exists" errors safely):

```sql
ALTER TABLE canonical_products ADD COLUMN is_match_priority INTEGER DEFAULT 0;
ALTER TABLE canonical_products ADD COLUMN brand_slots        TEXT;
ALTER TABLE canonical_products ADD COLUMN base_product_slots TEXT;
ALTER TABLE canonical_products ADD COLUMN type_slots         TEXT;
ALTER TABLE canonical_products ADD COLUMN product_group_id   TEXT;
ALTER TABLE canonical_products ADD COLUMN weight_value       REAL;
ALTER TABLE canonical_products ADD COLUMN weight_unit        TEXT;

CREATE TABLE IF NOT EXISTS product_groups (
  id         TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  category   TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

`weight_value` stores the canonical's pack size in grams (e.g., 5000 for 5kg,
500 for 500g). `weight_unit` is always `"g"` (normalised). Both are nullable —
canonicals without a stated pack size (e.g., loose produce) skip the weight
check entirely.

All new columns are nullable. No existing rows or queries break.  
**Turso:** Run these `ALTER TABLE` statements directly against the Turso DB via
the libSQL client before deploying any code changes. Verify with
`PRAGMA table_info(canonical_products)` after.

---

### Step 2 — Shared decomposer utility
**New file:** `crawler/utils/canonical-decomposer.js`

Pure function used by both the migration script and the canonicalizer:

```js
decomposeCanonical(canonicalName, commonAliases) → {
  brandSlots, baseProductSlots, typeSlots, productGroupId,
  weightValue, weightUnit   // extracted from canonical_name
}
```

Logic:
1. Extract weight spec (`5kg`, `10gm`, `2x500ml`) from `canonical_name`;
   normalise to grams → `weightValue` (REAL) + `weightUnit` (`"g"`)
2. Strip the extracted weight, dashes, and BBD notes from the remaining name
3. First remaining token = brand → `brand_slots[0]`
4. Remaining tokens = base product words → one slot group per distinct concept
   (e.g., `[["basmati","basmatireis"],["rice","reis"]]`)
5. Brand-free entries from `commonAliases` distributed into matching slot groups
6. `product_group_id` = slug of base product name without brand and without weight
   (e.g., `"basmati-rice-extra-long"` — weight-agnostic for substitution queries)

---

### Step 3 — Migration: backfill all 1,337 existing canonicals
**New file:** `scripts/migrate-canonical-slots.js`

Runs once. For every row in `canonical_products`:
- Calls `decomposeCanonical()` to compute slots and extract weight
- Upserts `brand_slots`, `base_product_slots`, `type_slots`, `product_group_id`,
  `weight_value`, `weight_unit`
- Upserts into `product_groups`
- Sets `is_match_priority = 1` for all rows (every canonical participates in matching)
- Does NOT touch `is_priority` (Pass 1 scope unchanged)
- Logs every weight extraction; rows where extraction fails get NULL `weight_value`
  (graceful skip — weight check is bypassed for that canonical)
- Runs in a single transaction; idempotent (safe to re-run)

---

### Step 4 — Seeder: populate slot columns for CSV canonicals
**File:** `scripts/seed-priority-canonicals.js`

Update `buildBrandCanonicals()` to:
- Separate brand misspellings from product variants in the CSV Misspellings column
  (heuristic: if a misspelling fuzzy-matches any known brand name → `brand_slots`;
  else → `base_product_slots`)
- Build word-level slot arrays (not phrases) so matching is order-independent
- Write `brand_slots`, `base_product_slots`, `type_slots`, `product_group_id`,
  `weight_value`, `weight_unit` on INSERT

Also add German/regional variants to Search Variations for existing CSV rows
covering products sold in German-language stores (Basmatireis, Reisflocken,
Reismehl, Kurkuma, Senföl, etc.).

Append 15 new rice rows (IDs 1001–1015) for Jamoona-specific types not in the
current CSV (Sona Masoori, Palakkadan Matta, Sella Basmati, Poha varieties, etc.).

---

### Step 5 — Auto-mapper: slot-based matching
**File:** `crawler/utils/auto-mapper.js`

- `loadPriorityCanonicals()` → now loads `is_match_priority = 1` (all 1,337)
  instead of `is_priority = 1` (8 only)
- New `matchesCanonical(normedTitle, dealWeightValue, canon)` function:
  1. **Slot check** — all slot groups must match (brand + base_product + type)
  2. **Weight check** — if both `canon.weight_value` and `deal.weight_value` are
     non-null, the ratio must be within ±10%; otherwise skip weight check
  ```js
  if (canon.weightValue != null && deal.weight_value != null) {
    const ratio = deal.weight_value / canon.weightValue;
    if (ratio < 0.9 || ratio > 1.1) return false;
  }
  ```
- Legacy alias substring fallback retained for any canonical with NULL slots
  (transition safety — no deals drop during rollout)

---

### Step 6 — Canonicalizer: slots on new canonical creation
**File:** `server/services/canonicalizer.js`

Update `createCanonical()` to call `decomposeCanonical()` and write all slot
columns (including `weight_value`, `weight_unit`) whenever a new canonical is
created dynamically from a deal product name. Future auto-created canonicals
immediately participate in slot-based matching with correct weight routing.

---

### Step 7 — Re-map all active deals (additive, preserves verified data)
**New file:** `scripts/run-automapper-all-deals.js`

Loads all active deals + all `is_match_priority = 1` canonicals, then calls
`autoMapDeals()`. Uses `INSERT OR IGNORE` — does NOT wipe existing mappings.
Rows with `verified_at IS NOT NULL` are preserved unconditionally.

```bash
node scripts/run-automapper-all-deals.js
```

---

## 4. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration assigns incorrect slots to a manually curated canonical | Medium | Migration is additive; manual review of all `verified = 1` canonicals before running |
| Brand misspelling heuristic misclassifies variants into wrong slot | Medium | Log every classification; review output before re-seeding |
| Weight check produces false negatives (deal weight parsed differently from canonical weight) | Medium | ±10% tolerance handles rounding; canonical with NULL `weight_value` skips check entirely; monitor match rate after Step 7 |
| Existing canonical rows have wrong or missing weight in `canonical_name` | Medium | Migration logs every weight extraction; rows where extraction fails get NULL `weight_value` (graceful skip) |
| Slot-based matcher produces more false positives than current system | Low–Medium | Run Step 5 in dry-run mode first; compare matched deal counts before/after |
| `ALTER TABLE` on Turso fails silently; columns never created | Low | Verify with `PRAGMA table_info(canonical_products)` on Turso after each ALTER |
| Re-mapping in Step 7 creates duplicate deal_mappings | Low | `INSERT OR IGNORE` prevents duplicates |

---

## 5. Performance

| Concern | Detail | Impact |
|---|---|---|
| Auto-mapper loads 1,337 canonicals vs 8 today | In-memory ~500KB | Negligible |
| 5,000 deals × 1,337 canonicals × ~5 slot checks + weight check per crawl | ~33M `string.includes()` calls + ~7M arithmetic ops | Expected < 5s; benchmark after Step 5 |
| Pass 1 scope | Unchanged — still `is_priority = 1` only (8 rows) | No impact on crawl time |
| Step 7 one-time re-map | Runs offline, not in crawl path | Acceptable one-time cost |

---

## 6. What does NOT change

- `is_priority` flag and Pass 1 fetching behaviour — unchanged
- `deal_mappings` schema — unchanged; 9,797 verified mappings preserved
- `common_aliases` column — kept and still written (used by search/display)
- Real Savings computation — unchanged; Layer 1 reference pool remains per-canonical
  (same weight only — a 5kg canonical's pool is never mixed with 500g prices)
- Substitution suggestion UI — deferred; data model is ready via `product_group_id`
  + `weight_value` + `weight_unit`
- All existing admin endpoints — unchanged
- All existing tests — no breaking changes to public interfaces
