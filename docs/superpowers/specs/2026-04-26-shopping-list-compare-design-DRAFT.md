# Shopping List & Cross-Store Price Comparison — Design Spec

**Date:** 2026-04-26
**Branch:** compare-stores
**Status:** APPROVED
**Prerequisite:** `2026-04-26-crawl-architecture-spec.md` — completed

---

## Goal

Let users build persistent, named shopping lists of Indian grocery products, then compare the total cost of that list across all crawled German Indian grocery stores — sorted by price, coverage, and delivery time — and proceed to order from a single store.

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | Three-tier: Shopping List → Comparison Result → Order | Clean separation of lifecycles. List is permanent, comparison is ephemeral, order is a snapshot. |
| Cart entry (anonymous) | localStorage, no login required | Lowers barrier to entry. User invests in building list first. |
| Login gate | Required at "compare prices" step | Highest-intent moment. Triggers server-side persistence and targeted crawls. |
| List persistence | Server-side, named, multiple lists per user | Repeat grocery purchases (every 2-4 weeks). Reuse same list with fresh prices each time. |
| Brand flexibility | Per item: brand-agnostic (base_key) or brand-specific (canonical_id) | User declares preference when adding item. Agnostic = cheapest match any brand. Specific = exact brand only. |
| Missing item — brand-agnostic | Auto-match cheapest available at that store | Any match is valid by definition. |
| Missing item — brand-specific | Use market median as estimate, clearly flagged. User manually accepts substitute. | Auto-substitution undermines trust. Price difference between brands can be significant. |
| Market median unavailable | Fallback cascade: canonical median → base_key median → category average → exclude with "price unknown" label. Never substitute €0. | €0 makes estimated total misleadingly low. Incomplete total is shown as "estimated total (X items unpriced)". |
| Pack size equivalence | Auto-calculate (2 × 1kg = 2kg). Clearly shown. User can override. | System does the work. User stays informed. |
| Store comparison totals | Two numbers: Confirmed total (items store actually has) + Estimated total (confirmed + median for missing items). If any item is unpriced, estimated total is labelled incomplete. | Fair apples-to-apples comparison. Estimates clearly flagged. Never hidden. |
| Single store vs split order | Single store only | One checkout, one delivery fee, one delivery window. Splitting erodes savings and adds complexity. |
| Sorting | By estimated total / confirmed total / coverage % / delivery time | User chooses their priority. |
| Delivery data | Manually entered per store (~30-50 stores). Crawlable later. | Manageable at current scale. |
| Minimum order value | Must be captured per store in store_shipping table. Surfaced prominently — a store below minimum is effectively unavailable. | Critical for comparison accuracy. |
| Order tracking | Intent-based: record comparison snapshot + "order intent" event when user clicks order. Self-report on return ("did you complete your order?"). | Platform cannot see store checkout. Honest about what we can know. |
| Order history | Linked to shopping list. Shows store, price snapshot, date, self-reported status. | Enables "resume last comparison" and learning. |
| Self-report data | Ordered? / Items all available? / Why not ordered? (one-tap) | Store reliability signal, price accuracy signal, conversion funnel data. |
| Price freshness | On-demand crawl (Mode 3) triggered when item added to list (post-login). Fetches latest price and availability across all stores via direct URL (3a) or search fallback (3b). | Data is always fresh for listed items by the time user compares. |
| Crawl states per item | 3a: known URL → direct fetch. 3b: no known URL → search with base_key tokens → canonicalize. Not found via search → confirmed unavailable + market median. | Search fallback closes the "never listed" gap; confirmed unavailable is a stronger signal than "not seen in deals". |
| Naming | New code uses `store_products` mental model. Existing `deals` table rename is a separate PR. | Rename touches every file — isolate as a focused low-risk refactor. |
| Crawl expansion | See `2026-04-26-crawl-architecture-spec.md`. Three modes: deals (existing), full catalog (weekly), on-demand (triggered by list addition, with search fallback). | Shopping list comparison requires product prices beyond deals sections. |

---

## Three-Tier Architecture

```
Tier 1: Shopping List (server-side, canonical-level, persistent)
  └── What the user WANTS, independent of any store or price
  └── Items: canonical_id (brand-specific) OR base_key + weight (brand-agnostic)
  └── Named, reusable, multiple lists per user
  └── Triggers on-demand crawl (Mode 3) on item addition (post-login)

Tier 2: Comparison Result (ephemeral, computed on demand)
  └── System resolves list against all stores
  └── Per store: confirmed items, estimated items, coverage %, totals, shipping
  └── Snapshot saved as comparison_session for order history / resume
  └── Sortable by: estimated total, confirmed total, coverage, delivery time

Tier 3: Order (store-specific, created when user picks a store)
  └── Existing cart/Shopify transfer flow from compare-stores spec
  └── Status: pending_confirmation → paid | never_placed
  └── Linked back to shopping list and comparison_session
```

---

## Data Model

### New tables

**`shopping_lists`**
```sql
CREATE TABLE shopping_lists (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_compared_at      TEXT,
  last_order_store_id   TEXT REFERENCES stores(id),
  last_order_total      REAL,
  last_ordered_at       TEXT
);
```

**`shopping_list_items`**
```sql
CREATE TABLE shopping_list_items (
  id              TEXT PRIMARY KEY,
  list_id         TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  canonical_id    TEXT REFERENCES canonical_products(id),  -- brand-specific
  base_key        TEXT,                                     -- brand-agnostic
  brand_flexible  INTEGER NOT NULL DEFAULT 0,              -- 0=brand-specific, 1=brand-agnostic
  desired_weight_value  REAL,
  desired_weight_unit   TEXT,
  quantity        INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  sort_order      INTEGER
);
```

**`store_shipping`**
```sql
CREATE TABLE store_shipping (
  store_id                TEXT PRIMARY KEY REFERENCES stores(id),
  flat_rate               REAL,
  free_shipping_threshold REAL,
  min_delivery_days       INTEGER,
  max_delivery_days       INTEGER,
  minimum_order_value     REAL,
  updated_at              TEXT NOT NULL,
  notes                   TEXT
);
```

**`comparison_sessions`**
```sql
CREATE TABLE comparison_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  list_id         TEXT REFERENCES shopping_lists(id),
  created_at      TEXT NOT NULL,
  selected_store_id     TEXT REFERENCES stores(id),
  order_intent_at       TEXT,     -- when user clicked "order from store X"
  self_report_status    TEXT CHECK (self_report_status IN ('ordered','not_ordered','still_deciding')),
  self_report_reason    TEXT,     -- why_not: price_higher|items_missing|changed_mind|website_issue|ordered_elsewhere
  items_all_available   INTEGER,  -- 1=yes, 0=no (self-reported)
  snapshot_json         TEXT NOT NULL  -- full comparison result at time of session
);
```

---

## Comparison Logic

For each store, for each shopping list item:

1. **Brand-agnostic item**: find cheapest active product matching `base_key` + weight equivalence at this store → **confirmed**
2. **Brand-specific item, store has it**: use current price → **confirmed**
3. **Brand-specific item, found via search (Mode 3b)**: use search result price → **confirmed**
4. **Brand-specific item, store has T1/T2 replacement only**: do NOT auto-substitute. Use market median → **estimated**. Surface replacement option to user manually.
5. **Any item, search ran + no match found**: store confirmed does not carry it. Use market median → **estimated**
6. **Pack size mismatch**: calculate equivalent quantity (2 × 1kg for 2kg request). Show clearly. User can override.

**Availability signal quality (best → worst):**

| State | Source | Used as |
|---|---|---|
| Active deal found | Mode 1 crawl | Confirmed — deal price |
| Catalog product found | Mode 2 crawl | Confirmed — regular price |
| Found via search | Mode 3b crawl | Confirmed — search result price |
| Not found via search | Mode 3b ran, no match | Estimated — market median (strong unavailable signal) |
| Search not yet run | On-demand pending | Estimated — market median (flagged as stale) |

**Market median fallback cascade** (used whenever a confirmed price is unavailable):

1. Canonical market median — median sale price across all stores that have ever carried this exact canonical
2. base_key market median — median price-per-kg across all canonicals sharing the same `base_key`, normalised to requested weight
3. Category average — average price-per-kg for the canonical's category, normalised to requested weight
4. None available → item marked **unpriced**, excluded from estimated total

Items that reach step 4 are listed separately beneath the store total as "X items could not be priced". The estimated total label shows "(Y items unpriced)" so the user knows the number is a floor.

**Store total:**
- `confirmed_total` = sum of confirmed item prices
- `estimated_total` = confirmed_total + sum of estimated item prices
- `shipping_cost` = flat_rate (or 0 if confirmed_total >= free_shipping_threshold)
- `confirmed_total_with_shipping` = confirmed_total + shipping_cost
- `estimated_total_with_shipping` = estimated_total + shipping_cost
- Check: if `confirmed_total < minimum_order_value` → store marked as **order not possible**

**Sorting options:**
- Estimated total with shipping (default — fairest comparison)
- Confirmed total with shipping (what you pay today)
- Coverage % (items confirmed / total items)
- Delivery time (min_delivery_days ascending)

---

## On-Demand Crawl UX

1. User adds item to list (post-login) → server queues Mode 3 crawl, returns `{ freshness: 'stale', revalidating: true }`
2. Client shows cached prices with "updating prices…" indicator
3. Client polls GET `/api/v1/shopping-list/prices?list_id=X` every 3s
4. Crawl completes → `{ freshness: 'fresh', revalidating: false }` — prices update in place
5. Timeout: 30s → show stale prices with "last updated [date]" label

---

## Order History & Learning

- Every comparison run saves a `comparison_session` with a full snapshot
- "Order intent" recorded when user clicks "Order from Store X"
- On next session: prompt "Did you complete your order at [Store]?" + "Were all items available?"
- If not ordered: one-tap reason capture
- Data uses: store reliability scores, price accuracy tracking, conversion funnel analysis, crawl priority signals

---

## Anonymous → Authenticated Flow

1. Anonymous user builds list in localStorage (`dd24_cart_v1` — existing key, existing flow)
2. At "compare prices": login wall
3. On login: localStorage list merged into server-side `shopping_lists` record
4. On-demand crawl (Mode 3) triggered for each item across all stores
5. Stale-while-revalidate: comparison displayed immediately with cached prices, refreshes as crawl completes

---

## Out of Scope (this spec)

- Split-order across multiple stores
- Real-time stock check (beyond on-demand crawl)
- Store reliability scoring (future — built from self-report data)
- Price alerts ("notify me when my list is under €X")
- Full `deals` → `store_products` rename (separate PR)
- Custom store full catalog crawl (7 stores, no common platform — Mode 1 only)
