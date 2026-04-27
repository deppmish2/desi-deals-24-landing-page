# Order History & Product Alerts — Design Spec

**Date:** 2026-04-28
**Branch:** compare-stores
**Status:** APPROVED
**Related specs:** `2026-04-26-shopping-list-compare-design-DRAFT.md`

---

## Goal

**Order History:** Give users a global record of every store they clicked "Order from" on, with accountability prompts (did you order? did items arrive? was the price right?) and a one-tap reorder that loads the same items back into the cart.

**Product Alerts:** Let users subscribe to one-shot email notifications for price drops or back-in-stock events on a specific product, at a specific store or at any store.

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Order history storage | Extend `comparison_sessions` — filter by `order_intent_at IS NOT NULL` | Already captures snapshot, store, intent, self-report. No new table needed. |
| Order history scope | Global feed across all sessions, sorted by date | No list concept at order level. User can reorder any past order. |
| Order entry detail | Store, date, total, itemised prices + coverage at time of order | Enough to understand what was ordered and whether it was good value. |
| Reorder flow | Parse `snapshot_json` items → load into cart → normal comparison flow | Fresh prices computed on reorder. Old prices shown as reference in history only. |
| Accountability | Mandatory self-report on return: ordered? items available? price right? | Platform cannot see store checkout. Self-report is the only signal we have. |
| Accountability fields | `self_report_status`, `self_report_reason`, `items_all_available`, `price_as_expected` | `price_as_expected` added beyond original spec — closes the "was price accurate?" signal loop. |
| Alert types | Price below threshold + back in stock | Most actionable alert types for grocery shopping. |
| Alert scope | Per product, at a specific store or any store | User controls specificity. |
| Alert lifecycle | One-shot — fires once, email sent, alert deleted | Simple. User re-sets if they want continued monitoring. |
| Notification channel | Email only | No push infra needed. Works without app install. |
| Alert checking | Post-crawl, end of Mode 1 (daily) and Mode 2 (weekly) | Freshest data. No separate scheduled job. Wired into existing crawl pipeline. |
| Back-in-stock detection | Canonical flipped `is_active = 0 → 1` in current crawl pass | Crawl already maintains `is_active`; transition is the signal. |
| Alert creation entry points | Product/deal page + shopping list comparison (unavailable/estimated items) | Both are high-intent moments when user has already expressed interest. |

---

## Order History

### Data Model

No new tables. `comparison_sessions` already captures everything needed.

**Addition to `comparison_sessions`** — one new column:

```sql
ALTER TABLE comparison_sessions ADD COLUMN price_as_expected INTEGER;
-- 1 = yes, 0 = no (self-reported). NULL = not yet answered.
```

**Full accountability fields on `comparison_sessions`:**

| Column | Type | Meaning |
|---|---|---|
| `order_intent_at` | TEXT | When user clicked "Order from Store X" — marks this as an order |
| `self_report_status` | TEXT | ordered / not_ordered / still_deciding |
| `self_report_reason` | TEXT | why_not: price_higher / items_missing / changed_mind / website_issue / ordered_elsewhere |
| `items_all_available` | INTEGER | 1 = yes, 0 = no |
| `price_as_expected` | INTEGER | 1 = yes, 0 = no (new) |

**Order history query:**

```sql
SELECT * FROM comparison_sessions
WHERE user_id = ? AND order_intent_at IS NOT NULL
ORDER BY order_intent_at DESC;
```

### Order History Page

Global feed. Each entry shows:

- Store name + logo
- Date of order intent
- Total paid (from `snapshot_json.confirmed_total_with_shipping`)
- Coverage: X / Y items confirmed
- Self-report status badge (ordered / not ordered / pending)
- Expandable: itemised list — product name, quantity, price at time, confirmed/estimated flag
- **Reorder** button
- **Accountability prompt** (if `self_report_status IS NULL` and order is > 1 day old)

### Accountability Prompt

Shown as a banner/card on the order history page for any order where `self_report_status IS NULL` and `order_intent_at < now - 1 day`.

Three questions, each one-tap:

1. **Did you complete your order?** → Ordered / Not ordered / Still deciding
2. **Were all items available?** *(shown only if ordered)* → Yes / No
3. **Was the price as expected?** *(shown only if ordered)* → Yes / No
4. **Why didn't you order?** *(shown only if not_ordered)* → Price was higher than shown / Items missing / Changed my mind / Website issue / Ordered elsewhere

One question at a time — tap to answer, next question appears. Answers saved immediately.

### Reorder Flow

1. User taps **Reorder** on a history entry
2. System reads `snapshot_json.items` — extracts `canonical_id` (or `base_key` + `brand_flexible`) and `quantity` for each item
3. Items loaded into cart (same structure as shopping list items)
4. User lands on the cart/shopping list page with items pre-filled
5. Normal comparison flow starts — fresh prices fetched via on-demand crawl (Mode 3)
6. Old order shown as a reference card at the top: *"Last ordered from [Store] on [date] for €XX.XX"*

---

## Product Alerts

### Data Model

**New `product_alerts` table:**

```sql
CREATE TABLE product_alerts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_id    TEXT NOT NULL REFERENCES canonical_products(id),
  store_id        TEXT REFERENCES stores(id),  -- NULL = any store
  alert_type      TEXT NOT NULL CHECK (alert_type IN ('price_below', 'back_in_stock')),
  price_threshold REAL,       -- required for price_below; NULL for back_in_stock
  created_at      TEXT NOT NULL,
  notified_at     TEXT        -- set when email sent; row deleted shortly after
);
```

Indexes:
```sql
CREATE INDEX idx_product_alerts_user ON product_alerts(user_id);
CREATE INDEX idx_product_alerts_canonical ON product_alerts(canonical_id, alert_type);
```

### Alert Checking Logic

Called at the end of every Mode 1 (daily deals) and Mode 2 (weekly full catalog) crawl, after `is_active` flags are updated.

**Price below threshold:**

```sql
SELECT pa.*, d.sale_price, d.store_id, s.name AS store_name, s.url AS store_url,
       cp.canonical_name, d.product_url
FROM product_alerts pa
JOIN canonical_products cp ON cp.id = pa.canonical_id
JOIN deals d ON d.canonical_id = pa.canonical_id AND d.is_active = 1
JOIN stores s ON s.id = d.store_id
WHERE pa.alert_type = 'price_below'
  AND d.sale_price < pa.price_threshold
  AND (pa.store_id IS NULL OR pa.store_id = d.store_id)
```

For `store_id IS NULL` (any store): pick the cheapest qualifying deal to include in the email.

**Back in stock:**

Detect canonicals that flipped `is_active = 0 → 1` in the current crawl pass. Crawl runner already tracks which deals were updated; extend it to record newly-activated deal IDs. Then:

```sql
SELECT pa.*, d.sale_price, d.store_id, s.name AS store_name, s.url AS store_url,
       cp.canonical_name, d.product_url
FROM product_alerts pa
JOIN canonical_products cp ON cp.id = pa.canonical_id
JOIN deals d ON d.canonical_id = pa.canonical_id AND d.id IN (<newly_active_deal_ids>)
JOIN stores s ON s.id = d.store_id
WHERE pa.alert_type = 'back_in_stock'
  AND (pa.store_id IS NULL OR pa.store_id = d.store_id)
```

**After firing:**
- Set `notified_at = now`
- Delete the alert row (one-shot)
- Send email (see below)

### Email Content

**Price drop email:**
> Subject: Price drop — [Product Name] now €X.XX at [Store]
>
> [Product Name] ([weight]) is now €X.XX at [Store] — below your alert of €Y.YY.
> [View deal →]
>
> This alert has been removed. Set a new one if you'd like to keep watching.

**Back in stock email:**
> Subject: Back in stock — [Product Name] at [Store]
>
> [Product Name] ([weight]) is back in stock at [Store] — €X.XX.
> [View product →]
>
> This alert has been removed. Set a new one if you'd like to keep watching.

For "any store" alerts, the email names the specific store where the condition was met.

### Alert Creation Entry Points

**From a deal / product page:**
- "Alert me when back in stock" (shown when `availability = out_of_stock`)
- "Alert me when price drops below €___" (always available; user enters threshold)
- Store selector: "at [this store]" or "at any store"

**From shopping list comparison:**
- On items marked as **estimated** (unavailable): offer "Alert me when available"
- On items marked as **confirmed**: offer "Alert me when price drops below €___"
- Store pre-filled from the comparison row; user can change to "any store"

### Alert Management Page

Simple list in user account settings:

| Product | Store | Alert type | Threshold | Set on | Action |
|---|---|---|---|---|---|
| TRS Toor Dal 5kg | Dookan | Price below | €8.50 | 2026-04-28 | Remove |
| Aashirvaad Atta 10kg | Any store | Back in stock | — | 2026-04-27 | Remove |

User can delete any pending alert manually before it fires.

---

## Out of Scope (this spec)

- Recurring alerts (re-fire until manually removed)
- Push / SMS notifications
- "Lowest ever price" alert type
- Price history charts on deal pages
- Alert aggregation (one email per day batching multiple alerts)
- Store reliability scoring from self-report data (future — data collected here feeds it)
