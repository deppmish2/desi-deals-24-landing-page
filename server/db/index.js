"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { createClient } = require("@libsql/client");
const { getAdminEmailSet } = require("../utils/admin-access");

// Local: file: URL pointing at the existing SQLite file
// Vercel / any env with TURSO_DATABASE_URL: remote Turso DB
const dbFileOverride = process.env.DB_FILE;
const tursoUrl =
  !dbFileOverride &&
  (process.env.TURSO_DATABASE_URL ||
  process.env.DESI_DEALS_DB_TURSO_DATABASE_URL);
const tursoAuthToken =
  process.env.TURSO_AUTH_TOKEN || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;
const usingRemoteDb = Boolean(tursoUrl);
const client = tursoUrl
  ? createClient({
      url: tursoUrl,
      authToken: tursoAuthToken,
    })
  : createClient({
      url: `file:${path.resolve(dbFileOverride || "./data/desiDeals24.db")}`,
    });

/**
 * Thin compatibility shim so route files can use the same call style.
 *
 * Sync better-sqlite3 pattern (old):
 *   db.prepare(sql).all(params)
 *   db.prepare(sql).get(params)
 *   db.prepare(sql).run(params)
 *
 * New async pattern (routes must use await):
 *   await db.query(sql, params)           → ResultSet { rows, ... }
 *   await db.execute(sql, params)         → same
 *   db.prepare(sql).all(params)           → Promise<row[]>
 *   db.prepare(sql).get(params)           → Promise<row | undefined>
 *   db.prepare(sql).run(params)           → Promise<ResultSet>
 */

// Normalise positional (?) and named (:name) params to libsql format
function normaliseArgs(sql, args) {
  if (!args) return [];
  // If it's already an array or undefined, pass through
  if (Array.isArray(args)) return args;
  // Named object params — libsql accepts plain objects for :name bindings
  if (typeof args === "object") return args;
  return [args];
}

const db = {
  /** Raw execute — returns libsql ResultSet */
  async execute(sql, args) {
    return client.execute({ sql, args: normaliseArgs(sql, args) });
  },

  /** Alias */
  async query(sql, args) {
    return client.execute({ sql, args: normaliseArgs(sql, args) });
  },

  /**
   * Returns an object whose .all/.get/.run are async, matching the
   * better-sqlite3 prepare() interface so routes need minimal changes.
   *
   * Usage in routes:
   *   const rows = await db.prepare(sql).all(params)
   *   const row  = await db.prepare(sql).get(params)
   *   await db.prepare(sql).run(params)
   */
  prepare(sql) {
    const normalizeA = (args) =>
      args.length === 1 &&
      !Array.isArray(args[0]) &&
      args[0] !== null &&
      typeof args[0] === "object"
        ? args[0]
        : args.flat();

    return {
      async all(...args) {
        const rs = await client.execute({ sql, args: normalizeA(args) });
        return rs.rows;
      },
      async get(...args) {
        const rs = await client.execute({ sql, args: normalizeA(args) });
        return rs.rows[0] ?? undefined;
      },
      /** Returns { changes, lastInsertRowid } for backward compatibility */
      async run(...args) {
        const rs = await client.execute({ sql, args: normalizeA(args) });
        return {
          changes: rs.rowsAffected,
          lastInsertRowid: rs.lastInsertRowid,
          rowsAffected: rs.rowsAffected,
        };
      },
    };
  },

  /**
   * transaction(fn) — wraps fn so it can be called like db.transaction(fn)().
   * Note: this does NOT provide true SQLite atomicity with @libsql/client when fn
   * uses the outer db object. The business logic has idempotency checks that
   * handle the common race cases. For true atomicity use db.batch() instead.
   */
  transaction(fn) {
    return async (...args) => fn(...args);
  },

  /** Run multiple statements in a batch (DDL, seeds). */
  async exec(sql) {
    // Split on semicolons and run each statement individually
    const stmts = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ sql: s, args: [] }));
    if (stmts.length === 0) return;
    return client.batch(stmts, "write");
  },

  /** Run a list of statements atomically. */
  async batch(statements, mode = "write") {
    return client.batch(statements, mode);
  },

  /** Expose the raw libsql client for advanced use. */
  get raw() {
    return client;
  },
};

// ── Schema bootstrap ──────────────────────────────────────────────────────────
function loadSchemaSql() {
  try {
    return fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  } catch (error) {
    console.warn("[db] schema load warning:", error.message);
    return "";
  }
}

const schema = loadSchemaSql();

function shouldBootstrapRuntimeDb() {
  const override = String(process.env.DB_BOOTSTRAP_ON_STARTUP || "")
    .trim()
    .toLowerCase();

  if (override === "true") return true;
  if (override === "false") return false;

  // Local file DBs should keep self-bootstrapping. Remote Turso runtimes should
  // stay on the hot path and avoid replaying schema/migration work on cold start.
  return !usingRemoteDb;
}

// We can't await at module level in CJS, so we fire-and-forget.
// This keeps local SQLite files and remote Turso schemas aligned.
const ready = (async () => {
  // Always-run migrations — idempotent ALTER TABLE columns that must exist on
  // both local and remote Turso DBs regardless of the bootstrap flag.
  const alwaysMigrations = [
    // Table renames (deals → store_products, etc.) — safe to re-run, fail silently if already renamed
    "ALTER TABLE deals RENAME TO store_products",
    "ALTER TABLE deal_mappings RENAME TO store_product_mappings",
    "ALTER TABLE deal_price_history RENAME TO price_history",
    "ALTER TABLE canonical_products ADD COLUMN is_priority INTEGER DEFAULT 0",
    "ALTER TABLE price_history ADD COLUMN is_deal INTEGER DEFAULT 0",
    // Ensure brand management tables exist on both local and remote paths
    // before the seed block below runs.
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
    `CREATE INDEX IF NOT EXISTS idx_brand_remap_jobs_status
       ON brand_remap_jobs(status, started_at)`,
    "ALTER TABLE entity_resolution_queue ADD COLUMN store_id TEXT REFERENCES stores(id) ON DELETE SET NULL",
    "ALTER TABLE entity_resolution_queue ADD COLUMN category TEXT",
    "CREATE INDEX IF NOT EXISTS idx_queue_deal_id ON entity_resolution_queue(deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_queue_category ON entity_resolution_queue(category, status)",
    "ALTER TABLE canonical_products ADD COLUMN base_key TEXT",
    "CREATE INDEX IF NOT EXISTS idx_canonical_base_key ON canonical_products(base_key)",
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
    "CREATE INDEX IF NOT EXISTS idx_product_alerts_user ON product_alerts(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_product_alerts_canonical ON product_alerts(canonical_id, alert_type)",
    `CREATE TABLE IF NOT EXISTS comparison_sessions (
      id                    TEXT PRIMARY KEY,
      user_id               TEXT NOT NULL REFERENCES users(id),
      list_id               TEXT REFERENCES shopping_lists(id),
      created_at            TEXT NOT NULL,
      selected_store_id     TEXT REFERENCES stores(id),
      order_intent_at       TEXT,
      self_report_status    TEXT CHECK (self_report_status IN ('ordered','not_ordered','still_deciding')),
      self_report_reason    TEXT,
      items_all_available   INTEGER,
      price_as_expected     INTEGER,
      snapshot_json         TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_comp_sessions_user  ON comparison_sessions(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_comp_sessions_list  ON comparison_sessions(list_id)",
    "CREATE INDEX IF NOT EXISTS idx_comp_sessions_order ON comparison_sessions(user_id, order_intent_at DESC)",
    `CREATE TABLE IF NOT EXISTS store_crawl_state (
      store_id            TEXT PRIMARY KEY REFERENCES stores(id),
      last_deal_crawl     TEXT,
      last_catalog_crawl  TEXT,
      catalog_cursor      TEXT,
      crawl_status        TEXT CHECK (crawl_status IN ('idle','running','error')),
      error_message       TEXT,
      updated_at          TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS pending_on_demand_crawls (
      id            TEXT PRIMARY KEY,
      canonical_id  TEXT NOT NULL,
      user_id       TEXT NOT NULL,
      queued_at     TEXT NOT NULL,
      started_at    TEXT
    )`,
    "CREATE INDEX IF NOT EXISTS idx_on_demand_queued  ON pending_on_demand_crawls(queued_at)",
    "CREATE INDEX IF NOT EXISTS idx_on_demand_started ON pending_on_demand_crawls(started_at)",
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
  ];
  for (const sql of alwaysMigrations) {
    try {
      await db.execute(sql);
    } catch (_) {
      // column already exists — ignore
    }
  }

  // Seed known_brands with initial brand list (INSERT OR IGNORE — safe to re-run)
  const SEED_BRANDS = [
    { name: "Aachi",        aliases: ["aachi"] },
    { name: "Aashirvaad",   aliases: ["aashirvaad", "aashirwad", "ashirwad"] },
    { name: "Bambino",      aliases: ["bambino"] },
    { name: "Daawat",       aliases: ["daawat", "dawat"] },
    { name: "Gits",         aliases: ["gits"] },
    { name: "Haldiram's",   aliases: ["haldiram", "haldirams"] },
    { name: "Heer",         aliases: ["heer"] },
    { name: "ITC",          aliases: ["itc"] },
    { name: "Knorr",        aliases: ["knorr"] },
    { name: "LKK",          aliases: ["lkk"] },
    { name: "Maggi",        aliases: ["maggi"] },
    { name: "MTR",          aliases: ["mtr"] },
    { name: "Nanak",        aliases: ["nanak"] },
    { name: "Priya",        aliases: ["priya"] },
    { name: "Shan",         aliases: ["shan"] },
    { name: "Swad",         aliases: ["swad"] },
  ];
  for (const brand of SEED_BRANDS) {
    try {
      await db.execute(
        `INSERT OR IGNORE INTO known_brands (name, aliases) VALUES (?, ?)`,
        [brand.name, JSON.stringify(brand.aliases)],
      );
    } catch (err) {
      if (!err.message?.includes("no such table")) {
        console.warn("[db] known_brands seed warning:", err.message);
      }
    }
  }

  if (!shouldBootstrapRuntimeDb()) {
    return;
  }

  try {
    if (schema) {
      await db.exec(schema);
    }
  } catch (e) {
    console.warn("[db] schema exec warning:", e.message);
  }

  const migrations = [
    "ALTER TABLE store_products ADD COLUMN best_before TEXT",
    "ALTER TABLE store_products ADD COLUMN canonical_id TEXT",
    "ALTER TABLE store_products ADD COLUMN display_date TEXT",
    "ALTER TABLE store_products ADD COLUMN display_order INTEGER",
    "ALTER TABLE stores ADD COLUMN free_shipping_min REAL",
    "ALTER TABLE stores ADD COLUMN address TEXT",
    "ALTER TABLE stores ADD COLUMN contact_phone TEXT",
    "ALTER TABLE stores ADD COLUMN contact_email TEXT",
    "ALTER TABLE stores ADD COLUMN webhook_secret TEXT",
    "ALTER TABLE stores ADD COLUMN platform TEXT DEFAULT 'unknown'",
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
    "ALTER TABLE crawl_runs ADD COLUMN crawl_date TEXT",
    "ALTER TABLE shopping_lists ADD COLUMN raw_input TEXT",
    "ALTER TABLE shopping_lists ADD COLUMN input_method TEXT",
    "ALTER TABLE shopping_lists ADD COLUMN last_used_at DATETIME",
    "ALTER TABLE shopping_lists ADD COLUMN reorder_reminder_days INTEGER",
    "ALTER TABLE list_items ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE list_items ADD COLUMN resolved INTEGER DEFAULT 0",
    "ALTER TABLE list_items ADD COLUMN unresolvable INTEGER DEFAULT 0",
    "ALTER TABLE price_alerts ADD COLUMN canonical_id TEXT",
    "ALTER TABLE price_alerts ADD COLUMN product_query TEXT",
    "ALTER TABLE price_alerts ADD COLUMN min_discount_pct REAL",
    "ALTER TABLE price_alerts ADD COLUMN target_store_id TEXT",
    "ALTER TABLE price_alerts ADD COLUMN triggered INTEGER DEFAULT 0",
    "ALTER TABLE price_alerts ADD COLUMN last_triggered_at DATETIME",
    "ALTER TABLE price_alerts ADD COLUMN is_active INTEGER DEFAULT 1",
    "ALTER TABLE waitlist_referrals DROP COLUMN invited_user_id_user_id",
    "ALTER TABLE waitlist_referrals DROP COLUMN inviter_user_id_user_id",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE canonical_products ADD COLUMN is_priority INTEGER DEFAULT 0",
    "ALTER TABLE canonical_products ADD COLUMN is_match_priority INTEGER DEFAULT 0",
    "ALTER TABLE canonical_products ADD COLUMN brand_slots TEXT",
    "ALTER TABLE canonical_products ADD COLUMN base_product_slots TEXT",
    "ALTER TABLE canonical_products ADD COLUMN type_slots TEXT",
    "ALTER TABLE canonical_products ADD COLUMN product_group_id TEXT",
    "ALTER TABLE canonical_products ADD COLUMN weight_value REAL",
    "ALTER TABLE canonical_products ADD COLUMN weight_unit TEXT",
    `CREATE TABLE IF NOT EXISTS product_groups (
      id         TEXT PRIMARY KEY,
      group_name TEXT NOT NULL,
      category   TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    "ALTER TABLE price_history ADD COLUMN is_deal INTEGER DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      deal_id TEXT NOT NULL REFERENCES store_products(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, deal_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id)",
    // FTS5 virtual table — local SQLite only, not Turso
    `CREATE VIRTUAL TABLE IF NOT EXISTS fts_canonicals USING fts5(
      canonical_id,
      canonical_name,
      base_key,
      aliases_text,
      category,
      brands_text
    )`,
    // store_products — crawl architecture columns
    "ALTER TABLE store_products ADD COLUMN crawl_mode TEXT DEFAULT 'deal'",
    "ALTER TABLE store_products ADD COLUMN is_on_deal INTEGER DEFAULT 1",
    "ALTER TABLE store_products ADD COLUMN external_product_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_sp_external_id ON store_products(store_id, external_product_id)",
    "CREATE INDEX IF NOT EXISTS idx_sp_crawl_mode ON store_products(crawl_mode, is_active)",
    // shopping_lists — order history tracking
    "ALTER TABLE shopping_lists ADD COLUMN last_compared_at DATETIME",
    "ALTER TABLE shopping_lists ADD COLUMN last_order_store_id TEXT REFERENCES stores(id)",
    "ALTER TABLE shopping_lists ADD COLUMN last_order_total REAL",
    "ALTER TABLE shopping_lists ADD COLUMN last_ordered_at DATETIME",
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch (_) {
      // column already exists — ignore
    }
  }

  const bootstrapStatements = [
    `CREATE TABLE IF NOT EXISTS job_runs (
      id TEXT PRIMARY KEY,
      job_name TEXT NOT NULL,
      trigger_type TEXT,
      status TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      finished_at DATETIME,
      duration_ms INTEGER,
      item_count INTEGER,
      warning_count INTEGER DEFAULT 0,
      details TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_job_runs_job_name_started
       ON job_runs(job_name, started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_job_runs_status_started
       ON job_runs(status, started_at)`,
    `CREATE TABLE IF NOT EXISTS price_history (
      id TEXT PRIMARY KEY,
      crawl_date TEXT NOT NULL,
      crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id),
      crawl_timestamp DATETIME NOT NULL,
      store_id TEXT NOT NULL REFERENCES stores(id),
      product_name TEXT NOT NULL,
      product_category TEXT NOT NULL,
      product_url TEXT NOT NULL,
      image_url TEXT,
      weight_raw TEXT,
      weight_value REAL,
      weight_unit TEXT,
      sale_price REAL NOT NULL,
      original_price REAL,
      discount_percent REAL,
      price_per_kg REAL,
      price_per_unit REAL,
      currency TEXT DEFAULT 'EUR',
      availability TEXT DEFAULT 'unknown',
      bulk_pricing TEXT,
      best_before TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (crawl_date, store_id, product_url)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_crawl_runs_crawl_date
       ON crawl_runs(crawl_date)`,
    `CREATE TABLE IF NOT EXISTS crawl_store_results (
      id TEXT PRIMARY KEY,
      crawl_run_id TEXT NOT NULL REFERENCES crawl_runs(id) ON DELETE CASCADE,
      crawl_date TEXT,
      store_id TEXT NOT NULL REFERENCES stores(id),
      store_name TEXT NOT NULL,
      store_url TEXT,
      started_at DATETIME,
      finished_at DATETIME,
      status TEXT NOT NULL,
      deals_scraped INTEGER DEFAULT 0,
      deals_inserted INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_unchanged INTEGER DEFAULT 0,
      deals_removed INTEGER DEFAULT 0,
      history_rows_written INTEGER DEFAULT 0,
      category_counts_json TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_crawl_store_results_run
       ON crawl_store_results(crawl_run_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crawl_store_results_store
       ON crawl_store_results(store_id, crawl_date)`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_crawl_date
       ON price_history(crawl_date)`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_store_date
       ON price_history(store_id, crawl_date)`,
    `CREATE INDEX IF NOT EXISTS idx_price_history_product_url
       ON price_history(product_url)`,
    `CREATE INDEX IF NOT EXISTS idx_store_products_display_date_order
       ON store_products(display_date, display_order)`,
    `CREATE INDEX IF NOT EXISTS idx_store_products_active_display
       ON store_products(is_active, display_date, display_order)`,
    `CREATE TABLE IF NOT EXISTS search_queries (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      normalized_query TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_email TEXT,
      session_id TEXT,
      route TEXT,
      result_count INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_search_queries_created
       ON search_queries(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_search_queries_normalized
       ON search_queries(normalized_query)`,
    `CREATE INDEX IF NOT EXISTS idx_search_queries_user_email
       ON search_queries(user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_search_queries_session_id
       ON search_queries(session_id)`,
  ];

  for (const sql of bootstrapStatements) {
    try {
      await db.execute(sql);
    } catch (error) {
      console.warn("[db] bootstrap statement warning:", error.message);
    }
  }

  const stores = [
    ["jamoona", "Jamoona", "https://www.jamoona.com"],
    ["dookan", "Dookan", "https://eu.dookan.com"],
    ["grocera", "Grocera", "https://www.grocera.de"],
    ["little-india", "Little India", "https://www.littleindia.de"],
    ["namma-markt", "Namma Markt", "https://www.nammamarkt.com"],
    ["globalfoodhub", "Global Food Hub", "https://globalfoodhub.com"],
    ["desigros", "Desigros", "https://www.desigros.com"],
    ["zora-supermarkt", "Zora Supermarkt", "https://www.zorastore.eu"],
    ["md-store", "MD Store", "https://www.md-store.de"],
    [
      "indiansupermarkt",
      "Indian Supermarkt",
      "https://www.indiansupermarkt.de",
    ],
    [
      "indianstorestuttgart",
      "Indian Store Stuttgart",
      "https://www.indianstorestuttgart.com",
    ],
    [
      "anuhita-groceries",
      "AnuHita Groceries",
      "https://www.anuhitagroceries.de",
    ],
    ["sairas", "SAIRAS", "https://www.sairas.de"],
    [
      "indische-lebensmittel-online",
      "Indische-Lebensmittel-Online",
      "https://www.indische-lebensmittel-online.de",
    ],
    ["indianfoodstore", "Indian Food Store", "https://www.indianfoodstore.de"],
    ["swadesh", "Swadesh", "https://www.swadesh.eu"],
    ["spicelands", "Spicelands", "https://www.spicelands.de"],
    ["annachi", "Annachi Europe", "https://www.annachi.fr"],
    [
      "namastedeutschland",
      "Namaste Deutschland",
      "https://www.namastedeutschland.de",
    ],
    ["india-store", "India Store", "https://www.india-store.de"],
    [
      "india-express-food",
      "India Express Food",
      "https://www.india-express-food.de",
    ],
    [
      "transfoodlev",
      "Transfood Lebensmittelvertrieb",
      "https://transfoodlev.com",
    ],
    ["desistore", "Desi Store", "https://desistore.at"],
    [
      "asiatischer-lebensmittelladen",
      "Asiatischer Lebensmittelladen",
      "https://www.asiatischer-lebensmittelladen.de",
    ],
    ["villagefoods", "Village Foods", "https://villagefoods.de"],
    [
      "indianspicebasket",
      "Indian Spice Basket",
      "https://indianspicebasket.be",
    ],
    ["barkatfood", "Barkat Food", "https://barkatfood.de"],
    ["yogimart", "Yogi Mart", "https://yogimart.de"],
    ["bajwa-shop", "Bajwa Shop", "https://bajwa-shop.com"],
    [
      "asiangrocerystore",
      "Asian Grocery Store",
      "https://www.asiangrocerystore.de",
    ],
    ["zakiasianfoods", "Zaki Asian Foods", "https://zakiasianfoods.de"],
    ["masimpex", "MAS Impex", "https://www.masimpex.com"],
  ];

  for (const [id, name, url] of stores) {
    const logoUrl = `${url.replace(/\/+$/, "")}/favicon.ico`;
    try {
      await db.execute(
        `INSERT OR IGNORE INTO stores (id, name, url, logo_url) VALUES (?, ?, ?, ?)`,
        [id, name, url, logoUrl],
      );
    } catch (_) {}
  }

  // Seed display member count (starts at 4347, incremented on each signup)
  try {
    await db.execute(
      `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('display_member_count', '4347')`,
    );
  } catch (_) {}

  // Seed admin status for known admin accounts (configurable via ADMIN_EMAILS env var)
  for (const email of getAdminEmailSet()) {
    try {
      await db.execute(`UPDATE users SET is_admin = 1 WHERE email = ?`, [
        email,
      ]);
    } catch (_) {}
  }
})();

db.ready = ready;

module.exports = db;
