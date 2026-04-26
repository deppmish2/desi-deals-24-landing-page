# Crawl Architecture — Design Spec

**Date:** 2026-04-26
**Branch:** compare-stores
**Status:** APPROVED
**Unblocks:** `2026-04-26-shopping-list-compare-design-DRAFT.md`

---

## Goal

Expand crawl coverage from deals-section-only (Mode 1) to full catalog and on-demand product lookup, so the shopping list price comparison can produce accurate totals across all stores — not just for products currently on deal.

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Crawl modes | Three modes: Deals, Full Catalog, On-Demand | Each serves a distinct need with different frequency and scope |
| Platform crawlers | Generic Shopify + WooCommerce crawlers, not per-store | 25 of 32 stores share these platforms; per-store is unscalable |
| Custom stores | Mode 1 only for v1 | 7 stores; building generic crawlers for unknown CMS is high effort / low volume |
| Dedup key | `store_id + external_product_id` primary; `store_id + product_url` fallback | Shopify/WooCommerce native IDs are stable; URL handles can encode sale/batch suffixes |
| On-demand execution | In-process async + DB-backed queue | Server is persistent Node process; GH Actions cold start (10-30s) too slow for UX. DB queue gives restart resilience without new infra |
| On-demand UX | Stale-while-revalidate, client polls 3s, 30s timeout | User sees cached prices immediately; fresh prices appear when crawl completes |
| Search fallback | Mode 3b: search with `base_key` tokens when no URL known | Distinguishes "genuinely unavailable" from "not in deals section". Improves coverage over time |
| Search token strategy | `base_key` tokens only — no brand or weight | Brand+weight too specific; canonicalization filters bad matches after results arrive |
| Title normalisation | Existing `canonicalizeDeals()` post-crawl step covers all modes | BBD stripping + "Sale Item" stripping in `canonical-decomposer.js`; no new code needed |
| `is_on_deal` flag | Added to `deals` table | A product can exist at a store without being on deal; these must be distinguished for comparison |
| Mode 2 scheduling | GitHub Actions weekly (same pattern as Mode 1) | No new infra; separate workflow file |
| `deals` rename | Out of scope — separate PR | Rename touches every file; isolate as focused low-risk refactor |

---

## Three Crawl Modes

```
Mode 1: Deals (existing)
  Trigger:   GitHub Actions — daily 08:00 Europe/Berlin
  Scope:     Deals sections only — all 32 stores
  Adapters:  Existing per-store adapters (unchanged)
  Output:    Active deals with is_on_deal = 1

Mode 2: Full Catalog (new)
  Trigger:   GitHub Actions — weekly
  Scope:     All products at Shopify (15) and WooCommerce (10) stores
  Adapters:  ShopifyFullCatalogCrawler, WooCommerceFullCatalogCrawler (new, generic)
  Output:    All products with is_on_deal = 0|1

Mode 3: On-Demand (new)
  Trigger:   User adds item to shopping list (post-login)
  Scope:     That item across all stores
  Sub-modes:
    3a — Direct: item has known product_url at store → fetch URL directly
    3b — Search: no known URL → search store with base_key tokens → canonicalize results
  Output:    Fresh price for that canonical at each store; or confirmed unavailable
```

---

## Platform Crawlers

### Shopify Full Catalog (Mode 2)

```
Endpoint:   GET /products.json?limit=250&page_info=<cursor>
Pagination: Link header → next page_info cursor
Auth:       None (public storefront)
Product ID: product.id (integer — stable dedup key)
Deal check: product.variants[].compare_at_price > product.variants[].price → is_on_deal = 1
Resumable:  cursor stored in store_crawl_state.catalog_cursor
```

### Shopify On-Demand Search (Mode 3b)

```
Endpoint:   GET /search/suggest.json?q=<base_key_tokens>&resources[type]=product&resources[limit]=10
Returns:    resources.results.products[]
Match:      Canonicalize each result title → accept if canonical_id matches
```

### WooCommerce Full Catalog (Mode 2)

```
Endpoint:   GET /wp-json/wc/v3/products?per_page=100&page=N&status=publish
Auth:       Consumer key + secret (store config) or public if available
Product ID: product.id (integer)
Deal check: product.sale_price set and < product.regular_price → is_on_deal = 1
```

### WooCommerce On-Demand Search (Mode 3b)

```
Endpoint:   GET /wp-json/wc/v3/products?search=<base_key_tokens>&per_page=10
Match:      Canonicalize each result → accept if canonical_id matches
```

---

## Shared Ingestion Pipeline

All three modes use the same pipeline after fetching raw product data:

```
Fetcher
  └── Raw product data (title, price, URL, external_product_id)
      │
      ▼
Normaliser
  └── Weight extraction, currency normalisation, availability flag
      │
      ▼
Deduplicator
  └── Resolve dedup key → upsert or insert
      Key: store_id + external_product_id  (Shopify / WooCommerce)
      Key: store_id + normalise(product_url) (custom stores / fallback)
      │
      ▼
Ingester
  └── Upsert into deals table
      Update: sale_price, is_on_deal, last_crawled_at, crawl_mode
      Create: new row if not seen before
      │
      ▼
Canonicalizer  (existing canonicalizeDeals())
  └── Title normalisation: strip BBD + "Sale Item" suffixes (canonical-decomposer.js)
      Resolve canonical_id → create canonical if new product
      │
      ▼
price_history recorder
  └── Append to deal_price_history (existing)
```

**Title normalisation note:** `canonical-decomposer.js` strips BBD/expiry keywords, date fragments, and `"- Sale Item"` suffixes before tokenisation. This is called inside `canonicalizeDeals()`. All three crawl modes feed through this step automatically — no per-mode normalisation needed.

---

## Data Model Additions

### `deals` table — new columns

```sql
ALTER TABLE deals ADD COLUMN crawl_mode TEXT DEFAULT 'deal';
  -- 'deal' | 'catalog' | 'on_demand'

ALTER TABLE deals ADD COLUMN is_on_deal INTEGER DEFAULT 0;
  -- 1 = sale price active, 0 = regular price

ALTER TABLE deals ADD COLUMN last_crawled_at TEXT;
  -- ISO timestamp, updated on every crawl pass

ALTER TABLE deals ADD COLUMN external_product_id TEXT;
  -- Shopify integer product_id or WooCommerce post_id
  -- Used as primary dedup key; NULL for custom store products
```

### New `store_crawl_state` table

```sql
CREATE TABLE store_crawl_state (
  store_id            TEXT PRIMARY KEY REFERENCES stores(id),
  last_deal_crawl     TEXT,
  last_catalog_crawl  TEXT,
  catalog_cursor      TEXT,   -- Shopify page_info for resumable full catalog crawl
  crawl_status        TEXT CHECK (crawl_status IN ('idle','running','error')),
  error_message       TEXT,
  updated_at          TEXT NOT NULL
);
```

### New `pending_on_demand_crawls` table

```sql
CREATE TABLE pending_on_demand_crawls (
  id            TEXT PRIMARY KEY,
  canonical_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  queued_at     TEXT NOT NULL,
  started_at    TEXT          -- set when crawl begins; NULL = still queued
);
```

On server startup: drain any rows where `started_at IS NULL` from a prior restart.

---

## On-Demand Crawl Flow

```
1. User adds item to shopping list (POST /api/v1/shopping-list/items)
2. Server:
   a. Saves item to shopping_list_items
   b. Writes row to pending_on_demand_crawls
   c. Fires unawaited Promise → runOnDemandCrawl(canonical_id)
   d. Returns { saved: true, prices: <cached>, freshness: 'stale', revalidating: true }

3. runOnDemandCrawl(canonical_id) — for each store:
   a. Has known product_url?  → Mode 3a: fetch URL directly
   b. No known URL?           → Mode 3b: search with base_key tokens
      → result found + canonicalizes correctly → ingest, link canonical_id
      → result not found → mark store as confirmed_unavailable for this canonical

4. On completion: update pending_on_demand_crawls row (delete or mark done)
   Notify via SSE or next poll response: { freshness: 'fresh', revalidating: false }

5. Client polls GET /api/v1/shopping-list/prices?list_id=X every 3s while revalidating: true
   Timeout: 30s → show cached prices with "last updated [date]" label
```

---

## Unavailability Signal Quality

| State | Meaning | Price used in comparison |
|---|---|---|
| Active deal found | Store has it, currently on deal | Confirmed — deal price |
| Catalog product found (is_on_deal=0) | Store has it, not on deal | Confirmed — regular price |
| Search found + canonicalized | Store has it, discovered via search | Confirmed — search result price |
| Search ran, no match | Store genuinely does not carry it | Estimated — market median |
| Never crawled, no search yet | Unknown | Estimated — market median (flagged) |

---

## Scheduling

| Mode | Mechanism | Frequency |
|---|---|---|
| Mode 1 (Deals) | Existing GitHub Actions workflow | Daily 08:00 Europe/Berlin |
| Mode 2 (Full Catalog) | New GitHub Actions workflow | Weekly (Sunday 02:00 Europe/Berlin) |
| Mode 3 (On-Demand) | In-process async, `pending_on_demand_crawls` queue | Per shopping list item add |

---

## Out of Scope (this spec)

- Custom store full catalog (7 stores, no common platform)
- `deals` → `store_products` rename (separate PR)
- WooCommerce auth credential management (store config UI)
- Crawl rate limiting / politeness delays (inherit from existing adapter defaults)
- Store reliability scoring from crawl success/failure data
