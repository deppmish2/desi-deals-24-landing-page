# How Canonical Mapping and Product Replacements Work

_Plain-language walkthrough. Technical reference: `crawl-pipeline.md`._

---

## Part 1 — What Happens After a Deal Is Crawled

### Step 1: The scraper fetches raw product data

Each store adapter (e.g. `crawler/stores/jamoona.js`) calls the store's API or HTML page and returns a list of product objects:

```
product_name: "TRS Toor Dal 2kg"
sale_price:   4.99
original_price: 6.49
weight_value: 2000
weight_unit:  "g"
product_url:  "https://jamoona.de/products/trs-toor-dal-2kg"
```

The crawler normalises these into a consistent format (parses weight, computes `price_per_kg`, maps to one of 16 categories via keyword rules).

### Step 2: The deal is saved to the database

The deal row is inserted into the `deals` table with `is_active=1`. If the same product URL already exists with a different price, the old row is set `is_active=0` and a new row is inserted — deals are never deleted.

At this point `deals.canonical_id` is NULL. The deal is visible in the app but has no "identity" yet — it's just a raw price entry tied to a store.

---

## Part 2 — Canonical Products: What Are They?

A **canonical product** is the shared identity behind all the different ways stores list the same thing.

Example:
- Jamoona sells "TRS Toor Dal 2kg" for €4.99
- Dookan sells "TRS Arhar Dal 2.0kg" for €5.49
- Little India sells "TRS Tur Daal 2 kg" for €5.19

All three are the same product. They each have a deal row, but they share **one canonical product** row — "TRS Toor Dal 2kg" with `id='trs-toor-dal-2kg'`.

The canonical row stores:
- The clean, normalised product name
- A category
- **Slot arrays**: decomposed token groups used for matching
  - `brand_slots`: `[["trs"]]`
  - `base_product_slots`: `[["toor"],["dal"]]`
  - `weight_value`/`weight_unit`: `2000`, `"g"`
- A `base_key`: a catalog-level identifier (e.g. `"toor dal"`) that groups this product with other toor dal products across brands

Once a deal has a canonical ID, it can participate in Real Savings calculations and show product replacements.

---

## Part 3 — How a Deal Gets Matched to a Canonical

Two matching passes happen on every crawl, in sequence.

### Pass A — Slot matching (fast, during the crawl)

Before the crawl loop starts, all **priority canonicals** are loaded into memory. A priority canonical is one marked `is_match_priority=1` with a non-null `brand_slots`.

Each canonical's slot arrays are pre-compiled into regex patterns:
- `brand_slots: [["trs"]]` → regex `/trs/`
- `base_product_slots: [["toor"],["dal"]]` → two regexes: `/toor/` and `/dal/`

When a new deal is scraped, its product name is normalised (lowercased, punctuation stripped) and tested against every priority canonical's regexes:

> "TRS Arhar Dal 2.0kg" → normalised: "trs arhar dal"
>
> Test against "TRS Toor Dal 2kg":
> - `/trs/` matches ✓
> - `/toor/` — "toor" is NOT in "trs arhar dal" ✗ → no match

> Test against "TRS Toor Dal 500g":
> - `/trs/` ✓
> - `/toor/` ✓
> - `/dal/` ✓
> - Weight: canonical=500g, deal=2000g → ratio=4.0, outside ±10% window → no match

The weight check catches size variants — a 500g canonical won't match a 2kg deal, even if all the text tokens match. This is intentional: each size is a separate canonical.

A match writes a `deal_mappings` row (`match_method='slot_match'`, `confidence=0.85`) and stamps `deals.canonical_id`.

### Pass B — Fuzzy canonicalization (post-crawl, for leftovers)

After all stores are done, `canonicalizeDeals()` runs on every active deal that still has no canonical.

**How it normalises:** strips weight values, units, qualifiers (organic, premium, split, whole), BBD dates, packaging words. "TRS Arhar Dal 2kg Best Before 06/26" → "trs arhar dal".

**How it matches:** compares the normalised deal name against every `canonical_name` in the DB using a combined similarity score:
- Levenshtein edit distance (character-level similarity)
- Consonant skeleton matching (phonetic similarity — "haldi" ↔ "haldi")
- Token overlap (how many words match)

The highest score wins.

**Decision:**

| Score | Action |
|---|---|
| Exact (1.0) | Map immediately |
| ≥ 0.90 | Map as fuzzy match |
| < 0.90 | Add to `entity_resolution_queue` for admin review |

When an admin reviews and confirms a queue item, the system fuzzy-matches all other pending items in the same category against the new canonical and auto-confirms any ≥0.90 matches — cascading the confirmation.

---

## Part 4 — How a New Canonical Is Created

Three routes lead to a new canonical row.

### Route 1: Auto-created on first encounter

When a deal in Pass B has no match and scores < 0.90, it hits `createCanonical()`:
- A slug ID is built from the name: "TRS Toor Dal 2kg" → `"trs-toor-dal-2kg"`
- The name is decomposed into slot arrays via `decomposeCanonical()`:
  - Strips weight and BBD patterns
  - Identifies the brand token by checking the name against the `known_brands` table
  - Remaining tokens become `base_product_slots`
- A `base_key` is resolved from the product name via `resolveBaseProduct()` (looks it up in a CSV catalog of ~1,000 common Indian grocery items)
- Row inserted with `is_match_priority=1` — immediately eligible for slot-matching in the next crawl

### Route 2: Admin review queue

Unmatched deals queue up in `entity_resolution_queue`. An admin can:
- **Confirm to existing canonical**: writes `deal_mappings`, stamps `deals.canonical_id`
- **Create new canonical**: fills in name, brand, base product, type, category → system decomposes slots and creates the row

### Route 3: Bootstrap pipeline (bulk AI seeding)

For large batches of unmapped products, an OpenAI batch job proposes canonical names and slots. Admin reviews and promotes staging rows to `canonical_products`.

---

## Part 5 — How Product Replacements Work

When a user is on a deal page or the compare-stores screen, the app fetches replacement suggestions. These come from two separate endpoints.

### Same-store replacements (`GET /api/v1/deals/replacements`)

`product-replacements.js` → `getReplacements(db, { canonicalId, storeId, dealId })`

The function loads all active, canonical-linked deals for the given store, then classifies each one into a tier based on how closely it matches the source product:

**T1 — Same Pack (relevance 1.0)**

Same brand, same exact product specification, different size.

"TRS Toor Dal 2kg" → T1 candidate: "TRS Toor Dal 500g"

How it detects this:
- Same brand (detected via `detectBrandForBase()` from the CSV catalog, or falls back to `brand_slots[0][0]`)
- Exact `base_product_slots` token-set equality (so "TRS Toor Dal Whole" and "TRS Toor Dal Split" are NOT T1 — their slot sets differ)
- Different `canonical_id` (not the exact same product)
- Different weight value
- Size must divide evenly: 500g divides into 2000g, so T1 ✓. 700g does not divide into 2000g, so filtered out.

**T2 — Same Spec, Different Brand (relevance 0.85)**

Cross-brand alternative for the exact same product.

"TRS Toor Dal 2kg" → T2 candidate: "Heera Toor Dal 2kg"

How it detects this:
- Exact `base_product_slots` token-set match (both have `["toor"]["dal"]`)
- OR: both share the same catalog `base_key` (e.g. both resolve to `"toor dal"`) AND same category — handles Hindi/English name differences ("Mung Sabut Whole" and "TRS Mung Beans" both map to `"moong dal yellow"`)
- Candidate must NOT be the same brand (guard prevents same-brand items leaking here)
- Size must divide evenly

**T3 — Same Brand, Different Variant (relevance 0.65)**

Same brand, related product (e.g. different preparation style or flour type).

"Heera Urid Dal Flour 500g" → T3 candidate: "Heera Urid Dal Flour Roasted 500g"

How it detects this:
- Same brand
- Same catalog `base_key` OR one product's slot-set is a subset of the other's (catches variants like "extra long" vs "original" or "roasted" variants)
- Size must divide evenly

**T4 — Same Category (relevance 0.4)**

Anything else in the same category. Always included alongside T1/T2/T3 (not a fallback — T4 always emits even when higher tiers have results). Displayed collapsed as a "N more from this category" pill. No size gate — larger packs are valid suggestions here.

**Sort order within each tier:**
- T1: weight ascending (smallest pack first)
- T2, T3, T4: `price_per_kg` ascending, fallback `sale_price` ascending — best value first

**Fake-deal filter (SQL level):**

Deals with inflated `discount_percent` (arithmetic discount differs from claimed discount by >10 percentage points) are filtered out before any tier evaluation. Deals without an `original_price` pass through (no discount claim to verify).

---

### Cross-store "same product" (`GET /api/v1/deals/same-product-other-stores`)

Answers: "Where else can I buy this same product at other stores?"

Uses `canonical_products.base_key + category` to find all canonicals that represent the same catalog base product, regardless of which canonical ID each store uses. For example, all stores' "toor dal" products share `base_key='toor dal'`, so this query surfaces all of them.

```sql
SELECT d.*, s.name AS store_name
FROM deals d
JOIN canonical_products cp ON cp.base_key = ? AND cp.category = ?
JOIN stores s ON s.id = d.store_id
WHERE d.is_active = 1 AND d.store_id != ?
  AND d.canonical_id = cp.id
ORDER BY d.price_per_kg ASC NULLS LAST, d.sale_price ASC
```

The `category` guard prevents cross-category false positives (e.g. a fried snack sharing a base_key with a raw lentil due to a catalog naming issue).

Falls back to exact `canonical_id` match when `base_key` is null.

---

## Part 6 — The base_key System

`base_key` is a catalog-level identifier that groups semantically equivalent products regardless of brand or store naming conventions.

It is resolved at write time by `resolveBaseProduct(canonical_name)` in `server/services/base-product-catalog.js`. The catalog is a CSV of ~1,000 common Indian grocery items. Each entry has a `base_key` (e.g. `"toor dal"`), aliases (e.g. "arhar dal", "tur dal", "pigeon peas"), regional misspellings, and known brand names.

`resolveBaseProduct("TRS Toor Dal 2kg")`:
1. Normalise the name: `"trs toor dal"`
2. Tokenise: `["trs", "toor", "dal"]`
3. Score each catalog entry's aliases:
   - Exact text match → score 120+
   - Text contains alias → score 100+  ← **known bug: substring, not whole-word**
   - Token overlap → score 60–80
4. Return the highest-scoring entry above threshold 70

Result: `{ base_key: "toor dal", ... }`

The phrase-containment checks at score 100+ and 90+ use `hasWholePhrase()` — a word-boundary-safe regex match — rather than `String.includes()`. This prevents false positives where a catalog alias appears as a substring of an unrelated word (e.g. "haldi" inside "haldiram").

---

## Summary: Data Flow Diagram

```
Store website
    │
    ▼
adapter.scrape()
    │ product_name, price, weight, ...
    ▼
deals table (is_active=1, canonical_id=NULL)
    │
    ├─── Pass A: slot matching ──────────────────────────────────────────┐
    │    loadPriorityCanonicals() once per run                           │
    │    For each deal: test regex against pre-compiled canonical slots  │
    │    Match found → deal_mappings + deals.canonical_id = canon.id ←──┘
    │
    └─── Pass B: fuzzy matching (post-crawl, unmapped only) ──────────────┐
         normalise deal name                                              │
         score against all canonical_names                               │
         ≥0.90 → deal_mappings + deals.canonical_id = canon.id ←────────┘
         <0.90 → entity_resolution_queue (admin review)
                     │
                     ▼
               Admin confirms
                     │
                     ▼
              deal_mappings + deals.canonical_id = canon.id


canonical_products row (once a deal is mapped):
  ├── base_key → cross-store "same product" queries
  ├── brand_slots / base_product_slots → T1/T2/T3 replacement tiers
  ├── category → T4 fallback tier + category guard
  └── weight_value/unit → size-compatible replacement filtering
```

---

## Key Files

| File | What it does |
|---|---|
| `crawler/index.js` | Orchestrates the full crawl cycle |
| `crawler/utils/auto-mapper.js` | Pass A: slot-based matching during crawl |
| `crawler/utils/canonical-decomposer.js` | Name → slot arrays (brand, product, type tokens) |
| `crawler/entity-resolution/index.js` | Pass B: `resolveName()` — exact + fuzzy match |
| `crawler/entity-resolution/fuzzy-matcher.js` | Levenshtein + consonant + token similarity |
| `crawler/entity-resolution/normaliser.js` | Strip weight, qualifiers, dates from product names |
| `server/services/canonicalizer.js` | Pass B orchestrator: `canonicalizeDeals()`, `createCanonical()` |
| `server/services/base-product-catalog.js` | CSV catalog lookup: `resolveBaseProduct()` → `base_key` |
| `server/services/product-replacements.js` | T1/T2/T3/T4 same-store replacement logic |
| `server/routes/deals.js` | `/same-product-other-stores` cross-store endpoint |
| `server/routes/admin-review-queue.js` | Admin confirm/create canonical from queue |
