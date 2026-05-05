# External Integrations

**Analysis Date:** 2026-05-04

## APIs & External Services

**Email Marketing:**
- Kit (formerly ConvertKit) — newsletter subscription for new user signups
  - SDK/Client: `node-fetch` (direct REST calls to `https://api.kit.com/v4`)
  - Auth: `KIT_API_KEY` (header: `X-Kit-Api-Key`)
  - Config: `KIT_FORM_ID` (optional, selects signup form)
  - Implementation: `server/services/kit.js`
  - Behavior: silently skipped if `KIT_API_KEY` is not set

**AI / LLM:**
- Anthropic Claude — product canonical catalogue bootstrapping
  - SDK/Client: `@anthropic-ai/sdk` `^0.89.0`
  - Auth: `ANTHROPIC_API_KEY`
  - Usage: `scripts/bootstrap-canonical-catalogue.js` (one-off data scripts only; NOT in live server request paths)
- OpenAI — entity resolution batch processing
  - SDK/Client: direct REST API (no SDK package; raw HTTP via `node-fetch`)
  - Auth: `OPENAI_API_KEY`
  - Usage: `scripts/process-pending-queue-openai-batch.js` (offline batch script only)

**Ops Notifications:**
- Slack — infrastructure alerts (crawl failures, thin deal pools)
  - SDK/Client: `node-fetch` (POST to incoming webhook URL)
  - Auth: `SLACK_WEBHOOK_URL` (full URL including secret)
  - Implementation: `server/services/ops-notifier.js`
  - Behavior: falls back to stdout logging if not configured

## Data Storage

**Databases:**
- Turso (libSQL / SQLite-compatible remote DB) — production database
  - Connection: `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (primary); also accepts `DESI_DEALS_DB_TURSO_DATABASE_URL` + `DESI_DEALS_DB_TURSO_AUTH_TOKEN` (alternate names for GitHub Actions secrets)
  - Client: `@libsql/client` `^0.17.0`; thin shim in `server/db/index.js` exposes `prepare().all/get/run()` and `execute()`/`query()` methods
  - Schema: `server/db/schema.sql` (30 tables)
  - Key tables: `store_products`, `canonical_products`, `store_product_mappings`, `shopping_lists`, `list_items`, `users`, `refresh_tokens`, `email_auth_tokens`, `crawl_runs`, `crawl_store_results`, `price_history`, `comparison_sessions`, `search_queries`, `events`
- Local SQLite — development and local testing
  - Connection: `DB_FILE` env var path, or default `./data/desiDeals24.db`
  - Production snapshot: `./data/prod_local.db` (use `DB_FILE=data/prod_local.db`)
  - Same `@libsql/client` driver via `file:` URL prefix

**File Storage:**
- Local filesystem only — no cloud object storage
- Crawled images referenced by URL (upstream store URLs), not stored locally
- Client build artifacts written to `client/dist/`

**Caching:**
- No active cache layer — `@vercel/kv` is a listed dependency but all cache functions in `server/services/session-store.js` are no-ops returning `null`/`false`/`[]`
- Recommendation snapshots use an in-memory pending-result map inside `server/routes/recommend.js` (process-lifetime only, not persistent)

## Authentication & Identity

**Magic Link Email Auth (primary):**
- Implementation: custom; `server/services/email-auth.js`, routes in `server/routes/auth.js`
- Flow: email address → SMTP-delivered one-time link → short-lived `email_auth_tokens` DB record → JWT pair
- Storage: `email_auth_tokens` table (DB), `refresh_tokens` table (DB), JWT in client `localStorage` under key `dd24_auth_session`

**Google OAuth:**
- Implementation: custom (no Passport.js); `server/services/google-oauth.js`
- Endpoints: `https://accounts.google.com/o/oauth2/v2/auth`, `https://oauth2.googleapis.com/token`, `https://openidconnect.googleapis.com/v1/userinfo`
- Auth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Callback: `GOOGLE_CALLBACK_URL` or `CLIENT_APP_URL/oauth/google/callback`
- Dev mode: mock flow enabled via `GOOGLE_AUTH_DEV_AUTO_VERIFY=true` or `GOOGLE_OAUTH_MOCK_PROFILE_JSON`

**Facebook OAuth:**
- Implementation: custom; `server/services/facebook-oauth.js`
- Endpoints: `https://www.facebook.com/v20.0/dialog/oauth`, `https://graph.facebook.com/v20.0/oauth/access_token`, `https://graph.facebook.com/me`
- Auth: `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET`
- Callback: `FACEBOOK_CALLBACK_URL` or derived from `CLIENT_APP_URL`
- Dev mode: mock flow via `FACEBOOK_OAUTH_MOCK_PROFILE_JSON`

**JWT (session tokens):**
- Implementation: hand-rolled HS256 JWT, no third-party JWT library; `server/utils/jwt.js`
- Signing: `JWT_SECRET` (access tokens), `JWT_REFRESH_SECRET` (refresh tokens)
- TTLs: `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS`
- Admin API: static `ADMIN_SECRET` Bearer token checked in `server/middleware/auth.js`

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry, Datadog, etc.)

**Logs:**
- morgan (`^1.10.0`) — HTTP access logs to stdout (dev format)
- `console.log`/`console.error` — crawler and server runtime events
- `server/services/ops-notifier.js` — structured ops alerts to Slack webhook or SMTP when configured; falls back to stdout

**Crawl Observability:**
- `crawl_runs` and `crawl_store_results` DB tables — per-store crawl history with timing, counts, and error messages
- `job_runs` DB table — generic job execution log

**Analytics (in-DB):**
- `events` table — user interaction events logged by `server/services/event-tracker.js`
- `search_queries` table — search term tracking logged by `server/services/search-tracker.js`

## CI/CD & Deployment

**Hosting:**
- Vercel — primary production deployment; `vercel.json` defines serverless function config
  - Function: `api/server.js`, max duration 300s, includes `server/**/*`
  - Static: `client/dist` served as CDN assets

**CI Pipeline:**
- GitHub Actions (`.github/workflows/crawl.yml`) — daily crawl at 08:00 Europe/Berlin (UTC cron `50 5 * * *`)
  - Connects to Turso production DB via GitHub Secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `DESI_DEALS_DB_TURSO_DATABASE_URL`, `DESI_DEALS_DB_TURSO_AUTH_TOKEN`
  - Node.js 20, `ubuntu-latest`
- GitHub Actions (`.github/workflows/weekly-catalog-crawl.yml`) — weekly catalog crawl

## Environment Configuration

**Required env vars (production):**
- `TURSO_DATABASE_URL` or `DESI_DEALS_DB_TURSO_DATABASE_URL` — Turso DB endpoint
- `TURSO_AUTH_TOKEN` or `DESI_DEALS_DB_TURSO_AUTH_TOKEN` — Turso auth token
- `ADMIN_SECRET` — static Bearer token for admin API routes
- `JWT_SECRET` — HMAC secret for access token signing
- `JWT_REFRESH_SECRET` — HMAC secret for refresh token signing
- `CLIENT_APP_URL` — public base URL for redirect/share URL generation

**Optional env vars:**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` — SMTP for magic-link and alert emails
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google OAuth
- `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` — Facebook OAuth
- `KIT_API_KEY`, `KIT_FORM_ID` — Kit newsletter integration
- `SLACK_WEBHOOK_URL` — Slack ops notifications
- `ALERT_EMAIL_TO` — email address for ops alert emails
- `ANTHROPIC_API_KEY` — Claude API (scripts only)
- `OPENAI_API_KEY` — OpenAI batch API (scripts only)
- `PORT` — override server port (default: 3000)
- `DB_FILE` — override local SQLite path
- `DB_BOOTSTRAP_ON_STARTUP` — force schema migration on startup (`true`/`false`)
- `VERCEL` — disables local cron scheduler when set
- `CRAWL_ON_STARTUP` — triggers crawl immediately on server start
- `ADMIN_EMAILS` — comma-separated admin email addresses seeded to DB

**Secrets location:**
- Production: Vercel dashboard (for app) + GitHub repository Secrets (for CI crawl)
- Local dev: `.env.local` file (gitignored, takes precedence via dotenv override)

## Webhooks & Callbacks

**Incoming:**
- OAuth callbacks: `/oauth/google/callback` (frontend route, handled by `client/src/pages/OAuthCallbackPage.jsx`), backend processes token exchange at `/api/v1/auth/google/callback`
- `/api/v1/inbound` — `server/routes/inbound.js`; store-facing webhook endpoint (store webhook secret validated per-store from `stores.webhook_secret` DB column)

**Outgoing:**
- Slack webhook: `SLACK_WEBHOOK_URL` — POSTed by `server/services/ops-notifier.js` on crawl failure or deal pool warnings
- Kit API: `https://api.kit.com/v4` — POST on new user signup from `server/services/kit.js`

## Store Scraping

**Crawl targets (31 stores):**
- Shopify JSON API — `/collections/{handle}/products.json?limit=250`: jamoona, dookan, namma-markt
- WooCommerce HTML + Cheerio — pagination `/page/N/`: little-india and several others
- HTMX/HTML + Cheerio — multi-selector fallback: grocera, and majority of remaining stores
- Full catalog mode — `crawler/shopify-full-catalog.js` and `crawler/woocommerce-full-catalog.js` for deeper product indexing
- All adapters in `crawler/stores/*.js`; each exports `{ storeId, storeName, storeUrl, scrape() }`
- HTTP transport: `node-fetch` v2 with 2–5s delays between stores

---

*Integration audit: 2026-05-04*
