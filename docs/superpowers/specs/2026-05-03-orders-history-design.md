# Orders History — Design Spec
**Date:** 2026-05-03
**Branch:** feature/platform-v1-frontend
**Design source:** `DesiDeals24 Design System Order History.zip`

---

## Overview

Orders History page surfaces all past orders placed via DesiDeals24. Orders are modeled as archived shopping lists (`shopping_lists.status = 'completed'`). A new `order_status` column tracks the delivery lifecycle (`pending → placed → shipped → delivered / issue`).

Responsive: Dir2 mobile timeline (`< 768px`), Dir4 desktop two-pane (`≥ 768px`), shared empty state.

---

## 1. DB Schema Migration

Added to `shopping_lists` via `alwaysMigrations` in `server/db/index.js`:

```sql
ALTER TABLE shopping_lists ADD COLUMN order_status TEXT DEFAULT 'pending'
  CHECK (order_status IN ('pending','placed','shipped','delivered','issue'));
ALTER TABLE shopping_lists ADD COLUMN savings_eur  REAL;
ALTER TABLE shopping_lists ADD COLUMN rating       INTEGER CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE shopping_lists ADD COLUMN eta_date     TEXT;
ALTER TABLE shopping_lists ADD COLUMN issue_text   TEXT;
ALTER TABLE shopping_lists ADD COLUMN tracking_url TEXT;
```

**Status semantics:**
- `shopping_lists.status` (`pending` = active cart / `completed` = archived) is unchanged — used everywhere else
- `order_status` is the Orders History lifecycle field only

**Savings computation:** at handoff time, if a compare result exists for the list, compute `savings_eur = cheapest_alt_total - chosen_store_total`. Stored once. Null if no compare was run; shown as `—` in UI.

---

## 2. Backend Routes

All routes in `server/routes/orders.js`, all require `requireUserAuth` middleware.

| Method | Path | Action |
|---|---|---|
| `GET` | `/orders` | Returns all `status='completed'` lists with items + new columns. Excludes active carts. |
| `PATCH` | `/orders/:id/handoff` | Sets `status='completed'`, `order_status='pending'`, `completed_store_id`, `completed_at`. Computes + stores `savings_eur` if compare result available. **Replaces** CartPage's current `complete` call. |
| `PATCH` | `/orders/:id/confirm` | Sets `order_status='placed'`. Triggered by "Yes, I placed it". |
| `DELETE` | `/orders/:id` | Deletes list + cascades items. Triggered by "I didn't order". |
| `PATCH` | `/orders/:id/rating` | Sets `rating` (1–5). |
| `PATCH` | `/orders/:id/status` | Advances `order_status` to `shipped`/`delivered`/`issue` (admin/manual updates). |

---

## 3. ComparePage Change

Current `completeOrder(id, store.store_id)` call in `ComparePage.jsx` (line 73) replaced with `handoffOrder(id, store.store_id, savings_eur)`. Behavior from user's perspective is identical — they're handed off to the store — but the order lands in Orders History with `order_status='pending'` awaiting confirmation.

`savings_eur` is computed client-side at handoff time from the comparison result already in local state:
```js
const savings_eur = stores.length > 1
  ? (stores.filter(s => s.store_id !== chosenStoreId)
      .reduce((min, s) => Math.min(min, s.total), Infinity)) - chosenStore.total
  : null;
// Positive = user chose cheaper store; negative/null stored as-is, shown as '—'
```

`handoffOrder(listId, storeId, savingsEur)` in `api.js` calls `PATCH /orders/:id/handoff` with body `{ store_id, savings_eur }`.

---

## 4. Shared Atoms (all in `OrdersPage.jsx`)

### `StoreLogo({ storeId, storeName, size=36 })`
- Initials: first letter of each word in `storeName`, max 2 chars
- Color: deterministic hash of `storeId` → one of 6 brand colors (green/orange/purple/blue/pink/amber)
- Border-radius: `size * 0.28`
- Border: `1.5px solid {color}33`

### `StatusPill({ status, size='md' })`

| status | label | color | bg | border |
|---|---|---|---|---|
| `pending` | `Confirm?` | slate600 | slate50 | slate200 |
| `placed` | `Placed` | #f59e0b | #fffbeb | #fde68a |
| `shipped` | `Shipped` | #3b82f6 | #eff6ff | #bfdbfe |
| `delivered` | `Delivered` | #16a34a | #f0fdf4 | #bbf7d0 |
| `issue` | `Issue` | #dc2626 | #fef2f2 | #fecaca |

Sizes: `md` = 10px / `padding: 3px 9px` ; `sm` = 9px / `padding: 2px 7px`. Both: weight 700, uppercase, letter-spacing 0.4, 5px status dot prefix.

### `Stars({ rating, size=11, onRate })`
5 `★` glyphs. Filled = `#FFD700`, empty = `#e2e8f0`. If `onRate` provided, stars are clickable.

### `SavingsSparkline({ data, width=140, height=42 })`
SVG polyline of monthly savings totals. `stroke-width: 1.8`, `linecap: round`. Filled area at 0.1 opacity. Last point: 3r filled circle (current-month emphasis). Hidden if all values null/zero.

### Formatters
```js
const fmt    = (n) => n != null ? `${n.toFixed(2).replace('.', ',')} €` : '—';
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeAgo = (iso) => { /* relative time: "2 hrs ago", "3 days ago" */ };
```

---

## 5. Empty State

Shown when `orders.length === 0` after successful load (both breakpoints).

- Three layered CSS receipt rectangles (front: green border + savings bars)
- Heading: `No orders yet` (Plus Jakarta Sans, 22px, 800)
- Subtitle: savings promise copy
- Primary CTA: `Start a shopping list` → `navigate('/list')`
- Secondary: `Already shopped? Log a past order →` (stub, no-op)
- Tips strip: 3 rows — Status ✓ (green), Savings % (orange), Reorder ↻ (blue)

---

## 6. Dir2 — Mobile Timeline (`< 768px`)

### Header
`Orders` / `Timeline · N orders`. White, slate100 border-bottom.

### Recap Strip
3-col grid, 1px hairline gaps (slate100 bg, white cells).
- Saved this year → green
- Orders → slate900
- Avg savings % → orange

### Grouping Pills
`Recent | By month | By store` + trailing `Search` chip. Client-side only, no refetch.

- `Recent` → flat, sorted by `completed_at DESC`
- `By month` → grouped under `MMM YYYY` headers
- `By store` → grouped under store name headers

### Timeline List (`D2Order`)

Two-column layout per order:

**Rail (36px):**
- 2px slate200 vertical line (clipped at first/last node)
- 36px `StoreLogo` (z-index over line)
- 14px status badge circle, bottom-right corner, `border: 2.5px white`, glyph: ✓ delivered / → shipped / • placed / ? pending / ! issue

**Card:**
- Date label: 10px / 600 / slate400 / uppercase
- White card: 14px radius, slate100 border, 12×13 padding
- Header row: store name (13/700) + order ID (10px slate400) | total (15/800) above `saved {fmt(savings)}` (green)
- Items summary: `N items · item1, item2, item3…` (11px slate500)
- Footer by `order_status`:
  - `pending` → dashed sub-card: "Did you complete checkout at {store}?" + `Yes, I placed it` (green flex-1) + `Didn't order` (white border)
  - `delivered` + unrated → `Rate` (white border) + `↻ Reorder` (green)
  - `delivered` + rated → `Stars` + `↻ Reorder` (green)
  - `shipped` → `Track` (blue bg/text/border)
  - `placed` → `awaiting shipment` (amber text)
  - `issue` → `issueText` (red)

**Reorder action:** calls `addItem()` for each order item via `useContext(CartContext)`, then `navigate('/cart')`.

---

## 7. Dir4 — Desktop Two-Pane (`≥ 768px`)

### Top Bar
`Orders` (20px/800) + `N total · X,XX € spent` (13px slate400). Right: 240px search + `Export CSV` (client-side CSV download).

### Savings Dashboard Strip
4-col grid (`1.5fr 1fr 1fr 1fr`, gap 24px):
1. Total saved · 2026 (green 30px) + `SavingsSparkline`
2. Orders count + `N delivered · N shipped · N placed · N issues`
3. Top store `StoreLogo` + name + `N orders · {fmt(saved)} saved`
4. Avg basket + `~N items per order`

### Filters Row
Status pills: `All | Delivered | Shipped | Placed | Issues`. Active = slate900/white. Dropdowns: `All stores ▾`, `Last 90 days ▾`. Right: `Showing N` count.

### Two-Pane Body (`grid-template-columns: 1fr 420px`)

**Left — List Pane:**
- Column headers: slate50 bg, 9px/700/uppercase/slate400
- `D4Row` per order: `padding 14px 18px`, columns `42px 1fr 110px 130px 90px 28px`
  - Col 1: 36px `StoreLogo`
  - Col 2: store name (14/700) + order ID (11px slate400) + items preview (12px slate500 ellipsis)
  - Col 3: date (12px slate600 tabular-nums)
  - Col 4: `StatusPill` — pending variant: inline `I placed it` (green) + `Didn't` (white border) with `e.stopPropagation()`
  - Col 5: total (15/800) + `−{savings}` (10/700 green) — pending: slate500, no savings
  - Col 6: `›` chevron (14px slate300)
  - Selected: slate50 bg + `border-left: 3px solid #16a34a`

**Right — Detail Pane (slate50 bg):**
- Inner white card: radius 14, slate100 border, padding 20
- Header: 48px `StoreLogo` + store name (18/800) + order ID/date (12px slate500) + `StatusPill`
- Pending banner (dashed slate300): "Did you complete checkout at {store}?" + `Yes, I placed it` / `I didn't order`
- Status timeline `Placed → Shipped → Delivered` (hidden when pending): green nodes + connectors for reached steps
- Items section: per-item name + qty + price + `−{savings}`
- Totals card: Subtotal + Shipping + `You saved vs {competitor}` + divider + `Total paid`
- Rating card (delivered only): `How was {store}?` + `Stars` (interactive if unrated)
- Actions row: `★ Rate` (delivered+unrated) + `Receipt` (`window.print()`) + `↻ Reorder all N items` (green, flex-1)

**Default selection on load:** first delivered order; fallback to first order if none delivered.

---

## 8. State Management

```js
const [orders, setOrders]            = useState(null);   // null=loading, []=empty
const [selectedOrderId, setSelected] = useState(null);   // Dir4
const [statusFilter, setStatusFilter]= useState('all');  // Dir4 filter pills
const [grouping, setGrouping]        = useState(0);      // Dir2: 0=Recent 1=Month 2=Store
const [searchQuery, setSearchQuery]  = useState('');     // debounced 300ms
const [windowWidth, setWindowWidth]  = useState(window.innerWidth);
```

`useEffect` on mount: add/remove `resize` listener for `windowWidth`.

**Optimistic updates:**
- Confirm → immediately set `order_status='placed'` in local state, fire `PATCH /orders/:id/confirm`
- Cancel → immediately remove order from local state, fire `DELETE /orders/:id`
- Rate → immediately set `rating` in local state, fire `PATCH /orders/:id/rating`

**Auth guard:** `getAuthSession()` on mount; if null, `navigate('/login')` (or show empty state with login prompt — match existing app pattern).

---

## 9. File Locations

| File | Change |
|---|---|
| `server/db/index.js` | Add 6 `ALTER TABLE` statements to `alwaysMigrations` |
| `server/routes/orders.js` | Add `handoff`, `confirm`, `DELETE`, `rating`, `status` routes; update `GET` |
| `client/src/utils/api.js` | Add `handoffOrder()`, `confirmOrder()`, `cancelOrder()`, `rateOrder()` |
| `client/src/pages/ComparePage.jsx` | Replace `completeOrder()` call (line 73) with `handoffOrder(id, store.store_id, savings_eur)` |
| `client/src/pages/OrdersPage.jsx` | Full rewrite — Dir2 + Dir4 + EmptyState + all atoms |

---

## 10. Out of Scope

- Push notifications for status changes
- Partner store webhook integration (auto-advance `order_status`)
- PDF receipt generation (Receipt button uses `window.print()`)
- `Log a past order` flow (stub link only)
- `All stores` / `Last 90 days` dropdown filtering (pills render, filtering is stub)
