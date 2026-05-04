#!/usr/bin/env node
/**
 * migrate-schema-to-prod-20260504.js
 * Generated: 2026-05-04 08:57 GMT+2
 *
 * Idempotent schema migration — brings production Turso DB to the same schema
 * level as prod_local.db (snapshot 2026-05-04) without touching data.
 *
 * Safe to re-run: CREATE TABLE/INDEX use IF NOT EXISTS; ALTER TABLE ADD COLUMN
 * failures (duplicate column) are silently ignored.
 *
 * Usage:
 *   node scripts/migrate-schema-to-prod-20260504.js           # against Turso (needs .env)
 *   DB_FILE=data/prod_local.db node scripts/migrate-schema-to-prod-20260504.js  # local test
 *   node scripts/migrate-schema-to-prod-20260504.js --dry-run  # print statements only
 */
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { createClient } = require("@libsql/client");

const isDryRun = process.argv.includes("--dry-run");

const dbFile   = process.env.DB_FILE;
const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;

if (!dbFile && !tursoUrl) {
  console.error("Error: set DB_FILE or TURSO_DATABASE_URL + TURSO_AUTH_TOKEN");
  process.exit(1);
}

const client = dbFile
  ? createClient({ url: `file:${dbFile}` })
  : createClient({ url: tursoUrl, authToken: tursoToken });

// ---------------------------------------------------------------------------
// All migrations in dependency order.
// ALTER TABLE ADD COLUMN — errors ignored (duplicate column).
// CREATE TABLE / INDEX   — IF NOT EXISTS, safe to re-run.
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  // ── canonical_products extra columns ──────────────────────────────────────
  "ALTER TABLE canonical_products ADD COLUMN is_priority INTEGER DEFAULT 0",
  "ALTER TABLE canonical_products ADD COLUMN is_match_priority INTEGER DEFAULT 0",
  "ALTER TABLE canonical_products ADD COLUMN brand_slots TEXT",
  "ALTER TABLE canonical_products ADD COLUMN base_product_slots TEXT",
  "ALTER TABLE canonical_products ADD COLUMN type_slots TEXT",
  "ALTER TABLE canonical_products ADD COLUMN product_group_id TEXT",
  "ALTER TABLE canonical_products ADD COLUMN weight_value REAL",
  "ALTER TABLE canonical_products ADD COLUMN weight_unit TEXT",
  "ALTER TABLE canonical_products ADD COLUMN base_key TEXT",
  "CREATE INDEX IF NOT EXISTS idx_canonical_base_key ON canonical_products(base_key)",

  // ── stores extra columns ───────────────────────────────────────────────────
  "ALTER TABLE stores ADD COLUMN free_shipping_min REAL",
  "ALTER TABLE stores ADD COLUMN address TEXT",
  "ALTER TABLE stores ADD COLUMN contact_phone TEXT",
  "ALTER TABLE stores ADD COLUMN contact_email TEXT",
  "ALTER TABLE stores ADD COLUMN webhook_secret TEXT",
  "ALTER TABLE stores ADD COLUMN platform TEXT DEFAULT 'unknown'",

  // ── users extra columns ────────────────────────────────────────────────────
  "ALTER TABLE users ADD COLUMN google_id TEXT",
  "ALTER TABLE users ADD COLUMN facebook_id TEXT",
  "ALTER TABLE users ADD COLUMN name TEXT",
  "ALTER TABLE users ADD COLUMN first_name TEXT",
  "ALTER TABLE users ADD COLUMN postcode TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN city TEXT",
  "ALTER TABLE users ADD COLUMN dietary_prefs TEXT",
  "ALTER TABLE users ADD COLUMN preferred_stores TEXT",
  "ALTER TABLE users ADD COLUMN blocked_stores TEXT",
  "ALTER TABLE users ADD COLUMN preferred_brands TEXT",
  "ALTER TABLE users ADD COLUMN delivery_speed_pref TEXT DEFAULT 'cheapest'",
  "ALTER TABLE users ADD COLUMN email_verified_at DATETIME",
  "ALTER TABLE users ADD COLUMN user_type TEXT CHECK (user_type IN ('basic', 'premium'))",
  "ALTER TABLE users ADD COLUMN last_login_at DATETIME",
  "ALTER TABLE users ADD COLUMN waitlist_referral_code TEXT",
  "ALTER TABLE users ADD COLUMN waitlist_referrer_user_id TEXT",
  "ALTER TABLE users ADD COLUMN waitlist_unlocked_at DATETIME",
  "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  "CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email)",
  "CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)",

  // ── store_products extra columns ───────────────────────────────────────────
  "ALTER TABLE store_products ADD COLUMN best_before TEXT",
  "ALTER TABLE store_products ADD COLUMN canonical_id TEXT",
  "ALTER TABLE store_products ADD COLUMN display_date TEXT",
  "ALTER TABLE store_products ADD COLUMN display_order INTEGER",
  "ALTER TABLE store_products ADD COLUMN last_pool_used_at DATETIME",
  "ALTER TABLE store_products ADD COLUMN crawl_mode TEXT DEFAULT 'deal'",
  "ALTER TABLE store_products ADD COLUMN is_on_deal INTEGER DEFAULT 1",
  "ALTER TABLE store_products ADD COLUMN external_product_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_store_products_store_id   ON store_products(store_id)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_name       ON store_products(product_name)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_category   ON store_products(product_category)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_is_active  ON store_products(is_active)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_sale_price ON store_products(sale_price)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_discount   ON store_products(discount_percent)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_crawl_run  ON store_products(crawl_run_id)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_canonical  ON store_products(canonical_id)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_display_date_order ON store_products(display_date, display_order)",
  "CREATE INDEX IF NOT EXISTS idx_store_products_active_display ON store_products(is_active, display_date, display_order)",
  "CREATE INDEX IF NOT EXISTS idx_sp_external_id ON store_products(store_id, external_product_id)",
  "CREATE INDEX IF NOT EXISTS idx_sp_crawl_mode  ON store_products(crawl_mode, is_active)",

  // ── crawl_runs extra columns ───────────────────────────────────────────────
  "ALTER TABLE crawl_runs ADD COLUMN crawl_date TEXT",
  "CREATE INDEX IF NOT EXISTS idx_crawl_runs_crawl_date ON crawl_runs(crawl_date)",

  // ── price_history extra column + indexes ──────────────────────────────────
  "ALTER TABLE price_history ADD COLUMN is_deal INTEGER DEFAULT 0",
  "CREATE INDEX IF NOT EXISTS idx_price_history_crawl_date ON price_history(crawl_date)",
  "CREATE INDEX IF NOT EXISTS idx_price_history_store_date ON price_history(store_id, crawl_date)",
  "CREATE INDEX IF NOT EXISTS idx_price_history_product_url ON price_history(product_url)",

  // ── shopping_lists extra columns ───────────────────────────────────────────
  "ALTER TABLE shopping_lists ADD COLUMN raw_input TEXT",
  "ALTER TABLE shopping_lists ADD COLUMN input_method TEXT",
  "ALTER TABLE shopping_lists ADD COLUMN last_used_at DATETIME",
  "ALTER TABLE shopping_lists ADD COLUMN reorder_reminder_days INTEGER",
  "ALTER TABLE shopping_lists ADD COLUMN last_compared_at DATETIME",
  "ALTER TABLE shopping_lists ADD COLUMN last_order_store_id TEXT REFERENCES stores(id)",
  "ALTER TABLE shopping_lists ADD COLUMN last_order_total REAL",
  "ALTER TABLE shopping_lists ADD COLUMN last_ordered_at DATETIME",
  "ALTER TABLE shopping_lists ADD COLUMN status TEXT DEFAULT 'pending'",
  "ALTER TABLE shopping_lists ADD COLUMN completed_store_id TEXT",
  "ALTER TABLE shopping_lists ADD COLUMN completed_at DATETIME",
  "ALTER TABLE shopping_lists ADD COLUMN order_status TEXT DEFAULT 'pending' CHECK (order_status IN ('pending','placed','shipped','delivered','issue'))",
  "ALTER TABLE shopping_lists ADD COLUMN savings_eur   REAL",
  "ALTER TABLE shopping_lists ADD COLUMN total_eur     REAL",
  "ALTER TABLE shopping_lists ADD COLUMN rating        INTEGER CHECK (rating BETWEEN 1 AND 5)",
  "ALTER TABLE shopping_lists ADD COLUMN eta_date      TEXT",
  "ALTER TABLE shopping_lists ADD COLUMN issue_text    TEXT",
  "ALTER TABLE shopping_lists ADD COLUMN tracking_url  TEXT",
  "CREATE INDEX IF NOT EXISTS idx_lists_user ON shopping_lists(user_id)",

  // ── list_items extra columns ───────────────────────────────────────────────
  "ALTER TABLE list_items ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE list_items ADD COLUMN resolved INTEGER DEFAULT 0",
  "ALTER TABLE list_items ADD COLUMN unresolvable INTEGER DEFAULT 0",
  "CREATE INDEX IF NOT EXISTS idx_list_items_list ON list_items(list_id)",

  // ── price_alerts extra columns ─────────────────────────────────────────────
  "ALTER TABLE price_alerts ADD COLUMN canonical_id TEXT",
  "ALTER TABLE price_alerts ADD COLUMN product_query TEXT",
  "ALTER TABLE price_alerts ADD COLUMN min_discount_pct REAL",
  "ALTER TABLE price_alerts ADD COLUMN target_store_id TEXT",
  "ALTER TABLE price_alerts ADD COLUMN triggered INTEGER DEFAULT 0",
  "ALTER TABLE price_alerts ADD COLUMN last_triggered_at DATETIME",
  "ALTER TABLE price_alerts ADD COLUMN is_active INTEGER DEFAULT 1",
  "CREATE INDEX IF NOT EXISTS idx_alerts_user   ON price_alerts(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_alerts_type   ON price_alerts(alert_type)",
  "CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(is_active)",
  "CREATE INDEX IF NOT EXISTS idx_alerts_store  ON price_alerts(target_store_id)",
  "CREATE INDEX IF NOT EXISTS idx_alert_notify  ON alert_notifications(alert_id)",

  // ── entity_resolution_queue extra columns ─────────────────────────────────
  "ALTER TABLE entity_resolution_queue ADD COLUMN store_id TEXT REFERENCES stores(id) ON DELETE SET NULL",
  "ALTER TABLE entity_resolution_queue ADD COLUMN category TEXT",
  "CREATE INDEX IF NOT EXISTS idx_queue_status   ON entity_resolution_queue(status)",
  "CREATE INDEX IF NOT EXISTS idx_queue_deal_id  ON entity_resolution_queue(deal_id)",
  "CREATE INDEX IF NOT EXISTS idx_queue_category ON entity_resolution_queue(category, status)",

  // ── email_auth_tokens indexes ──────────────────────────────────────────────
  "CREATE INDEX IF NOT EXISTS idx_email_auth_tokens_email      ON email_auth_tokens(email)",
  "CREATE INDEX IF NOT EXISTS idx_email_auth_tokens_expires_at ON email_auth_tokens(expires_at)",

  // ── waitlist_referrals indexes ─────────────────────────────────────────────
  "CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_inviter_user_id ON waitlist_referrals(inviter_user_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_referrals_invited_user_id ON waitlist_referrals(invited_user_id)",
  "CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_claimed_at ON waitlist_referrals(claimed_at)",

  // ── refresh_tokens indexes ─────────────────────────────────────────────────
  "CREATE INDEX IF NOT EXISTS idx_refresh_user    ON refresh_tokens(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_refresh_hash    ON refresh_tokens(token_hash)",
  "CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at)",

  // ── delivery / shipping indexes ────────────────────────────────────────────
  "CREATE INDEX IF NOT EXISTS idx_shipping_store   ON shipping_tiers(store_id)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_store   ON delivery_options(store_id)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_updated ON delivery_options(updated_at)",

  // ── events / search_queries indexes ───────────────────────────────────────
  "CREATE INDEX IF NOT EXISTS idx_events_name    ON events(event_name)",
  "CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_events_user    ON events(user_id)",

  // ── map_canonical index ────────────────────────────────────────────────────
  "CREATE INDEX IF NOT EXISTS idx_map_canonical ON store_product_mappings(canonical_id)",

  // ── NEW TABLES ─────────────────────────────────────────────────────────────

  `CREATE TABLE IF NOT EXISTS known_brands (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name    TEXT NOT NULL UNIQUE,
    aliases TEXT NOT NULL DEFAULT '[]'
  )`,

  `CREATE TABLE IF NOT EXISTS brand_remap_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    status      TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed')),
    started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    stats       TEXT,
    error       TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_brand_remap_jobs_status ON brand_remap_jobs(status, started_at)",

  `CREATE TABLE IF NOT EXISTS product_groups (
    id         TEXT PRIMARY KEY,
    group_name TEXT NOT NULL,
    category   TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,

  `CREATE TABLE IF NOT EXISTS bookmarks (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deal_id    TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, deal_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)",

  `CREATE TABLE IF NOT EXISTS job_runs (
    id            TEXT PRIMARY KEY,
    job_name      TEXT NOT NULL,
    trigger_type  TEXT,
    status        TEXT NOT NULL,
    started_at    DATETIME NOT NULL,
    finished_at   DATETIME,
    duration_ms   INTEGER,
    item_count    INTEGER,
    warning_count INTEGER DEFAULT 0,
    details       TEXT,
    error_message TEXT,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_job_runs_job_name_started ON job_runs(job_name, started_at)",
  "CREATE INDEX IF NOT EXISTS idx_job_runs_status_started   ON job_runs(status, started_at)",

  `CREATE TABLE IF NOT EXISTS crawl_store_results (
    id                    TEXT PRIMARY KEY,
    crawl_run_id          TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
    crawl_date            TEXT,
    store_id              TEXT NOT NULL REFERENCES stores(id),
    store_name            TEXT NOT NULL,
    store_url             TEXT,
    started_at            DATETIME,
    finished_at           DATETIME,
    status                TEXT NOT NULL,
    deals_scraped         INTEGER DEFAULT 0,
    deals_inserted        INTEGER DEFAULT 0,
    deals_updated         INTEGER DEFAULT 0,
    deals_unchanged       INTEGER DEFAULT 0,
    deals_removed         INTEGER DEFAULT 0,
    history_rows_written  INTEGER DEFAULT 0,
    category_counts_json  TEXT,
    error_message         TEXT,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_crawl_store_results_run   ON crawl_store_results(crawl_run_id)",
  "CREATE INDEX IF NOT EXISTS idx_crawl_store_results_store ON crawl_store_results(store_id, crawl_date)",

  `CREATE TABLE IF NOT EXISTS search_queries (
    id               TEXT PRIMARY KEY,
    query            TEXT NOT NULL,
    normalized_query TEXT NOT NULL,
    user_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email       TEXT,
    session_id       TEXT,
    route            TEXT,
    result_count     INTEGER,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_search_queries_created    ON search_queries(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_search_queries_normalized ON search_queries(normalized_query)",
  "CREATE INDEX IF NOT EXISTS idx_search_queries_user_email ON search_queries(user_email)",
  "CREATE INDEX IF NOT EXISTS idx_search_queries_session_id ON search_queries(session_id)",

  `CREATE TABLE IF NOT EXISTS product_alerts (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    canonical_id    TEXT NOT NULL REFERENCES canonical_products(id),
    store_id        TEXT REFERENCES stores(id),
    alert_type      TEXT NOT NULL CHECK (alert_type IN ('price_below', 'back_in_stock')),
    price_threshold REAL,
    created_at      TEXT NOT NULL,
    notified_at     TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_product_alerts_user      ON product_alerts(user_id)",
  "CREATE INDEX IF NOT EXISTS idx_product_alerts_canonical ON product_alerts(canonical_id, alert_type)",

  `CREATE TABLE IF NOT EXISTS comparison_sessions (
    id                 TEXT PRIMARY KEY,
    user_id            TEXT NOT NULL REFERENCES users(id),
    list_id            TEXT REFERENCES shopping_lists(id),
    created_at         TEXT NOT NULL,
    selected_store_id  TEXT REFERENCES stores(id),
    order_intent_at    TEXT,
    self_report_status TEXT CHECK (self_report_status IN ('ordered','not_ordered','still_deciding')),
    self_report_reason TEXT,
    items_all_available INTEGER,
    price_as_expected  INTEGER,
    snapshot_json      TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_comp_sessions_user  ON comparison_sessions(user_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_comp_sessions_list  ON comparison_sessions(list_id)",
  "CREATE INDEX IF NOT EXISTS idx_comp_sessions_order ON comparison_sessions(user_id, order_intent_at DESC)",

  `CREATE TABLE IF NOT EXISTS store_crawl_state (
    store_id           TEXT PRIMARY KEY REFERENCES stores(id),
    last_deal_crawl    TEXT,
    last_catalog_crawl TEXT,
    catalog_cursor     TEXT,
    crawl_status       TEXT CHECK (crawl_status IN ('idle','running','error')),
    error_message      TEXT,
    updated_at         TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS pending_on_demand_crawls (
    id           TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    queued_at    TEXT NOT NULL,
    started_at   TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_on_demand_queued  ON pending_on_demand_crawls(queued_at)",
  "CREATE INDEX IF NOT EXISTS idx_on_demand_started ON pending_on_demand_crawls(started_at)",

  // ── bootstrap / admin tooling tables ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS canonical_bootstrap_staging (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id              TEXT NOT NULL,
    batch_item_id         TEXT NOT NULL,
    canonical_name        TEXT NOT NULL,
    brand                 TEXT,
    product_type          TEXT NOT NULL,
    variant               TEXT,
    category              TEXT,
    weight_kg             REAL,
    weight_unit           TEXT,
    aliases               TEXT,
    ai_confidence         TEXT NOT NULL,
    needs_review          INTEGER DEFAULT 0,
    review_note           TEXT,
    promoted              INTEGER DEFAULT 0,
    promoted_canonical_id TEXT,
    created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cbs_batch_id      ON canonical_bootstrap_staging(batch_id)",
  "CREATE INDEX IF NOT EXISTS idx_cbs_needs_review  ON canonical_bootstrap_staging(needs_review)",
  "CREATE INDEX IF NOT EXISTS idx_cbs_promoted      ON canonical_bootstrap_staging(promoted)",
  "CREATE INDEX IF NOT EXISTS idx_cbs_canonical_name ON canonical_bootstrap_staging(canonical_name COLLATE NOCASE)",

  `CREATE TABLE IF NOT EXISTS canonical_bootstrap_source_products (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    staging_id           INTEGER NOT NULL REFERENCES canonical_bootstrap_staging(id) ON DELETE CASCADE,
    deal_id              TEXT NOT NULL,
    store_id             TEXT NOT NULL,
    store_name           TEXT,
    raw_product_name     TEXT NOT NULL,
    raw_category         TEXT,
    raw_weight           TEXT,
    raw_weight_value     REAL,
    raw_weight_unit      TEXT,
    store_count_at_crawl INTEGER,
    created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cbsp_staging_id ON canonical_bootstrap_source_products(staging_id)",
  "CREATE INDEX IF NOT EXISTS idx_cbsp_deal_id    ON canonical_bootstrap_source_products(deal_id)",
  "CREATE INDEX IF NOT EXISTS idx_cbsp_raw_name   ON canonical_bootstrap_source_products(raw_product_name COLLATE NOCASE)",

  `CREATE TABLE IF NOT EXISTS bootstrap_product_queue (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_name TEXT    NOT NULL,
    norm_name    TEXT    NOT NULL UNIQUE,
    status       TEXT    NOT NULL DEFAULT 'pending',
    source       TEXT,
    deal_count   INTEGER DEFAULT 0,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
  )`,
  "CREATE INDEX IF NOT EXISTS idx_bpq_status ON bootstrap_product_queue(status)",
  "CREATE INDEX IF NOT EXISTS idx_bpq_norm   ON bootstrap_product_queue(norm_name)",

  // ── app_settings ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
];

async function run() {
  const target = dbFile ? `file:${dbFile}` : tursoUrl;
  console.log(`Target: ${target}`);
  console.log(`Mode:   ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`Statements: ${MIGRATIONS.length}\n`);

  let applied = 0;
  let skipped = 0;
  let failed  = 0;

  for (const sql of MIGRATIONS) {
    const label = sql.slice(0, 80).replace(/\s+/g, " ").trim();
    if (isDryRun) {
      console.log(`  [dry] ${label}`);
      applied++;
      continue;
    }
    try {
      await client.execute(sql);
      console.log(`  [ok]  ${label}`);
      applied++;
    } catch (err) {
      const msg = err.message || String(err);
      // Duplicate column / already exists — expected and safe
      if (
        msg.includes("duplicate column") ||
        msg.includes("already exists") ||
        msg.includes("no such column") && sql.startsWith("ALTER TABLE") && sql.includes("DROP")
      ) {
        console.log(`  [--]  ${label}`);
        skipped++;
      } else {
        console.error(`  [ERR] ${label}`);
        console.error(`        ${msg}`);
        failed++;
      }
    }
  }

  console.log(`\nDone. applied=${applied} already-existed=${skipped} errors=${failed}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
