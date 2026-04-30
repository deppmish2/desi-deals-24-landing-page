# DesiDeals24 — Platform v1 Design Spec

**Date:** 2026-04-30
**Branch:** feature/platform-v1
**Status:** Approved — ready for Claude design

---

## 1. Purpose

DesiDeals24 helps users find the best prices on South Asian groceries across Indian stores in Germany. Users browse a canonical product catalog, add items to a cart, then run a cross-store price comparison to find the cheapest basket.

---

## 2. Design System

### Colors
| Token | Value | Usage |
|---|---|---|
| Primary | `#f97316` (orange-500) | CTAs, badges, active states |
| Brand green | `#15803d` | Logo, confirmed savings |
| Savings green | `#16a34a` | Real Savings badge, confirmed discount |
| Savings green bg | `#f0fdf4` | Real Savings card background |
| Savings green border | `#bbf7d0` | Real Savings card border |
| BBD amber | `#d5890f` | Best-before badge |
| Fake deal amber | `#d97706` + `bg-amber-50` | Suspect discount badge |
| Slate-900 / text | `#1e293b` | Primary text, prices |
| Slate-400 / muted | `#94a3b8` | Store name label, secondary text |
| Background | `radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)` | Full page background |
| Card bg | `#ffffff` | All cards |
| Card border | `#f1f5f9` (slate-100) | Card outlines |

### Discount Badge Color Scale
| Discount | Color |
|---|---|
| > 50% | `#e53e3e` (red) |
| 30–50% | `#c05200` (amber-dark) |
| 20–30% | `#1a56db` (blue) |
| < 20% | `#1e293b` (slate, default) |

### Typography
| Role | Size | Weight | Style |
|---|---|---|---|
| Store name label | 10px | extrabold | uppercase, tracking 1.5px |
| Product name | 15px | bold | line-clamp-2 |
| Sale price | 22px | extrabold | — |
| Original price | 14px | normal | line-through, muted |
| Price/kg | 11px | medium | muted |
| Badge label | 10px | extrabold | uppercase, tracking 1.4px |
| Badge value | 22px | extrabold | — |
| Body / secondary | 13px | normal | — |
| Section label | 12px | semibold | — |

### Shape & Shadow
- Cards: `rounded-2xl`, `border border-slate-100`, `shadow-sm`
- Modals / bottom sheets: `rounded-t-2xl` (mobile), `rounded-2xl` (desktop), `shadow-2xl`
- Buttons: `rounded-xl` (standard), `rounded-full` (pills/badges)
- Badge: `rounded-[14px]`

### Layout
- Mobile-first. Max content width `max-w-2xl` centered on desktop.
- Page padding: `px-4`
- Card grid: 2-column on mobile, 3-column on desktop (≥ sm breakpoint)
- Header: `sticky top-0 z-50`, height `min-h-[72px]`, white bg, subtle bottom shadow

---

## 3. Screen Inventory

| # | Screen | Auth | Route |
|---|---|---|---|
| 1 | Catalog — All Products | Guest | `/` |
| 2 | Catalog — Deals tab | Guest | `/?tab=deals` |
| 3 | Cart | Guest | `/cart` |
| 4 | Comparison | Login required | `/compare` |
| 5 | Order History | Login required | `/profile/orders` |
| 6 | Login Gate (modal) | — | Overlay on any screen |

---

## 4. Screen 1 & 2 — Catalog (All Products / Deals)

### Layout

```
┌─────────────────────────────────────┐
│  HEADER (sticky)                    │
│  Logo   [Search bar]   [Cart icon]  │
├─────────────────────────────────────┤
│  TAB BAR                            │
│  [All Products]  [Deals]            │
├─────────────────────────────────────┤
│  FILTER ROW (horizontal scroll)     │
│  [Category ▾]  [Store ▾]            │
│  (Deals tab only): [Discount% ▾] [Hide expired toggle] │
├─────────────────────────────────────┤
│  PRODUCT GRID (2-col mobile)        │
│  [Card] [Card]                      │
│  [Card] [Card]                      │
│  ...infinite scroll...              │
└─────────────────────────────────────┘
```

### Header
- Left: DesiDeals24 logo + wordmark (green `#15803d`, extrabold)
- Center: Search bar (expands on focus, debounced 400ms)
- Right: Cart icon with badge (orange pill, count)

### Search Bar
- Placeholder: "Search products, categories, stores…"
- On focus: shows auto-suggest dropdown (see §4.1)
- Debounced 400ms before triggering suggestions

### Tab Bar
- Two tabs: **All Products** | **Deals**
- Active tab: orange underline + orange text
- Inactive tab: slate-400 text
- Switching tabs: global filters persist, deals-only filters appear/hide

### Filter Row
- Horizontal scroll, no wrapping
- Each filter: pill button, outlined border, chevron icon
- Active filter: orange fill, white text
- Deals-only filters appear inline after global filters when Deals tab active

#### Filter Options
| Filter | Scope | Type |
|---|---|---|
| Category | Global | Dropdown (select one) |
| Store | Global | Dropdown (select one or multiple) |
| Discount % | Deals only | Dropdown (≥10%, ≥20%, ≥30%, ≥50%) |
| Hide expired | Deals only | Toggle switch |

### Product Grid States
| State | Display |
|---|---|
| Loading | Skeleton cards (same dimensions as real cards) |
| Empty (no results) | Centered illustration + "No products found" + clear filters link |
| Error | Centered error message + retry button |
| End of scroll | "You've seen everything" message |

---

### 4.1 Search Auto-Suggest

Triggered on keystroke (debounced). Appears as dropdown below search bar, full width.

```
┌─────────────────────────────────────┐
│  🔍 [search input]                  │
├─────────────────────────────────────┤
│  Products                           │
│  ○ Sch**ani** Toor Dal 500gm        │ ← matched term bold/highlighted
│  ○ Sch**ani** Basmati Rice 1kg      │
│  ○ Sch**ani** Moong Dal 500gm       │
├─────────────────────────────────────┤
│  Categories                         │
│  ○ Spices & Mas**alas**             │
│  ○ Rice & Grains                    │
├─────────────────────────────────────┤
│  Stores                             │
│  ○ Indian Spice Basket              │
│  ○ Jamoona                          │
├─────────────────────────────────────┤
│  [See all results for "scha" →]     │ ← full-width button, orange text
└─────────────────────────────────────┘
```

**Behavior:**
- Up to 3 results per group. Matched substring **bold** within suggestion text.
- Tap **product** → applies text search, closes dropdown, scrolls to product
- Tap **category** → applies category filter, clears search text, closes dropdown
- Tap **store** → applies store filter, clears search text, closes dropdown
- Tap **"See all results"** → applies full text search, closes dropdown
- Tap outside → closes, no filter change
- Empty query → no dropdown shown

---

### 4.2 Product Card

Cards displayed in 2-column grid (mobile), 3-column (desktop ≥ sm).

```
┌─────────────────────────┐
│  [Image area]      -33% │  ← discount badge: top-right, rounded pill
│                         │
│  BBD: 05 May 25         │  ← BBD badge: bottom-left of image, amber pill
└─────────────────────────┘
  INDIAN SPICE BASKET       ← store name: 10px uppercase slate-400 tracking-wide
  Schani Toor Dal 500gm     ← product name: 15px bold slate-900 line-clamp-2
  
  1,99 €  ~~2,99 €~~  3,98 €/kg
  ↑ sale  ↑ original  ↑ per-kg (right-aligned)

  ┌─────────────────────────────────┐
  │ ✓ REAL SAVINGS      29%        │  ← green card if verified
  │   vs market price  store: 36%  │
  └─────────────────────────────────┘

  Available in 3 stores             ← muted, 11px

  [+ Add to cart]    [WhatsApp icon]
```

#### Discount Badge
- Position: absolute top-right of image area
- Shape: rounded pill (`rounded-full`), 8px horizontal padding
- Background: color-coded (see §2 Discount Badge Color Scale)
- Text: `−X%`, 13px bold white

#### BBD Badge
- Position: absolute bottom-left of image area
- Shape: rounded-full pill, amber bg (`#d5890f`), white text
- Text: `Best before: DD MMM YY`, 10px

#### Real Savings Badge
- Full-width card at bottom of card content
- Background: `#f0fdf4`, border `#bbf7d0` (green tones)
- Left side: green circle checkmark icon + "REAL SAVINGS" label (10px extrabold uppercase green) + "vs market price" subtext (11px slate-500)
- Right side: actual % (22px extrabold green) + "store says X%" (10px slate-500) if gap ≥ 3%
- Fake deal variant: amber tones, warning icon instead of checkmark

#### Store Count
- Text: "Available in N stores", 11px slate-400
- Shown below price row, above CTA buttons

#### CTA Row
- `[+ Add to cart]` — full-width orange button (`bg-orange-500`, white text, `rounded-xl`, 42px height), left side
- `[WhatsApp]` — icon-only button, right side, square `rounded-xl`, border `border-slate-200`
- Row layout: flex, Add to cart takes remaining space, WhatsApp is fixed square

#### Card Interaction Rules
- Card surface: **not tappable** (no cursor-pointer, no hover state on card body)
- Only buttons are interactive
- Add to cart: shows brief "Added ✓" state (1.5s) then resets

---

## 5. Screen 3 — Cart

### Layout

```
┌─────────────────────────────────────┐
│  ← Back        Cart (N items)       │
├─────────────────────────────────────┤
│  ITEM LIST                          │
│  ┌───────────────────────────────┐  │
│  │ [img] Toor Dal      Brand ▾  │  │
│  │       500gm · €1.99          │  │
│  │       Jamoona · snapshot      │  │
│  │       [−] 1 [+]        [✕]   │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ ... next item ...             │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│  [Find best price →]                │  ← orange, full-width, sticky bottom
└─────────────────────────────────────┘
```

### Cart Item
Each item row shows:
| Element | Detail |
|---|---|
| Thumbnail | Small product image, `rounded-lg` |
| Canonical name | 14px bold slate-900 |
| Weight / unit | 12px slate-400 |
| Brand selector | Dropdown pill: shows selected brand or "Any brand" (11px) |
| Store | 11px slate-400 — "cheapest store at time of add" |
| Price | 14px bold, snapshot price |
| Qty controls | `[−]` counter `[+]` — inline, orange accent |
| Remove | `✕` icon, slate-300, tap to remove with swipe-to-delete support |

**"Any brand" note:** A small info icon (ⓘ) next to the brand selector; tooltip on tap: *"When 'Any brand' is selected, the comparison will match any brand of this product available in each store."*

### Empty Cart State
Centered: shopping bag icon + "Your cart is empty" + "Browse products" link (orange).

### Sticky CTA
- `[Find best price →]` — full-width, orange, `rounded-2xl`, 52px height
- Fixed to bottom of screen above safe area inset
- Disabled (greyed out) when cart is empty

### Auth Note
No lock or login prompt shown on cart itself. Auth gate appears only when user taps "Find best price".

---

## 6. Screen 4 — Comparison Page

### Access
Login required. If guest taps "Find best price":
- Login modal appears (Google OAuth or email)
- Post-login: resumes to Comparison page with cart intact

### Layout

```
┌─────────────────────────────────────┐
│  ← Back        Price Comparison     │
├─────────────────────────────────────┤
│  SORT BAR                           │
│  [Total price ●] [Availability] [Delivery] │
├─────────────────────────────────────┤
│  ℹ️  Out-of-stock items estimated   │  ← collapsed info banner, tap to expand
│     at market price for fair totals │
├─────────────────────────────────────┤
│  STORE CARDS (ranked by sort)       │
│  ┌─────────────────────────────┐   │
│  │ Store A              €42.30 │   │
│  │ 8/10 items · est. 2 days   │   │
│  │ ─────────────────────────── │   │
│  │ ✓ Schani Toor Dal    €1.99  │   │
│  │ ✓ India Gate Rice    €7.05  │   │
│  │ ✗ MDH Chana Masala         │   │
│  │   [Find replacement]        │   │
│  │ ─────────────────────────── │   │
│  │ [Order from Store A →]      │   │
│  └─────────────────────────────┘   │
│  ┌─────────────────────────────┐   │
│  │ Store B              €47.10 │   │
│  │ ...                         │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Sort Bar
- Three pill buttons: Total price | Max availability | Delivery speed
- Active: orange fill. Inactive: outlined.
- Delivery speed: shown greyed-out with "(coming soon)" tooltip if data unavailable

### Info Banner
- Collapsed by default. One line: *"ℹ️ Out-of-stock items estimated at market price for fair comparison"*
- Tap to expand full explanation
- Slate-50 background, slate-400 text, subtle border

### Store Card
#### Header Row
- Left: Store logo + store name (16px bold)
- Right: Total price (24px extrabold orange) — includes estimated out-of-stock items

#### Meta Row
- "X/Y items available" · Estimated delivery speed (if available)

#### Item Breakdown (collapsible, expanded by default)
**Available items:**
- Row: `✓` (green) · product name · matched price
- Standard white background

**Unavailable items:**
- Row: `✗` (slate-300) · product name (muted) · `[Find replacement]` button (small, outlined orange)
- Slightly muted row background (`bg-slate-50`)

**Replaced items (after manual replacement):**
- Row: `↔` (blue) · replacement product name · price
- Distinct background: `bg-blue-50`, left border `border-l-2 border-blue-400`
- "Replaced" pill label (10px, blue, `bg-blue-100`)

#### Order Button
- `[Order from Store X →]` — full-width, orange, `rounded-xl`
- Opens store in new tab

### Post-Order Overlay (on store card)

After tapping "Order from Store X":

```
┌─────────────────────────────────────┐
│  [Store card details — dimmed 60%]  │
│  ┌─────────────────────────────┐    │
│  │  Did you complete           │    │
│  │  your order?                │    │
│  │                             │    │
│  │  [Yes, ordered ✓]  [Not yet]│    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

- Overlay: `bg-white/60 backdrop-blur-sm` — card details visible beneath
- Prompt centered in card
- `[Yes, ordered ✓]` — green button, records store + timestamp, marks cart Completed
- `[Not yet]` — outlined button, dismisses overlay, card returns to normal
- If no response: cart stays Pending in history

**Confirmed state (after "Yes"):**
- Overlay replaced with: green checkmark + "Ordered from [Store] ✓" + date
- Card permanently shows confirmed state for this session

### Loading State
Spinner centered with: "Comparing prices across stores…"

### Empty / Error States
- No stores: "No stores could price your cart yet."
- Error: message + retry button

---

## 7. Screen 5 — Order History

Accessible from user profile / nav.

```
┌─────────────────────────────────────┐
│  ← Back        Order History        │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 30 Apr 2026 · Jamoona         │  │
│  │ ✓ Completed                   │  │
│  │ 4 items · €18.40             │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ 28 Apr 2026                   │  │
│  │ ⏳ Pending                    │  │
│  │ 7 items                       │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

Each history card:
- Date + store name (if completed)
- Status pill: `✓ Completed` (green) or `⏳ Pending` (amber)
- Item count + total price (if completed)
- Tappable to expand item snapshot

---

## 8. Screen 6 — Login Gate (Modal)

Triggered when guest taps "Find best price". Appears as bottom sheet (mobile) or centered modal (desktop).

```
┌─────────────────────────────────────┐
│  Sign in to compare prices          │
│  See which store gives you the      │
│  best deal on your full basket.     │
│                                     │
│  [G  Continue with Google]          │
│  [✉  Continue with email]           │
│                                     │
│  Cancel                             │
└─────────────────────────────────────┘
```

- Post-login: returns to Comparison page with cart intact (no data loss)
- "Cancel" → returns to Cart page

---

## 9. Replacement Picker (Modal)

Triggered by `[Find replacement]` on an unavailable item in a store card.

```
┌─────────────────────────────────────┐
│  Find a replacement                 │
│  for: MDH Chana Masala 100g         │
├─────────────────────────────────────┤
│  🔍 Search alternatives…           │
├─────────────────────────────────────┤
│  Suggested                          │
│  ○ Everest Chana Masala 100g  €1.49 │
│  ○ Shan Chana Masala 100g     €1.59 │
├─────────────────────────────────────┤
│  [Confirm replacement]              │
└─────────────────────────────────────┘
```

- Shows suggested alternatives (same canonical category / product group)
- Search allows manual lookup
- On confirm: item in store card switches to "Replaced" visual style (blue, §6)

---

## 10. User Flows (Summary)

### Flow 1 — Browse & Add to Cart (Guest)
```
/ (Catalog, All Products tab)
  → filter / search / scroll
  → [Add to cart] on card
  → cart badge increments
  → repeat
```

### Flow 2 — Deals Tab (Guest)
```
Tap "Deals" tab
  → catalog filtered to discounted products
  → discount % + hide expired filters visible
  → same add-to-cart behavior
  → back to All Products → global filters persist
```

### Flow 3 — Cart (Guest)
```
Tap cart icon
  → /cart
  → edit qty, brand preference, remove items
  → [Find best price]
  → if guest → Login modal → post-login → /compare
  → if logged in → /compare
```

### Flow 4 — Compare & Order (Login Required)
```
/compare
  → ranked store cards
  → optionally: find replacements for unavailable items
  → [Order from Store X] → new tab to store
  → overlay: "Did you complete your order?"
  → [Yes] → Completed in history / [Not yet] → dismiss
```

### Flow 5 — Order History
```
Profile → Order History
  → list of past carts: Pending | Completed
  → tap to expand item snapshot
```

---

## 11. Data Notes (for design reference)

| Data point | Source |
|---|---|
| Canonical product name | `canonical_products.canonical_name` |
| Product image | `canonical_products.image_url` |
| Cheapest price | MIN(`store_products.sale_price`) across active mappings |
| Discount badge % | `store_products.discount_pct` (store-claimed) |
| Real Savings % | Computed: `(market_price − sale_price) / market_price` |
| BBD | `store_products.best_before_date` |
| Store count | COUNT of active `store_product_mappings` for canonical |
| Cart persistence | localStorage (guest) + `shopping_lists` table (logged-in) |
| Order history | `shopping_lists` with status column (Pending / Completed) |

---

## 12. Out of Scope (v1)

- Product detail / tap-to-open page
- Automatic brand substitution (manual only)
- Actual delivery speed data (sort option shown as aspirational)
- Price drop push/email alerts
