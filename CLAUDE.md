# CLAUDE.md

## Style
Strict code, no verbosity. Use standard node/python libs. Tests: MVP, strict, exact.
Tests: use `--reporter=spec` to cut TAP noise.
Wiki files (`decisions.md`, `frontend.md`) — read only when needed, not proactively.

## Wiki
`docs/wiki/index.md` — read first. Maps store adapters, DB schema, API routes, decisions. Update after significant tasks (see `docs/wiki/WIKI.md`).

## Project
DesiDeals24 — Node.js full-stack. Crawls Indian grocery stores in Germany, shows deals via React + Tailwind. 31 stores implemented.

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
- `server/db/index.js` — libsql/Turso client (async); auto-runs `schema.sql` via `alwaysMigrations`; seeds stores
- `server/routes/store-products.js` — dynamic SQL query builder, no ORM
- `server/routes/catalog.js` — canonical product catalog + suggest (Platform v1)
- `server/routes/compare.js` — cross-store cart price comparison (Platform v1)
- `server/routes/orders.js` — order history (Platform v1)
- `server/routes/admin-dashboard.js` — brands, canonical-stats, remap
- `server/routes/admin-stats.js` — user/crawl stats (split for token efficiency)
- `server/middleware/auth.js` — `Authorization: Bearer <ADMIN_SECRET>` (admin)
- `server/middleware/user-auth.js` — JWT Bearer token (user-facing routes)

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
- React Router v6: `/`, `/deals`, `/insta`, `/deal/:dealId`, `/share/deal/:dealId`, `/saved`, `/list`, `/list/:id/compare`, `/admin`
- All API calls via `client/src/utils/api.js`
- Filters URL-synced via `useSearchParams`; search debounced 400ms

## Constraints
- **CommonJS only** — `require()`/`module.exports`. No `import`/`export` in server/crawler.
- **node-fetch v2** — `require('node-fetch')`. v3 is ESM-only.
- **DB is async (libsql/Turso)** — always `await` DB calls. `db.prepare().get/all/run()` return Promises. Route handlers must be `async` with `try/catch/next(err)`. Test shim is sync so tests pass either way — don't be fooled.
- **No Playwright/Puppeteer** — node-fetch + Cheerio only.
- **Price parser** handles `3.29` (Shopify) and `3,29` (WooCommerce). Don't simplify.
- **Local DB** `./data/prod_local.db` — production data. `desiDeals24.db` is a dev fallback.

## Known Issues
- **Grocera** — `/category/deals` lazy-loads JS; Cheerio gets ~1–3 deals. Playwright would fix.
- **Dookan** — dynamic collection discovery via `/collections.json`; keyword list in `crawler/stores/dookan.js`.
- **`punycode` warning** — harmless, from node-fetch deps.

## DB Schema
See `server/db/schema.sql`. Key tables:
- `store_products` — crawled listings (`is_active`, `product_url` dedup key)
- `canonical_products` — one row per product across stores
- `store_product_mappings` — links store listings to canonicals
- `shopping_lists` + `list_items` — user carts (status, completed_store_id, completed_at)
- `users`, `refresh_tokens`, `email_auth_tokens` — auth
- `crawl_runs`, `crawl_store_results` — crawler history
- `price_alerts`, `alert_notifications`, `events`, `search_queries` — analytics/alerts

## Categories (16)
`crawler/utils/category-mapper.js`: Rice & Grains, Flours & Baking, Lentils & Pulses, Spices & Masalas, Oils & Ghee, Sauces & Pastes, Snacks & Sweets, Beverages, Dairy & Paneer, Frozen Foods, Fresh Produce, Noodles & Pasta, Canned & Packaged, Personal Care, Household, Other.

## Env
`.env.example`. Prod: set `ADMIN_SECRET`. `CRAWL_ON_STARTUP=true` triggers crawl on start.

## PRD
`/Users/rasha/Documents/Rahul/Deals24/crawler-spice-stores/DesiDeals24_PRD.md` — original PRD (27 stores listed; 31 now implemented).

## Token Efficiency
- `grep -n` before reading — find the section, then read with offset/limit
- Filter test output: `| tail -20` or `| grep -E "pass|fail|Error"`
- Never read wiki files proactively — grep the index first
- Use `git diff --stat` before `git diff` on large branches

## Auto-Approve
Safe without asking: running tests, grep/read/ls, `npm run build:client`, `node --test`, `git log/diff/status/show`.
Always ask before: `git commit`, `git push`, destructive file ops, any curl to external services.

Code like reviewed by Codex agent.
