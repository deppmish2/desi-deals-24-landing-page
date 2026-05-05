# Frontend Redesign: Cart, Catalog & Compare Screens

**Date:** 2026-05-01
**Status:** Approved

## Overview

Redesign three core frontend screens using the DesiDeals24 design system handoff packages:

- **Cart** (`/cart`) — Direction 2: Rich Cards with prominent brand picker. No prices shown.
- **Compare** (`/compare`) — Direction 6: Store comparison cards with cart total headline, coverage bar, amber missing-items banner.
- **All Products** (`/products`) — New catalog browse page using existing `/api/v1/catalog` endpoint.

Plus cross-cutting changes: global NavTabs, extracted `ProductCard` component, "See alternatives" removed from product cards.

---

## Architecture

### Route Changes

| Old | New | File |
|---|---|---|
| `/` | stays → DealsPage | existing |
| `/deals` | stays → DealsPage | existing |
| `/list` | redirect → `/cart` | App.jsx |
| `/list/:id/compare` | redirect → `/compare` | App.jsx |
| `/cart` | **new** → CartPage | CartPage.jsx |
| `/compare` | **new** → ComparePage (restyled) | ComparePage.jsx |
| `/products` | **new** → CatalogPage | CatalogPage.jsx |

`App.jsx` changes: add 3 new routes, add 2 redirects (`/list` → `/cart`, `/list/:id/compare` → `/compare`).

### New/Modified Files

```
client/src/
  pages/
    CartPage.jsx                  new — Direction 2 cart screen
    CatalogPage.jsx               new — All Products catalog browse
    ComparePage.jsx               restyle — Direction 6 comparison cards
    DealsPage.jsx                 modify — remove "See alternatives", swap inline card for ProductCard
  components/
    NavTabs.jsx                   new — shared top navigation tabs
    ProductCard.jsx               new — extracted from DealsPage, context-aware buttons
    ReplacementsModal.jsx         extracted from DealsPage.jsx
    comparison/
      StoreComparisonCard.jsx     new
      CoverageBar.jsx             new
      MissingItemsBanner.jsx      new
  hooks/
    useCart.js                    extend — add brand/anyBrand/setBrand per item
  utils/
    api.js                        extend — add GET /api/v1/catalog/:id/brands call
```

### New Backend Endpoint

`GET /api/v1/catalog/:id/brands`

Returns distinct brands available for a canonical product:

```sql
SELECT DISTINCT brand
FROM store_product_mappings spm
JOIN store_products sp ON spm.store_product_id = sp.id
WHERE spm.canonical_id = :id
  AND sp.is_active = 1
  AND brand IS NOT NULL
ORDER BY brand ASC
```

Response: `{ data: ["Aashirvaad", "Tilda", "Kohinoor"] }`

Add to `server/routes/catalog.js`.

---

## Screen 1: CartPage (`/cart`)

### Purpose
User reviews shopping list, adjusts quantities, sets brand preferences, taps "Find best price" to proceed to compare (requires login).

**No prices shown anywhere on this screen.**

### Layout

```
┌─────────────────────────────────────┐
│  HEADER (sticky, white)             │
│  ← Back   Cart   N items            │
├─────────────────────────────────────┤
│  SCROLLABLE ITEM LIST               │
│  [CartItemCard]                     │
│  [CartItemCard]                     │
│  ...                                │
├─────────────────────────────────────┤
│  STICKY BOTTOM BAR                  │
│  N items in list  Prices shown at → │
│  [Find best price →]                │
└─────────────────────────────────────┘
```

Page background: `radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)`
Max width: `max-w-2xl` centered on desktop; full width on mobile.

### Header

- Background `#ffffff`, border-bottom `1px solid #f1f5f9`, sticky top z-50
- Left: `←` arrow, `font-size: 16px`, color `#94a3b8`
- Center: "Cart" `16px 700 #1e293b` + item count `11px #94a3b8`

### CartItemCard

```
┌──────────────────────────────────────┐
│  [56×56 thumb]  [Brand] Product Name │  padding 14px 14px 10px
│                 340g                 │
│                 Matches any brand    │  only if anyBrand=true
├──────────────────────────────────────┤
│  🗑 Remove          [−]  2  [+]      │  padding 8px 14px 14px
└──────────────────────────────────────┘
```

Card: `bg-white border border-slate-100 rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.05)]`

**Thumbnail (56×56px, border-radius 12px):**
- `image_url` from canonical_products
- Fallback: category-coloured placeholder with label (DAL / RICE / SPICE / DAIRY / FLOUR)

**Brand span (inline, tappable):**
- Font: `14px 700`
- Specific brand selected: color `#16a34a`, border-bottom `1.5px solid #86efac`
- Any brand: color `#94a3b8`, border-bottom `1.5px dashed #cbd5e1`
- No dropdown arrow — underline signals interactivity
- Tap → opens BrandPickerSheet

**Canonical name span (inline, non-interactive):** `14px 700 #1e293b`, flows after brand with a space

**Weight/pack:** `11px #94a3b8 mt-[3px]`

**"Matches any available brand":** `10px #94a3b8 mt-[3px]`, shown only when `anyBrand=true`

**Bottom section** (border-top `1px solid #f8fafc`):
- Remove: trash SVG 14×14 stroke `#cbd5e1` + "Remove" label `11px #cbd5e1`; tap removes item
- Stepper: border `1.5px solid rgba(22,163,74,0.2)`, radius `10px`, height `32px`
  - `−` 32px / count 32px `13px 700 #1e293b` / `+` 32px
  - Minus greyed `#cbd5e1` when qty=1; tap at qty=1 is no-op (removal via bin only)
  - `+` / `−` font: `15px 700 #16a34a`

### BrandPickerSheet

Triggered by tapping the brand span.

- Bottom sheet / modal
- Title: "Choose brand for [Canonical Name]"
- Calls `GET /api/v1/catalog/:id/brands`
- "Any brand" option at top: description "Match any available brand at comparison"
- Current selection has green checkmark `#16a34a`
- Tap to select → closes sheet, updates `CartContext` via `setBrand(id, brand, anyBrand)`

### Empty State

Shown when `items.length === 0`:

- Shopping bag SVG 72×72, bg `#f8fafc`, radius `20px`
- "Your cart is empty" — `17px 700 #1e293b mb-2`
- "Add products from the catalog to start comparing prices across stores." — `13px #94a3b8 leading-relaxed mb-7`
- "Browse products" button — orange `#f97316`, radius `14px`, padding `12px 28px`, `14px 700 white` → navigates `/products`

### Sticky Bottom Bar

- Sticky bottom, bg `#ffffff`, border-top `1px solid #f1f5f9`, padding `12px 16px 20px`
- Info row: `"{N} items in list"` `13px #64748b` | `"Prices shown at comparison →"` `11px #94a3b8`
- "Find best price →" button: full width, height `52px`, bg `#16a34a`, radius `16px`, `15px 800 white`
  - Disabled (empty cart): bg `#f1f5f9`, color `#94a3b8`, cursor not-allowed
  - Guest tap → Login Gate modal, then redirect `/compare`
  - Logged-in tap → `mergeCartIntoList()` → navigate `/compare`

---

## Screen 2: ComparePage (`/compare`) — Direction 6

### Purpose
Show ranked store comparison results for cart items. Allow replacing missing/unavailable items.

### Layout

```
┌─────────────────────────────────────┐
│  HEADER (sticky)                    │
│  ← Compare prices   N items         │
├─────────────────────────────────────┤
│  SORT PILLS                         │
│  [Best value] [Confirmed] [Coverage] │
├─────────────────────────────────────┤
│  SCROLLABLE StoreComparisonCards    │
└─────────────────────────────────────┘
```

### Data Flow

- On mount: call `runComparison(listId)` → POST `/lists/:id/recommend`
- Sort pills reorder cards client-side (no refetch)
- Sort options: `estimated_total` (Best value), `confirmed_total` (Confirmed), `coverage_pct` (Coverage)

### StoreComparisonCard

```
┌──────────────────────────────────────┐
│  [Store logo]  Store Name            │
│  Cart total: €24.50  Fair: €26.80   │  headline
│  ████████████████░░░░  12/15 items  │  CoverageBar
│  ┌───────────────────────────────┐   │
│  │ ⚠ 3 items not available      │   │  MissingItemsBanner (amber)
│  │ Est. missing: ~€6.30         │   │
│  └───────────────────────────────┘   │
│  ▾ Show full breakdown               │  expandable toggle
│  [ Shop at Store → ]                 │  CTA
└──────────────────────────────────────┘
```

**Expanded breakdown** (per item):
- ✓ Available: product name + store price
- ↔ Replaced: product name + "replaced" badge + `[Replace]` button
- ✗ Missing: product name + "not found" badge + `[Replace]` button

**Replace button:** opens `ReplacementsModal` with `fetchReplacements(canonicalId, storeId)` — T1/T2/T3/T4 tier bottom sheet. Selecting a replacement updates that item's canonical for this store context.

### Sub-components

**CoverageBar:** progress bar showing available/total. Green fill `#16a34a`, slate-100 track. Fraction label `"12/15 items"` right-aligned.

**MissingItemsBanner:** amber warning strip. Only shown when `missing > 0`.
- Background: amber-50, border amber-200, text amber-800
- "⚠ N items not available · Est. missing: ~€X.XX"

**ReplacementsModal:** imported from `client/src/components/ReplacementsModal.jsx` (extracted from DealsPage).

---

## Screen 3: CatalogPage (`/products`)

### Purpose
Browse all canonical products across all stores. Add to cart. No deals-specific UI.

### Layout

- Same filter chrome as DealsPage: search bar, category chips, store filter
- Reuse existing filter/search components from DealsPage where possible
- Grid of `<ProductCard context="catalog" />`

### Data

- `GET /api/v1/catalog` with params: `q`, `category`, `store`, `page`
- Pagination: load-more button or infinite scroll (match existing DealsPage pattern)

---

## Component: NavTabs

Shared top navigation. Renders in `CatalogPage` and `DealsPage` headers.

```
[ All Products ]  [ Deals ]  [ 🛒 N ]
```

- Active tab: green `#16a34a` underline / text
- Cart icon: badge showing `CartContext` item count
- Tap cart → `/cart`
- Tap "All Products" → `/products`
- Tap "Deals" → `/deals`

---

## Component: ProductCard

Extracted from `DealsPage.jsx` inline render into `client/src/components/ProductCard.jsx`.

```jsx
<ProductCard product={p} context="deals" | "catalog" />
```

**Button visibility by context:**

| Button | `context="deals"` | `context="catalog"` |
|---|---|---|
| Snatch deal | ✓ | ✗ |
| Add to cart | ✓ | ✓ |
| WhatsApp share | ✓ | ✓ |
| See alternatives | ✗ | ✗ |

"See alternatives" is removed from product cards entirely. It only appears as "Replace" inside the expanded breakdown of a `StoreComparisonCard`.

`DealsPage.jsx` replaces its inline card render with `<ProductCard context="deals" />`.
`CatalogPage.jsx` uses `<ProductCard context="catalog" />`.

---

## Hook: useCart Extensions

```js
// CartItem shape — new fields
{
  id: string,           // canonical_product_id
  canonical: string,    // product name without brand
  brand: string | null, // selected brand; null = any
  anyBrand: boolean,    // true if "Any brand" selected
  weight: string,
  qty: number,
  category: string,
  imageUrl: string | null,
}

// New action
setBrand(id, brand, anyBrand)
// Updates item in state + persists to localStorage (guest) or syncs to DB (logged-in)
```

Guest persistence: `localStorage` key `desiDeals24_cart`.
Logged-in: synced to `shopping_lists` table via `mergeCartIntoList()` on "Find best price" tap.

---

## Design Tokens (shared across all screens)

| Token | Value | Usage |
|---|---|---|
| Primary green | `#16a34a` | CTAs, steppers, active nav, brand underline |
| Brand underline | `#86efac` | Underline on specific brand spans |
| Orange | `#f97316` | "Browse products" CTA |
| Slate 900 | `#1e293b` | Primary text |
| Slate 500 | `#64748b` | Secondary text |
| Slate 400 | `#94a3b8` | Muted, counts, back arrow |
| Slate 300 | `#cbd5e1` | Remove button, disabled minus |
| Slate 100 | `#f1f5f9` | Borders, dividers |
| Slate 50 | `#f8fafc` | Bottom section divider |
| White | `#ffffff` | Card/header/bar backgrounds |
| Page bg | `radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)` | Page background |

**Typography:** DM Sans (Google Fonts import). Fallback: `system-ui, sans-serif`.

---

## Error Handling

- Brand picker API failure: show "Unable to load brands — tap to retry"; fallback to "Any brand"
- Compare API failure: show error state with retry button
- Cart persistence failure (localStorage): silent; data lives in memory for session
- Login gate: shown on "Find best price" tap for guest; modal with email auth flow (existing)

---

## Out of Scope

- Cross-store checkout (single-store comparison only)
- Price alerts from cart
- Sharing cart/list with another user
- Animated transitions between states
