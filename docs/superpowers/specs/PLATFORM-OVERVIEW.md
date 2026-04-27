# Desi Deals 24 — Platform Overview

**Last updated:** 2026-04-28
**Branch:** compare-stores

---

## Vision

A platform where Indian grocery shoppers in Germany can discover deals, build shopping lists, compare the total cost across all online Indian grocery stores, and get notified when prices drop or products come back in stock.

---

## Feature Map

| Feature | Status | Spec |
|---|---|---|
| Cross-store price comparison (cart-level) | Approved | [compare-stores-design](2026-04-18-compare-stores-design.md) |
| Shopping list & cross-store comparison | Approved | [shopping-list-compare-design](2026-04-26-shopping-list-compare-design-DRAFT.md) |
| Crawl architecture (deals, full catalog, on-demand) | Approved | [crawl-architecture-spec](2026-04-26-crawl-architecture-spec.md) |
| Order history & product alerts | Approved | [order-history-and-alerts-design](2026-04-28-order-history-and-alerts-design.md) |
| Search experience | Approved | [search-experience-design](2026-04-28-search-experience-design.md) |
| Admin dashboard | Approved | [admin-dashboard-tabs-canonical-stats-design](2026-04-12-admin-dashboard-tabs-canonical-stats-design.md) |
| Brand management & remap | Approved | [brand-management-remap-design](2026-04-12-brand-management-remap-design.md) |
| Mapped products tab | Approved | [mapped-products-tab-design](2026-04-14-mapped-products-tab-design.md) |
| Manual review queue | Approved | [manual-review-queue-design](2026-04-15-manual-review-queue-design.md) |

---

## How the Pieces Connect

```
User journey:

Search ──────────────────────────────────────────────┐
  └── Auto-suggest (client-side JSON index)           │
  └── Full search results (FTS5, canonical cards)     │
                                                      ▼
                                              Product / Deal page
                                                      │
                                    ┌─────────────────┴─────────────────┐
                                    │                                   │
                              Add to cart                        Set alert
                           (anonymous: localStorage)         (price drop / back in stock)
                                    │                                   │
                              Login gate                    Email on next crawl
                          (at "compare prices")
                                    │
                              Shopping List (server-side)
                              + on-demand crawl triggered
                                    │
                              Comparison Result
                              (all stores ranked by total)
                                    │
                              Pick a store → Order
                                    │
                              Order History
                              (accountability self-report + reorder)
```

---

## Architecture Overview

### Crawl Pipeline

Three modes feed a shared ingestion pipeline:

| Mode | Frequency | Scope |
|---|---|---|
| Mode 1: Deals | Daily (GitHub Actions) | Deals sections, all 32 stores |
| Mode 2: Full Catalog | Weekly (GitHub Actions) | All products, Shopify (15) + WooCommerce (10) stores |
| Mode 3: On-Demand | Per shopping list item add | That item across all stores (direct URL or search fallback) |

All modes → Fetcher → Normaliser → Deduplicator → Ingester → Canonicalizer → price_history

Post-crawl: rebuild FTS5 search index + suggest-index JSON + check product alerts.

### Store Coverage

- 32 stores total: 15 Shopify, 10 WooCommerce, 7 Custom
- Custom stores: Mode 1 (deals) only in v1

### Canonical System

Every product maps to a `canonical_products` entry — the store-agnostic identity of a product. Canonicals enable cross-store price comparison, replacement matching, and price history.

Key fields: `canonical_name`, `base_key` (product family), `brand_slots`, `base_product_slots` (token-level spec), `weight_value`, `category`.

---

## Data Model — Key Tables

| Table | Purpose |
|---|---|
| `stores` | 32 stores with platform, URL, shipping info |
| `deals` | All crawled products (deals + catalog items). `is_on_deal`, `crawl_mode`, `is_active`, `external_product_id` |
| `canonical_products` | Store-agnostic product identities. `base_key`, `brand_slots`, `base_product_slots` |
| `deal_price_history` | Price over time per deal |
| `store_shipping` | Flat rate, free threshold, min order value, delivery days per store |
| `shopping_lists` | Named, persistent lists per user |
| `shopping_list_items` | Items: brand-specific (`canonical_id`) or brand-agnostic (`base_key`) |
| `comparison_sessions` | Snapshot of every comparison run. Doubles as order history when `order_intent_at` is set |
| `product_alerts` | One-shot price-below and back-in-stock alerts per user |
| `store_crawl_state` | Per-store crawl progress and cursor for resumable full catalog crawl |
| `pending_on_demand_crawls` | DB-backed queue for on-demand crawl restart resilience |
| `fts_canonicals` | FTS5 virtual table for full-text product search |

---

## Implementation Dependencies

```
1. Crawl architecture (Mode 2 + Mode 3)     ← prerequisite for everything below
      ↓
2. Shopping list & comparison                ← needs Mode 3 on-demand crawl
      ↓
3. Order history                             ← extends comparison_sessions
   Product alerts                            ← needs post-crawl hook
   Search experience                         ← needs FTS5 index + suggest index
```

Items in step 3 are independent of each other and can be built in parallel.

---

## Key Cross-Cutting Decisions

| Decision | Choice |
|---|---|
| Deduplication key | `store_id + external_product_id` (Shopify/WooCommerce); `store_id + product_url` fallback |
| Multi-pack weight | Stored as total weight (5×2kg → 10kg). `weight_raw` preserves "5×2kg" for display. Minimum purchasable unit = whole pack. |
| Title normalisation | BBD/expiry keywords + "Sale Item" suffix stripped in `canonical-decomposer.js` before canonical matching |
| Fake deal filter | `FAKE_DEAL_THRESHOLD_PP = 7%` — deals where stated discount deviates >7pp from computed are excluded |
| Market median fallback | Canonical median → base_key median → category average → unpriced (never €0) |
| `deals` rename | `deals` → `store_products` rename deferred to a separate PR |
| Anonymous cart | localStorage (`dd24_cart_v1`), merged to server-side on login |
| Login gate | Required at "compare prices" — highest-intent moment |
| Single store ordering | One store per order. No split-order across stores. |
| Alert lifecycle | One-shot — fires once, deleted. User re-sets if needed. |
| Search engine | FTS5 (server) + client-side JSON index (auto-suggest). Meilisearch as future upgrade path. |
