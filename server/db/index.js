"use strict";
require("dotenv").config();
const path = require("path");
const fs = require("fs");

function loadBetterSqlite3Constructor() {
  try {
    return require("better-sqlite3");
  } catch {
    return null;
  }
}

function loadNodeSqliteDatabaseSync() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    return null;
  }
}

function createNodeSqliteCompat(dbPath) {
  const DatabaseSync = loadNodeSqliteDatabaseSync();
  if (!DatabaseSync) {
    throw new Error(
      "better-sqlite3 is unavailable and node:sqlite fallback is not supported in this Node runtime",
    );
  }

  const raw = new DatabaseSync(dbPath);
  function allowedNamedParams(sql) {
    const set = new Set();
    const re = /[@:$]([A-Za-z_][A-Za-z0-9_]*)/g;
    let match;
    while ((match = re.exec(sql)) !== null) {
      set.add(match[1]);
    }
    return set;
  }

  function sanitizeArgs(allowed, args) {
    if (!Array.isArray(args) || args.length !== 1) return args;
    const only = args[0];
    if (!only || typeof only !== "object" || Array.isArray(only)) return args;
    if (allowed.size === 0) return args;

    const filtered = {};
    for (const key of Object.keys(only)) {
      if (allowed.has(key)) filtered[key] = only[key];
    }
    return [filtered];
  }

  return {
    pragma(statement) {
      raw.exec(`PRAGMA ${statement}`);
    },
    exec(sql) {
      return raw.exec(sql);
    },
    prepare(sql) {
      const stmt = raw.prepare(sql);
      const allowed = allowedNamedParams(sql);
      return {
        run(...args) {
          return stmt.run(...sanitizeArgs(allowed, args));
        },
        get(...args) {
          return stmt.get(...sanitizeArgs(allowed, args));
        },
        all(...args) {
          return stmt.all(...sanitizeArgs(allowed, args));
        },
      };
    },
    transaction(fn) {
      return (...args) => {
        raw.exec("BEGIN");
        try {
          const out = fn(...args);
          raw.exec("COMMIT");
          return out;
        } catch (error) {
          raw.exec("ROLLBACK");
          throw error;
        }
      };
    },
  };
}

function createDb(dbPath) {
  const BetterSqlite3 = loadBetterSqlite3Constructor();
  if (BetterSqlite3) {
    try {
      return new BetterSqlite3(dbPath);
    } catch (error) {
      console.warn(
        `[db] better-sqlite3 init failed (${error.message}). Falling back to node:sqlite compatibility wrapper.`,
      );
    }
  } else {
    console.warn(
      "[db] better-sqlite3 module unavailable. Falling back to node:sqlite compatibility wrapper.",
    );
  }

  return createNodeSqliteCompat(dbPath);
}

// Vercel's filesystem is read-only except /tmp
const DB_PATH = process.env.VERCEL
  ? "/tmp/desiDeals24.db"
  : process.env.DB_PATH || "./data/desiDeals24.db";
const dbDir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = createDb(path.resolve(DB_PATH));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Run schema migrations (idempotent — all statements use IF NOT EXISTS)
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Additive column migrations for existing databases
try {
  db.prepare("ALTER TABLE deals ADD COLUMN best_before TEXT").run();
} catch (_) {}
try {
  db.prepare("ALTER TABLE stores ADD COLUMN free_shipping_min REAL").run();
} catch (_) {}
try {
  db.prepare("ALTER TABLE stores ADD COLUMN address TEXT").run();
} catch (_) {}
try {
  db.prepare("ALTER TABLE stores ADD COLUMN contact_phone TEXT").run();
} catch (_) {}
try {
  db.prepare("ALTER TABLE stores ADD COLUMN contact_email TEXT").run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN google_id TEXT UNIQUE`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN facebook_id TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN name TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN first_name TEXT`).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_facebook_id ON users(facebook_id)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE users ADD COLUMN postcode TEXT NOT NULL DEFAULT ''`,
  ).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN city TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN dietary_prefs TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN preferred_stores TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN blocked_stores TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN preferred_brands TEXT`).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE users ADD COLUMN delivery_speed_pref TEXT DEFAULT 'cheapest'`,
  ).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN email_verified_at DATETIME`).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE users ADD COLUMN user_type TEXT CHECK (user_type IN ('basic', 'premium'))`,
  ).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN last_login_at DATETIME`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN waitlist_referral_code TEXT`).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_waitlist_referral_code ON users(waitlist_referral_code)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE users ADD COLUMN waitlist_referrer_user_id TEXT`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_users_waitlist_referrer_user_id ON users(waitlist_referrer_user_id)`,
  ).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE users ADD COLUMN waitlist_unlocked_at DATETIME`).run();
} catch (_) {}
try {
  db.prepare(
    `UPDATE users
     SET first_name = trim(substr(name, 1, instr(name || ' ', ' ') - 1))
     WHERE (first_name IS NULL OR trim(first_name) = '')
       AND name IS NOT NULL
       AND trim(name) != ''`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `UPDATE users
     SET email_verified_at = COALESCE(email_verified_at, last_login_at, created_at, CURRENT_TIMESTAMP)
     WHERE email_verified_at IS NULL
       AND (
         google_id IS NOT NULL
         OR facebook_id IS NOT NULL
         OR password_hash IS NOT NULL
       )`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `UPDATE users
     SET user_type = 'basic',
         waitlist_unlocked_at = COALESCE(waitlist_unlocked_at, last_login_at, created_at, CURRENT_TIMESTAMP)
     WHERE (user_type IS NULL OR trim(user_type) = '')
       AND (
         waitlist_unlocked_at IS NOT NULL
         OR (
           SELECT COUNT(*)
           FROM waitlist_referrals wr
           WHERE wr.inviter_user_id = users.id
         ) >= 2
       )`,
  ).run();
} catch (_) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invited_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      referral_code TEXT,
      invited_email_snapshot TEXT,
      claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (_) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS email_auth_tokens (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'login')),
      referral_code TEXT,
      requested_ip TEXT,
      requested_user_agent TEXT,
      expires_at DATETIME NOT NULL,
      consumed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_users_email_verified_at ON users(email_verified_at)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_email_auth_tokens_email ON email_auth_tokens(email)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_email_auth_tokens_expires_at ON email_auth_tokens(expires_at)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_inviter_user_id ON waitlist_referrals(inviter_user_id)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_referrals_invited_user_id ON waitlist_referrals(invited_user_id)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_claimed_at ON waitlist_referrals(claimed_at)`,
  ).run();
} catch (_) {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_deal_pool_entries (
      pool_date TEXT NOT NULL,
      slot_index INTEGER NOT NULL,
      deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
      store_id TEXT NOT NULL REFERENCES stores(id),
      base_key TEXT,
      product_signature TEXT NOT NULL,
      category TEXT,
      product_name_snapshot TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (pool_date, slot_index),
      UNIQUE (pool_date, product_signature)
    )
  `);
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_daily_deal_pool_entries_pool_date ON daily_deal_pool_entries(pool_date)`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_daily_deal_pool_entries_product_signature ON daily_deal_pool_entries(product_signature)`,
  ).run();
} catch (_) {}
try {
  db.exec(`
    INSERT OR IGNORE INTO waitlist_referrals (
      inviter_user_id,
      invited_user_id,
      referral_code,
      invited_email_snapshot,
      claimed_at
    )
    SELECT
      u.waitlist_referrer_user_id,
      u.id,
      inviter.waitlist_referral_code,
      u.email,
      COALESCE(u.created_at, u.last_login_at, CURRENT_TIMESTAMP)
    FROM users u
    LEFT JOIN users inviter ON inviter.id = u.waitlist_referrer_user_id
    WHERE u.waitlist_referrer_user_id IS NOT NULL
      AND trim(u.waitlist_referrer_user_id) <> ''
  `);
} catch (_) {}
try {
  db.prepare(`ALTER TABLE deals ADD COLUMN canonical_id TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE shopping_lists ADD COLUMN raw_input TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE shopping_lists ADD COLUMN input_method TEXT`).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE shopping_lists ADD COLUMN last_used_at DATETIME`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE shopping_lists ADD COLUMN reorder_reminder_days INTEGER`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE list_items ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE list_items ADD COLUMN resolved INTEGER DEFAULT 0`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE list_items ADD COLUMN unresolvable INTEGER DEFAULT 0`,
  ).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE stores ADD COLUMN webhook_secret TEXT`).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE stores ADD COLUMN platform TEXT DEFAULT 'unknown'`,
  ).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE price_alerts ADD COLUMN canonical_id TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE price_alerts ADD COLUMN product_query TEXT`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE price_alerts ADD COLUMN min_discount_pct REAL`).run();
} catch (_) {}
try {
  db.prepare(`ALTER TABLE price_alerts ADD COLUMN target_store_id TEXT`).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE price_alerts ADD COLUMN triggered INTEGER DEFAULT 0`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE price_alerts ADD COLUMN last_triggered_at DATETIME`,
  ).run();
} catch (_) {}
try {
  db.prepare(
    `ALTER TABLE price_alerts ADD COLUMN is_active INTEGER DEFAULT 1`,
  ).run();
} catch (_) {}

// Seed all target stores
const insertStore = db.prepare(
  `INSERT OR IGNORE INTO stores (id, name, url, logo_url) VALUES (?, ?, ?, ?)`,
);
const stores = [
  // Original 5
  ["jamoona", "Jamoona", "https://www.jamoona.com"],
  ["dookan", "Dookan", "https://eu.dookan.com"],
  ["grocera", "Grocera", "https://www.grocera.de"],
  ["little-india", "Little India", "https://www.littleindia.de"],
  ["namma-markt", "Namma Markt", "https://www.nammamarkt.com"],
  // Shopify stores
  ["globalfoodhub", "Global Food Hub", "https://globalfoodhub.com"],
  ["desigros", "Desigros", "https://www.desigros.com"],
  ["zora-supermarkt", "Zora Supermarkt", "https://www.zorastore.eu"],
  ["md-store", "MD Store", "https://www.md-store.de"],
  ["indiansupermarkt", "Indian Supermarkt", "https://www.indiansupermarkt.de"],
  [
    "indianstorestuttgart",
    "Indian Store Stuttgart",
    "https://www.indianstorestuttgart.com",
  ],
  ["anuhita-groceries", "AnuHita Groceries", "https://www.anuhitagroceries.de"],
  ["sairas", "SAIRAS", "https://www.sairas.de"],
  // WooCommerce stores
  [
    "indische-lebensmittel-online",
    "Indische-Lebensmittel-Online",
    "https://www.indische-lebensmittel-online.de",
  ],
  ["indianfoodstore", "Indian Food Store", "https://www.indianfoodstore.de"],
  ["swadesh", "Swadesh", "https://www.swadesh.eu"],
  ["spicelands", "Spicelands", "https://www.spicelands.de"],
  ["annachi", "Annachi Europe", "https://www.annachi.fr"],
  // Custom HTML stores
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
];
const seedStores = db.transaction(() => {
  for (const [id, name, url] of stores) {
    const baseUrl = String(url || "").replace(/\/+$/, "");
    const logoUrl = baseUrl ? `${baseUrl}/favicon.ico` : null;
    insertStore.run(id, name, url, logoUrl);
  }
});
seedStores();

try {
  db.prepare(
    `UPDATE stores
     SET logo_url = CASE
       WHEN (logo_url IS NULL OR trim(logo_url) = '')
        AND url IS NOT NULL
        AND trim(url) != ''
       THEN rtrim(url, '/') || '/favicon.ico'
       ELSE logo_url
     END`,
  ).run();
} catch (_) {}

module.exports = db;
