# Technology Stack

**Analysis Date:** 2026-05-04

## Languages

**Primary:**
- JavaScript (ES2022+) — all server, crawler, and frontend code
  - Server/Crawler: CommonJS (`require`/`module.exports`) — no ESM
  - Frontend: ES Modules (`import`/`export`) via Vite bundler

**Secondary:**
- SQL — `server/db/schema.sql`, inline queries in all route files
- HTML/CSS — `client/src/index.css`, injected OG meta in `server/index.js`

## Runtime

**Environment:**
- Node.js `20.x` (pinned via `engines` in `package.json`; local runtime is v22.13.1)
- No `.nvmrc` — rely on `engines` field only

**Package Manager:**
- npm (root and client subdirectory are separate workspaces)
- Root lockfile: `package-lock.json` present
- Client lockfile: `client/package-lock.json` present

## Frameworks

**Backend:**
- Express `^4.18.2` — HTTP server, all API routes, static file serving (`server/index.js`)

**Frontend:**
- React `^18.2.0` — component library (`client/src/`)
- React Router DOM `^6.22.0` — client-side routing; routes: `/`, `/deals`, `/insta`, `/deal/:dealId`, `/share/deal/:dealId`, `/saved`, `/list`, `/list/:id/compare`, `/admin`

**Build/Dev:**
- Vite `^5.1.0` — frontend bundler and dev server (port 5173, proxies `/api` to backend port)
- `@vitejs/plugin-react` `^4.2.1` — JSX transform
- nodemon `^3.0.3` — backend auto-reload during dev

**CSS:**
- Tailwind CSS `^3.4.1` — utility-first styling
- PostCSS `^8.4.35` + Autoprefixer `^10.4.17` — CSS pipeline
- Custom design tokens in `client/tailwind.config.js`: brand greens, Plus Jakarta Sans font, Aura shadow/radius scale

**Crawler:**
- Cheerio `^1.0.0` — HTML parsing for WooCommerce and Cheerio-scraped stores
- node-fetch `^2.7.0` — HTTP requests (v2 specifically — v3 is ESM-only)

**Scheduling:**
- node-cron `^3.0.3` — local daily crawl scheduler (`crawler/scheduler.js`); fires at 08:00 Europe/Berlin
- GitHub Actions — production cron trigger (`cron: "50 5 * * *"`) in `.github/workflows/crawl.yml`

**Testing:**
- Node.js built-in `node:test` runner — regression and integration tests
- Test files: `tests/regression/*.test.mjs`, `tests/integration/*.test.js`, `tests/e2e/*.test.js`
- Run: `npm run test:regression` | `npm run test:integration` | `npm run test:e2e`

## Key Dependencies

**Critical:**
- `@libsql/client` `^0.17.0` — database client; wraps both local SQLite files and remote Turso (libSQL) endpoints. All DB calls are async Promises. Shim in `server/db/index.js` exposes `prepare().all/get/run()` interface matching better-sqlite3 call style.
- `better-sqlite3` `^9.4.3` — used only in `tests/integration/product-replacements.test.js` as an in-memory test DB. NOT used in production server paths.
- `@anthropic-ai/sdk` `^0.89.0` — Anthropic Claude API; used in `scripts/bootstrap-canonical-catalogue.js` (one-off data scripts, not in hot server paths)
- `uuid` `^9.0.0` — ID generation for DB records
- `nodemailer` `^8.0.1` — SMTP email for magic-link auth (`server/services/email-auth.js`) and price/ops alerts

**Infrastructure:**
- `dotenv` `^16.4.1` — env loading; loads `.env` then `.env.local` (override) at startup
- `cors` `^2.8.5` — cross-origin headers on all API routes
- `morgan` `^1.10.0` — HTTP request logging in dev mode
- `node-cron` `^3.0.3` — in-process scheduler for local dev
- `@vercel/kv` `^3.0.0` — package present in `package.json` but not actively `require`'d in server paths (session-store.js cache functions are no-ops)

## Configuration

**Environment:**
- Loaded via `dotenv` from `.env` and `.env.local` (override) at process start
- `.env.example` not found — env vars documented via source code grep
- Key required vars: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (production DB), `ADMIN_SECRET` (admin API auth), `JWT_SECRET` (user token signing)
- Optional vars: `SMTP_HOST/PORT/SECURE/USER/PASS` (email), `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `KIT_API_KEY`, `SLACK_WEBHOOK_URL`
- `DB_FILE` env var overrides DB path for local development (e.g. `DB_FILE=data/prod_local.db`)
- `VERCEL=1` disables local cron scheduler (GitHub Actions handles prod scheduling)

**Build:**
- `vercel.json` — Vercel deployment config; rewrites all `/api/*`, `/share/deal/*`, `/deal/*` to `api/server.js` serverless function; static frontend from `client/dist`
- `client/vite.config.js` — Vite config; reads `DD24_API_PORT` env var to configure dev proxy target (default: 3000)
- `client/tailwind.config.js` — design token definitions
- `client/postcss.config.js` — PostCSS pipeline

## Platform Requirements

**Development:**
- Node.js 20.x
- Local SQLite DB at `./data/prod_local.db` (use `DB_FILE=data/prod_local.db npm run dev`)
- Two concurrent processes: `npm run dev` (backend :3000) + `cd client && npm run dev` (frontend :5173)

**Production:**
- Vercel serverless (primary deployment target) — `vercel.json` defines function config; `api/server.js` is the serverless entry
- GitHub Actions for daily crawl (`ubuntu-latest`, Node 20, connects directly to Turso remote DB)
- Turso (libSQL remote DB) as primary production datastore

---

*Stack analysis: 2026-05-04*
