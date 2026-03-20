# DesiDeals24 — Production Architecture Design
> Output of `crisp_run.spec` — March 2026

---

## 1. Root Cause Analysis

### 1.1 Slow page loads after inactivity

**Primary cause: Vercel serverless cold starts.**
When the function has not been invoked for ~15–30 minutes, Vercel spins down the container. The next request must:
- Boot a new Node.js process
- Connect to Turso (TCP handshake + auth)
- Query the DB
- Return data

This adds 1–4 s of latency on first load after inactivity. Users perceive the site as "broken."

**Secondary cause: No edge/CDN cache in front of the API.**
`GET /api/v1/deals` is not cached at the CDN layer — every request (including the very first one post-cold-start) hits the serverless function directly.

### 1.2 Crawl reliability

**The crawl runs via GitHub Actions in an external repo** (not this codebase). This is fragile:
- If the Actions workflow is disabled, edited, or hits quota, crawls silently stop.
- No visibility from this codebase — the server has no way to alert on missed crawls.
- The Vercel 60 s function limit drove this workaround. It solves one constraint but creates an operational blind spot.

**The Vercel Cron only refreshes the pool, not the crawl.**
If GitHub Actions fails to push new deal data, the pool refresh will either:
- Re-curate stale data (old deals with wrong prices), or
- Silently generate a thin/empty pool if discounts have expired.

### 1.3 No in-memory / edge cache

Every `GET /api/v1/deals` call:
1. Hits serverless function (cold-start risk)
2. Issues a Turso TCP query over the network

The daily pool is fixed for 24 hours — it does not need to be re-fetched from the DB on every request. Without a cache layer, each page view pays the full round-trip cost.

### 1.4 Missing alerting

- No alert fires when a crawl is skipped or returns zero deals.
- No alert fires when the daily pool is thin (< 24 entries, or discounts below threshold).
- No alert fires when Turso latency spikes.
- Ops must notice the problem reactively, after users complain.

### 1.5 Concurrent crawl safety (partial)

The lock mechanism in `crawler/utils/snapshot.js` prevents double-runs within a single environment. But if both the local scheduler and GitHub Actions trigger simultaneously, they target the same Turso DB and the lock is the only guard. This is currently fine but will break if a third trigger is added without coordination.

---

## 2. Proposed Target Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ CRAWL PIPELINE (decoupled from web server)                         │
│                                                                     │
│  [Trigger: GitHub Actions / cron]                                  │
│       ↓                                                             │
│  [Crawl Worker — Node.js script, long-running OK]                  │
│    ├── Fetch from 21+ store adapters (sequential + retry)          │
│    ├── Normalize + validate deals                                   │
│    ├── Write to Turso (idempotent upsert by product_url)           │
│    └── Emit crawl_runs record (success/failure/count)              │
│                                                                     │
│  [Pool Builder — triggered after crawl completes]                  │
│    ├── Select top 24 deals (discount ≥ 20%, ≥ 10 stores)          │
│    ├── Write daily_deal_pool_entries for today's date              │
│    └── Invalidate CDN cache key for today's pool                   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ DATA LAYER                                                          │
│                                                                     │
│  Turso (libSQL) — persistent source of truth                       │
│    ├── deals (active/inactive, deduped by product_url)             │
│    ├── crawl_runs (audit log)                                       │
│    └── daily_deal_pool_entries (precomputed, per-date)             │
│                                                                     │
│  Vercel Edge Config / KV — ultra-low-latency cache                 │
│    └── today_pool:{date} → JSON blob (24 deals, TTL = midnight)    │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ API / DELIVERY LAYER (Vercel Serverless + Edge)                    │
│                                                                     │
│  GET /api/v1/deals                                                  │
│    1. Read from Edge KV cache (< 5 ms, no cold start)             │
│    2. Cache hit → return immediately (CDN-level)                   │
│    3. Cache miss → read from Turso → populate KV → return         │
│                                                                     │
│  Vercel Edge Cache headers on /api/v1/deals:                       │
│    Cache-Control: s-maxage=300, stale-while-revalidate=3600        │
│    (5-min CDN cache, serve stale while refreshing in background)   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ MONITORING                                                          │
│                                                                     │
│  Crawl health endpoint:  GET /api/v1/health/detail                 │
│  Checked by UptimeRobot or similar every 5 min                     │
│  Returns: last_crawl_at, pool_size, deals_active, crawl_errors     │
│                                                                     │
│  Alert conditions:                                                  │
│    - crawl not run in > 26 hours → email / Slack                   │
│    - pool_size < 18 → warning                                      │
│    - pool_size = 0 → critical                                       │
│    - crawl errors > 30% of stores → warning                        │
└────────────────────────────────────────────────────────────────────┘
```

---

## 3. Recommended Stack / Infra Choices

| Concern | Current | Recommended | Why |
|---|---|---|---|
| **Crawl trigger** | GitHub Actions (external repo) | GitHub Actions (this repo, `.github/workflows/daily-pipeline.yml`) | Same tool, but owned here. Visible, auditable, alertable. |
| **Crawl runtime** | Vercel function (60 s limit workaround) | GitHub Actions runner (no time limit) | No workarounds needed. 21 stores × ~5 s = ~2 min, well within limits. |
| **DB** | Turso | Turso (keep) | Already good. libSQL, edge replicas, fast reads. |
| **Pool cache** | None (DB query on every request) | Vercel KV (Redis-compatible, Edge network) | Eliminates Turso round-trip on hot path. Sub-5ms reads from edge. |
| **API cache** | None | Vercel Edge Cache (`Cache-Control` headers) | Free CDN caching. Serves millions of requests without hitting function. |
| **Cold start mitigation** | None | Edge caching + KV | Cold starts only affect cache-miss path (rare). |
| **Monitoring** | None | UptimeRobot (free) + email/Slack alerts via existing `alert-notifier.js` | No new infra needed. Wire up existing code. |
| **Crawl pool builder** | Vercel Cron 3× daily | Step in GitHub Actions workflow (after crawl job) | Sequential, reliable, no separate cron needed. |

---

## 4. Request Flow and Crawl Flow

### 4.1 Request Flow (after this change)

```
User browser
   │
   ▼
Vercel CDN Edge
   │ Cache-Control: s-maxage=300, stale-while-revalidate=3600
   │ HIT (95%+ of requests) → return cached response in < 50 ms
   │
   │ MISS (first request per 5-min window)
   ▼
Vercel Serverless Function: GET /api/v1/deals
   │
   ├─ Check Vercel KV for key "pool:{date}"
   │    HIT → return JSON (< 5 ms), set CDN cache headers
   │
   └─ MISS (rare: pool not yet built for today)
        │
        ▼
      Turso DB — query daily_deal_pool_entries for today
        │
        ▼
      Populate KV cache (TTL = seconds until midnight Berlin)
        │
        ▼
      Return response + CDN cache headers
```

Cold starts only affect the KV-miss path. Once KV is warm (populated after morning crawl), all requests are served from CDN or KV — no DB round-trip, no cold-start sensitivity.

### 4.2 Crawl Flow

```
GitHub Actions: .github/workflows/daily-pipeline.yml
  Triggers: hourly cron, with Berlin-time gating inside the app

  Job: crawl
    Step 1: checkout + npm install
    Step 2: node crawler/index.js
      ├── Acquire DB lock (crawl_locks table)
      ├── For each of 21 stores:
      │    ├── scrape() — fetch + parse
      │    ├── retry up to 2× on network error (exponential backoff)
      │    ├── normalize + validate
      │    └── upsert into deals table (idempotent by product_url)
      ├── Update crawl_runs record
      └── Release lock

    Step 3: node scripts/rebuild-pool-today.js
      ├── Delete today's pool entries
      ├── Run ensureDailyDealsPool() for today
      └── Log pool size + store count

    Step 4: node scripts/invalidate-kv-cache.js
      └── DELETE Vercel KV key "pool:{today}"
          (forces next API request to re-read from DB → re-populate KV)

    Step 5: Notify on failure
      └── If any step fails → POST to Slack webhook / send email via alert-notifier.js

  Job: verify-pool (runs after crawl, even on failure)
    Step 1: curl GET /api/v1/deals → assert pool_size >= 18
    Step 2: If assertion fails → alert (pool too thin)
```

---

## 5. Failure Handling

### 5.1 Per-store crawl failure

- Each store adapter wrapped in try/catch; error recorded in `crawl_runs.errors` JSON.
- Retry logic: 2 retries with 5 s backoff on network errors (not parse errors).
- Store marked `crawl_status = 'error'` in `stores` table — visible in admin dashboard.
- Crawl continues with remaining stores — one bad adapter does not kill the run.

### 5.2 Full crawl failure (job crash)

- GitHub Actions sends failure email automatically (free, built-in).
- `crawl_runs` record has `status = 'failed'` and `ended_at` timestamp.
- Health endpoint `/api/v1/health/detail` exposes `last_successful_crawl_at`.
- If crawl fails, **yesterday's active deals remain in DB** (never auto-deleted).
- Pool builder re-runs on the existing data — users see slightly stale but real data.
- Alert fires if `last_successful_crawl_at` > 26 hours ago.

### 5.3 Pool builder failure

- Pool builder failure is a separate concern from crawl failure.
- If pool build fails, yesterday's pool entries remain in `daily_deal_pool_entries`.
- API falls back: if no pool for today, serves previous day's pool.
- Alert fires if pool for today has < 18 entries by 8 AM Berlin.

### 5.4 DB unavailability (Turso outage)

- KV cache serves existing pool without DB access for TTL duration.
- If KV also misses (rare), function returns 503 with `Retry-After: 60`.
- Do NOT serve empty array — always serve last known data or clear error.

### 5.5 KV cache unavailability

- API falls back to direct Turso query (current behavior).
- No user impact beyond slightly higher latency.

---

## 6. Monitoring and Alerts

### 6.1 Health endpoint

`GET /api/v1/health/detail` (already exists — `server/routes/health.js`)

Extend to return:
```json
{
  "status": "ok",
  "last_crawl": {
    "started_at": "2026-03-20T05:01:23Z",
    "ended_at": "2026-03-20T05:08:45Z",
    "stores_attempted": 21,
    "stores_succeeded": 19,
    "deals_found": 347,
    "errors": ["grocera: timeout"]
  },
  "pool": {
    "date": "2026-03-20",
    "size": 24,
    "min_discount": 0.22,
    "stores_represented": 12
  },
  "db_latency_ms": 12,
  "cache_hit": true
}
```

### 6.2 Alert conditions

| Condition | Severity | Action |
|---|---|---|
| No crawl run in > 26 hours | Critical | Email + Slack |
| Crawl run: > 30% stores failed | Warning | Slack |
| Pool size < 18 by 08:00 Berlin | Warning | Slack |
| Pool size = 0 | Critical | Email + Slack |
| `/api/v1/deals` p95 > 2 s | Warning | Slack |
| Turso DB unreachable | Critical | Email + Slack |

### 6.3 UptimeRobot setup (free tier)

- Monitor: `GET /api/v1/health` every 5 minutes
- Keyword check: `"status":"ok"` must be present
- Alert contacts: email (Rahul, Deepak)
- Escalation: if down > 15 min → SMS or Slack webhook

### 6.4 Crawl run log

`crawl_runs` table already exists. Expose via admin dashboard:
- Last 7 crawl runs (date, duration, stores, deals, errors)
- Flag runs where `stores_succeeded / stores_attempted < 0.7` in red

---

## 7. Step-by-Step Migration Plan

### Phase 1 — Move crawl into this repo (1–2 days)

1. Create `.github/workflows/daily-pipeline.yml`:
   - Trigger: hourly cron + `workflow_dispatch`
   - Steps: checkout, `npm ci`, `npm run schedule:run`, notify on failure
2. Set GitHub repo secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ADMIN_SECRET`, `CRON_SECRET`, Slack webhook URL
3. Run manually once to verify end-to-end: crawl → pool → health check
4. Disable / archive the external GitHub Actions repo (do not delete — keep as backup for 30 days)

**Success criteria:** Daily crawl visible in this repo's Actions tab. `crawl_runs` record created. Pool size = 24.

---

### Phase 2 — Add Vercel KV cache (1 day)

1. Enable Vercel KV in project dashboard (free tier: 30 MB, enough for 365 days of pool blobs)
2. Install `@vercel/kv`: `npm install @vercel/kv`
3. In `server/routes/deals.js`, wrap the pool fetch:
   ```js
   const kv = require('@vercel/kv');
   const cacheKey = `pool:${poolDate}`;

   let pool = await kv.get(cacheKey);
   if (!pool) {
     pool = await getDailyDealsPool(db, { poolDate });
     const ttl = secondsUntilMidnightBerlin();
     await kv.set(cacheKey, pool, { ex: ttl });
   }
   ```
4. Add `Cache-Control: public, s-maxage=300, stale-while-revalidate=3600` response header on `/api/v1/deals`
5. Add KV invalidation step to crawl workflow (after pool builder runs):
   ```bash
   node scripts/invalidate-kv-cache.js
   ```

**Success criteria:** Second request to `/api/v1/deals` is served from KV (< 10 ms). Vercel dashboard shows CDN cache hit rate > 80%.

---

### Phase 3 — Add retry + backoff to crawlers (1 day)

1. Add `crawler/utils/fetch-with-retry.js`:
   ```js
   async function fetchWithRetry(url, options, retries = 2, backoff = 5000) {
     for (let i = 0; i <= retries; i++) {
       try { return await fetch(url, options); }
       catch (err) {
         if (i === retries) throw err;
         await new Promise(r => setTimeout(r, backoff * (i + 1)));
       }
     }
   }
   ```
2. Replace raw `fetch()` calls in store adapters with `fetchWithRetry()`
3. Do NOT retry on 4xx (store-side data error) — only on network/5xx

**Success criteria:** Re-run crawl against a temporarily unreachable store — confirms retry fires and logs correctly.

---

### Phase 4 — Health endpoint + UptimeRobot (1 day)

1. Extend `server/routes/admin-dashboard.js` to expose the health JSON format from §6.1
2. Expose at `GET /api/v1/health` (no auth) and `GET /api/v1/health/detail` (admin auth, more detail)
3. Wire `alert-notifier.js` to fire on crawl failure in the GitHub Actions workflow:
   ```bash
   node -e "require('./server/services/alert-notifier').sendCrawlFailureAlert(process.env.CRAWL_ERROR)"
   ```
4. Set up UptimeRobot monitor on `/api/v1/health`

**Success criteria:** Manually break a crawl run → alert received within 10 minutes.

---

### Phase 5 — Pool verification step + pool-thin alert (0.5 days)

1. Add `scripts/verify-pool.js`:
   - Queries today's pool size
   - Exits with code 1 if pool_size < 18
   - Sends alert if critical
2. Add as final step in `.github/workflows/daily-pipeline.yml`:
   ```yaml
   - name: Verify pool
     run: node scripts/verify-pool.js
     env:
       TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
       TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
   ```

**Success criteria:** Artificially reduce pool entries → GitHub Actions step fails → alert fires.

---

### Phase 6 — Vercel Cron cleanup (0.5 days)

1. Remove redundant crons from `vercel.json` (crawl now handled by GH Actions; pool built in GH Actions too)
2. Keep one Vercel Cron at `0 8 * * *` (Berlin 9 AM) as **safety net pool refresh**:
   - Runs `ensureDailyDealsPool()` only if pool_size < 24
   - Acts as catch-up if GitHub Actions was delayed
3. Remove the 4/5 AM UTC crons (now redundant)

---

## 8. Nice-to-Have Optimizations (Later)

### 8.1 Parallel store crawling with concurrency limit
Run 3–5 store adapters in parallel instead of sequentially. Reduces total crawl time from ~2 min to ~30 s. Use `p-limit` to cap concurrency and avoid overwhelming any single store.

### 8.2 Per-store incremental crawl
Track `stores.last_crawled_at` per store. Only re-crawl stores whose last crawl is > 20 hours old. Reduces load and avoids re-processing unchanged data.

### 8.3 Response streaming for large deal sets
If the pool ever grows to 100+ items, stream the response using Node.js streams or `res.write()` to reduce time-to-first-byte.

### 8.4 Edge Function for `/api/v1/deals`
Convert to a Vercel Edge Function (runs on V8 isolates, no cold start at all). Reads directly from Vercel KV at the edge. Sub-10ms globally. Requires removing Node.js-only APIs from the hot path.

### 8.5 Stale pool as permanent fallback
If today's pool cannot be built (e.g., all stores down), serve yesterday's pool with a `X-Pool-Date: yesterday` header. Frontend can show a banner: "Deals last updated yesterday."

### 8.6 Crawl diff notifications
After each crawl, compute diff vs previous: new deals added, expired deals removed, price changes. Emit to a channel or store as an event. Useful for future user notifications ("New deal at Jamoona!").

### 8.7 Shopify bulk catalog sync
For Shopify stores (jamoona, dookan, namma-markt), use the `/products.json?limit=250&page_info=...` cursor pagination instead of single-page fetch. Catches all deals, not just first 250.

### 8.8 Admin crawl trigger via UI
Add a "Run crawl now" button in the admin dashboard that calls `POST /api/v1/admin/crawl` → triggers `runCrawl(db)` in a background worker. Useful for on-demand refreshes without touching GitHub.
