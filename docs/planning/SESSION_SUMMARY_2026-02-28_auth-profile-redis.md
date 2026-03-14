# Session Summary — 2026-02-28 (Auth + Profile + Redis Session Layer)

## Goal for This Session

Deliver the auth/profile epic slice end-to-end on top of existing code:

- SQL-backed signup/login/profile
- JWT access tokens
- Refresh token session persistence with Upstash Redis acceleration + SQL fallback
- Route integration and docs

## Update (Matching + Cart Transfer Reliability Slice)

Completed additional fixes to address shopping-list matching accuracy and cart transfer completeness:

- Recommendation matcher hardening (`server/services/recommender.js`):
  - added normalized token fallback matching for noisy list text
  - uses canonical aliases + canonical name + raw item text for lookup
  - handles spelling variant (`...ie` -> `...i`) for common cases like `maggie` vs `maggi`
- Winner ranking correction:
  - stores are now ranked by match coverage first (`items_matched/items_total`), then price
  - prevents partial-match stores from winning purely due lower subtotal
- List canonicalization behavior fix (`server/routes/lists.js`):
  - list parsing/item-add no longer auto-creates new canonical IDs for unknown free-text
  - unresolved inputs remain unresolved and are handled by improved matcher
- Cart transfer behavior fix:
  - `server/services/cart-transfer.js` now preserves all matched items in transfer links
  - WooCommerce transfer builds add-to-cart URLs for every matched item
  - manual/tab-burst modes no longer truncate to first 12 links
  - frontend transfer action now opens all transfer links (`client/src/pages/RecommendationPage.jsx`)
  - recommendation response now includes full ranked store list (`stores`) so transfer can be executed for every store, not winner-only
- Added/updated tests:
  - `tests/integration/recommender.test.js` extended for coverage-priority and noisy-text matching
  - new `tests/integration/cart-transfer.test.js`
  - `tests/integration/canonicalizer.test.js` now verifies `createIfMissing:false` does not create canonicals

### Verification Snapshot (Matching + Transfer slice)

- `npm run test:integration` passes (11/11).
- `npm run test:e2e` passes (6/6).
- Live local verification with current DB snapshot:
  - previously problematic sample list now resolves winner at `4/4` matched items
  - transfer payload includes all matched links (not first-only)

## Update (Strict Full-Cart Transfer + 100% Match-Only Slice)

- Recommendation filtering tightened in `server/services/recommender.js`:
  - only stores with `items_matched === items_total` are kept
  - only stores with a single auto-cart URL are kept
  - response `reason` added for empty outcomes: `no_store_with_full_match_and_auto_cart`
- Cart-transfer policy updated in `server/services/cart-transfer.js`:
  - supports only automatic full-cart links:
    - Shopify cart permalink
    - WooCommerce multi add-to-cart URL
  - removes manual/tab-burst link-list fallback
  - adds inferred platform fallback when store metadata is missing
- Frontend recommendation UX simplified in `client/src/pages/RecommendationPage.jsx`:
  - shows only `100% Match Stores (Auto Cart)`
  - each option exposes `Transfer Cart to This Store` + single `Cart Link`
  - removed multi-link modal flow
- Brand substitution communication improved:
  - recommendation payload now includes explicit `brand_info` entries (`requested_brand` vs `matched_brand`)
  - Recommendation page renders this as clear information text (not warning)
  - warning counters no longer treat brand substitution as warning severity
- Tests updated and expanded:
  - `tests/integration/cart-transfer.test.js`
  - `tests/integration/recommender.test.js`

### Verification Snapshot (Strict slice)

- `npm run test:integration` passes (13/13).
- `npm run test:e2e` passes (6/6).
- `npm run build:client` passes.

## Update (Remaining PRD Slice Completion)

Additional delivery completed for remaining scope:

- Real Claude API integration is now active in both:
  - `crawler/entity-resolution/ai-resolver.js`
  - `server/services/list-parser.js`
- Route-level E2E suite is implemented and passing (`tests/e2e/routes.e2e.test.js`), covering:
  - auth/profile
  - lists/recommend/canonical/search
  - alerts/inbound/admin
  - public deals/stores/categories/contact routes
- `better-sqlite3` runtime mismatch mitigation added:
  - `server/db/index.js` now attempts `better-sqlite3` first and falls back to `node:sqlite` compat wrapper when native binding is unavailable.
- Build script improvement:
  - root `package.json` `build:client` no longer runs `npm install` implicitly; it now runs `npm --prefix client run build`.
- List write correctness fix:
  - `server/routes/lists.js` now persists resolved `canonical_id` and `brand_pref` for parsed items.

### Verification Snapshot (as of 2026-02-28)

- `npm run test:integration` passes (4/4).
- `npm run test:e2e` passes (4/4).
- Backend runtime loads under Node v24 in this workspace through fallback path when `better-sqlite3` binding is missing.
- Frontend Vite build cannot be fully completed in this sandbox right now due package registry DNS/network restriction (`ENOTFOUND registry.npmjs.org`) plus pre-existing corrupted local `client/node_modules`.

## Update (EPIC-08 Backend Hardening Slice)

Additional work delivered in the same session:

- Added `events` table + indexes in `server/db/schema.sql`.
- Added event tracker service (`server/services/event-tracker.js`) and instrumented key actions:
  - auth register/login/refresh/logout/logout-all
  - profile updates
  - list creation/item add
  - recommendation generation (with `duration_ms`)
  - alert create/update/delete
  - deals browse/suggest and search autocomplete (with `duration_ms`)
  - inbound fresh-stock accept
- Extended admin routes with:
  - delivery options CRUD:
    - `GET /api/v1/admin/delivery-options`
    - `POST /api/v1/admin/delivery-options`
    - `PUT /api/v1/admin/delivery-options/:id`
    - `DELETE /api/v1/admin/delivery-options/:id` (soft deactivate)
  - analytics KPI endpoint:
    - `GET /api/v1/admin/analytics/kpis?days=7`
    - returns totals, funnel counts, p50/p95 performance metrics, stale delivery-option count, top events
- Added route-level E2E coverage for this slice:
  - `admin delivery options and analytics KPI route e2e`

### Verification Snapshot (EPIC-08 slice)

- `npm run test:e2e` passes (5/5).
- `npm run test:integration` passes (4/4).

## Update (Crawler + Release Ops Slice)

- Re-enabled previously skipped crawler adapters in orchestrator:
  - `indische-lebensmittel-online`
  - `indianfoodstore`
  - `spicelands`
  - file: `crawler/index.js`
- Added release-readiness admin endpoint:
  - `GET /api/v1/admin/release/readiness`
  - includes freshness and go/no-go checks (crawl success ratio, store freshness, ER backlog, delivery option staleness)
- Added local backend performance smoke tooling:
  - script: `npm run perf:smoke`
  - file: `scripts/perf-smoke.js`
- Added release artifacts:
  - `docs/release/PERFORMANCE_REPORT_2026-02-28.md`
  - `docs/release/RELEASE_CHECKLIST.md`
  - `docs/release/INCIDENT_RUNBOOK.md`

### Verification Snapshot (Crawler + Ops slice)

- `npm run test:e2e` passes (5/5) including admin KPI + release-readiness coverage.
- `npm run test:integration` passes (4/4).
- `npm run perf:smoke` passes PRD target checks in local in-process harness.

## Update (Epic Closure Pass: 04 -> 03 -> 02 -> 07)

### EPIC-04 (Google OAuth callback)

- Added full Google OAuth backend service and routes:
  - `server/services/google-oauth.js`
  - `POST /api/v1/auth/google` (`id_token` or `authorization_code`)
  - `GET /api/v1/auth/google/url`
  - `GET /api/v1/auth/google/callback?code=...`
- Added mock-profile mode for deterministic local tests:
  - `GOOGLE_OAUTH_MOCK_PROFILE_JSON`
- Added route-level e2e coverage:
  - `google oauth routes e2e (mock profile mode)`

### EPIC-03 (top-200 accuracy harness)

- Added fixture generator:
  - `scripts/generate-er-fixture.js`
- Added and seeded fixture:
  - `crawler/entity-resolution/fixtures/top200.fixture.json` (200 rows)
- Added accuracy harness script:
  - `scripts/entity-resolution-accuracy.js`
- Added integration test gate:
  - `tests/integration/entity-resolution-accuracy.test.js`
- Added report:
  - `docs/release/ENTITY_RESOLUTION_ACCURACY_2026-02-28.md`
- Measured accuracy:
  - `95.00%` (`>=90%` target pass)

### EPIC-02 (adapter validation tooling)

- Added adapter validation script:
  - `scripts/crawl-validation.js`
  - npm script: `npm run crawl:validate`
- Added sandbox validation report:
  - `docs/release/CRAWL_VALIDATION_REPORT_2026-02-28.md`
  - `docs/release/crawl-validation-sandbox-2026-02-28.json`
- Re-enabled previously skipped stores in crawler orchestrator (already done in prior update):
  - `indische-lebensmittel-online`
  - `indianfoodstore`
  - `spicelands`

### EPIC-07 (frontend flow completion pass)

- Enhanced list and recommendation UX:
  - voice capture wrapper on list page
  - saved lists panel and recompute shortcut
  - delivery preference toggle with recommendation recompute
  - cart transfer detail modal + post-transfer prompt
  - deal-card alert entry point (`Set Deal Alert`)
- Added QA checklist artifact:
  - `docs/release/FRONTEND_UX_QA_2026-02-28.md`

### Verification Snapshot (Epic closure pass)

- `npm run test:e2e` passes (6/6).
- `npm run test:integration` passes (5/5).
- `npm run test:er-accuracy` passes (`95%`).
- `npm run crawl:validate` executes; sandbox network limitations still prevent real external crawl success measurement.

## What Was Already in the Repo

- SQLite schema for `stores`, `deals`, `crawl_runs` only.
- No user auth endpoints (`/auth/*`) or profile endpoint (`/me`).
- Existing "auth" middleware protected only admin routes using `ADMIN_SECRET` bearer token.

## Changes Implemented

### 1) Database Layer

- Extended schema in `server/db/schema.sql` with:
  - `users`
  - `refresh_tokens`
  - related indexes
- Added additive migration guards in `server/db/index.js` for user profile columns.

### 2) Auth Utilities

- Added password hashing utility (`scrypt`) in `server/utils/password.js`.
- Added JWT utility (`HS256` sign/verify) in `server/utils/jwt.js`.

### 3) Session Store (Redis + SQL)

- Added `server/services/session-store.js`:
  - Refresh token hashing (`sha256`)
  - SQL-backed session records (`refresh_tokens`)
  - Optional Upstash Redis cache for refresh session lookup/revocation

### 4) API + Middleware

- Added user auth middleware: `server/middleware/user-auth.js`.
- Added auth routes: `server/routes/auth.js`:
  - `POST /api/v1/auth/register`
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout`
  - `POST /api/v1/auth/logout-all`
  - `POST /api/v1/auth/google` (configured check + explicit not-implemented response)
- Added profile routes: `server/routes/profile.js`:
  - `GET /api/v1/me`
  - `PUT /api/v1/me`

### 5) App Wiring + Docs

- Mounted auth/profile routers in `server/index.js`.
- Updated `.env.example` with JWT + Google OAuth settings.
- Updated `README.md` API section with auth/profile endpoints.

### 6) Frontend End-to-End Wiring (Auth Slice)

- Extended `client/src/utils/api.js` with:
  - auth session localStorage handling
  - token refresh and authenticated request retry
  - auth/profile client methods (`registerUser`, `loginUser`, `logoutUser`, `fetchMe`, `updateMe`)
- Added pages:
  - `client/src/pages/LoginPage.jsx`
  - `client/src/pages/RegisterPage.jsx`
  - `client/src/pages/ProfilePage.jsx`
- Updated routes in `client/src/App.jsx` for `/login`, `/register`, `/profile`.
- Updated `client/src/components/Header.jsx` with auth-aware nav and logout action.

### 7) Shopping Lists + Recommendation Slice (Phase-3 Core Start)

- Extended `server/db/schema.sql` with:
  - `shopping_lists`
  - `list_items`
  - `shipping_tiers`
  - `delivery_options`
  - supporting indexes
- Added POC parser service: `server/services/list-parser-lite.js` (raw text -> structured list items).
- Added recommendation service: `server/services/recommender.js`:
  - per-item best-deal match by store from active deals
  - delivery preference modes (`cheapest|fastest|same_day_if_available`)
  - shipping tier + delivery option scoring
  - cart transfer method selection via `server/services/cart-transfer.js`
- Added authenticated list CRUD routes: `server/routes/lists.js`:
  - `POST /api/v1/lists`
  - `GET /api/v1/lists`
  - `GET /api/v1/lists/:id`
  - `PUT /api/v1/lists/:id`
  - `DELETE /api/v1/lists/:id`
  - `POST /api/v1/lists/:id/items`
  - `PUT /api/v1/lists/:id/items/:itemId`
  - `DELETE /api/v1/lists/:id/items/:itemId`
- Added recommendation endpoint route: `server/routes/recommend.js`:
  - `POST /api/v1/lists/:id/recommend`
- Wired routes in `server/index.js`.
- Updated README API section for list/recommend endpoints.
- Added frontend pages:
  - `client/src/pages/ShoppingListPage.jsx`
  - `client/src/pages/RecommendationPage.jsx`
- Added frontend API methods for lists/recommendation in `client/src/utils/api.js`.
- Wired UI routes in `client/src/App.jsx` and header navigation link to `/list`.

### 8) Alerts + Inbound Webhook Slice

- Extended `server/db/schema.sql` with:
  - `canonical_products` (scaffold)
  - `price_alerts`
  - `alert_notifications`
- Added alert notification service: `server/services/alert-notifier.js` (SMTP or log fallback + audit rows).
- Added post-crawl evaluator service: `server/services/alert-evaluator.js`:
  - evaluates active `price|deal|restock_any|restock_store` alerts after crawl
  - enforces cooldown window (`ALERT_COOLDOWN_MINUTES`)
- Integrated alert evaluation into crawl pipeline (`crawler/index.js`) after snapshot save.
- Added inbound webhook route: `server/routes/inbound.js`:
  - `POST /api/v1/inbound/fresh-stock`
  - validates `X-Webhook-Signature` using store `webhook_secret`
  - async dispatch for `fresh_arrived` alerts
- Added profile alert endpoints in `server/routes/profile.js`:
  - `GET /api/v1/me/alerts`
  - `POST /api/v1/me/alerts`
  - `PUT /api/v1/me/alerts/:id`
  - `DELETE /api/v1/me/alerts/:id`
- Added admin alert activity endpoint:
  - `GET /api/v1/admin/alerts/activity`
- Added minimal frontend alert management UI in `client/src/pages/ProfilePage.jsx`.
- Added frontend API methods for alerts in `client/src/utils/api.js`.

### 9) Entity-Resolution Scaffold (Foundational)

- Added `crawler/entity-resolution/` module structure:
  - `normaliser.js`
  - `fuzzy-matcher.js`
  - `ai-resolver.js` (stub)
  - `index.js`
  - `synonyms.json`
- Current status:
  - normalisation + fuzzy logic ready for integration
  - AI resolver intentionally stubbed (`UNSURE`) pending Anthropic API wiring
  - full AI-backed decisioning deferred to Anthropic wiring

### 10) Canonical Mapping Integration + APIs

- Added canonical mapping service: `server/services/canonicalizer.js`:
  - maps crawled deals to `canonical_products`
  - writes `deal_mappings`
  - updates `deals.canonical_id`
  - pushes ambiguous rows into `entity_resolution_queue`
- Integrated canonicalization into crawl pipeline (`crawler/index.js`) before alert evaluation.
- Added canonical/search API routes:
  - `GET /api/v1/canonical`
  - `GET /api/v1/canonical/:id`
  - `GET /api/v1/search/autocomplete`
- Added admin queue APIs:
  - `GET /api/v1/admin/entity-resolution/queue`
  - `POST /api/v1/admin/entity-resolution/resolve`
- Updated list item creation to resolve canonical IDs at write time (where possible).
- Updated recommender to prefer canonical matching and use cart transfer strategy service.

### 11) Integration Tests Added (and Passing)

- Added `node:test` integration tests using `node:sqlite` in-memory DB:
  - `tests/integration/canonicalizer.test.js`
  - `tests/integration/recommender.test.js`
  - `tests/integration/alerts.test.js`
- Added helper: `tests/integration/helpers.js`.
- Added npm script: `npm run test:integration`.
- Current status: all integration tests passing in this workspace.

## Architectural Decisions (Applied)

- User/profile data stays in SQL (source of truth).
- Refresh session state is persisted in SQL and cached in Upstash when configured.
- Existing admin secret middleware remains unchanged for admin endpoints.

## Remaining Gaps (Not Included in This Session)

- Full Google OAuth callback flow implementation.
- Claude API list parsing integration for list items (currently lightweight parser).
- Full alerts/webhooks/admin/analytics/performance epics.
- AI resolver integration for ambiguous canonical matches (currently stubbed `UNSURE`).
- Advanced cart transfer from persisted platform product IDs (current implementation infers from URLs and falls back).
- Broader automated suite for auth/lists/recommendation/alerts route-level behavior (current tests focus on service integration).

## Files Touched

- `server/db/schema.sql`
- `server/db/index.js`
- `server/index.js`
- `server/middleware/user-auth.js` (new)
- `server/routes/auth.js` (new)
- `server/routes/profile.js` (new)
- `server/utils/password.js` (new)
- `server/utils/jwt.js` (new)
- `server/services/session-store.js` (new)
- `.env.example`
- `README.md`
- `client/src/utils/api.js`
- `client/src/components/Header.jsx`
- `client/src/pages/LoginPage.jsx` (new)
- `client/src/pages/RegisterPage.jsx` (new)
- `client/src/pages/ProfilePage.jsx` (new)
- `client/src/App.jsx`
- `server/services/list-parser-lite.js` (new)
- `server/services/recommender.js` (new)
- `server/services/cart-transfer.js` (new)
- `server/routes/lists.js` (new)
- `server/routes/recommend.js` (new)
- `client/src/pages/ShoppingListPage.jsx` (new)
- `client/src/pages/RecommendationPage.jsx` (new)
- `server/services/alert-notifier.js` (new)
- `server/services/alert-evaluator.js` (new)
- `server/routes/inbound.js` (new)
- `server/routes/admin.js`
- `crawler/index.js`
- `server/services/canonicalizer.js` (new)
- `server/routes/canonical.js` (new)
- `server/routes/search.js` (new)
- `crawler/entity-resolution/synonyms.json` (new)
- `crawler/entity-resolution/normaliser.js` (new)
- `crawler/entity-resolution/fuzzy-matcher.js` (new)
- `crawler/entity-resolution/ai-resolver.js` (new)
- `crawler/entity-resolution/index.js` (new)
- `tests/integration/helpers.js` (new)
- `tests/integration/canonicalizer.test.js` (new)
- `tests/integration/recommender.test.js` (new)
- `tests/integration/alerts.test.js` (new)
- `package.json`
- `docs/planning/SESSION_SUMMARY_2026-02-28_auth-profile-redis.md` (new)

## Validation Notes

- Backend syntax checks passed for all changed JS files.
- Client JSX static parsing/build remains blocked by incomplete local client dependency install state in this workspace.
- Integration test suite (`npm run test:integration`) passes using in-memory `node:sqlite`.
- Runtime API smoke test via live Express app is still blocked here by `better-sqlite3` native bindings for current Node runtime (`node-v137`). Rebuild/install is required for full endpoint smoke verification.

## Update (2026-03-02 UI Alignment + Replacement Expansion)

### Scope Completed This Session

Primary focus was frontend behavior and UX parity with the prototype + UI mock references, while preserving existing backend recommendation APIs.

Implemented against:

- `smart_shopping_list_prototype.jsx`
- `ui_images/smart_shopping_list.jpeg`
- `ui_images/recommendation_page.jpeg`
- `ui_images/recommendation_page_2.jpeg`

### Shopping List Page Changes

- Converted page to suggestion-first builder UX.
- Removed list-management controls from the visible flow:
  - no list-name field
  - no save-list button
  - no delete-list controls
  - no saved-lists panel in the active UI
- Kept text + voice item entry and prioritized suggestions (`Recent` -> `Frequent` -> `Global`).
- Applied row-based list editing with:
  - zebra striping
  - inline quantity controls (`-` / `+`)
  - remove (`X`)
  - direct quantity editing input
  - category-constrained unit selection (e.g. rice/dal: `g|kg`, eggs: `pcs`, oil: `ml|L`)
- Added per-item quantity/unit cost hints:
  - pulls cheapest in-stock deal hint via `/deals` query
  - shows approximate total cost when conversion is possible
  - otherwise shows fallback rate/pack hint
- Submit CTA remains single action: `Find best prices`.

### Recommendation Page Changes

- Updated top-level layout to match mock style:
  - heading `2. Best Prices for Your List`
  - `Back to list` button
  - button-style sort toggles (`Sort by EUR Total`, `Sort by Availability`)
- Kept store cards with subtotal/shipping and itemized rows.
- Continued explicit info blocks for brand/size differences.

### Replacement Flow Expansion

Store-locked replacement modal flow now supports all three trigger types:

1. Missing items (`Not found` rows)
2. Brand changed items
3. Size changed items

Technical behavior:

- Added `Search replacement` buttons inside brand-change and size-diff blocks.
- Modal remains constrained to selected store catalog search.
- Replacement apply now maps target list item by `list_item_id` when available (for matched rows), and falls back to text matching for missing-item rows.
- After apply, recommendation is recomputed from updated list state.

### Runtime + Validation

- `npm run build:client` passed after each major UI patch.
- Local app was reloaded and verified on `http://localhost:3000` (`HTTP 200`).
- Runtime continues to use `node:sqlite` fallback in this environment when `better-sqlite3` native binding is unavailable.

### Files Updated in This Session

- `client/src/pages/ShoppingListPage.jsx`
- `client/src/pages/RecommendationPage.jsx`
- `docs/planning/SESSION_SUMMARY_2026-02-28_auth-profile-redis.md` (this update)

## Update (2026-03-02 Strict Brand + Category Matcher Hardening)

### Problem Addressed

- Incorrect substitutions were still being accepted for strict branded queries:
  - `annam idly rice` matching wrong-brand rice
  - `annam idly rice` matching snack products like `Annam Rice Murukku`

### Backend Matching Changes

- Enforced strict post-selection eligibility in recommender flow:
  - Category must match parsed item intent (`rice`, `dal`, `masala`, etc.).
  - If a brand is requested, brand must match exactly (with controlled fuzzy tolerance for common typo variants).
  - Variant mismatch (`variant_differs:*`) is treated as not-found for strict recommendation output.
- Added category inference from both:
  - deal `product_category`
  - product name lexical signals (to reject cross-category products such as snacks).
- Improved brand matcher to accept common token variants like `maggie` -> `maggi` without relaxing short-token strictness.

### Test Coverage Added/Updated

- Updated strict brand mismatch tests to expect no winner when brand differs.
- Added explicit regression test:
  - rejects wrong-brand rice and snack (`murukku`) for `annam idly rice`.
- Integration suite status after updates:
  - `npm run test:integration` passed (`19/19`).

### Runtime Verification

- Restarted local app and verified availability on `http://localhost:3000` (`HTTP 200`) after matcher updates.

### Files Updated

- `server/services/recommender.js`
- `tests/integration/recommender.test.js`
- `docs/planning/SESSION_SUMMARY_2026-02-28_auth-profile-redis.md` (this update)
