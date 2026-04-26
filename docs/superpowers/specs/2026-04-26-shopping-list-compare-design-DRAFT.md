# Shopping List & Cross-Store Price Comparison — Design Spec (DRAFT)

**Date:** 2026-04-26
**Branch:** compare-stores
**Status:** DRAFT — blocked pending crawl architecture spec
**Prerequisite:** `2026-04-26-crawl-architecture-spec.md` must be completed first

---

## Blocker

This feature requires expanded crawl coverage (Mode 2: priority catalog crawl, Mode 3: full catalog crawl) before it can be built. The comparison cannot produce accurate totals if only deal-section prices are known. See crawl architecture spec.

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
| Pack size equivalence | Auto-calculate (2 × 1kg = 2kg). Clearly shown. User can override. | System does the work. User stays informed. |
| Store comparison totals | Two numbers: Confirmed total (items store actually has) + Estimated total (confirmed + market median for missing items) | Fair apples-to-apples comparison. Estimates clearly flagged. Never hidden. |
| Single store vs split order | Single store only | One checkout, one delivery fee, one delivery window. Splitting erodes savings and adds complexity. |
| Sorting | By estimated total / confirmed total / coverage % / delivery time | User chooses their priority. |
| Delivery data | Manually entered per store (~30-50 stores). Crawlable later. | Manageable at current scale. |
| Minimum order value | Must be captured per store in store_shipping table. Surfaced prominently — a store below minimum is effectively unavailable. | Critical for comparison accuracy. |
| Order tracking | Intent-based: record comparison snapshot + "order intent" event when user clicks order. Self-report on return ("did you complete your order?"). | Platform cannot see store checkout. Honest about what we can know. |
| Order history | Linked to shopping list. Shows store, price snapshot, date, self-reported status. | Enables "resume last comparison" and learning. |
| Self-report data | Ordered? / Items all available? / Why not ordered? (one-tap) | Store reliability signal, price accuracy signal, conversion funnel data. |
| Price freshness | Targeted crawl triggered when item added to list (post-login). Fetches latest price and availability across all stores. Updates deals table and price history. | Data is always fresh for listed items by the time user compares. Crawl age not an issue. |
| Crawl states per item | Active deal → crawl URL, get fresh price. Inactive deal → crawl URL, check if back in stock. Never listed → show as not available. | Covers all states cleanly. |
| Naming | New code uses `store_products` mental model. Existing `deals` table rename is a separate PR. | Rename touches every file — isolate as a focused low-risk refactor. |
| Crawl expansion | Separate prerequisite spec. Three modes: deals (existing), priority catalog (~1,000 items), full catalog (weekly). Plus on-demand (triggered by list addition). | Shopping list comparison requires product prices beyond deals sections. |

---

## Three-Tier Architecture

```
Tier 1: Shopping List (server-side, canonical-level, persistent)
  └── What the user WANTS, independent of any store or price
  └── Items: canonical_id (brand-specific) OR base_key + weight (brand-agnostic)
  └── Named, reusable, multiple lists per user
  └── Triggers targeted crawl on item addition (post-login)

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

## Data Model (draft — to be finalised after crawl architecture spec)

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

## Comparison Logic (draft)

For each store, for each shopping list item:

1. **Brand-agnostic item**: find cheapest active `store_product` matching `base_key` + weight equivalence at this store → **confirmed**
2. **Brand-specific item, store has it**: use current price → **confirmed**
3. **Brand-specific item, store has replacement (T1/T2)**: do NOT auto-substitute. Use market median → **estimated**. Surface replacement option to user manually.
4. **Any item, store never listed it**: use canonical market median price → **estimated**
5. **Pack size mismatch**: calculate equivalent quantity (2 × 1kg for 2kg request). Show clearly. User can override.

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
4. Targeted crawl triggered for each item across all stores
5. Comparison computed and displayed

---

## Out of Scope (this spec)

- Split-order across multiple stores
- Real-time stock check (beyond targeted crawl)
- Store reliability scoring (future — built from self-report data)
- Price alerts ("notify me when my list is under €X")
- Full `deals` → `store_products` rename (separate PR)
- Full catalog crawl architecture (prerequisite spec — do first)

