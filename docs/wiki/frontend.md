---
title: Frontend
last_updated: 2026-04-11
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

## Related pages

- [Backend](backend.md) — API routes consumed by the frontend
- [Overview](overview.md) — project context
