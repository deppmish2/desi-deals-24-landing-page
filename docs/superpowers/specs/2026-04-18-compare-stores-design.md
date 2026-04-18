# Compare Stores — Design Spec

**Date:** 2026-04-18
**Branch:** `compare-stores`
**Status:** Approved for implementation

---

## Goal

Let logged-in users build a shopping cart from any deal, compare total order cost (products + shipping) across all stores, refine their cart with alternatives, accept per-store substitutions for unavailable items, place the order in one click (Shopify cart permalink), and track order history with payment confirmation.

---

## Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Auth requirement | Login required throughout | Order history needs user identity; cart without account has no value |
| Cart persistence | localStorage (`dd24_cart_v1`) | Fast, no server round-trip; cross-device sync is a future concern |
| Cart entry | Header icon → mini drawer → `/cart` page | Full management needs space; mini drawer is quick access |
| Compare layout | Winner hero expanded, others collapsed | Surfaces the answer immediately; detail on demand |
| Replacement UX on compare | Inline expansion within store card | No context switch; accepts in place |
| Substitution disclosure | Inline: crossed-out original → amber replacement + asterisk + warning | Honest without splitting the user's attention |
| Architecture | localStorage cart, server-side comparison, dedicated `/compare` route | Clean separation; `shopping_lists` table not designed for deal-level state |
| Shopify cart transfer | Variant ID stored at crawl; lazy full-refresh on demand | Accurate, fast at compare time; stale data gets refreshed when needed |
| Cart-level alternatives | Canonical-based, show median price from `real-savings.js` | Consistent with rest of app; user can make informed swap before comparing |

---

## Rename Note

The `deals` table and related naming will be renamed to `products` in a future dedicated refactor. This spec uses `deals` throughout to match the current codebase.

---

## 1. Data Layer

### 1.1 Schema additions

**`deals` table — new column:**
```sql
ALTER TABLE deals ADD COLUMN external_variant_id TEXT;
```
Shopify variant ID (default variant). Used to build cart permalink URLs.

**New table: `orders`**
```sql
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  status            TEXT NOT NULL DEFAULT 'pending_confirmation'
                    CHECK (status IN ('pending_confirmation', 'paid', 'never_placed')),
  subtotal          REAL NOT NULL,
  shipping_cost     REAL,
  total             REAL NOT NULL,
  currency          TEXT DEFAULT 'EUR',
  replacement_count INTEGER DEFAULT 0,
  shopify_cart_url  TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at      DATETIME
);
```

**New table: `order_items`**
```sql
CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  deal_id          TEXT REFERENCES deals(id) ON DELETE SET NULL,
  canonical_id     TEXT REFERENCES canonical_products(id) ON DELETE SET NULL,
  product_name     TEXT NOT NULL,
  product_url      TEXT,
  image_url        TEXT,
  quantity         INTEGER NOT NULL DEFAULT 1,
  unit_price       REAL NOT NULL,
  is_replacement   INTEGER DEFAULT 0,
  original_deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  original_name    TEXT
);
```

### 1.2 Shopify variant ID — population strategy

**At crawl time:** All three Shopify adapters (`jamoona`, `dookan`, `namma-markt`) already fetch product JSON. Save the default variant's `id` field as `external_variant_id` on insert/update.

**On-demand refresh:** When `POST /compare/stores` runs and a cart deal has `external_variant_id IS NULL`, the comparison service fetches `{store_url}/products/{handle}.json`, extracts the default variant ID, updates the `deals` row with all refreshed fields (price, availability, variant ID), and appends to `deal_price_history`. The comparison then uses the freshly fetched data.

**Non-Shopify stores:** `external_variant_id` stays NULL. Cart transfer falls back to opening `product_url` directly.

### 1.3 Shopify cart permalink format

```
https://{store_domain}/cart/{variantId1}:{qty1},{variantId2}:{qty2}
```

The comparison response includes `external_variant_id` for every matched deal item. The client builds the Shopify cart URL dynamically as substitutions are accepted — no extra server round-trip needed. The final URL (reflecting original matches + accepted substitutions) is sent in the `POST /orders` request body and stored on the `orders` row as `shopify_cart_url`.

---

## 2. API Layer

### Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/compare/stores` | Required | Compute per-store comparison |
| POST | `/api/v1/orders` | Required | Create order on "Shop at store" |
| GET | `/api/v1/orders` | Required | List user's order history |
| PATCH | `/api/v1/orders/:id/status` | Required | Update to `paid` or `never_placed` |

### `POST /compare/stores`

**Request body:**
```json
{
  "cartItems": [
    { "dealId": "...", "canonicalId": "...", "productName": "...", "quantity": 1 }
  ],
  "sortBy": "total"
}
```

`sortBy` values: `"total"` (default, cheapest first), `"match"` (highest match % first).

**Per-store response shape:**
```json
{
  "stores": [{
    "storeId": "jamoona",
    "storeName": "Jamoona",
    "storeUrl": "https://jamoona.de",
    "shopifyCartUrl": "https://jamoona.de/cart/123:1,456:2",
    "matchedCount": 12,
    "totalCount": 13,
    "hasSubstitutions": false,
    "items": [{
      "dealId": "orig-id",
      "canonicalId": "...",
      "productName": "Daawat Basmati 5kg",
      "quantity": 1,
      "available": true,
      "matchedDeal": { "id": "...", "product_name": "...", "sale_price": 8.99, ... }
    }],
    "subtotal": 44.21,
    "shippingCost": 2.99,
    "freeShippingMin": 50.00,
    "toFreeShipping": 5.79,
    "total": 47.20
  }]
}
```

### `POST /orders`

**Request body:**
```json
{
  "storeId": "jamoona",
  "items": [{
    "dealId": "...", "canonicalId": "...", "productName": "...",
    "productUrl": "...", "imageUrl": "...", "quantity": 1, "unitPrice": 8.99,
    "isReplacement": false, "originalDealId": null, "originalName": null
  }],
  "subtotal": 44.21,
  "shippingCost": 2.99,
  "total": 47.20,
  "shopifyCartUrl": "https://jamoona.de/cart/123:1"
}
```

Creates order with `pending_confirmation` status. Returns full order + items.

### `PATCH /orders/:id/status`

Body: `{ "status": "paid" | "never_placed" }`. Sets `confirmed_at` when status becomes `paid`.

### New service: `server/services/store-comparison.js`

Pure function — no side effects except the on-demand deal refresh (DB write + price history).

```
computeStoreComparison(db, cartItems) → storeResults[]
buildShopifyCartUrl(storeUrl, items) → string | null
```

---

## 3. Frontend Architecture

### New files

| File | Responsibility |
|---|---|
| `client/src/context/CartContext.jsx` | Cart state, localStorage persistence, auth gate |
| `client/src/components/CartDrawer.jsx` | Mini slide-in from header icon |
| `client/src/pages/CartPage.jsx` | Full cart management at `/cart` |
| `client/src/pages/CompareStoresPage.jsx` | Price comparison at `/compare` |
| `client/src/pages/OrderHistoryPage.jsx` | Order history at `/orders` |

### Modified files

| File | Change |
|---|---|
| `client/src/App.jsx` | Wrap with `CartProvider`; add `/cart`, `/compare`, `/orders` routes |
| `client/src/pages/DealsPage.jsx` | Add "+ Cart" button on deal cards; cart icon in header |
| `client/src/utils/api.js` | Add `fetchComparison`, `createOrder`, `fetchOrders`, `updateOrderStatus` |

### Cart state shape (localStorage key: `dd24_cart_v1`)

```json
[{
  "dealId": "string",
  "canonicalId": "string | null",
  "productName": "string",
  "imageUrl": "string | null",
  "salePrice": 8.99,
  "storeId": "string",
  "storeName": "string | null",
  "productUrl": "string | null",
  "weightRaw": "string | null",
  "quantity": 1
}]
```

### CartContext API

```js
{ cartItems, cartCount, addToCart(deal), removeFromCart(dealId),
  updateQuantity(dealId, qty), clearCart, isInCart(dealId) }
```

`addToCart` triggers a login gate if no session exists. Increments quantity if dealId already in cart.

---

## 4. User Flows

### 4.1 Add to cart

1. User sees deal card on `/deals`
2. If not logged in: "+ Cart" click opens login modal (existing auth flow)
3. If logged in: deal added to localStorage cart; button becomes "✓ In cart"; header icon badge increments

### 4.2 Cart management (`/cart`)

1. Full product list with image, name, weight, qty stepper, unit price, line total, remove button
2. "See alternatives" per item → inline expansion showing canonical-matched alternatives from any store, each displaying current price (green) + median market price (grey, from `real-savings.js`)
3. User can swap a cart item with an alternative (replaces the cart entry)
4. Running total at bottom + "Compare prices across stores →" CTA

### 4.3 Price comparison (`/compare`)

1. Triggers `POST /compare/stores`; on-demand variant ID refresh happens server-side
2. Winner store (lowest total) shown expanded; others shown as collapsed rows with total + match stat
3. User can expand any store card
4. Available items listed first; unavailable items below with "see alternatives" link
5. Alternatives expand inline — amber left-border rows showing alternative product + price
6. Accepting a replacement: original row crossed out, amber replacement row takes its place; "X substitutions" badge appears on card header; asterisk on total; incomparability warning shown; `shopifyCartUrl` rebuilt with new variant IDs
7. Stores without substitutions show "exact match" label
8. Sort toggle: "Cheapest" (default) | "Best match"

### 4.4 Place order

1. "Shop at [Store]" clicked
2. `POST /orders` called immediately → order created with `pending_confirmation`
3. For Shopify stores: `shopifyCartUrl` opened in new tab (all items pre-added to store cart)
4. For non-Shopify: `storeUrl` opened in new tab
5. Confirmation modal appears: "Did you complete the purchase?"
   - "Yes, I paid ✓" → `PATCH /orders/:id/status {status: "paid"}`
   - "No, I didn't place it" → `PATCH /orders/:id/status {status: "never_placed"}`
   - "Close" → dismisses modal; order stays `pending_confirmation`

### 4.5 Order history (`/orders`)

- Order cards: store name, date, total, status badge, item list with substitution disclosure
- `pending_confirmation`: "Mark as paid" + "Never placed" + "Compare again" actions
- `never_placed`: "Compare again" action (navigates to `/compare` with original cart still in localStorage)
- `paid`: view only + "Visit [Store]" link

---

## 5. Substitution Disclosure (Detail)

When a replacement is accepted for an item at a specific store:

- Original item row: product name in grey, strikethrough, `—` for price
- Replacement row below it: amber left-border, `↳ [replacement name]` in amber, price in amber
- Card total: asterisk appended (e.g. `€47.20*`)
- Card header: amber badge `X substitutions`
- Below the item list: `* Total includes X substitutes — not a direct comparison with other stores`
- Stores with no substitutions: `exact match` label in header

Substitution state is **ephemeral** (React state only, per `/compare` session). It is not persisted until the order is placed.

---

## 6. Crawler Changes

**Files to modify:** `crawler/stores/jamoona.js`, `crawler/stores/dookan.js`, `crawler/stores/namma-markt.js`

Each Shopify adapter already fetches `product.variants`. Add `external_variant_id: variant.id` (the default variant, i.e. `product.variants[0].id`) to the deal object returned by `scrape()`. The crawler's DB insert logic picks this up automatically.

---

## 7. Out of Scope (Follow-ups)

- Cross-device cart sync (localStorage → DB sync)
- Delivery duration sort (requires populating `delivery_options` table)
- `deals` → `products` rename (separate refactor)
- WooCommerce cart API integration (little-india)
