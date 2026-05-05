---
title: Frontend
last_updated: 2026-05-04
source_count: 4
---

The frontend is a React 18 SPA built with Vite and Tailwind CSS. It uses React Router v6 for client-side routing and a single `useDeals` hook as the primary data layer. The dev server proxies `/api` to port 3000 (the Express backend). In production, the built `client/dist/` is served directly by the Express server.

## Routing

Defined in `client/src/App.jsx`:

| Route | Component | Notes |
|---|---|---|
| `/` | `DealsPage` | Main deals listing |
| `/deals` | `DealsPage` | Alias for `/` |
| `/insta` | `AdLandingPage` | Instagram ad landing page (hardcoded deal cards) |
| `/deal/:dealId` | `DealsPage` | Deep-link to a deal (deal highlighted in list) |
| `/share/deal/:dealId` | `DealSharePage` | Social share redirect page |
| `/cart` | `CartPage` | Shopping cart — items, quantities, brand/weight badges. Persisted in localStorage. |
| `/products` | `CatalogPage` | Browse all canonical products; search + category/store filters. |
| `/compare/:id` | `ComparePage` | Cross-store price comparison for a saved list. Shows `StoreComparisonCard` per store. |
| `/orders` | `OrdersPage` | Completed shopping order history (auth required) |
| `/list` | Redirect → `/cart` | Legacy route alias |
| `/list/:id/compare` | `RedirectToCompare` | Legacy redirect → `/compare/:id` |
| `/admin` | `AdminPage` | Admin dashboard (auth required) |
| `/oauth/:provider/callback` | `OAuthCallbackPage` | Google OAuth callback handler |
| `*` | Redirect to `/` | SPA fallback |

`OAuthCallbackPage`, `DealSharePage`, `AdminPage`, `FeedbackWidget`, `ListPage`, `ComparePage`, `CartPage`, `CatalogPage`, and `OrdersPage` are lazy-loaded with `React.lazy()`. `SavedDealsPage` and the `/saved` route were removed (commit 81b0b57).

`FeedbackWidget` is deferred further: it mounts after idle callback (or 1.2s timeout) so it never blocks the critical render path.

## `useDeals` hook

`client/src/hooks/useDeals.js` — the primary data-fetching hook.

Key behaviors:
- **400ms debounce** on search queries (`requestFilters.q`); immediate for non-search filter changes
- **Default deals cache**: when the request is a "default" request (no active filters), reads/writes a sessionStorage cache keyed by Berlin date (`getBerlinDateKey()`). Avoids redundant API calls when the user navigates back to the default view.
- **Crawl polling**: if `res.meta.crawling === true`, re-fetches every 15s automatically so new deals appear without a manual refresh
- **Race condition guard**: uses `requestIdRef` to discard stale responses when filters change quickly
- Returns: `{ deals, pagination, meta, loading, error }`

## Cart

`client/src/hooks/useCart.js` — cart state management. Persisted to `localStorage` under key `dd24_cart_v1` (JSON array of items).

`client/src/hooks/CartContext.js` — React context exporting `CartContext`. Provided at the app root in `App.jsx` via `useCart()`. All components read/write cart via `useContext(CartContext)`.

Cart item shape:
```js
{
  raw_item_text: "TRS Jeera 400g",
  canonical_id: 123,           // null for free-text items
  product_category: "Spices",
  image_url: "...",
  weight_raw: "400g",
  quantity: 400,
  quantity_unit: "g",
  item_count: 1,
  brand: "TRS",                // null when anyBrand=true
  anyBrand: false,
  brand_pref: "TRS",           // "*" for any-brand items
}
```

Key operations: `addItem` (dedupes by `canonical_id` or text, increments `item_count`), `removeItem`, `updateItem`, `clearCart`, `setBrand`.

Weight display: shown as a green badge (`#16a34a` background, `#f0fdf4` fill) — `weight_raw` preferred; falls back to `quantity + quantity_unit`. Prominent, not secondary text.

## API client

`client/src/utils/api.js` — all API calls go through here. Uses ES module exports (frontend is ESM; only server/crawler are CommonJS).

Key functions:
- `fetchDeals(params)` — `GET /api/v1/deals` with query params
- `fetchDealById(dealId)` — fetches a single deal by ID
- `authRequest(path, options)` — authenticated request with JWT; auto-refreshes on 401 using stored refresh token
- `fetchCatalog(params)` — `GET /api/v1/catalog` with pagination/filter params
- `fetchCatalogProduct(canonicalId)` — single canonical product
- `fetchCatalogSuggest(q)` — `GET /api/v1/catalog/suggest?q=` (typeahead)
- `fetchLists()` / `createList(name)` / `fetchList(listId)` — list CRUD
- `addListItem(listId, item)` / `mergeCartIntoList(listId, cartItems)` — add items to list
- `runComparison(listId)` — `POST /api/v1/lists/:id/recommend`; returns store comparison result
- `fetchOrders()` — `GET /api/v1/orders`
- `handoffOrder(listId, storeId, savingsEur, totalEur)` — `PATCH /orders/:id/handoff`; called from ComparePage when user taps "Shop here"; `savingsEur` clamped to `null` if not finite (single-store edge case)
- `confirmOrder(listId)` — `PATCH /orders/:id/confirm`; advances pending→placed
- `cancelOrder(listId)` — `DELETE /orders/:id`
- `rateOrder(listId, rating)` — `PATCH /orders/:id/rating`; rating 1–5
- `fetchBrands()` — `GET /admin-dashboard/brands`
- `fetchCanonicalStats()` — `GET /admin-dashboard/canonical-stats`
- `triggerBrandRemap(brands)` — `POST /admin-dashboard/brands/remap`; synchronous result (no polling)
- Auth session stored in `localStorage` under key `dd24_auth_session` (JSON: `{ accessToken, refreshToken, user }`)
- Client session ID (analytics) stored in `sessionStorage` under `dd24_client_session_id`; sent as `X-DD24-Session-Id` header

Auth endpoints: email magic link (`startEmailAuth`, `completeEmailAuth`), Google OAuth (`fetchOAuthAuthUrl`, `loginWithOAuthCode`), logout (`logoutUser`).

## Analytics

`client/src/utils/analytics.js` — Google Analytics integration. Initialized lazily via `initGoogleAnalytics()` called in `RouteAnalytics` component on each route change. `trackPageView()` fires on every location change.

## Key design patterns

- **URL-synced filters**: `DealsPage` uses `useSearchParams` (React Router) to keep filters in the URL. Sharing a filtered URL reproduces the exact view.
- **Error boundary**: `ErrorBoundary` class component wraps the entire app shell. Render errors show a minimal fallback with a reload button rather than a blank screen.
- **No global state manager**: filters live in URL params; auth session in localStorage; deals in `useDeals` local state. No Redux/Zustand.

## Build

`cd client && npm run build` → outputs to `client/dist/`. Backend serves `client/dist/` as static files in production. Hashed asset filenames enable long-term caching.

## Admin page (`client/src/landing/AdminPage.jsx`)

Three-tab layout: **User Stats → Crawl Stats → Canonical Stats**.

### Canonical Stats tab

- **KPI row**: total canonicals, mapped deals count + %, unmapped product count + %.
- **Mapping health bar**: green/red proportional bar.
- **Brand Manager**: full CRUD for `known_brands`. Uses `BrandRow` component with local `aliasText` state — aliases are free-text while typing, parsed (split on `,`, trim, lowercase) only on `onBlur`. This prevents comma/space being stripped mid-type (the controlled-input anti-pattern). New brands get `_key: crypto.randomUUID()` for stable React keys. Delete requires `window.confirm`.
- **Suggestion chips**: derived from the first word of each unmapped product, deduped, filtered against existing brands, sorted by count descending. Each chip shows the count of unmapped products with that first word.
  - **Click chip label** → filters the unmapped products table to that word (toggle; clicking again deselects).
  - **Click `+`** → adds the word as a new brand entry.
  - Active chip is highlighted green; a filter badge appears in the table header with `×` to clear.
- **Fuzzy misspelling detection**: when a chip filter is active, the unmapped products table splits into two sections: "Possible misspellings" (Levenshtein distance ≤ `min(3, ceil(chipLength/4))`) shown first in amber, then "Exact matches" below. Uses an inline `levenshtein(a, b)` function (no dependency).
- **Save & Re-map**: sends all brands to `POST /brands/remap`, awaits the synchronous response, then refreshes canonical stats and brand list. No polling.

### Real Savings badge tooltip

In `DealsPage`, the "Real Savings" badge uses `createPortal` (rendered into `document.body`) with `position: fixed` coords from `getBoundingClientRect()`. This bypasses CSS stacking context and `overflow: hidden` clipping. Visible to admins only: `isAdmin = Boolean(session?.user?.is_admin) || import.meta.env.DEV`.

### Image proxy

`proxyDealImageUrl(deal)` takes the **full deal object** (not `deal.image_url` string) — it needs `deal.store.url` to resolve relative image paths. Passing the string instead of the object silently breaks image display.

## `formatPricePerKg(ppkg, weightUnit)`

`client/src/utils/formatters.js`. Accepts optional `weightUnit` — displays `/L` when unit is `ml` or `l`, `/kg` otherwise. **Always pass `deal.weight_unit` as the second arg** — omitting it silently shows `/kg` for liquid products.

## `DealSharePage` (`/share/deal/:dealId`)

Conditional rendering based on `deal.is_fake_deal` (server-computed, see backend wiki):

| Condition | UI |
|---|---|
| `is_fake_deal && discountPct && realPct != null` | Amber warning banner: "⚠️ Claims X% off — only Y% vs market price" |
| `is_fake_deal && realPct != null` | WA share uses `buildWhatsAppSuspectDiscountShareText` (exposes gap) |
| genuine deal | WA share uses `buildWhatsAppDealShareUrl` (standard copy) |

Secondary CTA link below SNATCH DEAL button:
- Fake: "See more inflated deals →" → `/deals?sort=real_savings`
- Genuine: "See more genuine deals →" → `/deals`

Falls back to genuine treatment when `real_savings` is unavailable.

## `DealsPage` — WhatsApp share branching

WA share in `DealCard` uses `deal.is_fake_deal` (from API) to branch:
- Fake: `buildWhatsAppSuspectDiscountShareText` — exposes claimed vs real saving gap
- Genuine: `buildWhatsAppDealShareUrl` — standard deal share copy

`buildWhatsAppSuspectDiscountShareText` and `buildWhatsAppShareUrl` live in `client/src/utils/share.js`.

## `StoreComparisonCard` (`/compare/:id`)

`client/src/components/comparison/StoreComparisonCard.jsx` — one card per store in `ComparePage`.

Key display rules:
- **Weight badge:** total weight = `weight_value × packs_needed`, normalized (≥1000g → kg, ≥1000ml → l). Green pill badge.
- **Per-kg line:** shown as sub-text (`price_per_unit + unit_label`), 11px semibold.
- **Missing items banner** (`items_not_found`): amber warning strip listing unstocked products; each has a "Replace" button triggering `ReplacementsModal`.
- `isWinner` card has green border + "Best value" banner; shows savings vs most-expensive store.
- Coverage bar shows `(available + replaced) / total`.

## `OrdersPage` (`/orders`)

`client/src/pages/OrdersPage.jsx` — order history page. Auth required (redirects to login if no session). Responsive: `windowWidth < 768` renders `Dir2` (mobile), else `Dir4` (desktop).

**Shared atoms** (all defined in same file):
- `StoreLogo` — initials avatar, deterministic color from `storeId` hash, 6-color palette
- `StatusPill` — coloured badge for 5 statuses: `pending` (gray), `placed` (amber), `shipped` (blue), `delivered` (green), `issue` (red)
- `Stars` — 1–5 star display; `onRate` prop makes it interactive
- `SavingsSparkline` — inline SVG area+line chart; renders monthly savings data
- `fmt(n)` — European currency format (`1,23 €`); `fmtDate(iso)` — `3 May 2026`; `timeAgo(iso)` — `5 min ago`

**Dir2 — mobile timeline:**
- Vertical rail with connecting line segments; `StoreLogo` + status badge per order
- `D2Order` card: store name, order ID, total, savings, first 3 items
- `D2Footer`: pending → confirm/cancel buttons; delivered → rate + reorder; shipped → track
- Recap strip: total saved, order count, avg savings %
- Grouping pills: Recent / By month / By store; search via `window.prompt`

**Dir4 — desktop two-pane:**
- Left pane: sortable order list (`D4Row`) with 6-column grid; status filter pills; search input; CSV export
- Right pane (420px): `D4Detail` — pending banner, status timeline (placed→shipped→delivered), items list, totals card, rating card, actions (track/rate/receipt/reorder)
- Dashboard strip: total saved + sparkline, order count by status, top store logo, avg basket

**Handlers** (optimistic UI, fire-and-forget API calls):
- `handleConfirm` — optimistic `order_status: "placed"`, then `confirmOrder`
- `handleCancel` — optimistic remove, then `cancelOrder`
- `handleRate` — optimistic rating update, then `rateOrder`
- `handleReorder` — `addItem` each item from order, then `navigate("/cart")`

## `ProductCard` (`/products`)

`client/src/components/ProductCard.jsx` — used in `CatalogPage`.

- "Add to cart" calls `CartContext.addItem` with brand extracted via `extractBrandFromName` (checks `KNOWN_BRANDS` set) or `product.primary_brand`.
- `anyBrand: !detectedBrand` — when no brand identified, the cart item gets any-brand mode.
- Image proxied via `/api/v1/admin/proxy/image?url=` (non-Shopify) or Shopify CDN with `?width=400`.
- **Weight/pack size badge**: composed as `[weight_raw, formatPricePerKg(price_per_kg, weight_unit)].filter(Boolean).join(" | ")` — e.g. `62g | 0.32 €/kg`. Mirrors `DealsPage` deal-card pattern. Catalog API returns `weight_raw`, `weight_value`, `weight_unit` from `COALESCE(canonical_products, canonicals)`.

## Shared search / filters / sort (search-parity)

Three components factored out so `DealsPage` and `CatalogPage` share the same UX. Plan: `docs/superpowers/plans/2026-05-03-search-filters-sort-parity.md`.

- `client/src/components/SortDropdown.jsx` — exports default component plus `SORT_OPTIONS`. `<SortDropdown value={sort} onChange={fn} toolbar={false} />`. `toolbar` switches the trigger styling (pill vs flat). `ChevronDownIcon` only rendered in pill variant.
- `client/src/components/FiltersModal.jsx` — exports default component plus `CATEGORIES`. Shared filters dialog used by both pages. Auth-gated apply: anonymous users get redirected through OAuth and the draft filter set is preserved in `sessionStorage` until the OAuth callback resumes the apply.
- `client/src/components/SearchWithSuggest.jsx` — input + `SuggestDropdown`. Debounced typeahead, keyboard navigation (ArrowUp/Down/Enter/Esc). Ships internal guards: `controlRef` cleared on empty/null suggestion data; ArrowDown gated on `dropdownOpen` so stale `controlRef` callbacks can't fire after the dropdown closes (commits 407d7af, cb882c0, 6c29aaa).

`DealsPage` mounts `SearchWithSuggest` twice (mobile vs desktop toolbar zones — see lines ~1344 and ~1513). `CatalogPage` mounts each component once. Both pages share `useSearchParams` URL-sync for `q`, `sort`, `category`, `store`, `is_discounted`, `min_discount`, `hide_expired`.

## Related pages

- [Backend](backend.md) — API routes consumed by the frontend
- [Overview](overview.md) — project context
