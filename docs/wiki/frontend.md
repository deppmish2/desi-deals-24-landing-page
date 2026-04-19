---
title: Frontend
last_updated: 2026-04-13
source_count: 3
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
| `/saved` | `SavedDealsPage` | Bookmarked deals (auth required) |
| `/admin` | `AdminPage` | Admin dashboard (auth required) |
| `/oauth/:provider/callback` | `OAuthCallbackPage` | Google OAuth callback handler |
| `*` | Redirect to `/` | SPA fallback |

`OAuthCallbackPage`, `SavedDealsPage`, `DealSharePage`, `AdminPage`, and `FeedbackWidget` are lazy-loaded with `React.lazy()` to keep the initial bundle small.

`FeedbackWidget` is deferred further: it mounts after idle callback (or 1.2s timeout) so it never blocks the critical render path.

## `useDeals` hook

`client/src/hooks/useDeals.js` — the primary data-fetching hook.

Key behaviors:
- **400ms debounce** on search queries (`requestFilters.q`); immediate for non-search filter changes
- **Default deals cache**: when the request is a "default" request (no active filters), reads/writes a sessionStorage cache keyed by Berlin date (`getBerlinDateKey()`). Avoids redundant API calls when the user navigates back to the default view.
- **Crawl polling**: if `res.meta.crawling === true`, re-fetches every 15s automatically so new deals appear without a manual refresh
- **Race condition guard**: uses `requestIdRef` to discard stale responses when filters change quickly
- Returns: `{ deals, pagination, meta, loading, error }`

## API client

`client/src/utils/api.js` — all API calls go through here. Uses ES module exports (frontend is ESM; only server/crawler are CommonJS).

Key functions:
- `fetchDeals(params)` — `GET /api/v1/deals` with query params
- `fetchDealById(dealId)` — fetches a single deal by ID
- `authRequest(path, options)` — authenticated request with JWT; auto-refreshes the access token on 401 using the stored refresh token
- `fetchBrands()` — `GET /admin-dashboard/brands`
- `fetchCanonicalStats()` — `GET /admin-dashboard/canonical-stats`
- `triggerBrandRemap(brands)` — `POST /admin-dashboard/brands/remap`; returns completed result directly (no polling needed)
- Auth session stored in `localStorage` under key `dd24_auth_session` (JSON: `{ accessToken, refreshToken, user }`)
- Client session ID (analytics) stored in `sessionStorage` under `dd24_client_session_id`; sent as `X-DD24-Session-Id` header on every request

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

## Related pages

- [Backend](backend.md) — API routes consumed by the frontend
- [Overview](overview.md) — project context
