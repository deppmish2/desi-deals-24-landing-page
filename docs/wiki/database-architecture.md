# DesiDeals24 — Database Architecture

## Engine & Connection

| | |
|---|---|
| **Engine** | Turso (libSQL) — remote production, SQLite file for local dev |
| **Local path** | `./data/prod_local.db` (set via `DB_FILE` env var) |
| **Module** | `server/db/index.js` |
| **Env vars** | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (or `DESI_DEALS_DB_*` prefixed variants) |

### DB API (compatibility shim)

```js
await db.prepare(sql).all(...args)   // → row[]
await db.prepare(sql).get(...args)   // → row | undefined
await db.prepare(sql).run(...args)   // → { changes, lastInsertRowid, rowsAffected }
await db.execute(sql, args)          // → ResultSet (libsql native)
await db.batch(statements, mode)     // → atomic batch
```

Parameters: positional `?` → array; named `:name` → object.

---

## Tables

### 1. `stores`
Registry of grocery stores being crawled.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | e.g. `"jamoona"` |
| name | TEXT NOT NULL | Display name |
| url | TEXT NOT NULL | Store website |
| platform | TEXT | `'unknown'` default |
| logo_url | TEXT | |
| last_crawled_at | DATETIME | |
| crawl_status | TEXT | `'active'` default |
| free_shipping_min | REAL | Min basket for free shipping |
| address | TEXT | |
| contact_phone | TEXT | |
| contact_email | TEXT | |
| webhook_secret | TEXT | |

---

### 2. `deals`
Individual product listings scraped from stores. Core table.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| crawl_run_id | TEXT → crawl_runs | |
| crawl_timestamp | DATETIME NOT NULL | |
| store_id | TEXT → stores | |
| canonical_id | TEXT → canonical_products | NULL until resolved |
| product_name | TEXT NOT NULL | Raw name from store |
| product_category | TEXT NOT NULL | |
| product_url | TEXT NOT NULL | Dedup key per crawl |
| image_url | TEXT | |
| weight_raw | TEXT | e.g. `"500g"` |
| weight_value | REAL | Parsed weight |
| weight_unit | TEXT | g, kg, ml, etc. |
| sale_price | REAL NOT NULL | |
| original_price | REAL | |
| discount_percent | REAL | |
| price_per_kg | REAL | Normalised for comparison |
| price_per_unit | REAL | |
| currency | TEXT | `'EUR'` default |
| availability | TEXT | `'unknown'` default |
| bulk_pricing | TEXT | |
| best_before | TEXT | |
| display_date | TEXT | |
| display_order | INTEGER | |
| is_active | INTEGER | 0 at crawl start, 1 for newly crawled |
| created_at | DATETIME | |

**Indexes:** store_id, product_name, product_category, is_active, sale_price, discount_percent, crawl_run_id, canonical_id, (display_date, display_order), (is_active, display_date, display_order)

---

### 3. `crawl_runs`
Metadata for each crawl cycle.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| crawl_date | TEXT | e.g. `"2026-04-15"` |
| started_at | DATETIME NOT NULL | |
| finished_at | DATETIME | |
| status | TEXT | `'running'` default |
| stores_attempted | INTEGER | |
| stores_succeeded | INTEGER | |
| deals_found | INTEGER | |
| errors | TEXT | JSON `[{store_id, error_message}]` |

**Indexes:** crawl_date

---

### 4. `crawl_store_results`
Per-store outcome for each crawl run.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| crawl_run_id | TEXT → crawl_runs | CASCADE |
| crawl_date | TEXT | Denormalised copy |
| store_id | TEXT → stores | |
| store_name / store_url | TEXT | Snapshot at crawl time |
| started_at / finished_at | DATETIME | |
| status | TEXT NOT NULL | success / failure / timeout |
| deals_scraped / inserted / updated / unchanged / removed | INTEGER | |
| history_rows_written | INTEGER | |
| category_counts_json | TEXT | `{category: count}` |
| error_message | TEXT | |
| created_at | DATETIME | |

---

### 5. `deal_price_history`
Immutable daily price snapshots — audit log. UNIQUE(crawl_date, store_id, product_url).

Key columns: all price fields from `deals` + `crawl_date`, `is_deal` flag.

**Indexes:** crawl_date, (store_id, crawl_date), product_url

---

### 6. `job_runs`
Generic ledger for scheduled and manual jobs.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| job_name | TEXT NOT NULL | e.g. `"crawl"`, `"brand_remap"` |
| trigger_type | TEXT | schedule / manual / webhook |
| status | TEXT NOT NULL | running / completed / failed |
| started_at / finished_at | DATETIME | |
| duration_ms | INTEGER | |
| item_count | INTEGER | |
| warning_count | INTEGER | |
| details | TEXT | JSON |
| error_message | TEXT | |

---

### 7. `crawl_locks`
Distributed lock to prevent concurrent store crawls.

| Column | Type | Notes |
|---|---|---|
| lock_key | TEXT PK | e.g. `"store:jamoona"` |
| owner_id | TEXT NOT NULL | Process/instance ID |
| acquired_at | DATETIME NOT NULL | |
| expires_at | DATETIME NOT NULL | Auto-release |

---

### 8. `users`
Registered shoppers and admins.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| email | TEXT UNIQUE NOT NULL | |
| name / first_name | TEXT | |
| password_hash | TEXT | |
| google_id / facebook_id | TEXT UNIQUE | OAuth IDs |
| postcode | TEXT NOT NULL | For delivery zones |
| city | TEXT | |
| dietary_prefs | TEXT | JSON array |
| preferred_stores / blocked_stores / preferred_brands | TEXT | JSON arrays |
| delivery_speed_pref | TEXT | `'cheapest'` default |
| email_verified_at | DATETIME | |
| user_type | TEXT | basic / premium |
| waitlist_referral_code | TEXT UNIQUE | |
| waitlist_referrer_user_id | TEXT → users | Self-referential |
| waitlist_unlocked_at | DATETIME | |
| is_admin | INTEGER | 0=user, 1=admin |
| created_at / last_login_at | DATETIME | |

---

### 9. `email_auth_tokens`
One-time tokens for passwordless login/signup.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| email | TEXT NOT NULL | |
| token_hash | TEXT UNIQUE NOT NULL | HMAC-SHA256, never plaintext |
| purpose | TEXT | signup / login |
| referral_code | TEXT | |
| requested_ip / requested_user_agent | TEXT | |
| expires_at | DATETIME NOT NULL | |
| consumed_at | DATETIME | |

---

### 10. `waitlist_referrals`
Confirmed referral claims (inviter → invited, 1 per invited user).

---

### 11. `refresh_tokens`
Session refresh tokens (JWT for access, this for refresh).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT → users | CASCADE |
| token_hash | TEXT UNIQUE NOT NULL | |
| expires_at | DATETIME NOT NULL | |
| revoked_at | DATETIME | |

---

### 12. `shopping_lists` + `list_items`
User-created lists. Items optionally resolve to `canonical_products`.

---

### 13. `shipping_tiers`
Shipping cost brackets per store (min_basket → max_basket → cost).

### 14. `delivery_options`
Delivery method options per store (standard, express, next-day, pickup) with cutoff times and postcode eligibility.

---

### 15. `canonical_products`
**Central entity-resolution table.** Each row is a unique product identity used to group deals across stores for price comparison.

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | Hyphen-slug, e.g. `heera-soan-papdi-500g` |
| canonical_name | TEXT NOT NULL | Human-readable; input to fuzzy matcher |
| category | TEXT | One of 16 categories |
| common_aliases | TEXT | JSON array of alt names |
| base_unit | TEXT | |
| image_url | TEXT | |
| verified | INTEGER | 0=auto, 1=admin-verified |
| is_priority / is_match_priority | INTEGER | Matching weight flags |
| brand_slots | TEXT | JSON `[["heera"]]` — brand token groups |
| base_product_slots | TEXT | JSON `[["soan"],["papdi"]]` — product tokens |
| type_slots | TEXT | JSON `[]` — variant tokens |
| product_group_id | TEXT | Slug joining all tokens with `-` |
| weight_value / weight_unit | REAL / TEXT | |
| created_at | DATETIME | |

**Role in system:**
- `id` — join key for `deal_mappings`, `deals.canonical_id`, price comparison
- `canonical_name` — input vocabulary for fuzzy matcher when resolving new deals
- `brand_slots` / `base_product_slots` / `type_slots` — structured decomposition for `decomposeCanonical()` and auto-mapping

---

### 16. `product_groups`
Brand-agnostic, weight-agnostic groups for cross-brand comparison and substitution suggestions (e.g. all 500g–5kg basmati variants share one group).

| Column | Type | Notes |
|---|---|---|
| id | TEXT PK | |
| group_name | TEXT NOT NULL | e.g. `"Basmati Rice"` |
| category | TEXT | |

---

### 17. `deal_mappings`
Maps deals to canonical products. Primary key is `(deal_id, canonical_id)`.

| Column | Type | Notes |
|---|---|---|
| deal_id | TEXT → deals | CASCADE |
| canonical_id | TEXT → canonical_products | CASCADE |
| match_method | TEXT NOT NULL | exact / fuzzy / manual / slot |
| match_confidence | REAL | 0–1 |
| verified_at | DATETIME | Admin-verified timestamp |

**This table drives price comparison across stores.** `batchGetRealSavings()` joins on `deal_mappings.canonical_id` to group all deals for the same product and compute reference prices.

**Indexes:** canonical_id

---

### 18. `entity_resolution_queue`
Admin review queue for deals that couldn't be auto-matched (confidence < 0.90).

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| deal_id | TEXT → deals | CASCADE |
| suggested_canonical_id | TEXT → canonical_products | SET NULL — best fuzzy guess |
| confidence | REAL | Score of the suggestion |
| raw_name | TEXT NOT NULL | Original deal name |
| normalised_name | TEXT | Stored at enqueue time (re-derived live on GET) |
| status | TEXT | `'pending'` default; confirmed / dismissed |
| store_id | TEXT → stores | SET NULL |
| category | TEXT | |
| created_at | DATETIME | |

**Indexes:** status, deal_id, (category, status)

---

### 19. `price_alerts` + `alert_notifications`
User price alert definitions and their delivery audit log.

---

### 20. `events`
Analytics event log (deal views, signups, list creation, etc.).

### 21. `search_queries`
Search analytics — raw and normalised queries with result counts.

### 22. `app_settings`
Key-value config store. Current entries: `display_member_count`.

### 23. `known_brands`
Brand registry with JSON aliases. Used by `decomposeCanonical()` for brand slot extraction.

Seeded: Aachi, Aashirvaad, Bambino, Daawat, Gits, Haldiram's, Heer, ITC, Knorr, LKK, Maggi, MTR, Nanak, Priya, Shan, Swad

### 24. `brand_remap_jobs`
Async job tracker for admin-triggered brand remaps.

### 25. `bookmarks`
User-saved deals. UNIQUE(user_id, deal_id).

---

## Foreign Key Map

| Child | FK | Parent | On Delete |
|---|---|---|---|
| deals | store_id | stores | — |
| deals | crawl_run_id | crawl_runs | — |
| deals | canonical_id | canonical_products | — |
| crawl_store_results | crawl_run_id | crawl_runs | CASCADE |
| crawl_store_results | store_id | stores | — |
| deal_price_history | crawl_run_id | crawl_runs | — |
| deal_price_history | store_id | stores | — |
| deal_mappings | deal_id | deals | CASCADE |
| deal_mappings | canonical_id | canonical_products | CASCADE |
| entity_resolution_queue | deal_id | deals | CASCADE |
| entity_resolution_queue | suggested_canonical_id | canonical_products | SET NULL |
| entity_resolution_queue | store_id | stores | SET NULL |
| refresh_tokens | user_id | users | CASCADE |
| shopping_lists | user_id | users | CASCADE |
| list_items | list_id | shopping_lists | CASCADE |
| shipping_tiers | store_id | stores | — |
| delivery_options | store_id | stores | — |
| price_alerts | user_id | users | CASCADE |
| price_alerts | target_store_id | stores | — |
| alert_notifications | alert_id | price_alerts | CASCADE |
| alert_notifications | user_id | users | CASCADE |
| events | user_id | users | SET NULL |
| search_queries | user_id | users | SET NULL |
| bookmarks | user_id | users | CASCADE |
| bookmarks | deal_id | deals | CASCADE |
| users | waitlist_referrer_user_id | users | SET NULL |

---

## Migration Strategy

**Always-run migrations** (execute on every app start, idempotent):
1. `ALTER TABLE canonical_products ADD COLUMN is_priority INTEGER DEFAULT 0`
2. `ALTER TABLE deal_price_history ADD COLUMN is_deal INTEGER DEFAULT 0`
3. `CREATE TABLE IF NOT EXISTS known_brands`
4. `CREATE TABLE IF NOT EXISTS brand_remap_jobs`
5. `CREATE INDEX IF NOT EXISTS idx_brand_remap_jobs_status`
6. `ALTER TABLE entity_resolution_queue ADD COLUMN store_id`
7. `ALTER TABLE entity_resolution_queue ADD COLUMN category`
8. `CREATE INDEX IF NOT EXISTS idx_queue_deal_id`
9. `CREATE INDEX IF NOT EXISTS idx_queue_category`

**Bootstrap migrations** (local SQLite only, if `DB_BOOTSTRAP_ON_STARTUP != 'false'`):
Full `schema.sql` + 51 ALTER TABLE statements + additional tables.

**Seeding** (local only): 31 stores, 16 brands, admin flags, display member count.

---

## Entity Resolution Pipeline

```
crawled deal
    │
    ▼
normalise(raw_name)          ← strips BBD, exp, dates, units, qualifiers
    │
    ▼
exact match against canonical_names
    │ miss
    ▼
fuzzyMatch(normalised, canonical_names)   ← threshold ≥ 0.90
    │ hit                     │ miss
    ▼                         ▼
deal_mappings INSERT     entity_resolution_queue INSERT (status=pending)
deals.canonical_id SET        │
                              ▼
                         Admin Review Queue UI
                         (confirm / create / dismiss)
```

---

## Design Notes

- **No ORM** — raw SQL via `db.prepare()` shim or `db.execute()`
- **Soft deletes** — `deals.is_active` flag; no hard deletes on crawl
- **Immutable history** — `deal_price_history` is append-only
- **Price comparison joins on `canonical_id`** — not canonical_name
- **canonical_name is the matcher's vocabulary** — kept clean for fuzzy matching quality
- **No ON UPDATE CASCADE** — canonical_id renames require manual cascade (see `admin-review-queue.js` PATCH endpoint)
- **Slot arrays are nested** — `[["heera"]]`, `[["soan"],["papdi"]]` — each inner array is a synonym group
