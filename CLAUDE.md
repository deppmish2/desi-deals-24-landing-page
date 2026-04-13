# CLAUDE.md


## Coding Style
Strict code, no verbosity. Use existing standard node/python libs, don't reinvent. Tests cover MVP — strict, exact.

Guidance for Claude Code working with DesiDeals24 codebase.

## Wiki

Project knowledge in `docs/wiki/`. Read `docs/wiki/index.md` first — maps store adapters, DB schema, API routes, decisions. Update wiki after significant tasks (see `docs/wiki/WIKI.md` for conventions).

## Project Overview

DesiDeals24 — Node.js full-stack app crawls Indian grocery stores in Germany, aggregates deals, displays via React + Tailwind frontend. Test version covers 5 of 27 target stores from PRD.

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

- `server/index.js` — Express app, mounts routes, starts scheduler
- `server/db/index.js` — better-sqlite3 singleton; auto-runs `schema.sql` on startup; seeds 5 stores with `INSERT OR IGNORE`
- `server/routes/deals.js` — dynamic SQL query builder (no ORM)
- `server/middleware/auth.js` — checks `Authorization: Bearer <ADMIN_SECRET>`

### Crawler

- `crawler/index.js` — sequential orchestrator; marks previous deals inactive before inserting new; adds random 2–5s delay between stores
- Each store adapter exports `{ storeId, storeName, storeUrl, scrape() }`
- `scrape()` returns array of deal objects (see §5.3 of PRD for required fields)

### Store Adapter Types

| Adapter                      | Method                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| jamoona, dookan, namma-markt | Shopify undocumented JSON API: `/collections/{handle}/products.json?limit=250` |
| little-india                 | WooCommerce HTML + Cheerio. Pagination via `/page/N/`                          |
| grocera                      | Custom HTMX site + Cheerio. Multi-selector fallback strategy                   |

### Frontend

- React Router v6 with 4 pages: `/`, `/deals`, `/store/:storeId`, `/category/:category`
- All API calls via `client/src/utils/api.js`
- Filters URL-synced via `useSearchParams` in `DealsPage`
- `useDeals` hook debounces search 400ms

## Key Technical Constraints

- **CommonJS only** — `require()`/`module.exports` throughout. No `import`/`export` in server or crawler files.
- **node-fetch v2** — use `require('node-fetch')`. v3 is ESM-only.
- **better-sqlite3 is synchronous** — never `await` database calls. All `db.prepare().get/all/run()` calls synchronous.
- **No Playwright/Puppeteer** — crawlers use node-fetch + Cheerio only.
- **Price parser handles two formats**: English dot-decimal (`3.29` from Shopify) and German comma-decimal (`3,29` from WooCommerce/custom sites). Don't simplify this logic.
- **SQLite path** relative: `./data/desiDeals24.db` — `data/` must exist (gitignored but present locally).

## Known Issues

- **Grocera** returns ~1–3 deals — `/category/deals` uses lazy-loaded JS. Cheerio adapter finds some via price+image heuristic, misses most. Playwright adapter would fix.
- **Dookan** uses dynamic collection discovery — queries `/collections.json` for collection with 'sale'/'deal' in handle. If sale collection name changes, update keyword list in `crawler/stores/dookan.js`.
- **`punycode` deprecation warning** from Node.js 22 harmless — comes from `node-fetch` dependencies.

## Database Schema

Three tables: `stores`, `deals`, `crawl_runs`. See `server/db/schema.sql`.

- `deals.is_active` — set to `0` at crawl start, re-set to `1` for newly crawled deals
- `deals.product_url` — deduplication key within crawl run
- `crawl_runs.errors` — JSON string array of `{store_id, error_message}` objects

## Product Categories (16 total)

Keyword-mapped in `crawler/utils/category-mapper.js`:
Rice & Grains, Flours & Baking, Lentils & Pulses, Spices & Masalas, Oils & Ghee, Sauces & Pastes, Snacks & Sweets, Beverages, Dairy & Paneer, Frozen Foods, Fresh Produce, Noodles & Pasta, Canned & Packaged, Personal Care, Household, Other.

## Environment Variables

See `.env.example`. Only required prod change: `ADMIN_SECRET`.
Set `CRAWL_ON_STARTUP=true` to trigger crawl on server start.

## PRD Reference

`/Users/rasha/Documents/Rahul/Deals24/crawler-spice-stores/DesiDeals24_PRD.md`

PRD covers all 27 target stores. Codebase implements first 5.

Code like reviewed by Codex agent.