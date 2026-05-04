# Codebase Structure

**Analysis Date:** 2026-05-04

## Directory Layout

```
desi-deals-24-landing-page/
├── server/                  # Node.js Express backend (CommonJS)
│   ├── index.js             # Entry point — Express app, route mounting, scheduler, SPA serve
│   ├── db/
│   │   ├── index.js         # libsql/Turso client + better-sqlite3 shim
│   │   └── schema.sql       # DDL for all 30 tables; auto-run on startup
│   ├── routes/              # 21 Express router modules
│   ├── services/            # Domain logic shared across routes and crawler
│   ├── middleware/          # auth.js, user-auth.js, user-admin-auth.js
│   └── utils/               # jwt.js, admin-access.js, password.js
├── crawler/                 # Standalone crawler process (CommonJS)
│   ├── index.js             # runCrawl() orchestrator — 31 adapters, entity resolution
│   ├── scheduler.js         # node-cron 08:00 Europe/Berlin + CRAWL_ON_STARTUP
│   ├── on-demand-crawl.js   # Single-store re-crawl utility
│   ├── stores/              # 31 store adapters (one file per store)
│   ├── utils/               # price-parser, weight-parser, category-mapper, shopify-catalog, etc.
│   └── entity-resolution/   # fuzzy-matcher, normaliser, synonyms, ai-resolver
├── client/                  # React SPA (Vite + ESM)
│   ├── src/
│   │   ├── main.jsx         # React DOM root
│   │   ├── App.jsx          # React Router v6 routes
│   │   ├── index.css        # Global styles (Tailwind base)
│   │   ├── DealsPage.jsx    # Main deals listing (69KB — largest page)
│   │   ├── CartPage.jsx     # Cart management
│   │   ├── ComparePage.jsx  # Cross-store compare results
│   │   ├── CatalogPage.jsx  # Canonical product catalog
│   │   ├── OrdersPage.jsx   # Order history (46KB)
│   │   ├── DealSharePage.jsx# Shareable deal link
│   │   ├── OAuthCallbackPage.jsx
│   │   ├── AdLandingPage.jsx# Instagram/ad landing page
│   │   ├── ListPage.jsx     # Shopping list redirect
│   │   ├── components/      # Shared UI components
│   │   ├── hooks/           # React hooks (useCart, useStoreProducts)
│   │   ├── utils/
│   │   │   └── api.js       # All HTTP calls + auth session management
│   │   ├── pages/           # Additional page components
│   │   └── landing/
│   │       └── AdminPage.jsx# Admin panel (74KB)
│   ├── dist/                # Built SPA (served by Express in prod) — gitignored
│   └── package.json         # React 18, React Router 6, Tailwind 3, Vite 5
├── tests/
│   ├── client/              # Frontend tests
│   ├── e2e/                 # End-to-end tests (node --test)
│   ├── integration/         # Integration tests (node --test)
│   └── regression/          # Regression tests (.test.mjs, node --test)
├── scripts/                 # One-off migration and operational scripts
│   ├── migrate-schema-to-prod.js  # Idempotent Turso production DB migration
│   ├── seed-priority-canonicals.js
│   ├── migrate-real-savings.js
│   └── process-pending-queue-openai-batch.js (and related)
├── data/                    # Local DB files (not deployed)
│   └── prod_local.db        # Production data snapshot for local dev
├── docs/
│   └── wiki/                # Project wiki (index.md, decisions.md, etc.)
├── api/                     # Vercel serverless function entry (if used)
├── logs/                    # Crawler/server log output
├── .planning/
│   └── codebase/            # GSD codebase maps (this directory)
├── .agents/skills/          # Project skill definitions
├── package.json             # Root: Express, libsql, node-fetch v2, cheerio, etc.
├── vercel.json              # Vercel deployment config
└── CLAUDE.md                # Project instructions for Claude
```

## Directory Purposes

**`server/routes/`:**
- Purpose: One Express router module per API domain
- Contains: 21 `.js` files, each exports a router
- Key files:
  - `store-products.js` — deal listing, filtering, pagination, replacements (26KB)
  - `auth.js` — email magic-link, JWT, Google/Facebook OAuth (37KB)
  - `admin.js` — crawl control, entity resolution, analytics (25KB)
  - `lists.js` — shopping list CRUD + items (20KB)
  - `orders.js` — order history
  - `catalog.js` — canonical product search/suggest
  - `compare.js` — cross-store cart comparison
  - `admin-review-queue.js` — manual review queue for entity resolution (17KB)

**`server/services/`:**
- Purpose: Domain logic shared by both routes and crawler
- Contains: 35+ `.js` files
- Key files:
  - `canonicalizer.js` — entity resolution pipeline, canonical upsert
  - `cart-comparator.js` — cross-store price comparison engine
  - `recommender.js` — smart list recommendations (79KB — largest service)
  - `item-matcher.js` — fuzzy/brand-aware product matching (13KB)
  - `product-replacements.js` — substitute product suggestions (10KB)
  - `real-savings.js` — savings computation vs. regular price (11KB)
  - `store-product-order.js` — stable daily display order (10KB)
  - `base-product-catalog.js` — base product slot management (8KB)
  - `grocery-synonyms.js` — synonym expansion for search (17KB)

**`crawler/stores/`:**
- Purpose: One scraper per store; 31 adapters total
- Contains: `.js` files named by store slug (e.g., `jamoona.js`, `little-india.js`)
- Pattern: Every file exports `{ storeId, storeName, storeUrl, scrape() }`
- Scraping methods by adapter type:
  - Shopify JSON API (`/collections/{handle}/products.json`): jamoona, dookan, namma-markt
  - WooCommerce HTML + Cheerio (paginated): little-india
  - HTMX + Cheerio: grocera
  - Custom HTML + Cheerio: most others

**`crawler/utils/`:**
- Purpose: Shared parsing utilities used by multiple store adapters
- Key files: `price-parser.js`, `weight-parser.js`, `category-mapper.js`, `shopify-catalog.js`, `pass1-fetcher.js`, `auto-mapper.js`, `canonical-decomposer.js`

**`crawler/entity-resolution/`:**
- Purpose: Fuzzy matching pipeline for canonical product linking
- Key files: `index.js`, `fuzzy-matcher.js`, `normaliser.js`, `synonyms.json`

**`client/src/components/`:**
- Purpose: Reusable React UI components
- Key files:
  - `ProductCard.jsx` — deal card (8KB)
  - `ReplacementsModal.jsx` — replacement product selection (20KB)
  - `StoreComparisonCard.jsx` — per-store cart compare result (19KB — in `comparison/`)
  - `FiltersModal.jsx` — category/store filter UI (10KB)
  - `SearchWithSuggest.jsx` — debounced search with suggestions (8KB)

**`client/src/hooks/`:**
- Purpose: React custom hooks
- Key files: `useCart.js`, `useStoreProducts.js`, `CartContext.js`

## Key File Locations

**Entry Points:**
- `server/index.js`: Express server — all routes mounted here, scheduler started, SPA served
- `crawler/index.js`: Exports `runCrawl(db, opts)` — full crawl pipeline
- `client/src/main.jsx`: React DOM root
- `client/src/App.jsx`: React Router v6 route definitions

**Configuration:**
- `package.json`: Root dependencies and npm scripts
- `client/package.json`: Frontend dependencies
- `server/db/schema.sql`: Complete DB schema — 30 tables
- `vercel.json`: Vercel deployment rewrite rules
- `.env.local`: Local env overrides (not committed)

**Core Logic:**
- `server/routes/store-products.js`: Main deals query engine with dynamic SQL
- `server/services/canonicalizer.js`: Entity resolution — links listings to canonical products
- `server/services/cart-comparator.js`: Cross-store cart comparison
- `crawler/index.js`: Crawl orchestration pipeline
- `client/src/utils/api.js`: All frontend HTTP calls + auth session

**DB:**
- `server/db/index.js`: DB client, shim, migration runner
- `server/db/schema.sql`: DDL source of truth

**Testing:**
- `tests/regression/` — regression test suite (`.test.mjs`)
- `tests/integration/` — integration tests (`.test.js`)
- `tests/e2e/` — e2e tests (`.test.js`)

## Naming Conventions

**Files (backend):**
- `kebab-case.js` for all server and crawler files
- Route files named after their API path segment: `store-products.js` → `/api/v1/store-products`
- Service files named after their function: `cart-comparator.js`, `price-history-recorder.js`

**Files (frontend):**
- `PascalCase.jsx` for React components and pages
- `camelCase.js` for utilities and hooks
- Page-level files live in `client/src/` root (flat, not in a `pages/` subfolder)

**Directories:**
- `server/`, `crawler/`, `client/` — top-level system boundaries
- All lowercase with hyphens for directories

**Store adapter IDs:**
- `storeId` is a kebab-case string matching the filename: `"little-india"` in `crawler/stores/little-india.js`

## Where to Add New Code

**New API endpoint:**
- Create router in `server/routes/<name>.js` following existing pattern
- Mount in `server/index.js`: `app.use("/api/v1/<name>", require("./routes/<name>"))`
- If endpoint needs user auth: import and apply `requireUserAuth` from `server/middleware/user-auth.js`
- If admin-only: apply `requireAuth` from `server/middleware/auth.js`

**New domain service:**
- Add to `server/services/<name>.js`
- Use `module.exports = { functionName }` pattern
- Must be CommonJS — no `import`/`export`

**New store adapter:**
- Create `crawler/stores/<store-id>.js`
- Export `{ storeId, storeName, storeUrl, scrape }` matching interface
- Register in the stores array in `crawler/index.js`

**New React page:**
- Create `client/src/<PageName>Page.jsx`
- Add `<Route path="/<path>" element={<PageName />} />` in `client/src/App.jsx`
- All API calls go through `client/src/utils/api.js` — add named exports there

**New API call from frontend:**
- Add a named export function to `client/src/utils/api.js`
- Use `request()` for public endpoints, `authRequest()` for auth-required endpoints
- Import in the page/component that needs it

**New shared UI component:**
- Add to `client/src/components/<ComponentName>.jsx`

**New DB table:**
- Add `CREATE TABLE IF NOT EXISTS` to `server/db/schema.sql`
- Schema auto-runs on server startup via `alwaysMigrations` in `server/db/index.js`
- For production Turso sync: use `scripts/migrate-schema-to-prod.js`

**New crawler utility:**
- Add to `crawler/utils/<name>.js` (shared by adapters)
- Or to `server/services/<name>.js` if also needed by routes

**New test:**
- Regression: `tests/regression/<name>.test.mjs`
- Integration: `tests/integration/<name>.test.js`
- E2E: `tests/e2e/<name>.test.js`
- Run with `node --test tests/<type>/*.test.{js,mjs}`

## Special Directories

**`data/`:**
- Purpose: Local SQLite DB files for development; production snapshot
- Generated: Yes (by crawler runs and DB operations)
- Committed: Partially — `prod_local.db` is the reference local snapshot; `.zip` archives present

**`client/dist/`:**
- Purpose: Built React SPA; served by Express in production
- Generated: Yes (`npm run build:client`)
- Committed: No (gitignored except `index.html` which has a tracked modification)

**`.planning/codebase/`:**
- Purpose: GSD codebase maps consumed by `/gsd-plan-phase` and `/gsd-execute-phase`
- Generated: Yes (by GSD mapping agents)
- Committed: Yes

**`scripts/`:**
- Purpose: One-off operational scripts — DB migrations, batch processing, seeding
- Generated: No
- Committed: Yes

**`logs/`:**
- Purpose: Crawler and server log output
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-05-04*
