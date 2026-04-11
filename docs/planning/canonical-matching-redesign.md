# Canonical Matching Redesign — Developer Review Document

**Status:** Awaiting approval before execution  
**Date:** 2026-04-11  
**Scope:** `crawler/utils/auto-mapper.js`, `scripts/seed-priority-canonicals.js`,
`server/db/schema.sql`, `server/db/index.js`, `server/services/canonicalizer.js`,
`crawler/utils/canonical-decomposer.js` (new), `scripts/migrate-canonical-slots.js` (new)

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

### The three root failures

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

---

## 2. Proposed solution

### Token-slot matching (replaces substring alias matching)

Each canonical is described by three independent sets of token slots:

```
brand_slots:        [ ["daawat", "dawat"] ]
base_product_slots: [ ["basmati", "basmatireis"], ["rice", "reis"] ]
type_slots:         [ ["extra"], ["long", "lang", "extralang"] ]
```

A deal matches a canonical if the deal title contains **at least one variant
from every slot group**. Word order does not matter. Weight specs between brand
and product are ignored.

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

### New `product_groups` table

Groups brand-level canonicals for the same base product type. Enables cross-brand
Real Savings comparisons and future price alerts per product type.

```
product_groups: basmati-rice-extra-long
  ├── Daawat Basmati Rice Extra Long
  ├── Heer Basmati Rice Extra Long
  └── (any future brand)
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

CREATE TABLE IF NOT EXISTS product_groups (
  id         TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  category   TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

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
  brandSlots, baseProductSlots, typeSlots, productGroupId
}
```

Logic:
1. Strip weight specs (`5kg`, `10gm`, `2x500ml`), dashes, and BBD notes from
   `canonical_name`
2. First remaining token = brand → `brand_slots[0]`
3. Remaining tokens = base product words → each word becomes its own slot group
   (word-level, not phrase-level, to handle any word order)
4. Brand-free entries from `commonAliases` are distributed into matching slot groups
5. `product_group_id` = slug of the base product name (without brand)

---

### Step 3 — Migration: backfill all 1,337 existing canonicals
**New file:** `scripts/migrate-canonical-slots.js`

Runs once. For every row in `canonical_products`:
- Calls `decomposeCanonical()` to compute slots
- Upserts `brand_slots`, `base_product_slots`, `type_slots`, `product_group_id`
- Upserts into `product_groups`
- Sets `is_match_priority = 1` for all rows (every canonical participates in matching)
- Does NOT touch `is_priority` (Pass 1 scope unchanged)
- Runs in a single transaction; idempotent (safe to re-run)

---

### Step 4 — Seeder: populate slot columns for CSV canonicals
**File:** `scripts/seed-priority-canonicals.js`

Update `buildBrandCanonicals()` to:
- Separate brand misspellings from product variants in the CSV Misspellings column
  (heuristic: if a misspelling fuzzy-matches any known brand name → `brand_slots`;
  else → `base_product_slots`)
- Build word-level slot arrays (not phrases) so matching is order-independent
- Write `brand_slots`, `base_product_slots`, `type_slots`, `product_group_id` on INSERT

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
- New `matchesCanonical(normedTitle, canon)` function using slot set membership
- Legacy alias substring fallback retained for any canonical with NULL slots
  (transition safety — no deals drop during rollout)

---

### Step 6 — Canonicalizer: slots on new canonical creation
**File:** `server/services/canonicalizer.js`

Update `createCanonical()` to call `decomposeCanonical()` and write slot columns
whenever a new canonical is created dynamically from a deal product name.
Future auto-created canonicals immediately participate in slot-based matching.

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
| Migration assigns incorrect slots to a manually curated canonical | Medium | Review all `verified = 1` canonicals before running; migration is logged |
| Brand misspelling heuristic misclassifies variants into wrong slot | Medium | Log every classification; review output before re-seeding |
| Slot matcher produces more false positives than current system | Low–Medium | Run Step 5 in dry-run mode first; compare matched deal counts before/after |
| `ALTER TABLE` on Turso fails silently; columns never created | Low | Verify with `PRAGMA table_info` on Turso after each ALTER |
| Step 7 re-map creates duplicate deal_mappings | Low | `INSERT OR IGNORE` prevents duplicates |

---

## 5. Performance

| Concern | Detail | Impact |
|---|---|---|
| Auto-mapper loads 1,337 canonicals vs 8 today | In-memory ~500KB | Negligible |
| 5,000 deals × 1,337 canonicals × ~5 slot checks per crawl | ~33M `string.includes()` calls | Expected < 5s; benchmark after Step 5 |
| Pass 1 scope | Unchanged — still `is_priority = 1` only (8 rows) | No impact on crawl time |
| Step 7 one-time re-map | Runs offline, not in crawl path | Acceptable one-time cost |

---

## 6. What does NOT change

- `is_priority` flag and Pass 1 fetching behaviour — unchanged
- `deal_mappings` schema — unchanged; 9,797 verified mappings preserved
- `common_aliases` column — kept and still written (used by search/display)
- Real Savings computation — unchanged (benefits automatically from more mappings)
- All existing admin endpoints — unchanged
- All existing tests — no breaking changes to public interfaces
