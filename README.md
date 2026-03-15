# DesiDeals24

Desi grocery deals aggregator for Germany. Automatically crawls 5 online stores, aggregates current sales and discounts, and presents them in a searchable, filterable React UI.

**Live stores:** Jamoona · Dookan · Namma Markt · Little India · Grocera

---

## Quick Start

### 1. Install dependencies

```bash
# Server dependencies
npm install

# Client dependencies
cd client && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` if needed (defaults work for local development):

| Variable                      | Default                  | Description                                                  |
| ----------------------------- | ------------------------ | ------------------------------------------------------------ |
| `PORT`                        | `3000`                   | Express server port                                          |
| `DB_PATH`                     | `./data/desiDeals24.db`  | SQLite database file                                         |
| `TURSO_DATABASE_URL`          | —                        | Remote Turso/libsql database URL                             |
| `TURSO_AUTH_TOKEN`            | —                        | Turso auth token                                             |
| `ADMIN_SECRET`                | `changeme-in-production` | Bearer token for admin endpoints                             |
| `CRAWL_ON_STARTUP`            | `false`                  | Set `true` to crawl immediately on server start              |
| `CRAWL_LOCK_TTL_MINUTES`      | `180`                    | Shared crawl lock expiry for Turso-backed crawl runs         |

### 3. Run the crawler (fetch deals)

```bash
npm run crawl
```

Expected output:

```
=== Crawl run <uuid> started ===
--- Crawling: Jamoona ---
[jamoona] Found 91 deals
✓ Jamoona: 91 deals stored
...
=== Crawl finished: 5/5 stores, 423 deals ===
```

### 4. Start the server

```bash
npm start
```

The server starts at **http://localhost:3000**

- Frontend UI: http://localhost:3000
- Deals API: http://localhost:3000/api/v1/deals

---

## Development Mode

Run the backend with auto-reload and the React dev server concurrently:

```bash
# Terminal 1 — backend (auto-reloads on changes)
npm run dev

# Terminal 2 — frontend dev server with hot reload
cd client && npm run dev
```

Frontend dev server runs at **http://localhost:5173** and proxies `/api` requests to the backend on port 3000.

---

## Build for Production

```bash
npm run build:client
```

This builds the React app into `client/dist/`. The Express server automatically serves it from that path.

---

## Daily Crawl Lifecycle

### How availability is maintained

1. At 06:00 Europe/Berlin, the full crawl writes directly into SQLite or Turso.
2. The crawler updates only changed products, inserts new products, and deactivates removed ones.
3. At 07:00 Europe/Berlin, the app fixes the daily 24-deal pool for that Berlin date.
4. The landing page and unlocked deals page read directly from that daily pool.
5. Products are excluded from the pool if they appeared in the prior rolling 7-day window.

### Daily pool rules

- The pool is fixed for the day once generated.
- No intra-day re-curation happens after the pool is fixed.
- Only currently active, in-stock deals are materialized for viewing.

### Serverless note (Vercel)

- Vercel cron runs hourly and the handler gates execution in code using Europe/Berlin time.
- That keeps the 06:00 crawl and 07:00 pool generation aligned across DST changes.
- Ensure function `maxDuration` is high enough for your store count.

---

## Project Structure

```
desi-deals-24/
├── server/
│   ├── index.js              # Express app entry point
│   ├── db/
│   │   ├── schema.sql        # SQLite schema (deals, stores, crawl_runs)
│   │   └── index.js          # DB singleton + schema migration + store seeding
│   ├── routes/
│   │   ├── deals.js          # GET /api/v1/deals, GET /api/v1/deals/:id
│   │   ├── stores.js         # GET /api/v1/stores, GET /api/v1/stores/:id
│   │   ├── categories.js     # GET /api/v1/categories
│   │   └── admin.js          # POST /crawl/trigger, GET /crawl/status, GET /proxy/image
│   └── middleware/
│       └── auth.js           # Bearer token auth for admin routes
│
├── crawler/
│   ├── index.js              # Orchestrator — runs all store adapters sequentially
│   ├── scheduler.js          # node-cron daily scheduler
│   ├── stores/
│   │   ├── jamoona.js        # Shopify JSON API
│   │   ├── dookan.js         # Shopify JSON API (dynamic collection discovery)
│   │   ├── namma-markt.js    # Shopify JSON API
│   │   ├── little-india.js   # WooCommerce + Cheerio
│   │   └── grocera.js        # Custom HTMX site + Cheerio
│   └── utils/
│       ├── price-parser.js   # Handles EN (3.29) and DE (3,29) decimal formats
│       ├── weight-parser.js  # Extracts weight from product names (500g, 1kg, etc.)
│       ├── category-mapper.js # Maps product names to 16 categories
│       └── image-resolver.js # Picks best-resolution image from srcset/data-attrs
│
├── client/
│   ├── src/
│   │   ├── pages/            # HomePage, DealsPage, StorePage, CategoryPage
│   │   ├── components/       # Header, DealCard, DealsGrid, FilterPanel, Pagination, EmptyState
│   │   ├── hooks/            # useDeals (debounced), useStores
│   │   └── utils/            # api.js (fetch wrapper), formatters.js (price/time)
│   ├── index.html
│   ├── vite.config.js        # Proxies /api → localhost:3000
│   └── tailwind.config.js    # Design tokens (saffron-orange, deep green, off-white)
│
├── data/
│   └── desiDeals24.db        # SQLite database (gitignored)
│
├── .env.example              # Environment variable template
└── package.json
```

---

## API Reference

All endpoints are prefixed with `/api/v1`.

### `GET /deals`

Returns paginated, filterable list of active deals.

| Param          | Default         | Description                                          |
| -------------- | --------------- | ---------------------------------------------------- |
| `q`            | —               | Search product name                                  |
| `store`        | —               | Filter by store slug (comma-separated)               |
| `category`     | —               | Filter by category                                   |
| `min_discount` | —               | Minimum discount %                                   |
| `max_price`    | —               | Maximum sale price (EUR)                             |
| `availability` | `in_stock`      | `in_stock`, `out_of_stock`, `all`                    |
| `sort`         | `discount_desc` | `discount_desc`, `price_asc`, `price_desc`, `newest` |
| `page`         | `1`             | Page number                                          |
| `limit`        | `24`            | Results per page (max 100)                           |

```bash
# Top discounts, max €10, first page
curl "http://localhost:3000/api/v1/deals?sort=discount_desc&max_price=10&limit=5"
```

### `GET /stores`

All stores with active deal counts.

### `GET /categories`

All product categories with deal counts.

### `GET /canonical`

List canonical products with optional `q`, `category`, `limit`.

### `GET /canonical/:id`

Canonical product detail with active store variants.

### `GET /search/autocomplete?q=`

Autocomplete suggestions from canonical names (fallback to raw deal names).

### `POST /auth/register`

Create user account and return auth tokens.

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@example.com","password":"supersecret123","postcode":"80331"}'
```

### `POST /auth/login`

Login with email/password and return `{accessToken, refreshToken}`.

### `POST /auth/google`

Google OAuth login using either `id_token` or `authorization_code` payload.

### `GET /auth/google/url`

Returns Google OAuth consent URL for redirect-based login flows.

### `GET /auth/google/callback?code=...`

OAuth callback endpoint that exchanges Google code and returns app auth tokens.

### `POST /auth/refresh`

Exchange refresh token for a fresh token pair.

### `GET /me`

Get current user profile. Requires `Authorization: Bearer <accessToken>`.

### `PUT /me`

Update user profile fields (`postcode`, `city`, `dietary_prefs`, `preferred_stores`, `blocked_stores`, `preferred_brands`, `delivery_speed_pref`).

### `GET /me/alerts`

List all alerts for authenticated user.

### `POST /me/alerts`

Create alert (`price|deal|restock_any|restock_store|fresh_arrived`) using `product_query` or `canonical_id`.

### `PUT /me/alerts/:id`

Update alert threshold/activation.

### `DELETE /me/alerts/:id`

Delete alert.

### `POST /inbound/fresh-stock`

Inbound store webhook (HMAC via `X-Webhook-Signature`) for `fresh_arrived` notifications.

### `POST /lists`

Create shopping list from `raw_input` and auto-split into items.

### `GET /lists`

Get all shopping lists for the authenticated user.

### `GET /lists/:id`

Get list details with items.

### `POST /lists/:id/recommend`

Compute best store recommendation from current active deals.

### `GET /admin/crawl/status`

Status of the most recent crawl run.

### `GET /admin/alerts/activity`

Admin alert volume and delivery status summary (7d notifications).

### `GET /admin/entity-resolution/queue`

Get pending/manual-resolution queue rows (admin token required).

### `POST /admin/entity-resolution/resolve`

Confirm/reject queue mappings (`{ queue_id|deal_id, canonical_id, verdict }`).

### `GET /admin/delivery-options`

List delivery options with staleness metadata (`stale=true` when `updated_at` is older than 45 days).

### `POST /admin/delivery-options`

Create a delivery option (`store_id`, `delivery_type`, `label`, optional surcharge/cutoff/eligibility fields).

### `PUT /admin/delivery-options/:id`

Update delivery option fields and refresh `updated_at`.

### `DELETE /admin/delivery-options/:id`

Soft-deactivate a delivery option (`is_active=0`).

### `GET /admin/analytics/kpis`

KPI snapshot from the `events` table (funnel, active users, p50/p95 browse/search/recommend durations, stale delivery-option count).

### `GET /admin/release/readiness`

Release readiness summary with pass/fail checks (crawl success ratio, store freshness, pending ER queue, stale delivery options).

### `POST /admin/crawl/trigger`

Manually trigger a crawl. Requires `Authorization: Bearer <ADMIN_SECRET>` header.

```bash
curl -X POST http://localhost:3000/api/v1/admin/crawl/trigger \
  -H "Authorization: Bearer desiDeals24-dev-secret"
```

### `GET /admin/proxy/image?url=<encoded>`

Proxies product images to avoid CORS issues in the frontend.

### `npm run perf:smoke`

Runs an in-process backend performance smoke benchmark and outputs JSON metrics for browse/search/recommend paths.

### `npm run crawl:validate`

Runs adapter-level crawl validation and outputs per-store status (`ok|empty|error`) and success-rate summary.

### `npm run test:er-accuracy`

Runs top-200 entity-resolution accuracy harness and enforces minimum threshold (default `>=90%`).

---

## Adding a New Store

1. Create `crawler/stores/<store-slug>.js` following the adapter pattern:

```js
"use strict";
const fetch = require("node-fetch");

module.exports = {
  storeId: "my-store",
  storeName: "My Store",
  storeUrl: "https://mystore.de",
  async scrape() {
    // fetch deals, return array of deal objects
    return deals;
  },
};
```

2. Seed the store in `server/db/index.js` (`INSERT OR IGNORE INTO stores ...`).

3. Import and add the adapter in `crawler/index.js`.

Deal objects must include: `store_id`, `product_name`, `product_url`, `sale_price`, `currency`, `availability`. See `crawler/stores/jamoona.js` for a full reference.

---

## Tech Stack

| Layer     | Technology                                           |
| --------- | ---------------------------------------------------- |
| Backend   | Node.js + Express (CommonJS)                         |
| Database  | SQLite via better-sqlite3 (synchronous)              |
| Crawler   | node-fetch v2 + Cheerio (no headless browser needed) |
| Scheduler | node-cron                                            |
| Frontend  | React 18 + Vite + Tailwind CSS                       |
| Routing   | React Router v6                                      |
