-- Stores registry
CREATE TABLE IF NOT EXISTS stores (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  platform          TEXT DEFAULT 'unknown',
  logo_url          TEXT,
  last_crawled_at   DATETIME,
  crawl_status      TEXT DEFAULT 'active',
  free_shipping_min REAL,
  address           TEXT,
  contact_phone     TEXT,
  contact_email     TEXT,
  webhook_secret    TEXT
);

-- Individual deals/offers
CREATE TABLE IF NOT EXISTS deals (
  id                TEXT PRIMARY KEY,
  crawl_run_id      TEXT NOT NULL,
  crawl_timestamp   DATETIME NOT NULL,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  canonical_id      TEXT REFERENCES canonical_products(id),
  product_name      TEXT NOT NULL,
  product_category  TEXT NOT NULL,
  product_url       TEXT NOT NULL,
  image_url         TEXT,
  weight_raw        TEXT,
  weight_value      REAL,
  weight_unit       TEXT,
  sale_price        REAL NOT NULL,
  original_price    REAL,
  discount_percent  REAL,
  price_per_kg      REAL,
  price_per_unit    REAL,
  currency          TEXT DEFAULT 'EUR',
  availability      TEXT DEFAULT 'unknown',
  bulk_pricing      TEXT,
  best_before       TEXT,
  is_active         INTEGER DEFAULT 1,
  last_pool_used_at DATETIME,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Crawl run metadata
CREATE TABLE IF NOT EXISTS crawl_runs (
  id                TEXT PRIMARY KEY,
  started_at        DATETIME NOT NULL,
  finished_at       DATETIME,
  status            TEXT DEFAULT 'running',
  stores_attempted  INTEGER DEFAULT 0,
  stores_succeeded  INTEGER DEFAULT 0,
  deals_found       INTEGER DEFAULT 0,
  errors            TEXT
);

CREATE TABLE IF NOT EXISTS crawl_locks (
  lock_key          TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  acquired_at       DATETIME NOT NULL,
  expires_at        DATETIME NOT NULL
);

-- End users and profile preferences
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT UNIQUE NOT NULL,
  name                TEXT,
  first_name          TEXT,
  password_hash       TEXT,
  google_id           TEXT UNIQUE,
  facebook_id         TEXT UNIQUE,
  postcode            TEXT NOT NULL,
  city                TEXT,
  dietary_prefs       TEXT,
  preferred_stores    TEXT,
  blocked_stores      TEXT,
  preferred_brands    TEXT,
  delivery_speed_pref TEXT DEFAULT 'cheapest',
  email_verified_at   DATETIME,
  user_type           TEXT CHECK (user_type IN ('basic', 'premium')),
  waitlist_referral_code TEXT UNIQUE,
  waitlist_referrer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  waitlist_unlocked_at DATETIME,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at       DATETIME
);

-- One-time email auth links for double opt-in signup and passwordless login
CREATE TABLE IF NOT EXISTS email_auth_tokens (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL,
  token_hash          TEXT NOT NULL UNIQUE,
  purpose             TEXT NOT NULL CHECK (purpose IN ('signup', 'login')),
  referral_code       TEXT,
  requested_ip        TEXT,
  requested_user_agent TEXT,
  expires_at          DATETIME NOT NULL,
  consumed_at         DATETIME,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Confirmed waitlist referral claims
CREATE TABLE IF NOT EXISTS waitlist_referrals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  inviter_user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_user_id      TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  referral_code        TEXT,
  invited_email_snapshot TEXT,
  claimed_at           DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at           DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Fixed daily landing pool entries
CREATE TABLE IF NOT EXISTS daily_deal_pool_entries (
  pool_date             TEXT NOT NULL,
  slot_index            INTEGER NOT NULL,
  deal_id               TEXT REFERENCES deals(id) ON DELETE SET NULL,
  store_id              TEXT NOT NULL REFERENCES stores(id),
  base_key              TEXT,
  product_signature     TEXT NOT NULL,
  category              TEXT,
  product_name_snapshot TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (pool_date, slot_index),
  UNIQUE (pool_date, product_signature)
);

-- Refresh token sessions (access token remains stateless JWT)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT UNIQUE NOT NULL,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Saved shopping lists
CREATE TABLE IF NOT EXISTS shopping_lists (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  raw_input             TEXT,
  input_method          TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at          DATETIME,
  reorder_reminder_days INTEGER
);

-- Items inside a list. canonical_id is optional until entity-resolution epic lands.
CREATE TABLE IF NOT EXISTS list_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id         TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  canonical_id    TEXT,
  raw_item_text   TEXT NOT NULL,
  quantity        REAL,
  quantity_unit   TEXT,
  item_count      INTEGER NOT NULL DEFAULT 1,
  brand_pref      TEXT,
  resolved        INTEGER DEFAULT 0,
  unresolvable    INTEGER DEFAULT 0
);

-- Shipping cost tiers by basket value
CREATE TABLE IF NOT EXISTS shipping_tiers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id     TEXT NOT NULL REFERENCES stores(id),
  min_basket   REAL DEFAULT 0,
  max_basket   REAL,
  cost         REAL NOT NULL,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Delivery speed options (manually maintained)
CREATE TABLE IF NOT EXISTS delivery_options (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id           TEXT NOT NULL REFERENCES stores(id),
  delivery_type      TEXT NOT NULL,
  label              TEXT NOT NULL,
  surcharge          REAL DEFAULT 0,
  cutoff_time        TEXT,
  cutoff_timezone    TEXT DEFAULT 'Europe/Berlin',
  eligible_postcodes TEXT,
  eligible_cities    TEXT,
  min_basket         REAL DEFAULT 0,
  available_days     TEXT,
  estimated_hours    INTEGER,
  estimated_days     INTEGER,
  is_active          INTEGER DEFAULT 1,
  updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Canonical product registry (scaffold for entity-resolution epic)
CREATE TABLE IF NOT EXISTS canonical_products (
  id              TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  category        TEXT,
  common_aliases  TEXT,
  base_unit       TEXT,
  image_url       TEXT,
  verified        INTEGER DEFAULT 0,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Maps deal rows to canonical products
CREATE TABLE IF NOT EXISTS deal_mappings (
  deal_id           TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  canonical_id      TEXT NOT NULL REFERENCES canonical_products(id) ON DELETE CASCADE,
  match_method      TEXT NOT NULL,
  match_confidence  REAL,
  verified_at       DATETIME,
  PRIMARY KEY (deal_id, canonical_id)
);

-- Ambiguous resolution queue for admin review
CREATE TABLE IF NOT EXISTS entity_resolution_queue (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id               TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  suggested_canonical_id TEXT REFERENCES canonical_products(id) ON DELETE SET NULL,
  confidence            REAL,
  raw_name              TEXT NOT NULL,
  normalised_name       TEXT,
  status                TEXT DEFAULT 'pending',
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User alerts
CREATE TABLE IF NOT EXISTS price_alerts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_id      TEXT,
  product_query     TEXT,
  alert_type        TEXT NOT NULL DEFAULT 'price',
  target_price      REAL,
  min_discount_pct  REAL,
  target_store_id   TEXT REFERENCES stores(id),
  triggered         INTEGER DEFAULT 0,
  last_triggered_at DATETIME,
  is_active         INTEGER DEFAULT 1,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Alert delivery audit
CREATE TABLE IF NOT EXISTS alert_notifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id          INTEGER NOT NULL REFERENCES price_alerts(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_context   TEXT,
  sent_to           TEXT,
  sent_status       TEXT DEFAULT 'queued',
  provider_message  TEXT,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Product/user/system analytics events
CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name    TEXT NOT NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  source        TEXT DEFAULT 'api',
  route         TEXT,
  entity_type   TEXT,
  entity_id     TEXT,
  payload       TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deals_store_id   ON deals(store_id);
CREATE INDEX IF NOT EXISTS idx_deals_name       ON deals(product_name);
CREATE INDEX IF NOT EXISTS idx_deals_category   ON deals(product_category);
CREATE INDEX IF NOT EXISTS idx_deals_is_active  ON deals(is_active);
CREATE INDEX IF NOT EXISTS idx_deals_sale_price ON deals(sale_price);
CREATE INDEX IF NOT EXISTS idx_deals_discount   ON deals(discount_percent);
CREATE INDEX IF NOT EXISTS idx_deals_crawl_run  ON deals(crawl_run_id);
CREATE INDEX IF NOT EXISTS idx_deals_canonical  ON deals(canonical_id);
CREATE INDEX IF NOT EXISTS idx_crawl_locks_expires ON crawl_locks(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id  ON users(google_id);
CREATE INDEX IF NOT EXISTS idx_email_auth_tokens_email ON email_auth_tokens(email);
CREATE INDEX IF NOT EXISTS idx_email_auth_tokens_expires_at ON email_auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_inviter_user_id ON waitlist_referrals(inviter_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_referrals_invited_user_id ON waitlist_referrals(invited_user_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_referrals_claimed_at ON waitlist_referrals(claimed_at);
CREATE INDEX IF NOT EXISTS idx_daily_deal_pool_entries_pool_date ON daily_deal_pool_entries(pool_date);
CREATE INDEX IF NOT EXISTS idx_daily_deal_pool_entries_product_signature ON daily_deal_pool_entries(product_signature);
CREATE INDEX IF NOT EXISTS idx_refresh_user     ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_hash     ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_expires  ON refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_lists_user       ON shopping_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_list_items_list  ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_shipping_store   ON shipping_tiers(store_id);
CREATE INDEX IF NOT EXISTS idx_delivery_store   ON delivery_options(store_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user      ON price_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_type      ON price_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_active    ON price_alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_alerts_store     ON price_alerts(target_store_id);
CREATE INDEX IF NOT EXISTS idx_alert_notify     ON alert_notifications(alert_id);
CREATE INDEX IF NOT EXISTS idx_map_canonical    ON deal_mappings(canonical_id);
CREATE INDEX IF NOT EXISTS idx_queue_status     ON entity_resolution_queue(status);
CREATE INDEX IF NOT EXISTS idx_delivery_updated ON delivery_options(updated_at);
CREATE INDEX IF NOT EXISTS idx_events_name      ON events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_created   ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_user      ON events(user_id);
