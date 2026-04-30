# DesiDeals24 — Platform v1 Design Spec

**Date:** 2026-04-30  
**Branch:** feature/platform-v1  
**Status:** Approved by user

---

## Overview

DesiDeals24 helps users find the best prices on South Asian groceries across Indian stores in Germany. This spec defines the user flows and screen requirements for Platform v1: a product catalog, cart, and cross-store price comparison system.

The core value proposition: browse canonical products (not store-specific listings), add to cart, and find which store gives you the best deal on your full basket.

---

## Navigation

### Tabs
- **All Products** — default landing, full canonical product catalog
- **Deals** — same catalog filtered to discounted/on-sale products

### Global Filters (persist across both tabs)
- Search (text, debounced)
- Category
- Store

### Search Auto-Suggest
Triggered on text input (debounced). Displays a dropdown with 3 grouped sections:

```
[Products]
  - Up to 3 canonical product names matching query
  - Search term highlighted within each suggestion

[Categories]
  - Up to 3 category names matching query
  - Search term highlighted

[Stores]
  - Up to 3 store names matching query
  - Search term highlighted

[See all results for "query" →]  ← button at bottom, applies search and closes dropdown
```

- Tapping a **product suggestion** → applies search filter, scrolls to that product
- Tapping a **category suggestion** → applies category filter, clears search text
- Tapping a **store suggestion** → applies store filter, clears search text
- Tapping **"See all results"** → applies full text search across catalog, closes dropdown
- Clicking outside dropdown → closes without applying

### Deals-Only Filters (visible only on Deals tab)
- Discount % (minimum threshold)
- Hide expired (hides BBD/near-expiry items)

---

## Product Card

Each card represents a **canonical product** — one card per product regardless of how many stores carry it.

### Card Elements
| Element | Detail |
|---|---|
| Product image | Canonical product image |
| Discount badge | −X% (store's claimed discount), shown if discounted |
| BBD badge | Best-before date, shown if near-expiry |
| Real Savings badge | Verified savings vs market price: "REAL SAVINGS / vs market price / XX% / store says YY%" — shown only if verified |
| Store name | Small caps, above product name — cheapest store |
| Product name + weight | e.g. "Schani Toor Dal 500gm" |
| Sale price | Large, primary |
| Original price | Smaller, strikethrough — shown if discounted |
| Price per kg | e.g. "3,98 €/kg" |
| Store count | "Available in N stores" |
| Add to cart button | Adds cheapest store version to cart |
| WhatsApp share icon | Shares product link via WhatsApp |

### Card Interaction
- **Tapping the card itself does nothing** — card is not a navigation target
- **[Add to cart]** — only interaction that modifies cart state
- **[WhatsApp share]** — triggers native share / opens WhatsApp

---

## Flows

### Flow 1 — Browse & Add to Cart (Guest)

```
App opens → Catalog page (All Products tab)
  → Search / Category / Store filters
  → Scroll canonical product cards
  → [Add to cart] on card → adds cheapest store version to cart
  → Cart icon badge in nav updates
```

No login required. Cart persists via localStorage — survives page refresh, cleared on explicit cart clear or post-order completion.

---

### Flow 2 — Deals Tab (Guest)

```
Tap "Deals" tab
  → Same catalog, filtered: is_active + has_discount
  → Deals-only filters appear: Discount % | Hide expired
  → Same [Add to cart] behavior
  → Switch back to "All Products" → full catalog, global filters persist
```

---

### Flow 3 — Cart Page (Guest)

```
Tap Cart nav icon → Cart page

Cart page shows:
  → Item list, each item showing:
       - Selected brand + "any brand" option toggle
            ("any brand" = comparison engine may match any brand of this
             canonical product available in a given store, not just the
             specific brand originally added to cart)
       - Canonical product name
       - Weight / unit
       - Store (cheapest store at time of add — price is a snapshot, not live)
       - Price
       - Qty controls (+ / −)
       - Remove (×)
  → [Find best price] CTA button
```

No login required to view or edit cart.

---

### Flow 4 — Comparison Page (Login Required)

```
[Find best price]
  → Guest → Login gate modal → post-login resumes to Comparison
  → Logged in → Comparison page
```

#### Comparison Page

Displays ranked store cards. Default sort: Total price.

**Sort options:**
- Total price (default)
- Max availability
- Delivery speed *(aspirational — shown but may be unavailable per store)*

#### Store Card

```
Store card shows:
  - Store name + logo
  - Total cart price (incl. estimated out-of-stock items at market price)
  - Items available: X / Y
  - Estimated delivery speed (if available)
  - Item breakdown:
      Available items → name + matched price
      Unavailable items → name + [Find replacement] button
  - Info banner (collapsed by default, expandable):
      "Out-of-stock items are priced at market rate to keep
       totals comparable across stores."
```

#### Replacement Flow

```
[Find replacement] on unavailable item
  → Manual replacement picker (search / suggest alternatives)
  → User picks replacement
  → Item shown with distinct visual treatment in store card:
       - Different background color
       - "Replaced" label
       - Clearly distinguishable from originally matched items
```

#### Post-Comparison: Store Redirect

```
[Order from Store X]
  → Opens store in new tab (comparison page stays open)
  → That store card shows semi-transparent overlay (details visible beneath):
       "Did you complete your order?"
       [Yes ✓]   [Not yet]

  [Yes ✓]
    → Overlay replaced with "Ordered ✓" confirmation state on card
    → Store + timestamp saved
    → Cart status → Completed in order history

  [Not yet]
    → Overlay dismisses
    → Card returns to normal state
    → User can tap another store

  No response / tab closed
    → Cart remains Pending in order history
```

---

### Flow 5 — Order History (Logged-in)

```
User profile / history section
  → List of past carts (snapshots), each showing:
       - Items + quantities at time of cart
       - Status: Pending | Completed
       - If Completed: store name, date ordered
```

Data collected: what was in the cart, which store the user ordered from, when. Used for store performance insights and personalization.

---

## Data Model Notes (existing, for reference)

- `canonical_products` — one row per canonical product; `base_product_slots`, `brand_slots`, `weight_value`
- `store_products` — one row per store listing; `sale_price`, `original_price`, `discount_pct`, `best_before_date`, `is_active`
- `store_product_mappings` — links store listings to canonical products with `match_confidence`
- `shopping_lists` + `list_items` — existing list/cart persistence (to be repurposed or extended for cart history)
- `price_history` — market price baseline for Real Savings calculation

---

## Out of Scope (v1)

- Product detail page (tap-to-open)
- Automatic brand substitution (replacements are manual)
- Delivery speed data (aspirational sort option only)
- Push/email alerts for price drops (existing `price_alerts` table not exposed in this flow)
