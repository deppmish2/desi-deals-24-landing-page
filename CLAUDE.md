# CLAUDE.md

## Style
Strict code, no verbosity. Use standard node/python libs. Tests: MVP, strict, exact.
Tests: use `--reporter=spec` to cut TAP noise.
Wiki files (`decisions.md`, `frontend.md`) — read only when needed, not proactively.

## Wiki
`docs/wiki/index.md` — read first. Maps store adapters, DB schema, API routes, decisions. Update after significant tasks (see `docs/wiki/WIKI.md`).

## Project
DesiDeals24 — Node.js full-stack. Crawls Indian grocery stores in Germany, shows deals via React + Tailwind. 5 of 27 stores implemented.

## Commands
```bash
npm install && cd client && npm install   # deps
npm run crawl                             # fetch deals
npm start                                 # prod server
npm run dev                               # backend dev (auto-reload)
cd client && npm run dev                  # frontend dev (:5173 → proxies /api to :3000)
npm run build:client                      # build frontend
rm data/desiDeals24.db && node -e "require('./server/db')"  # reset DB
```

## Architecture

**Backend** (CommonJS — no ESM)
- `server/index.js` — Express, mounts routes, scheduler
- `server/db/index.js` — better-sqlite3 singleton; auto-runs `schema.sql`; seeds stores
- `server/routes/deals.js` — dynamic SQL query builder, no ORM
- `server/routes/admin-dashboard.js` — brands, canonical-stats, remap
- `server/routes/admin-stats.js` — user/crawl stats (split for token efficiency)
- `server/middleware/auth.js` — `Authorization: Bearer <ADMIN_SECRET>`

**Crawler**
- `crawler/index.js` — sequential; marks old deals inactive; 2–5s delay between stores
- Store adapter exports `{ storeId, storeName, storeUrl, scrape() }`
- `scrape()` returns deal array (see PRD §5.3)

**Store adapters**
| Adapter | Method |
|---|---|
| jamoona, dookan, namma-markt | Shopify JSON API `/collections/{handle}/products.json?limit=250` |
| little-india | WooCommerce HTML + Cheerio, pagination `/page/N/` |
| grocera | HTMX + Cheerio, multi-selector fallback |

**Frontend**
- React Router v6: `/`, `/deals`, `/store/:storeId`, `/category/:category`
- All API calls via `client/src/utils/api.js`
- Filters URL-synced via `useSearchParams`; search debounced 400ms

## Constraints
- **CommonJS only** — `require()`/`module.exports`. No `import`/`export` in server/crawler.
- **node-fetch v2** — `require('node-fetch')`. v3 is ESM-only.
- **better-sqlite3 sync** — never `await` DB calls. `db.prepare().get/all/run()` all sync.
- **No Playwright/Puppeteer** — node-fetch + Cheerio only.
- **Price parser** handles `3.29` (Shopify) and `3,29` (WooCommerce). Don't simplify.
- **SQLite path** `./data/desiDeals24.db` — `data/` must exist (gitignored, present locally).

## Known Issues
- **Grocera** — `/category/deals` lazy-loads JS; Cheerio gets ~1–3 deals. Playwright would fix.
- **Dookan** — dynamic collection discovery via `/collections.json`; keyword list in `crawler/stores/dookan.js`.
- **`punycode` warning** — harmless, from node-fetch deps.

## DB Schema
Tables: `stores`, `deals`, `crawl_runs` — see `server/db/schema.sql`.
- `deals.is_active` — `0` at crawl start, `1` for newly crawled
- `deals.product_url` — dedup key per crawl run
- `crawl_runs.errors` — JSON `[{store_id, error_message}]`

## Categories (16)
`crawler/utils/category-mapper.js`: Rice & Grains, Flours & Baking, Lentils & Pulses, Spices & Masalas, Oils & Ghee, Sauces & Pastes, Snacks & Sweets, Beverages, Dairy & Paneer, Frozen Foods, Fresh Produce, Noodles & Pasta, Canned & Packaged, Personal Care, Household, Other.

## Env
`.env.example`. Prod: set `ADMIN_SECRET`. `CRAWL_ON_STARTUP=true` triggers crawl on start.

## PRD
`/Users/rasha/Documents/Rahul/Deals24/crawler-spice-stores/DesiDeals24_PRD.md` — all 27 stores.

Code like reviewed by Codex agent.
