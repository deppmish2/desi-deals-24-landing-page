<!-- refreshed: 2026-05-04 -->
# Architecture

**Analysis Date:** 2026-05-04

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         React SPA (Vite + React 18)                  │
│   /  /deals  /cart  /compare/:id  /products  /orders  /admin         │
│   client/src/App.jsx                                                  │
└──────────────┬───────────────────────────────────────────────────────┘
               │  HTTP (proxied in dev: :5173 → :3000)
               │  Static serve in prod (Express serves client/dist/)
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Express Server  server/index.js                    │
│   CORS → Morgan → JSON parse → /api DB-ready guard                   │
│                                                                       │
│   /api/v1/store-products   /api/v1/auth    /api/v1/lists             │
│   /api/v1/catalog          /api/v1/me      /api/v1/compare           │
│   /api/v1/search           /api/v1/orders  /api/v1/canonical         │
│   /api/v1/admin            /api/v1/admin-dashboard                   │
│   /api/v1/health           /api/v1/contact /api/v1/waitlist          │
└──────────────┬───────────────────────────────────────────────────────┘
               │
       ┌───────┴───────────────────┐
       ▼                           ▼
┌──────────────────┐   ┌───────────────────────────────────────────────┐
│  Services Layer  │   │             Crawler  crawler/index.js          │
│  server/services/│   │  31 store adapters → deals array               │
│  canonicalizer   │   │  pass1-fetcher → auto-mapper → canonicalizer  │
│  cart-comparator │   │  price-history-recorder → display-order       │
│  recommender     │   │  Scheduled: node-cron daily 08:00 Berlin       │
│  item-matcher    │   │  crawler/scheduler.js                          │
│  product-parser  │   └────────────────┬──────────────────────────────┘
└──────┬───────────┘                    │
       │                                │
       ▼                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│               DB Layer  server/db/index.js                            │
│   @libsql/client — SQLite (local) or Turso (remote)                  │
│   prepare().get/all/run() → Promise-based better-sqlite3 shim        │
│   schema.sql auto-migrated on startup (alwaysMigrations)             │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Express server | Route mounting, middleware, SPA fallback, scheduler init | `server/index.js` |
| DB layer | libsql/Turso client, prepare() shim, schema migration | `server/db/index.js` |
| Store products route | Deal listing, filtering, pagination, replacements, real-savings | `server/routes/store-products.js` |
| Catalog route | Canonical product search, brand data, suggest | `server/routes/catalog.js` |
| Compare route | Cross-store cart price comparison | `server/routes/compare.js` |
| Orders route | Order history CRUD, status, rating | `server/routes/orders.js` |
| Lists route | Shopping list CRUD + list items | `server/routes/lists.js` |
| Auth route | Email magic-link, JWT refresh, Google/Facebook OAuth | `server/routes/auth.js` |
| Admin route | Crawl trigger, entity resolution, delivery options, KPIs | `server/routes/admin.js` |
| Admin dashboard | Brands, canonical-stats, remap jobs | `server/routes/admin-dashboard.js` |
| Admin review queue | Manual review queue for low-confidence canonical matches | `server/routes/admin-review-queue.js` |
| Canonicalizer service | Links store listings to canonical products, enqueues review | `server/services/canonicalizer.js` |
| Cart comparator service | Cross-store pricing for a given cart | `server/services/cart-comparator.js` |
| Recommender service | Smart list recommendations | `server/services/recommender.js` |
| Item matcher service | Fuzzy/brand-aware product matching | `server/services/item-matcher.js` |
| Crawler entry | Orchestrates all 31 store adapters sequentially | `crawler/index.js` |
| Crawler scheduler | node-cron daily 08:00 Europe/Berlin, optional startup crawl | `crawler/scheduler.js` |
| Store adapters | Per-store scrape() function, returns deal array | `crawler/stores/*.js` |
| React SPA | Full UI — deals, cart, compare, catalog, orders, admin | `client/src/` |
| API utility | All frontend HTTP calls, auth session, token refresh | `client/src/utils/api.js` |

## Pattern Overview

**Overall:** Monorepo — Node.js backend (CommonJS) + React SPA (ESM/Vite) in `client/`

**Key Characteristics:**
- Backend is CommonJS throughout — `require()`/`module.exports` only; no `import`/`export`
- Frontend is ESM (Vite) — `import`/`export` only
- No ORM — raw SQL via dynamic query builder in `server/routes/store-products.js` and direct `db.prepare().all/get/run()` in routes
- Services layer (`server/services/`) encapsulates domain logic shared across routes and crawler
- Crawler is a separate process (`node crawler/index.js`) that writes to the same DB; server and crawler share services via `require()`

## Layers

**Frontend (React SPA):**
- Purpose: User-facing UI and admin panel
- Location: `client/src/`
- Contains: Pages, components, hooks, API client
- Depends on: `client/src/utils/api.js` for all server calls
- Used by: Browser

**API Layer (Express Routes):**
- Purpose: HTTP interface; validates input, delegates to services or DB, returns JSON
- Location: `server/routes/`
- Contains: 21 route modules
- Depends on: `server/db/`, `server/services/`, `server/middleware/`
- Used by: React SPA, crawler (indirect via shared DB)

**Services Layer:**
- Purpose: Domain logic too complex for a route handler; reused by routes and crawler
- Location: `server/services/`
- Contains: canonicalizer, cart-comparator, recommender, item-matcher, product-parser, price-history-recorder, real-savings, product-replacements, store-product-order, search expanders, alert-evaluator, etc.
- Depends on: `server/db/`, crawler entity-resolution utils
- Used by: Routes, `crawler/index.js`

**DB Layer:**
- Purpose: Unified async libsql/Turso client with better-sqlite3-compatible shim
- Location: `server/db/index.js`
- Contains: `execute()`, `query()`, `prepare()`, `batch()`, `transaction()` wrappers
- Depends on: `@libsql/client`, `server/db/schema.sql`
- Used by: All routes, services, crawler

**Crawler:**
- Purpose: Fetch deals from 31 Indian grocery stores in Germany; write to DB
- Location: `crawler/index.js`, `crawler/stores/`, `crawler/utils/`
- Contains: 31 store adapters, entity-resolution pipeline, utility parsers
- Depends on: `server/services/` (canonicalizer, price-history-recorder, etc.), `server/db/`
- Used by: `crawler/scheduler.js` (cron), admin trigger (`/api/v1/admin/crawl/trigger`)

**Middleware:**
- Purpose: Auth guards
- Location: `server/middleware/`
- Contains: `auth.js` (admin Bearer token), `user-auth.js` (JWT access token), `user-admin-auth.js`
- Depends on: `server/utils/jwt.js`
- Used by: Route handlers as `requireAuth` / `requireUserAuth`

## Data Flow

### Primary Request Path — Deal Listing

1. Browser calls `fetchDeals(params)` → `GET /api/v1/store-products` (`client/src/utils/api.js:134`)
2. Route handler builds dynamic SQL, queries `store_products` + `canonical_products` (`server/routes/store-products.js:246`)
3. `buildStableDisplayOrder()` applies deterministic daily sort (`server/services/store-product-order.js`)
4. `batchGetRealSavings()` annotates each deal with savings data (`server/services/real-savings.js`)
5. `serializeDeal()` normalizes the row shape for the frontend (`server/routes/store-products.js:106`)
6. Response JSON consumed by `DealsPage.jsx` (`client/src/DealsPage.jsx`)

### Crawl Pipeline

1. `runCrawl(db)` invoked by scheduler or admin trigger (`crawler/index.js`)
2. `acquireCrawlLock()` prevents concurrent runs (`crawler/utils/snapshot.js`)
3. Each store adapter's `scrape()` runs sequentially with 2–5s random delay
4. Deals written to `store_products`, old deals marked `is_active = 0`
5. `runPass1()` fetches full product catalogs for Shopify stores (`crawler/utils/pass1-fetcher.js`)
6. `autoMapDeals()` attempts canonical mapping for new deals (`crawler/utils/auto-mapper.js`)
7. `canonicalizeDeals(db)` runs entity resolution pipeline (`server/services/canonicalizer.js`)
8. Low-confidence matches enqueued to `entity_resolution_queue` for admin review
9. `recordStoreHistory()` updates `price_history` (`server/services/price-history-recorder.js`)
10. `buildStableDisplayOrder()` pre-computes display seed (`server/services/store-product-order.js`)

### Cart Comparison Flow

1. User adds deals to cart (localStorage via `useCart` hook, `client/src/hooks/useCart.js`)
2. `POST /api/v1/compare/cart` with `{ items: [...] }` (`server/routes/compare.js:9`)
3. `compareCart(db, items)` joins `store_products` + `canonical_products` across stores (`server/services/cart-comparator.js:11`)
4. Returns per-store totals with matched/missing items
5. `ComparePage.jsx` renders `StoreComparisonCard.jsx` for each store result

### Auth Flow

1. User triggers email magic-link: `POST /api/v1/auth/email-link/start` (`server/routes/auth.js:839`)
2. Token stored in `email_auth_tokens`; link emailed via nodemailer
3. `POST /api/v1/auth/email-link/complete` exchanges token for JWT access + refresh tokens
4. Tokens stored in `localStorage` via `writeAuthSession()` (`client/src/utils/api.js:15`)
5. `authRequest()` auto-refreshes access token using refresh token when 401 received

**State Management:**
- Frontend: React local state + `useSearchParams` for URL-synced filters; no Redux/Zustand
- Auth session: `localStorage` key `dd24_auth_session` (managed in `client/src/utils/api.js`)
- Cart: `localStorage` via `useCart` hook (`client/src/hooks/useCart.js`)

## Key Abstractions

**Store Adapter Interface:**
- Purpose: Uniform scraping contract for all 31 stores
- Examples: `crawler/stores/jamoona.js`, `crawler/stores/little-india.js`, `crawler/stores/grocera.js`
- Pattern: Each module exports `{ storeId, storeName, storeUrl, scrape() }`. `scrape()` returns `Promise<deal[]>` where each deal matches the shape defined in CLAUDE.md §5.3

**Canonical Products:**
- Purpose: One product entity across multiple store listings; enables cross-store price comparison
- Tables: `canonical_products`, `store_product_mappings`
- Managed by: `server/services/canonicalizer.js`
- ID format: slug strings (e.g., `tata-salt-1kg`)

**DB Prepare Shim:**
- Purpose: better-sqlite3-compatible API over async libsql so routes need minimal changes
- Pattern: `const rows = await db.prepare(sql).all(params)` — same syntax works locally (SQLite) and in prod (Turso)
- Location: `server/db/index.js:74`

**API Utility:**
- Purpose: Single module owns all HTTP calls, auth state, token refresh logic
- Location: `client/src/utils/api.js`
- Pattern: Named exports per domain (fetchDeals, fetchMe, fetchLists, etc.); internal `authRequest()` auto-refreshes JWT

## Entry Points

**Backend Server:**
- Location: `server/index.js`
- Triggers: `npm start` or `npm run dev`
- Responsibilities: Loads all routes, starts scheduler, serves React SPA from `client/dist/` in production

**Crawler:**
- Location: `crawler/index.js` (exports `runCrawl`)
- Triggers: `npm run crawl` (CLI), `crawler/scheduler.js` (cron 08:00 Berlin), `POST /api/v1/admin/crawl/trigger` (admin UI)
- Responsibilities: Sequential scrape of all active stores, entity resolution, price history recording

**Frontend:**
- Location: `client/src/main.jsx` → `client/src/App.jsx`
- Triggers: Browser load (prod: served by Express; dev: Vite on :5173)
- Responsibilities: React Router v6 routing, all UI

**On-demand Crawl:**
- Location: `crawler/on-demand-crawl.js`
- Triggers: Manual or scripted single-store re-crawl
- Responsibilities: Crawl one store without full pipeline

## Architectural Constraints

- **CommonJS only (backend):** All files in `server/` and `crawler/` use `require()`/`module.exports`. Never use `import`/`export` in backend code.
- **node-fetch v2:** `require('node-fetch')` — v3 is ESM-only and cannot be used.
- **DB always async:** Every `db.prepare().get/all/run()` call returns a Promise. Routes must be `async` with `try/catch/next(err)`. Test shim is sync — do not be misled.
- **No Playwright/Puppeteer:** Crawler uses node-fetch + Cheerio only.
- **Price parser handles both formats:** `3.29` (Shopify) and `3,29` (WooCommerce) — do not simplify to one case.
- **No ORM:** All queries are raw SQL. Query building is done manually in `server/routes/store-products.js`.
- **Threading:** Single-threaded Node.js event loop. No worker threads. Crawler runs in-process on local, GitHub Actions in serverless mode.
- **Global state:** `db` singleton exported from `server/db/index.js`; required by all routes and services.
- **Circular imports:** `server/services/canonicalizer.js` requires `crawler/entity-resolution` and `crawler/utils/canonical-decomposer`. Crawler `index.js` requires server services. This cross-boundary dependency is intentional and working but must not be deepened.

## Anti-Patterns

### Bypassing the DB shim with raw client calls

**What happens:** Calling `client.execute()` directly instead of `db.prepare().all/get/run()` or `db.execute()`
**Why it's wrong:** The shim handles argument normalization (`normaliseArgs`) needed for named params; bypassing it causes silent failures on some param shapes
**Do this instead:** Always use `db.prepare(sql).all(params)` or `db.execute(sql, params)` via the exported `db` object from `server/db/index.js`

### Synchronous DB calls in route handlers

**What happens:** Forgetting `await` on `db.prepare().get()` calls (returns Promise, not value)
**Why it's wrong:** The route returns before the DB responds; response body is `{}` or undefined
**Do this instead:** All route handlers must be `async` functions; every DB call must be `await`ed

### Direct cross-import between crawler and server routes

**What happens:** A route file `require()`-ing from `crawler/` directly
**Why it's wrong:** Creates tight coupling; crawler is a process-level concern, not a request-handling concern
**Do this instead:** Place shared logic in `server/services/`; both crawler and routes require the service

## Error Handling

**Strategy:** Express error middleware. Route handlers call `next(err)` on unexpected errors.

**Patterns:**
- All route handlers: `async (req, res, next) => { try { ... } catch(e) { next(e); } }`
- Validation errors: `return res.status(400).json({ error: "..." })` inline
- Auth failures: `return res.status(401).json({ error: "..." })` from middleware
- Global error handler registered in `server/index.js` catches unhandled route errors

## Cross-Cutting Concerns

**Logging:** `morgan("dev")` for HTTP request logs; `console.log/error` for crawler; `crawler/utils/crawl-logger.js` for structured crawl logs
**Validation:** Inline in route handlers — no schema validation library
**Authentication:** Two tiers — admin (static `ADMIN_SECRET` Bearer token via `server/middleware/auth.js`) and user (JWT via `server/middleware/user-auth.js`)
**Berlin timezone:** `server/services/berlin-time.js` used for display date keys and scheduler timezone

---

*Architecture analysis: 2026-05-04*
