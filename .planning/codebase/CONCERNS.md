# Codebase Concerns

**Analysis Date:** 2026-05-04

## Tech Debt

**`store_products` rows accumulate indefinitely:**
- Issue: Old rows are only marked `is_active = 0`, never deleted. Every crawl appends new rows. The UNIQUE constraint is `(crawl_date, store_id, product_url)` — the same product URL creates a new row every crawl day.
- Files: `crawler/index.js:212-229`, `server/db/schema.sql:105`
- Impact: Table grows ~32 stores × ~100 deals × 365 days/year unboundedly. Queries that scan `is_active = 0` rows (e.g. `ACTIVE_DEALS_SQL` full-table load in slow path) get slower over time. No purge job exists for `store_products`.
- Fix approach: Add a scheduled purge that deletes rows older than N days where `is_active = 0`. Mirror `purgeOldHistory()` pattern in `server/services/price-history-recorder.js:104`.

**`db.transaction()` is a no-op shim — not atomic:**
- Issue: `db.transaction(fn)` is documented in `server/db/index.js:105-111` as not providing true SQLite atomicity. It just calls `fn()`. Code that relies on it for correctness (e.g. `server/services/deals-seed-loader.js:44-45`) gets no rollback protection.
- Files: `server/db/index.js:105-115`, `server/services/deals-seed-loader.js:44-45`
- Impact: Multi-step writes that fail partway through leave the DB in a partial state. Currently mitigated by idempotency checks but not safe for all callers.
- Fix approach: Replace `db.transaction(fn)` callers with `db.batch(statements, "write")` per the comment. Audit all call sites.

**`better-sqlite3` is a declared dependency but the server uses `@libsql/client`:**
- Issue: `package.json` lists `better-sqlite3` as a production dependency. The server (`server/db/index.js`) uses `@libsql/client` exclusively. `better-sqlite3` is only used in a handful of one-off migration scripts and one integration test (`tests/integration/product-replacements.test.js:4`).
- Files: `package.json:33`, `tests/integration/product-replacements.test.js:4`, `scripts/fix-fresh-produce-base-keys.js:2`
- Impact: Unnecessary native addon compiled on every `npm install`; bloats production image.
- Fix approach: Move `better-sqlite3` to `devDependencies` and update the one integration test to use `node:sqlite` (already used in `tests/integration/helpers.js`).

**`alwaysMigrations` array in `server/db/index.js` grows without end:**
- Issue: Each schema addition is appended as another `ALTER TABLE ... ADD COLUMN` string. All run on every server startup (they fail silently if the column already exists). There is no versioned migration system.
- Files: `server/db/index.js:167-260`
- Impact: Startup time grows; errors are silently swallowed. A bad migration that doesn't fail silently would crash startup with no diagnostic.
- Fix approach: Adopt a schema versioning table (`schema_version`) and only run new migrations.

**`markDealsInactive` loops one row per `UPDATE`:**
- Issue: `crawler/index.js:212-229` issues one `UPDATE store_products SET is_active = 0 WHERE id = ?` per deactivated deal ID rather than batching with `WHERE id IN (...)`.
- Files: `crawler/index.js:212-229`
- Impact: Large deactivation sets (e.g. store going offline) cause hundreds of individual DB round-trips. With remote Turso, each is a network call.
- Fix approach: Batch IDs into chunks and use `WHERE id IN (?,?,...)` up to 999 placeholders.

**`EXCLUDED_STORE_IDS` ("dookan") is defined twice independently:**
- Issue: Dookan display-exclusion is defined as `const EXCLUDED_STORE_IDS = ["dookan"]` in `server/routes/store-products.js:22` AND as `const EXCLUDED_DISPLAY_STORE_IDS_SQL = "'dookan'"` in `crawler/index.js:34`. Neither references the other.
- Files: `server/routes/store-products.js:22-27`, `crawler/index.js:34`
- Impact: Adding or removing a store from display exclusion requires updating two files; easy to miss one.
- Fix approach: Extract to a shared constant in `server/config/store-exclusions.js` and require it in both places.

**`morgan("dev")` runs in production:**
- Issue: `server/index.js:50` uses `app.use(morgan("dev"))` unconditionally. The `dev` format is colorized and verbose; not suitable for production log aggregation.
- Files: `server/index.js:50`
- Impact: Noisy logs in production; colorization breaks log parsers.
- Fix approach: `app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"))`.

**`store_product_mappings.deal_id` column name drift:**
- Issue: `store_product_mappings.deal_id` references `store_products(id)` but uses the old column name from before the `deals → store_products` rename. A comment in `server/db/schema.sql:294` acknowledges this: "Column name not renamed (SQLite column rename requires full table recreation). Accepted naming drift."
- Files: `server/db/schema.sql:293-302`
- Impact: Misleading for new contributors; `entity_resolution_queue` has the same issue (line 308).
- Fix approach: Recreate tables with correct column names during a planned maintenance migration. Low urgency but a documentation liability.

---

## Known Bugs / Behavioral Issues

**Grocera adapter: `CRAWL_ON_STARTUP` / regular crawl misses non-deal products:**
- Symptoms: Grocera crawl in deals-only mode (`isFullCatalogEnabled() === false`) fetches only products tagged `deal` via the Typesense filter. `filter_by: "tags.en:=[deal] && inventory.hidden:=false"`. If Grocera's tagging is inconsistent, items appear to be missing from the app.
- Files: `crawler/stores/grocera.js:27-30`
- Trigger: Normal crawl run without `FULL_CATALOG_CRAWL=1`.
- Workaround: Previously used Cheerio scraping `category/deals`; now uses Typesense API which is more reliable but still tag-dependent.

**Dookan: hardcoded `SALE_HANDLES` list may silently miss new collections:**
- Symptoms: If Dookan adds a new sale collection with a slug not in `SALE_HANDLES` or `FALLBACK_HANDLES`, it is silently skipped. No warning is emitted unless _all_ handles return empty.
- Files: `crawler/stores/dookan.js:25-43`
- Trigger: Dookan restructures their collections.
- Workaround: Dynamic discovery via `resolveCollectionHandles` provides partial coverage in full-catalog mode.

**`transfoodlev`, `villagefoods`, `bajwa-shop` all use `defaultHandles: ["all"]`:**
- Symptoms: These three adapters fetch the entire store catalog (`/collections/all`) rather than a deals-filtered collection. Every product is returned, causing false "deals" to appear (no `compare_at_price` discount).
- Files: `crawler/stores/transfoodlev.js`, `crawler/stores/villagefoods.js`, `crawler/stores/bajwa-shop.js`
- Trigger: Every crawl.
- Workaround: The `DISPLAYABLE_DISCOUNT_SQL` filter in routes hides products without a discount, but products still consume DB storage and crawl time.

---

## Security Considerations

**JWT fallback secret `"changeme-in-production"` is hardcoded:**
- Risk: If `JWT_SECRET` and `ADMIN_SECRET` are both unset, all three auth functions (`accessSecret()`, `refreshSecret()` in `server/routes/auth.js`, and the same pattern in `server/middleware/user-auth.js`, `server/middleware/user-admin-auth.js`) use a well-known literal secret. Any attacker can forge valid JWTs.
- Files: `server/routes/auth.js:76-92`, `server/middleware/user-auth.js:8-10`, `server/middleware/user-admin-auth.js:11`, `server/routes/store-products.js:202`
- Current mitigation: Production presumably sets `ADMIN_SECRET` or `JWT_SECRET`. There is no startup assertion.
- Recommendations: Add a startup check: if `JWT_SECRET` is unset or equals `"changeme-in-production"`, throw in `production` mode and warn otherwise.

**`cors()` with no origin restriction:**
- Risk: `server/index.js:49` uses `app.use(cors())` with no `origin` option, allowing requests from any domain. All API endpoints including authenticated user routes accept cross-origin requests from arbitrary origins.
- Files: `server/index.js:49`
- Current mitigation: JWT authentication protects user data routes.
- Recommendations: Restrict to `CLIENT_APP_URL` / `APP_URL` env vars in production.

**Hardcoded Typesense API key in `crawler/stores/grocera.js`:**
- Risk: `TS_API_KEY = "4gpobkq7OLuOLEvRpMVL2u1aR3BLeCUZ"` is committed to source. This is noted as a "public search key" from Grocera's own frontend JS, so its exposure is intentional on Grocera's end — but committing third-party credentials to source is bad practice and ties a credential rotation to a code deploy.
- Files: `crawler/stores/grocera.js:13-14`
- Current mitigation: Key is read-only / public search key per the comment.
- Recommendations: Move to `GROCERA_TYPESENSE_API_KEY` env var with fallback to the hardcoded value. Keeps the adapter functional without a code change if the key rotates.

**Email auth rate limiting is per-email, not per-IP:**
- Risk: `server/routes/auth.js:847-860` rate-limits magic-link requests by checking the latest token for that email address. An attacker can request links for many different email addresses from one IP without triggering the limit.
- Files: `server/routes/auth.js:847-860`
- Current mitigation: `requested_ip` is stored in `email_auth_tokens` but not used for rate limiting.
- Recommendations: Add IP-based rate limiting (e.g. `express-rate-limit`) to the `/auth/request-link` endpoint.

**No HTTP security headers (`helmet` not installed):**
- Risk: No `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, or `Content-Security-Policy` headers are set. The server has no helmet-equivalent middleware.
- Files: `server/index.js` (absent)
- Current mitigation: Cloudflare/Vercel edge may add some headers at the CDN layer.
- Recommendations: Add `helmet` to `dependencies` and call `app.use(helmet())` before route registration.

**`express.json()` has no body size limit:**
- Risk: `server/index.js:51` calls `express.json()` with no `limit` option (default 100kb). A client can submit large payloads to authenticated endpoints (e.g. `POST /api/v1/lists` accepting item arrays).
- Files: `server/index.js:51`
- Current mitigation: None at the Express layer.
- Recommendations: `app.use(express.json({ limit: "50kb" }))`.

---

## Performance Bottlenecks

**Recommender issues one DB query per store (N+1 pattern):**
- Problem: `server/services/recommender.js:1631-1651` iterates `for (const store of stores)` and executes `SELECT ... FROM store_products WHERE store_id = ? LIMIT 1500` per store. With 32 stores, this is 32 sequential DB round-trips per recommendation request. On remote Turso each round-trip has network latency.
- Files: `server/services/recommender.js:1631-1650`
- Cause: Architecture fetches store-local deal pools independently to enable per-store matching.
- Improvement path: Fetch all active deals for all candidate stores in one query (`WHERE store_id IN (...)`) and partition in memory. Already has a 1500-row per-store cap so total result set is bounded at ~48k rows.

**In-memory deal cache loads entire active deal set into RAM:**
- Problem: `server/routes/store-products.js:416-424` loads all active deals (`ACTIVE_DEALS_SQL`) into a `Map` keyed by crawl ID, serialized as JS objects. For a catalog of 3000+ active deals, this is a multi-MB in-process cache refreshed every 5 minutes.
- Files: `server/routes/store-products.js:40-48`, `server/routes/store-products.js:416-424`
- Cause: Avoids per-request DB scans on the unfiltered "browse all deals" path.
- Improvement path: The fast path (lines 293-412) uses indexed SQL with `display_date` + `display_order`; ensure all common queries hit the fast path. The slow path (full in-memory load) should be documented as fallback-only.

**FTS5 `fts_canonicals` is rebuilt after every crawl, blocking the crawler:**
- Problem: `crawler/index.js:832-834` calls `require("./fts-rebuild").rebuildAll()` as fire-and-forget after every crawl run. FTS5 `INSERT` statements on a large canonical table are synchronous from the crawler's perspective.
- Files: `crawler/index.js:832-834`, `crawler/fts-rebuild.js`
- Cause: Canonical FTS index must stay current for search. Rebuild is a full table scan.
- Improvement path: FTS5 `fts_canonicals` is marked "local SQLite only, not Turso" (`server/db/index.js:376`) — confirm this path is exercised and add a guard to skip on Turso to avoid errors.

---

## Fragile Areas

**`server/services/recommender.js` (2474 lines) — God object:**
- Files: `server/services/recommender.js`
- Why fragile: Single file contains brand detection, weight parsing, combination-engine calls, store matching, cart transfer logic, and pack-size variant resolution. Test coverage is high (746-line test file) but any refactor risks breaking scoring logic whose interactions are complex.
- Safe modification: Run `npm run test:integration` before and after any change. Read `docs/wiki/` matching-spec before modifying scoring weights.
- Test coverage: `tests/integration/recommender.test.js` and `tests/integration/recommender-exact-combination.test.js` cover happy paths; edge cases around brand-stripping and `anyBrandMode` are partially covered.

**`server/db/index.js` — fire-and-forget schema bootstrap:**
- Files: `server/db/index.js:163-170`
- Why fragile: `const ready = (async () => { ... })()` — a module-level async IIFE that runs schema migrations. Route handlers may execute before `ready` resolves if startup is fast. There is no `await db.ready` before serving requests.
- Safe modification: Before adding new `alwaysMigrations` entries, verify the column doesn't already exist in both `schema.sql` and the migration list to avoid duplicate entries.
- Test coverage: No test covers race between server start and schema ready.

**`crawler/index.js` — 32-store sequential crawl with no circuit breaker:**
- Files: `crawler/index.js`
- Why fragile: All 32 adapters run in sequence. One adapter hanging (e.g. on a slow network response with no timeout) stalls the entire crawl. `node-fetch` v2's `timeout` option is used in some adapters (e.g. grocera line 37) but not all.
- Safe modification: Always specify `timeout` in `node-fetch` calls. Verify each new adapter sets a fetch timeout.
- Test coverage: No integration test covers crawl-level error isolation.

**`tests/integration/helpers.js` uses `node:sqlite` (experimental, Node 22+):**
- Files: `tests/integration/helpers.js:5`, `package.json:46`
- Why fragile: `package.json` declares `"node": "20.x"` but `node:sqlite` (`DatabaseSync`) is a Node 22 experimental feature. Tests fail on Node 20.
- Safe modification: Either update `engines.node` to `">=22"` or replace `node:sqlite` with `better-sqlite3` in the test helper (already a declared dependency).
- Test coverage: All 20 integration tests use this helper.

---

## Scaling Limits

**Remote Turso latency on per-row loops:**
- Current capacity: Works well for development and low traffic.
- Limit: `markDealsInactive` (one UPDATE per deactivated deal) and the recommender's per-store query loop both issue sequential round-trips to Turso. At 32 stores with 100 deactivated deals each, that's 3200 sequential network calls per crawl.
- Scaling path: Batch updates; use `db.batch()` for bulk deactivation.

**In-memory deal cache — single process only:**
- Current capacity: Fine for single-instance Express server.
- Limit: `_memCache` is a module-level `Map` in `server/routes/store-products.js`. Multiple Node.js processes (e.g. Vercel serverless) each maintain their own independent cache, causing redundant DB loads.
- Scaling path: Move cache to `@vercel/kv` (already a declared dependency).

---

## Dependencies at Risk

**`node-fetch` v2.7.0 — maintenance mode:**
- Risk: v2 is only maintained for security patches. v3 switched to ESM-only which is incompatible with the CommonJS-only server constraint.
- Impact: No new features; security patches still arrive. Upgrading to v3 requires converting the entire backend to ESM.
- Migration plan: Replace with the built-in `globalThis.fetch` (available since Node 18, stable in Node 21). Requires only a `require('node-fetch')` → global `fetch` swap in crawlers and services.

**`@anthropic-ai/sdk` listed in production `dependencies` but only used by scripts:**
- Risk: `@anthropic-ai/sdk` is only imported in `scripts/bootstrap-canonical-catalogue.js`. Including it in production `dependencies` adds ~2MB to the server bundle.
- Impact: Deploy bloat; SDK version updates trigger full deploys.
- Migration plan: Move to `devDependencies` or create a separate `scripts/package.json`.

**`@vercel/kv` declared but unused in hot paths:**
- Risk: `@vercel/kv` is in `dependencies` but `server/routes/store-products.js` uses a module-level `Map` cache rather than KV. It may be used elsewhere but the main cache path bypasses it.
- Files: `package.json`, `server/routes/store-products.js:40-48`
- Impact: Dependency declared but provides no benefit unless explicitly configured.
- Migration plan: Either wire the KV cache (enables multi-process scaling) or remove the dependency.

---

## Missing Critical Features

**No server-side request rate limiting:**
- Problem: There is no `express-rate-limit` or equivalent on any route. Auth endpoints (`/auth/request-link`), search, and recommendation endpoints are all unprotected against abuse.
- Blocks: Prevents safe public launch without a CDN-level WAF as the only protection.

**No startup assertion for required environment variables:**
- Problem: Missing `ADMIN_SECRET`, `JWT_SECRET`, `TURSO_DATABASE_URL`, etc. cause silent fallbacks to insecure defaults (e.g. `"changeme-in-production"` JWT secret) or runtime errors instead of a clear startup failure.
- Blocks: Hard to debug misconfigured deployments.

**`store_products.crawl_run_id` has no FK constraint:**
- Problem: `server/db/schema.sql:20` declares `crawl_run_id TEXT NOT NULL` with no `REFERENCES crawl_runs(id)` clause (contrast with `crawl_store_results.crawl_run_id` which does have the FK at line 61).
- Files: `server/db/schema.sql:20`
- Blocks: Orphan rows if a crawl_run is deleted. No cascading cleanup.

---

## Test Coverage Gaps

**Crawler error isolation — no test:**
- What's not tested: What happens when one store adapter throws. Does the crawl continue or abort?
- Files: `crawler/index.js`
- Risk: A single adapter failure could abort the entire crawl silently or loudly.
- Priority: High

**`server/db/index.js` bootstrap race — no test:**
- What's not tested: Route handler executing before `alwaysMigrations` completes.
- Files: `server/db/index.js:163-170`
- Risk: Column-not-found errors on cold start in race conditions.
- Priority: Medium

**Auth middleware with missing/invalid `ADMIN_SECRET` — no test:**
- What's not tested: Server behavior when `ADMIN_SECRET` is unset; whether `"changeme-in-production"` JWT is accepted.
- Files: `server/middleware/auth.js`, `server/middleware/user-auth.js`
- Risk: Security regression — a future change could accidentally enable the fallback in production.
- Priority: High

**`transfoodlev` / `villagefoods` / `bajwa-shop` adapters — no unit tests:**
- What's not tested: These three `createShopifyDealsAdapter` instances have no adapter-level tests.
- Files: `crawler/stores/transfoodlev.js`, `crawler/stores/villagefoods.js`, `crawler/stores/bajwa-shop.js`
- Risk: Silent breakage if `shopify-product-factory` behavior changes.
- Priority: Low

---

*Concerns audit: 2026-05-04*
