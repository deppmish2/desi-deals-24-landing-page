# AGENTS.md

This file provides guidance to Codex when working with the DesiDeals24 codebase.

## Project Overview

DesiDeals24 is a Node.js full-stack web app that crawls Indian grocery stores in Germany, aggregates their current deals, and displays them in a React + Tailwind frontend. This is a test version covering 5 of the 27 target stores from the PRD.

## Commands

**Install all dependencies:**

```bash
npm install
cd client && npm install
```

**Run the crawler (fetch live deals from all stores):**

```bash
npm run crawl
```

**Start the API server (production mode):**

```bash
npm start
```

**Development mode (backend auto-reload):**

```bash
npm run dev
```

**Frontend dev server (hot reload, proxies /api to :3000):**

```bash
cd client && npm run dev
```

**Build React frontend:**

```bash
npm run build:client
# or: cd client && npm run build
```

**Reset the database (wipe all deals, re-seed stores):**

```bash
rm data/desiDeals24.db && node -e "require('./server/db')"
```

## Architecture

### Backend (CommonJS — do NOT use ES module syntax)

- `server/index.js` — Express app, mounts all routes, starts scheduler
- `server/db/index.js` — better-sqlite3 singleton; auto-runs `schema.sql` on startup; seeds 5 stores with `INSERT OR IGNORE`
- `server/routes/deals.js` — dynamic SQL query builder (do not use ORM)
- `server/middleware/auth.js` — checks `Authorization: Bearer <ADMIN_SECRET>`

### Crawler

- `crawler/index.js` — sequential orchestrator; marks previous deals inactive before inserting new ones; adds random 2–5s delay between stores
- Each store adapter exports `{ storeId, storeName, storeUrl, scrape() }`
- `scrape()` must return an array of deal objects (see §5.3 of PRD for required fields)

### Store Adapter Types

| Adapter                      | Method                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| jamoona, dookan, namma-markt | Shopify undocumented JSON API: `/collections/{handle}/products.json?limit=250` |
| little-india                 | WooCommerce HTML + Cheerio. Pagination via `/page/N/`                          |
| grocera                      | Custom HTMX site + Cheerio. Multi-selector fallback strategy                   |

### Frontend

- React Router v6 with 4 pages: `/`, `/deals`, `/store/:storeId`, `/category/:category`
- All API calls go through `client/src/utils/api.js`
- Filters are URL-synced via `useSearchParams` in `DealsPage`
- `useDeals` hook debounces search queries by 400ms

## Key Technical Constraints

- **CommonJS only** — `require()`/`module.exports` throughout. No `import`/`export` in server or crawler files.
- **node-fetch v2** — use `require('node-fetch')`. v3 is ESM-only.
- **better-sqlite3 is synchronous** — never `await` database calls. All `db.prepare().get/all/run()` calls are synchronous.
- **No Playwright/Puppeteer** — crawlers use node-fetch + Cheerio only (no headless browser).
- **Price parser handles two formats**: English dot-decimal (`3.29` from Shopify) and German comma-decimal (`3,29` from WooCommerce/custom sites). Do not simplify this logic.
- **SQLite path** is relative: `./data/desiDeals24.db` — the `data/` directory must exist (it's gitignored but present locally).

## Known Issues

- **Grocera** only returns ~1–3 deals — their `/category/deals` page uses lazy-loaded JS. The Cheerio adapter finds some products via price+image heuristic but misses most. A Playwright adapter would fix this.
- **Dookan** uses dynamic collection discovery — it queries `/collections.json` to find a collection with 'sale'/'deal' in the handle. If their sale collection name changes, update the keyword list in `crawler/stores/dookan.js`.
- **`punycode` deprecation warning** from Node.js 22 is harmless — it comes from `node-fetch`'s dependencies.

## Database Schema

Three tables: `stores`, `deals`, `crawl_runs`. See `server/db/schema.sql`.

- `deals.is_active` — set to `0` at the start of each crawl run, then re-set to `1` for newly crawled deals
- `deals.product_url` — used as the deduplication key within a crawl run
- `crawl_runs.errors` — JSON string array of `{store_id, error_message}` objects

## Product Categories (16 total)

Mapped by keyword matching in `crawler/utils/category-mapper.js`:
Rice & Grains, Flours & Baking, Lentils & Pulses, Spices & Masalas, Oils & Ghee, Sauces & Pastes, Snacks & Sweets, Beverages, Dairy & Paneer, Frozen Foods, Fresh Produce, Noodles & Pasta, Canned & Packaged, Personal Care, Household, Other.

## Environment Variables

See `.env.example`. The only required change for production is `ADMIN_SECRET`.
Set `CRAWL_ON_STARTUP=true` to trigger a crawl immediately when the server starts.

## PRD Reference

Full product requirements are at:
`/Users/rasha/Documents/Rahul/Deals24/crawler-spice-stores/DesiDeals24_PRD.md`

The PRD covers all 27 target stores. This codebase implements the first 5.
