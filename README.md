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
| `ADMIN_SECRET`                | `changeme-in-production` | Bearer token for admin endpoints                             |
| `CRAWL_ON_STARTUP`            | `false`                  | Set `true` to crawl immediately on server start              |
| `CRAWL_INTERVAL_HOURS`        | `24`                     | How often the scheduler crawls (cron: 6am daily)             |
| `UPSTASH_REDIS_REST_URL`      | —                        | Upstash Redis REST base URL (must be absolute `https://...`) |
| `UPSTASH_REDIS_REST_TOKEN`    | —                        | Upstash Redis REST token                                     |
| `STARTUP_CRAWL_DELAY_MS`      | `8000`                   | Delay before startup crawl (non-serverless runtime only)     |
| `INITIAL_DATA_RETRY_MS`       | `30000`                  | Retry interval when app has no deals yet                     |
| `INITIAL_DATA_MAX_ATTEMPTS`   | `40`                     | Max first-load bootstrap retries                             |
| `CRAWL_SNAPSHOT_EVERY_STORES` | `3`                      | Save Redis snapshot every N crawled stores (checkpointing)   |

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

## Crawl + Redis Data Lifecycle

### How availability is maintained

1. On cold start, app checks local SQLite for active deals.
2. If empty, it tries Redis snapshot restore (`desiDeals24:snapshot`).
3. If still empty, it falls back to bundled `server/deals-seed.json`.
4. If still empty (true first run), it starts/retries crawl bootstrap until data exists.

### When Redis snapshot is written

- End of crawl run (final snapshot write).
- During crawl checkpoints every `CRAWL_SNAPSHOT_EVERY_STORES` stores.

This reduces risk of ending with no snapshot if a long crawl is interrupted.

### Serverless note (Vercel)

- Timer-based background startup crawl is skipped on Vercel/serverless.
- Prefer explicit crawl invocations (`/api/cron` or admin trigger) for long runs.
- Ensure function `maxDuration` is high enough for your store count.

### Required Redis env format

- `UPSTASH_REDIS_REST_URL` must be a full absolute URL, e.g. `https://<your-id>.upstash.io`
- `UPSTASH_REDIS_REST_TOKEN` must be present in the same environment where crawl runs.

If Redis writes fail, check logs for `[snapshot] Save failed (...)` which now includes HTTP status/body when available.

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
