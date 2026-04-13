---
title: Backend
last_updated: 2026-04-13
source_count: 3
---

The backend is an Express app (`server/index.js`) using CommonJS modules throughout. It serves the REST API, handles auth, and in non-serverless mode starts the cron scheduler. In production (Vercel), the scheduler is skipped — crawls are triggered by GitHub Actions instead.

## Express setup

Entry point: `server/index.js`

Middleware stack (in order):
1. `cors()` — open CORS (no restrictions)
2. `morgan("dev")` — request logging
3. `express.json()` — body parsing
4. DB readiness gate — every `/api` request awaits `db.ready` before proceeding

Static assets: `client/dist/assets/` served with `Cache-Control: max-age=1y, immutable`. All other `client/dist/` files served with `index: false` (SPA fallback). Hashed bundles never need revalidation.

## API routes

| Route | Handler | Notes |
|---|---|---|
| `GET /api/v1/deals` | `server/routes/deals.js` | Paginated, filterable. Main data endpoint. |
| `POST /api/v1/auth/email-link/start` | `server/routes/auth.js` | Sends magic link email |
| `POST /api/v1/auth/email-link/complete` | `server/routes/auth.js` | Validates token, issues JWT |
| `GET /api/v1/auth/google/url` | `server/routes/auth.js` | OAuth URL generation |
| `POST /api/v1/auth/google` | `server/routes/auth.js` | OAuth code exchange |
| `POST /api/v1/auth/refresh` | `server/routes/auth.js` | Access token refresh |
| `POST /api/v1/auth/logout` | `server/routes/auth.js` | Revokes refresh token |
| `GET /api/v1/auth/me` | `server/routes/auth.js` | Returns current user |
| `GET/POST/DELETE /api/v1/bookmarks` | `server/routes/bookmarks.js` | Saved deals per user |
| `GET /api/v1/health` | `server/routes/health.js` | Health check (no auth) |
| `GET /api/v1/admin-dashboard/stats` | `server/routes/admin-dashboard.js` | Admin stats (auth required) |
| `GET /api/v1/admin-dashboard/canonical-stats` | `server/routes/admin-dashboard.js` | Mapping health: total canonicals, mapped/unmapped deal counts, unmapped product list |
| `GET /api/v1/admin-dashboard/brands` | `server/routes/admin-dashboard.js` | Returns all `known_brands` rows |
| `POST /api/v1/admin-dashboard/brands/remap` | `server/routes/admin-dashboard.js` | Replaces brand list, re-decomposes all canonicals, maps unmapped deals. Runs **synchronously** — returns result in response body. |
| `GET /api/v1/admin-dashboard/brands/remap-status/:jobId` | `server/routes/admin-dashboard.js` | Reads `brand_remap_jobs` row by id (retained for legacy polling clients) |
| `GET /api/v1/member-count` | inline in `server/index.js` | Display member count |
| `POST /api/v1/contact` | `server/routes/contact.js` | Contact form |
| `POST /api/v1/waitlist` | `server/routes/waitlist.js` | Waitlist signup |

## OG meta injection

`server/index.js` handles `/deal/:dealId` and `/share/deal/:dealId` routes server-side to inject Open Graph meta tags into the React `index.html` before serving. This enables social share previews. The `injectClientMeta()` function uses regex replacement on the static HTML — not a template engine.

## Database

DB module: `server/db/index.js` — exports a singleton. In local dev, uses `better-sqlite3` (synchronous). In production, uses Turso's libSQL client (async, hence `db.ready` promise).

Schema: `server/db/schema.sql` — auto-applied on startup. Key tables:

| Table | Purpose |
|---|---|
| `stores` | Store registry (id, name, url, platform, crawl status) |
| `deals` | Active/inactive deals; deduped by `product_url` per store |
| `deal_price_history` | Daily price snapshot per product (for Real Savings comparison) |
| `crawl_runs` | Crawl run metadata and error log |
| `crawl_store_results` | Per-store per-run result stats |
| `crawl_locks` | Distributed lock to prevent concurrent crawls |
| `job_runs` | Generic scheduled job ledger |
| `canonical_products` | Canonical product registry (entity resolution) |
| `deal_mappings` | Maps deal rows to canonical products |
| `entity_resolution_queue` | Ambiguous mappings pending admin review |
| `known_brands` | Brand whitelist used for canonical slot decomposition. `name TEXT UNIQUE`, `aliases TEXT` (JSON array of lowercase strings). Source of truth for which tokens are brand identifiers. |
| `brand_remap_jobs` | Audit log for admin-triggered remap runs. `status`: running/completed/failed. `stats` JSON: `{canonicalsRedecomposed, canonicalsDeleted, newlyMapped, stillUnmapped, duration_ms}`. |
| `users` | User accounts (email, Google OAuth, postcode, preferences) |
| `email_auth_tokens` | Passwordless email magic links |
| `refresh_tokens` | JWT refresh token sessions |
| `shopping_lists` / `list_items` | Saved shopping lists |
| `price_alerts` / `alert_notifications` | Price alert subscriptions |
| `events` / `search_queries` | Analytics events |
| `app_settings` | Generic key-value config |

Key indexes: `deals(is_active, display_date, display_order)` — the main query path for the homepage.

## Auth

`server/middleware/auth.js` — checks `Authorization: Bearer <token>`. Admin routes require `ADMIN_SECRET`; user routes validate JWT access tokens. Refresh tokens are stored hashed in `refresh_tokens` table.

Email auth flow: start → magic link sent → user clicks → `complete` endpoint validates hash → issues access + refresh tokens.

OAuth: Google only. Two URL patterns supported for compatibility with older frontend builds (`/api/v1/auth/google` and `/api/auth/google`).

## Scheduling

In non-serverless mode (`!process.env.VERCEL`), `server/index.js` starts `crawler/scheduler.js` which runs the crawl on a Berlin-time morning schedule. In production, GitHub Actions handles this — the server explicitly skips the scheduler.

## Brand remap endpoint (`POST /brands/remap`)

Accepts `{ brands: [{name, aliases}] }`. Steps:

1. **Deduplicate** by lowercase name — merges aliases when the same name appears twice (e.g. chip-added "aashirvaad" + existing "Aashirvaad"). Prevents `UNIQUE constraint` errors.
2. **Replace `known_brands`** — DELETE all, INSERT deduped set.
3. **Re-decompose canonicals** — for every `canonical_products` row, calls `decomposeCanonical()` with fresh brands. Canonicals that no longer resolve a brand slot are deleted (and their `deals.canonical_id` NULLed). Others get updated `brand_slots`, `base_product_slots`, `product_group_id`. All writes go through a single `db.batch()` call.
4. **Map unmapped deals** — loads all active deals with no `deal_mappings` entry, runs `autoMapDeals()`, batch-inserts new mappings.
5. Returns `{ jobId, status: "completed", stats }` synchronously.

**Critical:** This runs synchronously within the HTTP request. Do **not** convert it back to a background async — Vercel kills background work when the response is sent. All prior stuck jobs (status='running' forever) were caused by the background-async pattern.

## Related pages

- [Crawler](crawler.md) — the crawl pipeline called by the scheduler
- [Decisions](decisions.md) — why Turso, why serverless, crawl architecture choices
