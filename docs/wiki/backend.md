---
title: Backend
last_updated: 2026-05-03
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
| `GET /api/v1/deals/replacements` | `server/routes/deals.js` | Same-store replacement tiers (T1–T4) via `getReplacements()`. Params: `canonical_id`, `store_id`, `deal_id`. |
| `GET /api/v1/deals/same-product-other-stores` | `server/routes/deals.js` | Cross-store alternatives. Uses `canonical_products.base_key + category` SQL JOIN — expands to all canonicals sharing the same catalog base product. Falls back to exact `canonical_id` match when `base_key` is null. |
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
| `GET /api/v1/catalog` | `server/routes/catalog.js` | Paginated canonical product catalog. Params: `q`, `category`, `store`, `is_discounted`, `min_discount`, `hide_expired`, `page`, `limit`. Returns `{data, pagination}`. |
| `GET /api/v1/catalog/suggest` | `server/routes/catalog.js` | Typeahead: returns `{products, categories, stores}` matching `?q=`. |
| `GET /api/v1/catalog/:id/brands` | `server/routes/catalog.js` | Returns flat brand list from `brand_slots` for a canonical product. |
| `GET /api/v1/lists` | `server/routes/lists.js` | Returns user's shopping lists (auth required) |
| `POST /api/v1/lists` | `server/routes/lists.js` | Create a new list |
| `GET /api/v1/lists/:id` | `server/routes/lists.js` | Get list with items |
| `PUT /api/v1/lists/:id` | `server/routes/lists.js` | Update list metadata |
| `DELETE /api/v1/lists/:id` | `server/routes/lists.js` | Delete list |
| `POST /api/v1/lists/:id/items` | `server/routes/lists.js` | Add item to list |
| `PUT /api/v1/lists/:id/items/:itemId` | `server/routes/lists.js` | Update list item |
| `DELETE /api/v1/lists/:id/items/:itemId` | `server/routes/lists.js` | Remove list item |
| `POST /api/v1/lists/:id/recommend` | `server/routes/recommend.js` | Run recommender: cross-store price comparison for list items. Returns `{stores: [{store_name, confirmed_total, coverage, items, items_not_found}]}`. |
| `POST /api/v1/lists/:id/cart-transfer` | `server/routes/recommend.js` | Transfer cart to a specific store (mark list as completed) |
| `POST /api/v1/lists/:id/replacement-search` | `server/routes/recommend.js` | Find replacements for a missing item at a specific store |
| `POST /api/v1/compare/cart` | `server/routes/compare.js` | Cross-store comparison (auth required) |
| `GET /api/v1/orders` | `server/routes/orders.js` | Returns completed shopping lists with items and lifecycle columns (auth required) |
| `PATCH /api/v1/orders/:id/handoff` | `server/routes/orders.js` | Sets `order_status=pending`; records `completed_store_id`, `savings_eur`, `total_eur`, `completed_at` (auth required) |
| `PATCH /api/v1/orders/:id/confirm` | `server/routes/orders.js` | Advances `order_status` from `pending` → `placed` (auth required) |
| `DELETE /api/v1/orders/:id` | `server/routes/orders.js` | Cancels/deletes the order record (auth required) |
| `PATCH /api/v1/orders/:id/rating` | `server/routes/orders.js` | Sets `rating` 1–5 on delivered orders (auth required) |
| `PATCH /api/v1/orders/:id/status` | `server/routes/orders.js` | Advances `order_status` through lifecycle: `placed→shipped→delivered→issue` (auth required) |
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
| `store_products` | Crawled listings; deduped by `product_url` per store; `is_active` flag |
| `store_product_mappings` | Links `store_products` rows to `canonical_products` |
| `price_history` | Daily price snapshot per product (for Real Savings comparison) |
| `crawl_runs` | Crawl run metadata and error log |
| `crawl_store_results` | Per-store per-run result stats |
| `crawl_locks` | Distributed lock to prevent concurrent crawls |
| `job_runs` | Generic scheduled job ledger |
| `canonical_products` | One row per distinct product across stores. Key columns: `canonical_name`, `category`, `base_key`, `brand_slots` (JSON), `weight_value`, `weight_unit`, `image_url`. |
| `entity_resolution_queue` | Ambiguous mappings pending admin review |
| `known_brands` | Brand whitelist used for canonical slot decomposition. `name TEXT UNIQUE`, `aliases TEXT` (JSON array of lowercase strings). Source of truth for which tokens are brand identifiers. |
| `brand_remap_jobs` | Audit log for admin-triggered remap runs. `status`: running/completed/failed. `stats` JSON: `{canonicalsRedecomposed, canonicalsDeleted, newlyMapped, stillUnmapped, duration_ms}`. |
| `users` | User accounts (email, Google OAuth, postcode, preferences) |
| `email_auth_tokens` | Passwordless email magic links |
| `refresh_tokens` | JWT refresh token sessions |
| `shopping_lists` / `list_items` | Saved shopping lists. `shopping_lists` has 7 order lifecycle columns added via `alwaysMigrations`: `order_status` (TEXT, pending/placed/shipped/delivered/issue), `completed_store_id`, `savings_eur` (REAL), `total_eur` (REAL), `rating` (INT 1–5), `eta_date` (TEXT), `issue_text` (TEXT), `tracking_url` (TEXT) |
| `price_alerts` / `alert_notifications` | Price alert subscriptions |
| `events` / `search_queries` | Analytics events |
| `app_settings` | Generic key-value config |

Key indexes: `deals(is_active, display_date, display_order)` — the main query path for the homepage.

## Auth

`server/middleware/auth.js` — admin routes; checks `Authorization: Bearer <ADMIN_SECRET>`. `server/middleware/user-auth.js` — user-facing routes; validates JWT access token (HS256, payload must include `type:"access"`). `server/utils/jwt.js` — `signJwt(payload, secret, expiresInSec)` / `verifyJwt(token, secret)` using Node `crypto` HMAC. Admin routes require `ADMIN_SECRET`; user routes validate JWT access tokens. Refresh tokens are stored hashed in `refresh_tokens` table.

Email auth flow: start → magic link sent → user clicks → `complete` endpoint validates hash → issues access + refresh tokens.

OAuth: Google only. Two URL patterns supported for compatibility with older frontend builds (`/api/v1/auth/google` and `/api/auth/google`).

## Scheduling

In non-serverless mode (`!process.env.VERCEL`), `server/index.js` starts `crawler/scheduler.js` which runs the crawl on a Berlin-time morning schedule. In production, GitHub Actions handles this — the server explicitly skips the scheduler.

## Brand remap endpoint (`POST /brands/remap`)

Accepts `{ brands: [{name, aliases}] }`. Steps:

1. **Deduplicate** by lowercase name — merges aliases when the same name appears twice (e.g. chip-added "aashirvaad" + existing "Aashirvaad"). Prevents `UNIQUE constraint` errors.
2. **Replace `known_brands`** — DELETE all, INSERT deduped set.
3. **Re-decompose canonicals** — for every `canonical_products` row, calls `decomposeCanonical()` with fresh brands. Canonicals that no longer resolve a brand slot are deleted (and their `deals.canonical_id` NULLed). Others get updated `brand_slots`, `base_product_slots`, `product_group_id`, `base_key`. All writes go through a single `db.batch()` call.
4. **Map unmapped deals** — loads all active deals with no `deal_mappings` entry, runs `autoMapDeals()`, batch-inserts new mappings.
5. Returns `{ jobId, status: "completed", stats }` synchronously.

**Critical:** This runs synchronously within the HTTP request. Do **not** convert it back to a background async — Vercel kills background work when the response is sent. All prior stuck jobs (status='running' forever) were caused by the background-async pattern.

## Deal serialization & enrichment

`server/routes/deals.js → serializeDeal(row)` — converts a DB row to the API response shape. All deal list and detail responses pass through this.

After serialization, every response path calls `batchGetRealSavings` + `computeRealSavings` and attaches two additional fields:

| Field | Type | Description |
|---|---|---|
| `real_savings` | object \| null | Real savings data: `real_discount_pct`, `rating`, `reference_source`, `reference_price_per_kg` |
| `real_savings_debug` | string \| null | Why `real_savings` is null (e.g. `"not_cheaper"`, `"no_history"`) |
| `is_fake_deal` | boolean | `true` when `discount_percent - real_savings.real_discount_pct >= FAKE_DEAL_THRESHOLD_PP` |

**`FAKE_DEAL_THRESHOLD_PP = 10`** — defined at top of `server/routes/deals.js`. A deal is "fake" when the store claims ≥10 percentage points more discount than the real saving vs market price. Used client-side to branch share copy, WA text, and DealSharePage headline.

## DB connectivity

`server/db/index.js` connects to **Turso** when `DESI_DEALS_DB_TURSO_DATABASE_URL` is present in env. Falls back to local SQLite when no Turso URL is set. Run locally with `DB_FILE=data/prod_local.db npm run dev`.

**prod_local.db (as of 2026-04-21):** `data/prod_local.db` is the curated local snapshot used as the replacement for the live Turso DB. State: 14,598 canonical products (12,443 with `is_match_priority=1`), 3,003 with `base_key` populated, 22 unmapped active deals in entity_resolution_queue. `base_key` column added 2026-04-21 and backfilled from `resolveBaseProduct()`. All active `deals.product_category` values synced to match `canonical_products.category` (18,507 rows updated, 0 active drift).

## Recommender service

`server/services/recommender.js` — powers `POST /api/v1/lists/:id/recommend`. For each cart item, finds the best matching deal at every store.

**Two-path matching per item:**

- **Path 1 (no brand / any-brand):** text-search only. Brand is stripped from `raw_item_text` before SQL `LIKE` query so "Any brand Amchur Powder" searches for "Amchur Powder" — prevents MDH-prefix hits from inflating brand_match scores in the ranker.
- **Path 2 (specific brand):** SQL query includes brand token; smart ranker scores all candidates.

**Combination engine (`findStrictExactCandidatesAtStore`):** expands the base pool via `base_key` (all canonicals sharing the same catalog base product). Accepts `rawItemText` to apply `applySubVariantPreference` — if the item is "Extra Long Basmati Rice", candidates matching "extra long" are preferred. Falls back to full pool when no preferred candidates exist at that store.

**Smart ranker (`server/services/smart-ranker.js` → `rankMatch`):** scores each candidate on 5 features: embedding similarity (30%), brand match (25%), token overlap (20%), weight match (15%), phonetic (10%). Minimum confidence threshold: `SMART_MATCH_THRESHOLD = 0.45`.

**`SUB_VARIANT_KEYWORDS`:** `["extra long", "long grain", "short grain", "everyday", "classic", "premium", "organic", "aged", "traditional", "original"]` — keywords extracted from cart item text to prefer matching sub-variants. These are stripped by `QUALITY_QUALIFIERS` in `base-product-catalog.js` when building `base_key`, so both "Extra Long" and "Everyday" Basmati map to the same base key. The post-filter restores the preference.

**Response shape per store:**
```json
{
  "store_name": "Dookan",
  "store_id": "dookan",
  "confirmed_total": 12.45,
  "coverage": { "available": 5, "replaced": 1, "missing": 1, "total": 7 },
  "items": [{ "product_name": "...", "effective_price": 2.49, "packs_needed": 2, ... }],
  "items_not_found": ["Amchur Powder"]
}
```

## Related pages

- [Crawler](crawler.md) — the crawl pipeline called by the scheduler
- [Decisions](decisions.md) — why Turso, why serverless, crawl architecture choices
