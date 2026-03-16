"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { createClient } = require("@libsql/client");

// Local: file: URL pointing at the existing SQLite file
// Vercel / any env with TURSO_DATABASE_URL: remote Turso DB
const tursoUrl =
  process.env.TURSO_DATABASE_URL ||
  process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const tursoAuthToken =
  process.env.TURSO_AUTH_TOKEN ||
  process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;
const client = tursoUrl
  ? createClient({
      url: tursoUrl,
      authToken: tursoAuthToken,
    })
  : createClient({
      url: `file:${path.resolve("./data/desiDeals24.db")}`,
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
      args.length === 1 && !Array.isArray(args[0]) && args[0] !== null && typeof args[0] === 'object'
        ? args[0] : args.flat();

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

// We can't await at module level in CJS, so we fire-and-forget.
// This keeps local SQLite files and remote Turso schemas aligned.
const ready = (async () => {
  try {
    if (schema) {
      await db.exec(schema);
    }
  } catch (e) {
    console.warn("[db] schema exec warning:", e.message);
  }

  const migrations = [
    "ALTER TABLE deals ADD COLUMN best_before TEXT",
    "ALTER TABLE deals ADD COLUMN canonical_id TEXT",
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
    "ALTER TABLE deals ADD COLUMN last_pool_used_at DATETIME",
    "ALTER TABLE waitlist_referrals DROP COLUMN invited_user_id_user_id",
    "ALTER TABLE waitlist_referrals DROP COLUMN inviter_user_id_user_id",
    "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0",
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch (_) {
      // column already exists — ignore
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
    ["indiansupermarkt", "Indian Supermarkt", "https://www.indiansupermarkt.de"],
    ["indianstorestuttgart", "Indian Store Stuttgart", "https://www.indianstorestuttgart.com"],
    ["anuhita-groceries", "AnuHita Groceries", "https://www.anuhitagroceries.de"],
    ["sairas", "SAIRAS", "https://www.sairas.de"],
    ["indische-lebensmittel-online", "Indische-Lebensmittel-Online", "https://www.indische-lebensmittel-online.de"],
    ["indianfoodstore", "Indian Food Store", "https://www.indianfoodstore.de"],
    ["swadesh", "Swadesh", "https://www.swadesh.eu"],
    ["spicelands", "Spicelands", "https://www.spicelands.de"],
    ["annachi", "Annachi Europe", "https://www.annachi.fr"],
    ["namastedeutschland", "Namaste Deutschland", "https://www.namastedeutschland.de"],
    ["india-store", "India Store", "https://www.india-store.de"],
    ["india-express-food", "India Express Food", "https://www.india-express-food.de"],
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

  // Seed admin status for known admin accounts
  const adminEmails = ["itsjustrahul@gmail.com", "deppmish2@googlemail.com"];
  for (const email of adminEmails) {
    try {
      await db.execute(
        `UPDATE users SET is_admin = 1 WHERE email = ?`,
        [email],
      );
    } catch (_) {}
  }
})();

db.ready = ready;

module.exports = db;
