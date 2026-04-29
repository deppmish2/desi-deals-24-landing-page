# Crawl Pipeline & Canonical Product System

_Last updated: 2026-04-21_

---

## 1. What Triggers a Crawl

| Trigger | When |
|---|---|
| **Daily scheduler** | `0 8 * * *` cron — 08:00 Europe/Berlin (`crawler/scheduler.js`) |
| **Startup crawl** | If `CRAWL_ON_STARTUP=true` env var, runs 2s after server boots |
| **Manual API** | Admin HTTP call → `runCrawl(db, { triggerType: 'manual' })` |

---

## 2. The Crawl Loop (Per Store)

32 store adapters are processed **sequentially** with a 2–5 second delay between each. For every store:

### Step 1 — Scrape
`adapter.scrape()` fetches products and returns normalized deal objects:
```
product_name, store_id, product_url, sale_price, original_price,
discount_percent, price_per_kg, weight_raw, weight_value, weight_unit, ...
```
Adapter types: Shopify JSON API, WooCommerce HTML + Cheerio, HTMX + Cheerio.

### Step 2 — Reconcile (deals table)

| Situation | Action |
|---|---|
| New product URL | INSERT new row (`is_active=1`) |
| Same URL, price changed | Set old `is_active=0`, INSERT new row |
| Same URL, same price | No change |
| Was active, not in today's scrape | Set `is_active=0` (soft-delete) |

Deals are **never hard-deleted**.

### Step 3 — Price History Snapshot (deal_price_history)
- Delete today's existing rows for this store (idempotent re-runs)
- INSERT one snapshot row per product with today's price, price_per_kg
- `is_deal=1` if `original_price > sale_price` (on promotion) — critical for baseline calculation

### Step 4 — Slot-based Auto-map (deal_mappings)
Newly inserted deals are immediately matched against canonical products. See Section 4.

### Step 5 — Record Store Result (crawl_store_results)
One metadata row: inserted/updated/unchanged/removed counts, category distribution, error message.

---

## 3. DB Tables Written Per Crawl

| Table | What changes |
|---|---|
| `crawl_runs` | 1 new row (status, timestamps, totals) |
| `crawl_store_results` | 1 row per store |
| `deals` | INSERT new; set `is_active=0` for removed/changed |
| `deal_price_history` | Delete today's rows for store, INSERT fresh snapshot |
| `deal_mappings` | INSERT for slot-matched deals |
| `entity_resolution_queue` | INSERT for unmatched deals |
| `canonical_products` | Aliases updated; rarely new rows |
| `product_groups` | INSERT OR IGNORE if new canonical created |

---

## 4. How a Deal Gets a Canonical

Two passes happen every crawl cycle.

### Pass A — Slot-based matching (during crawl, fast)

Before the crawl loop, all canonicals with `is_match_priority=1` AND `brand_slots IS NOT NULL` are loaded into memory with pre-compiled regexes.

For each new deal, the normalised product name is tested against every priority canonical:
- **All slot groups** (`brand_slots`, `base_product_slots`, `type_slots`) must appear in the deal name
- **Weight must match ±10%** (e.g. canonical=500g → deal must be 450–550g)

Match → `deal_mappings` row (`match_method='slot_match'`, `confidence=0.85`) + `deals.canonical_id` updated.

### Pass B — Fuzzy canonicalization (post-crawl)

`canonicalizeDeals()` runs on every still-unmapped active deal:

1. Normalise the product name (strip weight units, qualifiers, dates, punctuation)
2. Score against every `canonical_name` via combined similarity (Levenshtein + consonant skeleton + token overlap)
3. Decision:

| Score | Action |
|---|---|
| Exact match | Map → `method='exact'`, `confidence=1.0` |
| Fuzzy ≥ 0.90 | Map → `method='fuzzy'` |
| < 0.90 | Queue in `entity_resolution_queue` for admin review |

---

## 5. deal_mappings vs deals.canonical_id

Both exist for different reasons:

| | Purpose |
|---|---|
| `deal_mappings` | Audit trail — stores method, confidence, verified_at |
| `deals.canonical_id` | Denormalised cache for fast read queries |

Every mapping write must update **both**. If they drift, deals appear unmapped in the UI but have a mapping row in the DB.

---

## 6. How Canonical Products Are Created

### Route A — Auto-created during canonicalization
When a deal has no match, `createCanonical()` builds a new canonical row from the deal name:
- Decomposes into `brand_slots`, `base_product_slots`, `type_slots` via `decomposeCanonical()`
- Sets `is_match_priority=1` immediately (eligible for next crawl's slot-matching)
- Creates a `product_groups` row

### Route B — Bootstrap pipeline (bulk AI seeding)
```
Unmapped products
  → bootstrap_product_queue      (queued for processing, deduped by norm_name)
  → canonical_bootstrap_staging  (AI proposes: name, brand, type, weight, aliases, confidence)
  → Admin reviews (needs_review=1 rows)
  → canonical_products           (promoted=1 → row created + deal_mappings written)
```
`canonical_bootstrap_source_products` links each staging row back to the raw deals that sourced it.

### Route C — Admin panel
Manual creation or edit via admin dashboard. Entity resolution queue items can be confirmed (creates mapping) or dismissed.

---

## 7. Canonical Fields That Matter

| Field | Role |
|---|---|
| `brand_slots` | `[["heera","heer"]]` — brand token synonym groups |
| `base_product_slots` | `[["soan"],["papdi"]]` — product token groups |
| `type_slots` | `[["split"],["hulled"]]` — variant tokens |
| `weight_value` / `weight_unit` | Normalised weight in base units (g or ml) |
| `product_group_id` | Token-joined slug for cross-brand grouping |
| `is_match_priority` | `1` = loaded into memory every crawl for slot-matching |
| `verified` | `0` = auto-created, `1` = admin-confirmed |

---

## 8. How Canonicals Power Features

### Real Savings
Uses 90 days of `deal_price_history` grouped by `canonical_id`:
- Requires ≥3 price observations across ≥2 stores
- Computes median `price_per_kg` as the baseline
- Current deal vs baseline → real discount %
- ≥25% → **Great**, ≥15% → **Good**, ≥5% → **Low**, else no badge

### Product Replacements (compare-stores)
Two separate API calls from the frontend:

**Same-store (`GET /replacements`)** — `server/services/product-replacements.js` `getReplacements()`. Four tiers, all within the same store:

| Tier | Logic |
|---|---|
| T1 | Same brand, different size (exact slot match) |
| T2 | Different brand, same base product — primary: exact `base_product_slots` set equality; fallback: catalog `base_key` match **with `sameCategory` guard** (handles Hindi/English terminology differences, e.g. "Mung Sabut Whole" ↔ "TRS Mung Beans" both → `"moong dal yellow"`; category guard prevents fried snacks matching raw lentils via shared `base_key`) |
| T3 | Same brand + same product group (via catalog `base_key` or slot subset); catches variants like "extra long" vs "original" |
| T4 | Same category fallback |

**Cross-store (`GET /same-product-other-stores`)** — `server/routes/deals.js`. SQL JOIN on `canonical_products.base_key = ? AND canonical_products.category = ?`. Expands to all canonicals sharing the same catalog base product, with a **category guard** to prevent cross-category false positives (e.g. snack vs raw lentil). Falls back to exact `canonical_id` match when `base_key` is null.

`canonical_products.base_key` — TEXT column populated by `resolveBaseProduct(canonical_name)` at write time (canonicalizer, admin-review-queue, brand remap). Indexed (`idx_canonical_base_key`). 3,003 of 14,598 canonicals have a non-null `base_key` (catalog coverage limited to ~1,000 common grocery items).

---

## 9. entity_resolution_queue — Coverage Gap Meter

Every deal that fails to auto-match lands here (`status='pending'`). The pending count is a direct measure of how many products are invisible to real savings and replacements.

Admin actions:
- **Confirm** → writes `deal_mappings`, updates `deals.canonical_id`, closes item
- **Dismiss** → marks ignored

---

## 10. Key Source Files

| File | Role |
|---|---|
| `crawler/index.js` | Main orchestrator — `runCrawl()` |
| `crawler/scheduler.js` | Cron + startup trigger |
| `crawler/utils/auto-mapper.js` | Slot-based matching — `loadPriorityCanonicals()`, `autoMapDeals()` |
| `crawler/utils/canonical-decomposer.js` | `decomposeCanonical()` — name → slots |
| `server/services/canonicalizer.js` | Fuzzy pass — `canonicalizeDeals()`, `createCanonical()` |
| `server/services/price-history-recorder.js` | `recordStoreHistory()` |
| `server/services/real-savings.js` | `batchGetRealSavings()`, `computeRealSavings()` |
| `server/services/product-replacements.js` | `getReplacements()` — T1/T2/T3/T4 logic; T2 uses `base_key` fallback for Hindi/English term differences |
| `server/services/base-product-catalog.js` | `resolveBaseProduct(name)` — maps product name → `base_key` via CSV catalog; lazy-loaded cache |
| `crawler/utils/category-mapper.js` | `mapCategory()` — keyword-based; `SNACK_PHRASES` pre-check prevents fried dal snacks from matching lentil keywords |
| `scripts/backfill-base-product-slots.js` | Retroactive slot decomposition |
