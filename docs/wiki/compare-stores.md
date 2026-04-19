# Compare Stores Feature

Users build a cart from any deal page, then see side-by-side store cost breakdowns (products + shipping), accept per-store substitutions for unavailable items, open the winning store in a new tab, and track order history.

---

## Architecture

```
localStorage cart
      │
      ▼
POST /api/v1/compare/stores  ←  canonicalIds[]
      │
store-comparison.js          ←  queries deals, shipping_tiers per store
      │
JSON: stores[], each with items[], subtotal, shippingCost, total
      │
CompareStoresPage.jsx        ←  renders StoreCard per store
      │
ItemRow → fetchReplacements()  ←  lazy, per unavailable item
      │
handlePlaceOrder → createOrder (POST /api/v1/orders)
                 → window.open(store.storeUrl)
                 → OrderConfirmModal → PATCH /api/v1/orders/:id/status
```

Cart state lives in `localStorage` — no auth required to build a cart. Orders require auth (JWT).

---

## New Files

| File | Purpose |
|---|---|
| `server/services/store-comparison.js` | Core logic: match canonical IDs to active deals per store, look up shipping tiers, compute totals |
| `server/routes/compare.js` | `POST /api/v1/compare/stores` — thin wrapper around the service |
| `server/routes/orders.js` | `POST /api/v1/orders`, `GET /api/v1/orders`, `PATCH /api/v1/orders/:id/status` |
| `client/src/context/CartContext.jsx` | Cart state + localStorage persistence via React Context |
| `client/src/components/CartDrawer.jsx` | Slide-in cart panel; shows item count, links to `/compare` |
| `client/src/pages/CompareStoresPage.jsx` | Main comparison UI: StoreCard list, ItemRow with replacements, order flow |
| `client/src/pages/OrderHistoryPage.jsx` | Lists past orders; per-order status controls |

---

## Modified Files

| File | Change |
|---|---|
| `server/db/schema.sql` | Add `orders` + `order_items` tables |
| `server/index.js` | Mount `/compare` + `/orders` routers; add SPA fallback routes |
| `client/src/utils/api.js` | Add `fetchComparison`, `createOrder`, `fetchOrders`, `updateOrderStatus` |
| `client/src/App.jsx` | Wrap with `CartProvider`; add `/compare` + `/orders` routes |
| `client/src/pages/DealsPage.jsx` | Add "Add to Cart" button on DealCard; render CartDrawer |

---

## DB Schema

### `orders`

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
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at      DATETIME
);
```

### `order_items`

```sql
CREATE TABLE IF NOT EXISTS order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  deal_id           TEXT REFERENCES deals(id) ON DELETE SET NULL,
  canonical_id      TEXT REFERENCES canonical_products(id) ON DELETE SET NULL,
  product_name      TEXT NOT NULL,
  product_url       TEXT,
  image_url         TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_price        REAL NOT NULL,
  is_replacement    INTEGER DEFAULT 0,
  original_deal_id  TEXT REFERENCES deals(id) ON DELETE SET NULL,
  original_name     TEXT
);
```

Status transitions: `pending_confirmation` → `paid` or `never_placed`. The PATCH endpoint only accepts `paid` and `never_placed` to prevent regressions.

---

## API Endpoints

### `POST /api/v1/compare/stores`

**Body:**
```json
{ "items": [{ "canonicalId": "cp_xxx", "quantity": 1 }] }
```

**Response:**
```json
{
  "stores": [
    {
      "storeId": "jamoona",
      "storeName": "Jamoona",
      "storeUrl": "https://...",
      "matchedCount": 3,
      "totalCount": 4,
      "subtotal": 24.97,
      "shippingCost": 3.99,
      "total": 28.96,
      "toFreeShipping": 25.03,
      "freeShippingThreshold": 50,
      "items": [
        {
          "canonicalId": "cp_xxx",
          "quantity": 1,
          "matchedDeal": { "id": "...", "sale_price": 8.99, ... },
          "available": true
        }
      ]
    }
  ]
}
```

Stores sorted by `total` ascending by default. Pass `?sortBy=matched` for availability-first sort.

### `POST /api/v1/orders`

Requires auth. Creates order + order_items rows. Returns `{ id, status, total, ... }`.

### `GET /api/v1/orders`

Requires auth. Returns `{ orders: [...] }` for the authenticated user, most recent first.

### `PATCH /api/v1/orders/:id/status`

Requires auth. Body: `{ "status": "paid" | "never_placed" }`. Sets `confirmed_at = datetime('now')` when transitioning to `paid`.

---

## Frontend State

### CartContext

```js
{ cartItems, addToCart, removeFromCart, updateQuantity, clearCart }
```

Each cart item: `{ dealId, canonicalId, productName, imageUrl, salePrice, storeId, quantity }`.

Persisted to `localStorage` under `dd24_cart`. No auth required.

### CompareStoresPage

Key state:

| State | Purpose |
|---|---|
| `stores[]` | Comparison result from API |
| `acceptedReplacements` | `{ [storeId]: { [dealId]: repDeal \| null } }` — per-store substitutions |
| `placingOrder` | `storeId \| null` — disables button while order is in-flight |
| `pendingOrder` | Set when anonymous user clicks Shop; triggers login prompt |
| `orderCreated` | Set on successful `createOrder`; drives OrderConfirmModal |

### ItemRow (inside StoreCard)

Unavailable items lazy-load replacements via `fetchReplacements(item.canonicalId, storeId, item.dealId)`. The third arg excludes the source deal from suggestions. Accepted replacements update `acceptedReplacements` and recalculate the store card stats in-render (no extra API call).

### handlePlaceOrder flow

1. Guard against double-tap: early return if `placingOrder === store.storeId`.
2. If not logged in: open store tab → set `pendingOrder` → `setPlacingOrder(null)` → return.
3. If logged in: `createOrder()` → on success: open store tab + set `orderCreated` → on error: set `orderError`. `finally`: `setPlacingOrder(null)`.

---

## Shipping Cost Logic

`store-comparison.js` first queries `MIN(min_basket) WHERE cost = 0` from `shipping_tiers` to determine the free shipping threshold. Falls back to `stores.free_shipping_min` if no zero-cost tier exists. Shipping cost is `null` (displayed as "—") when no tier row matches the basket value — avoids showing €0.00 for stores with no shipping data.

---

## Replacement Logic

**Entry point:** `GET /api/v1/deals/replacements?canonical_id=X&store_id=Y&deal_id=Z`  
**Service:** `server/services/product-replacements.js` → `getReplacements(db, { canonicalId, storeId, dealId })`

`dealId` is optional — omit it to get replacements without excluding a specific source deal. When omitted, source weight falls back to `canonical_products.weight_value` so size checks still work.

### Step 1 — Load context

Fetches the source canonical (`canonical_name`, `category`, `weight_value`) and resolves two values from the name via `base-product-catalog.js`:

- **`srcBaseKey`** — base product type (e.g. `"basmati-rice"`)
- **`srcBrand`** — brand within that base (e.g. `"Daawat"`)

Then loads all active, canonical-linked deals for the target store in one query.

### Step 2 — Classify candidates into tiers

Each deal row is evaluated and placed into the **first** matching tier, then skipped via `continue`.

| Tier | Label | Relevance | Criteria |
|---|---|---|---|
| T1 | `same_pack` | 1.0 | Same brand + **exact `base_product_slots` match** + different weight. Exact slot match prevents variants (e.g. "Split Chilka" vs "Whole") from being treated as size variants. Falls back to `base_key` equality when slots are null. |
| T2 | `same_spec` | 0.85 | **Cross-brand alternative**: different canonical whose `base_product_slots` token set is identical to source. Populated by `scripts/backfill-base-product-slots.js`. |
| T3 | `same_brand` | 0.65 | Same brand + **same product group** — surfaces variants ("Extra Long" ↔ "Original", "Urid Flour" ↔ "Urid Flour Roasted"). Matched via `base_key` equality (catalog brands) or slot-subset check (non-catalog brands: one slot set fully contained in the other). |
| T4 | `same_category` | 0.4 | Same category only — **only emitted when T1+T2+T3 are all empty**. Displayed collapsed as a CTA pill ("N more from this category"); expands on click. |

Same-canonical deals (identical `canonical_id`) are always skipped — they represent the same product variant and would not be useful replacements.

**Brand detection (T1/T3):** `srcBrand` resolved from CSV catalog (`detectBrandForBase`). For brands absent from catalog (e.g. Anjappar), falls back to `brand_slots[0][0]`. When using fallback (`srcBrandFromCatalogOnly = false`), candidate brand check uses `nameHasBrand` rather than strict catalog equality.

### Step 3 — Sort and cap

- T1: weight ascending (smallest pack first)
- T2, T3, T4: discount % descending, then price ascending
- Each tier capped at 4 results

### `sizeCompatible(src, cand)`

Accepts candidates whose size divides evenly into the source (500g fits inside 1kg; 700g does not). Uses epsilon ratio check — `|round(src/cand) - src/cand| < 0.01` — instead of float modulo to avoid precision errors on decimal weights (oils, spices).

Items without a `canonicalId` cannot receive replacements — this is a data quality issue for deals ingested before canonical matching.

---

## Replacement Modal UI (ReplacementsModal in DealsPage.jsx)

**Display order** (always):
1. Non-category tiers (T1, T2, T3) — in server-returned order
2. "Same Product, Other Stores" (admin-only)
3. "More from this category" (T4) — **always last**, rendered after other stores

**Kg-saving % badge** on each replacement row:
- Shows `(sourcePricePerKg - deal.price_per_kg) / sourcePricePerKg * 100` — how much cheaper/pricier vs the source deal
- Green when cheaper (`-X%`), red when more expensive (`+X%`)
- **Not shown for T4 (same_category)** — different product types make the comparison meaningless
- Falls back to no badge when either deal lacks `price_per_kg`

## Known Limitations

- **Delivery duration sort** is a no-op — falls back to total cost. The `delivery_options` table has no data for most stores.
- **No-canonical items** show as permanently unavailable with no replacement path.
- **Shopify cart URL** (`/cart/add`) is built client-side from `product_url`. Variant IDs are not pre-fetched — the URL opens the product page, not a pre-filled cart.
