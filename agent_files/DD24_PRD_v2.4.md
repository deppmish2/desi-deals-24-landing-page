# DesiDeals24 — Product Requirements Document

**Version:** 2.4 | **Date:** 2026-02-28 | **Status:** Ready for Development  
**Supersedes:** v1.0 (2025-02-23), v2.0, v2.1, v2.2, v2.3 (2026-02-28)

---

## 1. Product Overview

DesiDeals24 is a responsive web application that:

1. Crawls **full product catalogues** (not just deals) from 27 Indian grocery stores delivering to Germany
2. Aggregates and normalises products into a unified canonical catalogue using entity resolution
3. Allows authenticated users to build shopping lists (voice or text, including Hinglish)
4. Recommends the **single best store** for the complete basket including shipping, factoring in user's delivery speed preference
5. Surfaces same-day and express delivery options where available for the user's postcode/city
6. Transfers the cart to the chosen store in one click where technically possible
7. Captures buying pattern data to build demand intelligence for future store partnerships

---

## 2. Goals & Success Metrics

| Goal                                        | Metric                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Full catalogue crawled across all 27 stores | ≥80% stores successfully crawled per weekly run                                |
| Prices synced daily                         | ≥95% of active products have price updated within 24h                          |
| Smart shopping list recommendation          | User receives best-store result in <5s                                         |
| Cart transfer                               | ≥60% of Shopify/WooCommerce stores support one-click transfer at launch        |
| Entity resolution accuracy                  | ≥90% correct matches on top-200 products (manual QA)                           |
| User retention                              | ≥40% of registered users submit a second list within 30 days                   |
| Same-day delivery surfaced correctly        | Postcode eligibility check returns correct result in ≥95% of cases (manual QA) |
| Data freshness trust                        | "Last updated" visible on every page; crawl staleness alert if >26h            |

---

## 3. Target Stores

All 27 stores. Slugs used as primary identifiers throughout the system.

| #   | Slug                   | Name                         | URL                             |
| --- | ---------------------- | ---------------------------- | ------------------------------- |
| 1   | jamoona                | Jamoona                      | jamoona.com                     |
| 2   | dookan                 | Dookan                       | eu.dookan.com                   |
| 3   | grocera                | Grocera                      | grocera.de                      |
| 4   | little-india           | Little India                 | littleindia.de                  |
| 5   | namma-markt            | Namma Markt                  | nammamarkt.com                  |
| 6   | desigros               | Desigros                     | desigros.com                    |
| 7   | spice-village          | Spice Village                | spicevillage.eu                 |
| 8   | zora                   | Zora Supermarkt              | zorastore.eu                    |
| 9   | md-store               | MD Store                     | md-store.de                     |
| 10  | indian-supermarkt      | Indian Supermarkt            | indiansupermarkt.de             |
| 11  | indische-lebensmittel  | Indische-Lebensmittel-Online | indische-lebensmittel-online.de |
| 12  | namaste-deutschland    | Namaste Deutschland          | namastedeutschland.de           |
| 13  | india-store            | India Store                  | india-store.de                  |
| 14  | indian-food-store      | Indian Food Store            | indianfoodstore.de              |
| 15  | indian-store-stuttgart | Indian Store Stuttgart       | indianstorestuttgart.com        |
| 16  | indian-food-depot      | Indian Food Depot Frankfurt  | indianfooddepot.de              |
| 17  | swadesh                | Swadesh                      | swadesh.eu                      |
| 18  | spicelands             | Spicelands                   | spicelands.de                   |
| 19  | indian-bazar           | Indian Bazar                 | indianbazar.de                  |
| 20  | india-express          | India Express Food           | india-express-food.de           |
| 21  | village-foods          | Village Foods Asia           | villagefoods.de                 |
| 22  | anuhita                | AnuHita Groceries            | anuhitagroceries.de             |
| 23  | annachi                | Annachi Europe               | annachi.fr                      |
| 24  | sairas                 | SAIRAS                       | sairas.de                       |
| 25  | sona-food              | Sona Food Traders            | sonafoodtraders.de              |
| 26  | masala-wala            | Masala-Wala                  | masala-wala.com                 |
| 27  | feines                 | Feines.de                    | feines.de/indien                |

---

## 4. System Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Scheduler (node-cron)              │
│   Daily: price sync  |  Weekly: full catalogue crawl │
└───────────────────┬──────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────┐
│              Crawler Service (Node.js)                │
│  - Playwright (JS-rendered) + Cheerio (static)        │
│  - Per-store adapters (27) + generic fallback         │
│  - Full catalogue mode + price-sync mode              │
│  - Rate limiting, retry, dedup logic                  │
└───────────────────┬──────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────┐
│           Entity Resolution Service                   │
│  - Normaliser (synonyms, weight strip, lowercase)     │
│  - Fuzzy matcher (string-similarity, threshold 0.82)  │
│  - Claude API resolver (ambiguous cases only)         │
│  - Writes to canonical_products + product_mappings    │
└───────────────────┬──────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────┐
│                 SQLite Database                       │
│  stores | products | canonical_products               │
│  product_mappings | prices | shipping_tiers           │
│  users | shopping_lists | list_items | crawl_runs     │
└───────────────────┬──────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────┐
│              REST API (Express.js) /api/v1            │
└───────────────────┬──────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────────┐
│           Frontend (React + Tailwind CSS)             │
│  Deal browse | Smart Shopping List | Auth | Profile   │
└──────────────────────────────────────────────────────┘
```

**Tech Stack:**

- Backend: Node.js + Express.js
- Crawler: Playwright + Cheerio
- Entity Resolution: custom normaliser + `string-similarity` npm + Claude API (claude-sonnet-4-6, ambiguous cases only)
- NLP / List Parsing: Claude API
- Database: SQLite via better-sqlite3
- Frontend: React + Tailwind CSS
- Scheduler: node-cron
- Auth: JWT (access token 15min, refresh token 30 days) + Google OAuth2

---

## 5. Crawler Requirements

### 5.1 Two Crawl Modes

| Mode         | Trigger                   | Scope                                             | Target Duration |
| ------------ | ------------------------- | ------------------------------------------------- | --------------- |
| `full`       | Weekly (Sunday 02:00 UTC) | All pages, all products, catalogue rebuild        | <120 min        |
| `price-sync` | Daily (02:00 UTC)         | Prices + availability only for known product URLs | <30 min         |

`CRAWL_ON_STARTUP=true` triggers a `full` crawl when server starts cold (no existing DB data), otherwise triggers `price-sync`.

### 5.2 Per-Store Adapter Pattern

Each store has `crawler/stores/<slug>.js`:

```javascript
module.exports = {
  storeId: "jamoona",
  storeName: "Jamoona",
  storeUrl: "https://www.jamoona.com",
  platform: "shopify", // 'shopify' | 'woocommerce' | 'custom' | 'unknown'

  // FULL MODE: entry points for catalogue crawl
  catalogueUrls: ["https://www.jamoona.com/collections/all"],
  discoverCatalogueUrls: async (page) => {
    /* optional dynamic discovery */
  },

  // PRICE-SYNC MODE: lightweight — re-scrape known product URLs
  scrapeProductPrice: async (page, url) => ({
    salePrice,
    originalPrice,
    availability,
  }),

  // Scrape a listing/collection page → array of raw products
  scrapeListingPage: async (page, url) => [
    /* rawProducts */
  ],

  // Optional: scrape additional fields from individual product page
  scrapeProductPage: async (page, url) => {
    /* extraFields */
  },

  // Shopify: variant ID map for cart permalink generation
  getShopifyVariantId: async (page, productUrl) => "variant-id-string",
};
```

Generic fallback adapter handles Shopify (`/collections/all`, variant JSON) and WooCommerce (`?product_cat=`, `add-to-cart` params) patterns for stores without custom adapters.

### 5.3 Raw Product Data Fields

Fields captured per product during crawl. Entity resolution runs after.

| Field                 | Type                                        | Required                              |
| --------------------- | ------------------------------------------- | ------------------------------------- |
| `id`                  | UUID                                        | auto                                  |
| `store_id`            | String                                      | Y                                     |
| `product_url`         | String                                      | Y                                     |
| `raw_name`            | String                                      | Y                                     |
| `raw_category`        | String                                      | N (inferred)                          |
| `image_url`           | String                                      | null if missing                       |
| `weight_raw`          | String                                      | Y                                     |
| `weight_value`        | Float                                       | N                                     |
| `weight_unit`         | Enum: g/kg/ml/l/units/pieces                | N                                     |
| `sale_price`          | Float EUR                                   | Y                                     |
| `original_price`      | Float EUR                                   | N                                     |
| `discount_percent`    | Float                                       | auto-calc                             |
| `price_per_kg`        | Float                                       | auto-calc                             |
| `price_per_unit`      | Float                                       | N                                     |
| `availability`        | Enum: in_stock/out_of_stock/limited/unknown | Y                                     |
| `platform_product_id` | String                                      | N (Shopify variant ID, WC product ID) |
| `bulk_pricing`        | JSON `[{min_qty, price}]`                   | N                                     |
| `crawl_run_id`        | UUID                                        | Y                                     |
| `crawl_timestamp`     | ISO 8601                                    | Y                                     |
| `is_active`           | Boolean                                     | Y                                     |

### 5.4 Product Category Taxonomy

Keyword-matched on `raw_name` if store provides no category:

- `Rice & Grains` — rice, basmati, poha, semolina, rava, sooji, oats
- `Flours & Baking` — atta, maida, besan, cornflour, bread
- `Lentils & Pulses` — dal, lentil, chana, moong, urad, rajma, toor, arhar, tuvar
- `Spices & Masalas` — masala, spice, haldi, turmeric, cumin, jeera, coriander, chilli, hing
- `Oils & Ghee` — oil, ghee, butter
- `Sauces & Pastes` — chutney, pickle, achar, sauce, paste
- `Snacks & Sweets` — bhujia, mixture, ladoo, halwa, biscuit, namkeen, chakli, papad
- `Beverages` — tea, chai, coffee, lassi, juice
- `Dairy & Paneer` — paneer, yogurt, curd, milk, cream
- `Frozen Foods` — paratha, naan, samosa, frozen
- `Fresh Produce` — vegetable, fruit, herb, fresh
- `Noodles & Pasta` — noodle, vermicelli, pasta, sewai
- `Canned & Packaged` — canned, tin, ready meal, instant
- `Personal Care` — soap, shampoo, hair oil, cosmetic
- `Household` — incense, agarbatti, pooja, diyas
- `Other` — fallback

### 5.5 Crawler Behaviour Rules

- **Politeness:** 2–5s random delay between requests to same store
- **User-Agent:** realistic browser string
- **Timeout:** 30s per page; skip + log on breach
- **Retry:** up to 2× with exponential backoff
- **JS rendering:** Playwright for stores where price elements absent from static HTML
- **Image extraction:** prefer `srcset` / `data-zoom-src` over `src`
- **Price parsing:** strip €/EUR, convert German decimal (`2,99` → `2.99`), handle `ab` prefix
- **Maintenance:** HTTP 503 or maintenance page → `crawl_status: 'maintenance'`, skip
- **Dedup:** within a crawl run, deduplicate by `(store_id + product_url)`
- **0-deal guard:** if a store returns 0 products in `full` mode, log warning, retain previous records as `is_active: true`, do not wipe

### 5.6 Crawl Run Logging

Table: `crawl_runs`

| Field              | Type                               |
| ------------------ | ---------------------------------- |
| `id`               | UUID                               |
| `mode`             | `full` / `price-sync`              |
| `started_at`       | ISO 8601                           |
| `finished_at`      | ISO 8601                           |
| `status`           | running / completed / failed       |
| `stores_attempted` | Int                                |
| `stores_succeeded` | Int                                |
| `products_found`   | Int                                |
| `errors`           | JSON `[{store_id, error_message}]` |

---

## 6. Entity Resolution

### 6.1 Purpose

Maps raw product names from 27 stores onto a single `canonical_products` record. Enables the shopping list to query "toor dal" and retrieve all store variants with current prices.

### 6.2 Three-Layer Pipeline

**Layer 1 — Rule-based normaliser** (runs on every product, no external calls)

```javascript
// crawler/entity-resolution/normaliser.js
function normalise(rawName) {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(kg|kilo|kilogram|g|gram|ml|ltr|litre|liter|l|oz|lb)\b/g, "")
    .replace(
      /\b(organic|premium|extra|special|fresh|pure|whole|split|hulled)\b/g,
      "",
    )
    .replace(/\b(pack|packet|pouch|bag|box|tin|jar|bottle|sachet)\b/g, "")
    .replace(
      new RegExp(Object.keys(SYNONYMS).join("|"), "g"),
      (m) => SYNONYMS[m],
    )
    .replace(/\s+/g, " ")
    .trim();
}
```

Synonym dictionary lives at `crawler/entity-resolution/synonyms.json`. Seed entries (extend continuously):

```json
{
  "arhar": "toor",
  "tuvar": "toor",
  "dhal": "dal",
  "pigeon peas": "toor dal",
  "besan": "chickpea flour",
  "gram flour": "chickpea flour",
  "sooji": "semolina",
  "rava": "semolina",
  "suji": "semolina",
  "haldi": "turmeric",
  "jeera": "cumin",
  "dhania": "coriander",
  "hing": "asafoetida",
  "methi": "fenugreek",
  "karela": "bitter gourd",
  "shimla mirch": "capsicum",
  "kaddu": "pumpkin",
  "lauki": "bottle gourd",
  "bhindi": "okra"
}
```

**Layer 2 — Fuzzy matching** (runs after normalisation, no external calls)

Use `string-similarity` npm. Threshold: 0.82. Scores 0.60–0.81 are "ambiguous" → passed to Layer 3.

```javascript
// crawler/entity-resolution/fuzzy-matcher.js
import { findBestMatch } from "string-similarity";
function fuzzyMatch(normalisedName, canonicalNames) {
  const result = findBestMatch(normalisedName, canonicalNames);
  if (result.bestMatch.rating >= 0.82)
    return {
      match: result.bestMatch.target,
      confidence: result.bestMatch.rating,
      method: "fuzzy",
    };
  if (result.bestMatch.rating >= 0.6)
    return {
      match: result.bestMatch.target,
      confidence: result.bestMatch.rating,
      method: "ambiguous",
    };
  return null;
}
```

**Layer 3 — Claude API resolution** (ambiguous cases only, ~5–10% of products)

```javascript
// crawler/entity-resolution/ai-resolver.js
async function resolveAmbiguous(productA, productB) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 10,
    messages: [
      {
        role: "user",
        content: `Same grocery product? Answer YES, NO, or UNSURE only.\nA: "${productA.raw_name}" (${productA.weight_raw})\nB: "${productB.canonical_name}"`,
      },
    ],
  });
  const answer = response.content[0].text.trim().toUpperCase();
  // YES → create mapping, confidence 0.90; NO → skip; UNSURE → flag for manual review
  return answer;
}
```

All AI-confirmed matches are written back into `synonyms.json` automatically, reducing future AI calls.

### 6.3 Brand Handling

Different brands of the same product type are **not merged** — they remain separate canonical products. Example: `mdh-toor-dal` and `trs-toor-dal` are distinct. Users set brand preferences in their profile.

### 6.4 Pack Size Handling

Weight is stripped from canonical name for matching but stored in `weight_raw` / `weight_value`. All price comparisons normalise to `price_per_kg`. When displaying results, group by canonical product and sort variants by `price_per_kg`.

---

## 7. Database Schema

```sql
-- Store registry
CREATE TABLE stores (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  platform         TEXT DEFAULT 'unknown', -- shopify|woocommerce|custom|unknown
  logo_url         TEXT,
  last_crawled_at  DATETIME,
  crawl_status     TEXT DEFAULT 'active',  -- active|maintenance|error
  webhook_secret   TEXT                    -- HMAC-SHA256 secret for inbound store webhooks; NULL = no webhook partnership
);

-- Shipping tiers: base cost by basket value (manually maintained, updated ~monthly)
CREATE TABLE shipping_tiers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id     TEXT NOT NULL REFERENCES stores(id),
  min_basket   REAL DEFAULT 0,
  max_basket   REAL,           -- NULL = no upper bound (free tier)
  cost         REAL NOT NULL,  -- 0 = free
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Delivery options: speed variants with eligibility and surcharges
-- One row per delivery type per store. Maintained manually (~monthly).
CREATE TABLE delivery_options (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id         TEXT NOT NULL REFERENCES stores(id),
  delivery_type    TEXT NOT NULL,   -- 'standard'|'next_day'|'same_day'|'express'
  label            TEXT NOT NULL,   -- display string e.g. "Same Day", "Express (3h)", "Next Day"
  surcharge        REAL DEFAULT 0,  -- added on top of shipping_tier cost; 0 = no extra charge
  cutoff_time      TEXT,            -- "HH:MM" in store local time; NULL = no cutoff
  cutoff_timezone  TEXT DEFAULT 'Europe/Berlin',
  eligible_postcodes TEXT,          -- JSON array of postcodes e.g. ["80331","80333","80335"]
                                    -- NULL = available Germany-wide (no postcode restriction)
  eligible_cities  TEXT,            -- JSON array e.g. ["Munich","Berlin"] — human label only
  min_basket       REAL DEFAULT 0,  -- minimum basket for this delivery type
  available_days   TEXT,            -- JSON array e.g. ["Mon","Tue","Wed","Thu","Fri","Sat"]
                                    -- NULL = all days
  estimated_hours  INTEGER,         -- delivery window in hours e.g. 3 for "Express (3h)"
  estimated_days   INTEGER,         -- delivery window in days e.g. 1 for "Next Day"; NULL if hours used
  is_active        BOOLEAN DEFAULT 1,
  updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Raw products from crawl (one row per store SKU)
CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  store_id            TEXT NOT NULL REFERENCES stores(id),
  product_url         TEXT NOT NULL,
  raw_name            TEXT NOT NULL,
  raw_category        TEXT,
  product_category    TEXT NOT NULL,
  image_url           TEXT,
  weight_raw          TEXT,
  weight_value        REAL,
  weight_unit         TEXT,
  platform_product_id TEXT,   -- Shopify variant ID or WC product ID
  bulk_pricing        TEXT,   -- JSON
  crawl_run_id        TEXT NOT NULL,
  crawl_timestamp     DATETIME NOT NULL,
  is_active           BOOLEAN DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(store_id, product_url)
);

-- Prices (updated daily by price-sync crawl)
CREATE TABLE prices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id       TEXT NOT NULL REFERENCES products(id),
  sale_price       REAL NOT NULL,
  original_price   REAL,
  discount_percent REAL,
  price_per_kg     REAL,
  price_per_unit   REAL,
  currency         TEXT DEFAULT 'EUR',
  availability     TEXT DEFAULT 'unknown',
  recorded_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Unified canonical product catalogue
CREATE TABLE canonical_products (
  id              TEXT PRIMARY KEY,  -- slug e.g. 'toor-dal'
  canonical_name  TEXT NOT NULL,
  category        TEXT NOT NULL,
  common_aliases  TEXT,              -- JSON array of known aliases
  base_unit       TEXT,              -- 'kg' for weight-sold items
  image_url       TEXT,              -- best available image across stores
  verified        BOOLEAN DEFAULT 0, -- manually reviewed flag
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Maps store products to canonical products
CREATE TABLE product_mappings (
  product_id       TEXT NOT NULL REFERENCES products(id),
  canonical_id     TEXT NOT NULL REFERENCES canonical_products(id),
  match_method     TEXT NOT NULL,  -- exact|fuzzy|ai|manual
  match_confidence REAL,
  verified_at      DATETIME,
  PRIMARY KEY (product_id, canonical_id)
);

-- User accounts
CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT UNIQUE NOT NULL,
  password_hash     TEXT,               -- NULL if Google OAuth only
  google_id         TEXT UNIQUE,
  postcode          TEXT NOT NULL,
  city              TEXT,               -- inferred from postcode
  dietary_prefs     TEXT,               -- JSON: ["vegetarian","halal","jain"]
  preferred_stores  TEXT,               -- JSON: ["jamoona","grocera"]  (whitelist; NULL = all)
  blocked_stores    TEXT,               -- JSON: ["dookan"]
  preferred_brands  TEXT,               -- JSON: {"toor-dal": "mdh"}
  delivery_speed_pref TEXT DEFAULT 'cheapest', -- 'cheapest'|'fastest'|'same_day_if_available'
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at     DATETIME
);

-- Saved shopping lists
CREATE TABLE shopping_lists (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  name            TEXT NOT NULL,       -- e.g. "Weekly Shop", "Diwali Prep"
  raw_input       TEXT,                -- original voice/text input (analytics)
  input_method    TEXT,                -- 'voice'|'text'
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME,
  reorder_reminder_days INTEGER        -- NULL = no reminder
);

-- Items within a shopping list
CREATE TABLE list_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id         TEXT NOT NULL REFERENCES shopping_lists(id),
  canonical_id    TEXT REFERENCES canonical_products(id),  -- NULL if unresolved
  raw_item_text   TEXT NOT NULL,   -- user's original text for this item
  quantity        REAL,
  quantity_unit   TEXT,
  brand_pref      TEXT,            -- NULL = any brand
  resolved        BOOLEAN DEFAULT 0,
  unresolvable    BOOLEAN DEFAULT 0 -- flagged if no match found after all 3 layers
);

-- Product alerts — all types in v1
CREATE TABLE price_alerts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           TEXT NOT NULL REFERENCES users(id),
  canonical_id      TEXT NOT NULL REFERENCES canonical_products(id),
  alert_type        TEXT NOT NULL DEFAULT 'price',
                    -- 'price'        → notify when sale_price drops below target_price
                    -- 'deal'         → notify when discount_percent >= min_discount_pct
                    -- 'restock_any'  → notify when availability → in_stock at any store
                    -- 'restock_store'→ notify when availability → in_stock at target_store_id
                    -- 'fresh_arrived'→ notify via store webhook (see §8.8 + §20)
  target_price      REAL,             -- required for 'price' type; NULL otherwise
  min_discount_pct  REAL,             -- for 'deal' type; NULL = any discount (≥1%)
  target_store_id   TEXT REFERENCES stores(id),
                    -- required for 'restock_store'; NULL = any store for other types
  triggered         BOOLEAN DEFAULT 0,
  last_triggered_at DATETIME,         -- prevents duplicate alerts within same crawl window
  is_active         BOOLEAN DEFAULT 1,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (alert_type = 'price'         AND target_price IS NOT NULL) OR
    (alert_type = 'deal'          AND target_price IS NULL) OR
    (alert_type = 'restock_any'   AND target_price IS NULL AND target_store_id IS NULL) OR
    (alert_type = 'restock_store' AND target_price IS NULL AND target_store_id IS NOT NULL) OR
    (alert_type = 'fresh_arrived' AND target_price IS NULL)
  )
);

-- Crawl run metadata
CREATE TABLE crawl_runs (
  id                TEXT PRIMARY KEY,
  mode              TEXT NOT NULL,   -- full|price-sync
  started_at        DATETIME NOT NULL,
  finished_at       DATETIME,
  status            TEXT DEFAULT 'running',
  stores_attempted  INTEGER DEFAULT 0,
  stores_succeeded  INTEGER DEFAULT 0,
  products_found    INTEGER DEFAULT 0,
  errors            TEXT             -- JSON array
);

-- Indexes
CREATE INDEX idx_products_store        ON products(store_id);
CREATE INDEX idx_products_canonical    ON product_mappings(canonical_id);
CREATE INDEX idx_prices_product        ON prices(product_id);
CREATE INDEX idx_prices_recorded       ON prices(recorded_at);
CREATE INDEX idx_canonical_name        ON canonical_products(canonical_name);
CREATE INDEX idx_canonical_category    ON canonical_products(category);
CREATE INDEX idx_list_items_list       ON list_items(list_id);
CREATE INDEX idx_list_items_canonical  ON list_items(canonical_id);
CREATE INDEX idx_alerts_user           ON price_alerts(user_id);
CREATE INDEX idx_alerts_canonical      ON price_alerts(canonical_id);
CREATE INDEX idx_alerts_type_active    ON price_alerts(alert_type, is_active);
CREATE INDEX idx_delivery_store        ON delivery_options(store_id);
CREATE INDEX idx_delivery_type         ON delivery_options(store_id, delivery_type);
```

---

## 8. REST API Specification

Base path: `/api/v1`

### 8.1 Auth

| Method | Path             | Description                                                          |
| ------ | ---------------- | -------------------------------------------------------------------- |
| POST   | `/auth/register` | Email + postcode registration. Returns `{accessToken, refreshToken}` |
| POST   | `/auth/login`    | Email/password login                                                 |
| POST   | `/auth/google`   | Google OAuth2 callback                                               |
| POST   | `/auth/refresh`  | Refresh access token                                                 |
| POST   | `/auth/logout`   | Invalidate refresh token                                             |

### 8.2 Deals / Browse (read-only, no auth required)

**GET `/deals`** — Paginated active deals (products with `discount_percent > 0`)

Query params: `q`, `store` (comma-sep slugs), `category`, `min_discount`, `max_price`, `availability` (default: in_stock), `sort` (discount_desc|price_asc|price_desc|newest), `page` (default 1), `limit` (default 24, max 100)

Response shape:

```json
{
  "data": [
    {
      "id": "uuid",
      "store": { "id": "jamoona", "name": "Jamoona", "url": "..." },
      "canonical_id": "toor-dal",
      "product_name": "Toor Dal 1kg",
      "product_category": "Lentils & Pulses",
      "product_url": "https://...",
      "image_url": "https://...",
      "weight_raw": "1kg",
      "weight_value": 1.0,
      "weight_unit": "kg",
      "sale_price": 2.49,
      "original_price": 3.99,
      "discount_percent": 37.6,
      "price_per_kg": 2.49,
      "currency": "EUR",
      "availability": "in_stock",
      "crawl_timestamp": "2026-02-28T08:00:00Z"
    }
  ],
  "pagination": { "page": 1, "limit": 24, "total": 312, "total_pages": 13 },
  "meta": { "last_crawl": "2026-02-28T08:00:00Z", "active_stores": 25 }
}
```

### 8.3 Stores

**GET `/stores`** — All stores with crawl status, active product count, and available delivery types

Response includes per-store `delivery_options` array:

```json
{
  "data": [
    {
      "id": "grocera",
      "name": "Grocera",
      "url": "grocera.de",
      "crawl_status": "active",
      "active_products_count": 2400,
      "delivery_options": [
        {
          "type": "standard",
          "label": "Standard",
          "estimated_days": 3,
          "surcharge": 0
        },
        {
          "type": "same_day",
          "label": "Same Day",
          "estimated_hours": 4,
          "surcharge": 2.99,
          "eligible_cities": ["Munich"],
          "cutoff_time": "12:00"
        }
      ]
    }
  ]
}
```

**GET `/stores/:storeId/products`** — All active products for a store (same filters as `/deals`)

**GET `/stores/:storeId/delivery`** — Full delivery options for a store, optionally filtered by postcode

Query params: `postcode` — if provided, returns only options eligible for that postcode plus `postcode_eligible: true|false` per option

### 8.4 Products & Catalogue

**GET `/products/:id`** — Full detail for a single product

**GET `/canonical/:id`** — Canonical product with all store variants and current prices

**GET `/categories`** — Categories with product counts

**GET `/search/autocomplete?q=`** — Returns up to 8 canonical product name suggestions after 2 chars (used by shopping list input)

### 8.5 Shopping List

All endpoints require auth (`Authorization: Bearer <accessToken>`).

**POST `/lists`** — Create new list from raw text/voice input

Request:

```json
{
  "raw_input": "2 kilo basmati, toor dal, Everest garam masala",
  "input_method": "text",
  "name": "Weekly Shop"
}
```

Response: parsed list with resolved items, unresolved items flagged. Async entity resolution runs server-side; client polls or uses WebSocket.

**GET `/lists`** — All lists for authenticated user

**GET `/lists/:id`** — List with items and current resolution status

**PUT `/lists/:id`** — Update list name or reorder reminder

**DELETE `/lists/:id`** — Delete list

**POST `/lists/:id/items`** — Add item to existing list

**PUT `/lists/:id/items/:itemId`** — Update item (quantity, brand pref, resolved canonical)

**DELETE `/lists/:id/items/:itemId`** — Remove item

### 8.6 Recommendation Engine

**POST `/lists/:id/recommend`** — Calculate best store(s) for the basket, ranked by user's delivery preference

Request:

```json
{
  "postcode": "80331",
  "delivery_preference": "cheapest"
  // "cheapest" | "fastest" | "same_day_if_available"
  // Falls back to user profile setting if omitted
}
```

Response:

```json
{
  "preference_applied": "cheapest",
  "winner": {
    "store": { "id": "jamoona", "name": "Jamoona", "url": "..." },
    "items_matched": 8,
    "items_total": 10,
    "items_not_found": ["curry leaves", "fresh methi"],
    "subtotal": 33.4,
    "delivery": {
      "type": "standard",
      "label": "Standard Delivery",
      "shipping_cost": 0.0,
      "surcharge": 0.0,
      "total_delivery_cost": 0.0,
      "estimated_days": 3,
      "estimated_hours": null,
      "same_day_eligible": false,
      "same_day_cutoff_passed": null
    },
    "total": 33.4,
    "cart_transfer_method": "shopify_permalink",
    "cart_url": "https://jamoona.com/cart/39291:1,48291:2,..."
  },
  "runner_up": {
    "store": { "id": "dookan", "name": "Dookan" },
    "total": 36.9,
    "items_matched": 8,
    "delivery": {
      "type": "standard",
      "estimated_days": 2,
      "total_delivery_cost": 3.9
    }
  },
  "same_day_option": {
    // Present only when delivery_preference != "same_day_if_available" AND a same-day
    // option exists for this postcode — surfaces it as an upsell without forcing it
    "store": { "id": "grocera", "name": "Grocera" },
    "items_matched": 7,
    "items_total": 10,
    "total": 38.2,
    "delivery": {
      "type": "same_day",
      "label": "Same Day (order before 12:00)",
      "surcharge": 2.99,
      "total_delivery_cost": 2.99,
      "estimated_hours": 4,
      "cutoff_time": "12:00",
      "cutoff_passed": false
    },
    "note": "€4.80 more than cheapest option — delivered today"
  }
}
```

**Scoring logic in `server/services/recommender.js`:**

```javascript
function scoreStore(store, basketTotal, deliveryPref, postcode, now) {
  const shipping = getShippingCost(store.id, basketTotal);
  const deliveryOpts = getEligibleDeliveryOptions(store.id, postcode, now);

  if (deliveryPref === "same_day_if_available") {
    const sdOpt = deliveryOpts.find((o) => o.delivery_type === "same_day");
    if (!sdOpt) return null; // exclude store from ranked results
    return { total: basketTotal + shipping + sdOpt.surcharge, delivery: sdOpt };
  }
  if (deliveryPref === "fastest") {
    const best = deliveryOpts.sort(
      (a, b) =>
        (a.estimated_hours ?? a.estimated_days * 24) -
        (b.estimated_hours ?? b.estimated_days * 24),
    )[0];
    return { total: basketTotal + shipping + best.surcharge, delivery: best };
  }
  // 'cheapest' (default): use cheapest eligible option
  const cheapest = deliveryOpts.sort((a, b) => a.surcharge - b.surcharge)[0];
  return {
    total: basketTotal + shipping + cheapest.surcharge,
    delivery: cheapest,
  };
}
```

`cart_transfer_method`: `shopify_permalink` | `woocommerce_add_to_cart` | `tab_burst` | `manual`

### 8.7 User Profile

**GET `/me`** — Current user profile

**PUT `/me`** — Update postcode, dietary prefs, preferred/blocked stores, brand prefs, delivery speed preference

`delivery_speed_pref` values: `"cheapest"` (default) | `"fastest"` | `"same_day_if_available"`

**GET `/me/alerts`** — All active alerts for the user, grouped by `alert_type`

**POST `/me/alerts`** — Create an alert. Request body varies by type:

```json
// Price drop alert
{ "canonical_id": "toor-dal", "alert_type": "price", "target_price": 2.50 }

// Deal alert (notify when any discount appears, or above threshold)
{ "canonical_id": "basmati-rice", "alert_type": "deal", "min_discount_pct": 15 }

// Back-in-stock at any store
{ "canonical_id": "curry-leaves", "alert_type": "restock_any" }

// Back-in-stock at a specific store
{ "canonical_id": "curry-leaves", "alert_type": "restock_store", "target_store_id": "grocera" }

// Fresh produce arrived (requires store to have webhook_secret set)
{ "canonical_id": "fresh-methi", "alert_type": "fresh_arrived" }
```

Response: `{ "id": 42, "alert_type": "deal", "canonical_id": "basmati-rice", ... }`

**PUT `/me/alerts/:id`** — Update an alert (e.g. change `target_price`, `min_discount_pct`, toggle `is_active`)

**DELETE `/me/alerts/:id`** — Delete alert

### 8.8 Admin

**POST `/admin/crawl/trigger`** — Trigger crawl. Body: `{"mode": "full"|"price-sync"}`. Auth: `Authorization: Bearer <ADMIN_SECRET>`

**GET `/admin/crawl/status`** — Latest crawl run status

**GET `/admin/entity-resolution/queue`** — Products pending manual review

**POST `/admin/entity-resolution/resolve`** — Manually confirm or reject a mapping `{product_id, canonical_id, verdict: "confirm"|"reject"}`

**GET `/admin/delivery-options`** — List all delivery options across all stores

**POST `/admin/delivery-options`** — Create delivery option. Body: full `delivery_options` row fields

**PUT `/admin/delivery-options/:id`** — Update a delivery option (e.g. change cutoff time, surcharge, postcode list)

**DELETE `/admin/delivery-options/:id`** — Deactivate a delivery option (`is_active: false`, not hard delete)

**POST `/api/v1/inbound/fresh-stock`** — Receives fresh produce arrival webhook from store partners. Authenticated via per-store `HMAC-SHA256` signature in `X-Webhook-Signature` header verified against `stores.webhook_secret`.

```json
// Inbound payload from store
{
  "store_id": "grocera",
  "items": [
    {
      "product_name": "Curry Leaves",
      "quantity_kg": 5.0,
      "available_from": "2026-03-01T09:00:00Z"
    },
    {
      "product_name": "Fresh Methi",
      "quantity_kg": 3.0,
      "available_from": "2026-03-01T09:00:00Z"
    }
  ]
}
```

On receipt: resolve each `product_name` against `canonical_products` via entity resolution pipeline → find all `price_alerts` with `alert_type = 'fresh_arrived'` and matching `canonical_id` → dispatch email alerts → acknowledge `200 OK` immediately (fire-and-forget alert dispatch, do not block response on email delivery).

---

## 9. Entity Resolution Service

### 9.1 File Structure

```
crawler/entity-resolution/
├── index.js          # Orchestrator: runs after each full crawl
├── normaliser.js     # Layer 1: rule-based text normalisation
├── fuzzy-matcher.js  # Layer 2: string-similarity matching
├── ai-resolver.js    # Layer 3: Claude API for ambiguous cases
├── synonyms.json     # Synonym dictionary (primary proprietary asset)
└── __tests__/
    ├── normaliser.test.js
    ├── fuzzy-matcher.test.js
    └── top200.fixture.json   # Manual QA fixture for 200 common products
```

### 9.2 Processing Order

1. After every `full` crawl, run entity resolution on all new/updated products
2. Normalise `raw_name` → `normalised_name`
3. Exact match against existing `canonical_products.canonical_name`
4. If no exact match: fuzzy match (≥0.82 → map; 0.60–0.81 → Layer 3; <0.60 → new canonical)
5. Layer 3 (Claude API) for ambiguous; YES → map at 0.90; NO → create new canonical; UNSURE → queue for manual admin review
6. Write to `product_mappings`; update `synonyms.json` with confirmed AI matches

### 9.3 Accuracy Target

≥90% correct on `top200.fixture.json` before first production deploy. Run `npm test` to validate.

---

## 10. Smart Shopping List — NLP Parsing

### 10.1 Voice Input

Use browser Web Speech API (`webkitSpeechRecognition`). No backend transcription needed in Phase 1. Language hint: `lang = 'en-IN'` (best coverage for Indian English and Hinglish).

### 10.2 Text Parsing via Claude API

After voice transcription or direct text input, send to Claude API for structured extraction:

```javascript
// server/services/list-parser.js
async function parseShoppingList(rawText) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Extract grocery items from this text. Return ONLY a JSON array, no other text.
Each object: {"item": "canonical item name in English", "quantity": number|null, "unit": "kg|g|ml|l|units|null", "brand": "brand name|null"}
Text: "${rawText}"`,
      },
    ],
  });
  return JSON.parse(response.content[0].text);
}
```

### 10.3 Parsed Item → Canonical Product Matching

Each parsed item runs through the same entity resolution pipeline (normaliser → fuzzy → AI). Matched items show `resolved: true` with `canonical_id`. Unmatched items show in UI as amber warnings — user can manually select from autocomplete.

---

## 11. Cart Transfer

### 11.1 Transfer Methods by Platform

| Method                    | Platforms          | How                                                                  |
| ------------------------- | ------------------ | -------------------------------------------------------------------- |
| `shopify_permalink`       | Shopify stores     | `/cart/VARIANT_ID:QTY,VARIANT_ID:QTY` — full cart, one redirect      |
| `woocommerce_add_to_cart` | WooCommerce stores | `?add-to-cart=PRODUCT_ID&quantity=N` per item, chained               |
| `tab_burst`               | Other stores       | Open each product URL in new tab (max 5 items auto, prompt for more) |
| `manual`                  | Fallback           | Link list of product URLs with copy button                           |

### 11.2 Platform Detection

Detect platform during `full` crawl and store in `stores.platform`. Indicators:

- Shopify: `Shopify.theme` in page JS, `/cart.js` endpoint returns 200, URL pattern `/collections/`
- WooCommerce: `woocommerce` class on `<body>`, `wp-content` in asset URLs

### 11.3 Shopify Variant ID Capture

During `full` crawl, each Shopify adapter must capture `platform_product_id` (variant ID) from product JSON (`/products/<handle>.json` endpoint). This is stored in `products.platform_product_id` and used to build the cart permalink.

### 11.4 Pre-Transfer UI Contract

Before redirect, UI must clearly state:

- Store name and URL being opened
- Number of items pre-filled vs. total
- That DesiDeals24 does not handle payment
- Transfer method quality: "Seamless" (shopify_permalink) | "Assisted" (woocommerce) | "Manual" (tab_burst/manual)

---

## 12. Shipping & Delivery Configuration

All delivery data is manually maintained (not crawled) and stored in two tables: `shipping_tiers` (base cost by basket value) and `delivery_options` (speed variants). Both are seeded before first deployment and reviewed monthly.

### 12.1 Shipping Tier Seed Example (Jamoona)

```sql
INSERT INTO shipping_tiers (store_id, min_basket, max_basket, cost) VALUES
('jamoona', 0,     29.99, 5.90),
('jamoona', 30.00, 49.99, 3.90),
('jamoona', 50.00, NULL,  0.00);
```

### 12.2 Delivery Options Seed Examples

```sql
-- Jamoona: standard Germany-wide, no same-day
INSERT INTO delivery_options
  (store_id, delivery_type, label, surcharge, estimated_days, available_days) VALUES
('jamoona', 'standard', 'Standard (2-4 days)', 0, 3, '["Mon","Tue","Wed","Thu","Fri"]');

-- Grocera: standard Germany-wide + same-day Munich only
INSERT INTO delivery_options
  (store_id, delivery_type, label, surcharge, cutoff_time, eligible_postcodes,
   eligible_cities, estimated_hours, available_days) VALUES
('grocera', 'standard', 'Standard (DHL)', 0, NULL, NULL, NULL, NULL, '["Mon","Tue","Wed","Thu","Fri","Sat"]'),
('grocera', 'same_day', 'Same Day Munich', 2.99, '12:00', '["80331","80333","80335","80336","80337","80339","80469","80538","80539","80634","80636","80637","80638","80639","80797","80798","80799","80801","80802","80803","80804","80805","80807","80809","80939","80999"]',
  '["Munich"]', 4, '["Mon","Tue","Wed","Thu","Fri","Sat"]');

-- Spice Village: standard + same-day Berlin only
INSERT INTO delivery_options
  (store_id, delivery_type, label, surcharge, cutoff_time, eligible_postcodes,
   eligible_cities, estimated_hours, available_days) VALUES
('spice-village', 'standard', 'Standard (3-5 days)', 0, NULL, NULL, NULL, NULL, '["Mon","Tue","Wed","Thu","Fri"]'),
('spice-village', 'same_day', 'Same Day Berlin', 3.50, '11:00',
  '["10115","10117","10119","10178","10179","10243","10245","10247","10249","10315","10317","10318","10319","10365","10367","10369","10405","10407","10409","10435","10437","10439","10551","10553","10555","10557","10559","10585","10587","10589","10623","10625","10627","10629","10707","10709","10711","10713","10715","10717","10719","10777","10779","10781","10783","10785","10787","10789","10823","10825","10827","10829","10961","10963","10965","10967","10969","10997","10999"]',
  '["Berlin"]', 3, '["Mon","Tue","Wed","Thu","Fri","Sat"]');
```

### 12.3 Postcode Eligibility Check

```javascript
// server/services/recommender.js
function getEligibleDeliveryOptions(storeId, postcode, now) {
  const opts = db
    .prepare(
      `
    SELECT * FROM delivery_options
    WHERE store_id = ? AND is_active = 1
  `,
    )
    .all(storeId);

  return opts.filter((opt) => {
    // Postcode check: NULL eligible_postcodes = Germany-wide
    if (opt.eligible_postcodes) {
      const list = JSON.parse(opt.eligible_postcodes);
      if (!list.includes(postcode)) return false;
    }
    // Day check: NULL available_days = all days
    if (opt.available_days) {
      const days = JSON.parse(opt.available_days);
      const today = now.toLocaleDateString("en-US", { weekday: "short" }); // "Mon"
      if (!days.includes(today)) return false;
    }
    // Cutoff check: same_day options expire after cutoff
    if (opt.cutoff_time && opt.delivery_type === "same_day") {
      const [hh, mm] = opt.cutoff_time.split(":").map(Number);
      const cutoff = new Date(now);
      cutoff.setHours(hh, mm, 0, 0);
      if (now >= cutoff) return false;
    }
    return true;
  });
}
```

### 12.4 Cutoff Passed Behaviour

When a same-day option's cutoff time has passed for the current day, the option is **not suppressed** from the UI — it is shown with `cutoff_passed: true` and the label changes to "Same Day (available tomorrow — order before 12:00)". This preserves the information value for users planning ahead.

### 12.5 Maintenance Cadence

Delivery options must be reviewed when: (a) a store's website mentions delivery changes, (b) a user-submitted flag indicates incorrect delivery info, (c) monthly admin review. The `updated_at` column on each row is the audit trail. Admin UI shows rows not updated in >45 days highlighted in amber as a reminder.

---

## 13. Frontend Requirements

### 13.1 Pages & Routes

| Route                 | Component            | Auth Required              |
| --------------------- | -------------------- | -------------------------- |
| `/`                   | `HomePage`           | No                         |
| `/deals`              | `DealsPage`          | No                         |
| `/store/:storeId`     | `StorePage`          | No                         |
| `/category/:category` | `CategoryPage`       | No                         |
| `/list`               | `ShoppingListPage`   | No (guest: list not saved) |
| `/list/:id`           | `SavedListPage`      | Yes                        |
| `/list/:id/result`    | `RecommendationPage` | No                         |
| `/profile`            | `ProfilePage`        | Yes                        |
| `/login`              | `LoginPage`          | No                         |
| `/register`           | `RegisterPage`       | No                         |

### 13.2 Component Specifications

**Header:** Logo + "DesiDeals24" | Search bar | Nav: Deals / Stores / Categories / My Lists | Auth state (login button or avatar) | Hamburger on mobile

**Search Bar:** Autocomplete after 2 chars from `/search/autocomplete`. Enter → `/deals?q=`. Show result count.

**Filters:** Store (checkbox + deal count badge) | Category (checkbox) | Discount slider (10/20/30/50%+) | Max price (€0–50) | In Stock toggle | **Delivery Speed** (Same Day / Next Day / Any) | Sort dropdown. Mobile: slide-in drawer.

**Deal Card:** Product image (lazy, fallback SVG) | Store name | Product name (2-line truncate) | Category badge | Weight | Sale price (large, green) | Original price (strikethrough, if available) | Discount badge (if ≥5%) | Price/kg (if available) | Availability dot | **Same-day badge** (⚡ Same Day — shown on store badge if user's postcode is eligible) | "View Deal →" button (opens product URL, new tab) | "Updated X hours ago"

**Shopping List Input:** Voice button (Web Speech API) | Free-text area | Parsed items list with status dots (green=resolved, amber=ambiguous, red=unresolvable) | **Delivery speed selector** (Cheapest / Fastest / Same Day if available — 3-option toggle, defaults to user profile setting) | "Find Best Price" CTA

**Recommendation Card:** Winner store with match count, subtotal, shipping, total | **Delivery badge** (e.g. "Standard · 3 days" or "⚡ Same Day · by 18:00") | "Send Cart to [Store] →" CTA | Transfer method badge | Runner-up row | Missing items list | **Same-day upsell row** — shown when `delivery_preference = "cheapest"` AND a same-day option exists for user's postcode: "⚡ Get it today from Grocera for €4.80 more" as a dismissible secondary CTA

**Delivery Speed Toggle** (inline on ShoppingListPage and RecommendationPage):

- Three options: `Cheapest` | `Fastest` | `Same Day`
- `Same Day` option greyed out with tooltip "Not available for your postcode" if no same-day store serves user's postcode
- Selecting `Same Day` re-runs the recommendation filtered to same-day eligible stores only
- Persists to user profile on change (if logged in)

**Post-Transfer:** "Did you complete your order?" (Yes/No) | Save list prompt with name field | Reorder reminder selector (1w/2w/3w/1m) | Missing items feedback field

**Profile Page:** Saved lists (name, item count, last used, Reorder CTA) | Price alerts — shown grouped by type: Price Drop / Deal / Back in Stock / Fresh Produce Arrived — each with product name, store (if store-specific), threshold, and active/triggered status | Preferences (dietary, store whitelist/blacklist, brand prefs, default delivery speed) | Postcode

**Alert Subscribe Button** — present on every Deal Card, canonical product page, and shopping list result: "🔔 Alert me" opens a bottom-sheet with the four alert type options. Pre-selects the most logical type contextually: Deal Card → `deal`; out-of-stock product → `restock_any`; Fresh Produce category → `fresh_arrived`. User can switch type before confirming. Requires login — guest users see "Sign in to set alerts".

**Last Updated Banner:** Sticky; "Data refreshes every 24 hours. Last update: X hours ago." Red if >26h.

### 13.3 Design Tokens

| Token          | Value                      |
| -------------- | -------------------------- |
| Primary        | `#E85A2B` (saffron-orange) |
| Secondary      | `#2B7A3F` (deep green)     |
| Background     | `#F9F5F0`                  |
| Card bg        | `#FFFFFF`                  |
| Text primary   | `#1A1A1A`                  |
| Text secondary | `#6B6B6B`                  |
| Border         | `#E5E0D8`                  |
| Font           | `DM Sans` (Google Fonts)   |

### 13.4 Responsive Breakpoints

| Breakpoint | Width       | Deal Grid Columns |
| ---------- | ----------- | ----------------- |
| Mobile     | <640px      | 1                 |
| Tablet     | 640–1023px  | 2                 |
| Desktop    | 1024–1279px | 3                 |
| Wide       | ≥1280px     | 4                 |

---

## 14. Project File Structure

```
desi-deals-24/
├── package.json
├── .env.example
├── README.md
│
├── server/
│   ├── index.js
│   ├── routes/
│   │   ├── auth.js
│   │   ├── deals.js
│   │   ├── stores.js
│   │   ├── categories.js
│   │   ├── products.js
│   │   ├── lists.js          # Shopping list CRUD
│   │   ├── recommend.js      # Recommendation engine
│   │   ├── profile.js        # User profile + alerts (all types)
│   │   ├── inbound.js        # Store webhooks: POST /inbound/fresh-stock
│   │   └── admin.js
│   ├── services/
│   │   ├── list-parser.js        # Claude API NLP parsing
│   │   ├── recommender.js        # Best-store calculation + cart URL builder + delivery scoring
│   │   ├── delivery.js           # getEligibleDeliveryOptions(), cutoff check helpers
│   │   ├── alert-notifier.js     # Dispatches all alert types: price|deal|restock_any|restock_store|fresh_arrived
│   │   └── alert-evaluator.js    # Runs after each price-sync crawl; checks deal+restock alerts against new prices
│   ├── db/
│   │   ├── index.js
│   │   └── schema.sql
│   └── middleware/
│       ├── auth.js           # JWT verification
│       └── admin-auth.js
│
├── crawler/
│   ├── index.js              # Orchestrator (full + price-sync modes)
│   ├── scheduler.js
│   ├── generic-adapter.js
│   ├── entity-resolution/
│   │   ├── index.js
│   │   ├── normaliser.js
│   │   ├── fuzzy-matcher.js
│   │   ├── ai-resolver.js
│   │   ├── synonyms.json     # PRIMARY PROPRIETARY ASSET — commit carefully
│   │   └── __tests__/
│   │       ├── normaliser.test.js
│   │       ├── fuzzy-matcher.test.js
│   │       └── top200.fixture.json
│   ├── utils/
│   │   ├── price-parser.js
│   │   ├── weight-parser.js
│   │   ├── category-mapper.js
│   │   ├── image-resolver.js
│   │   └── platform-detector.js
│   └── stores/               # 27 adapter files
│       ├── jamoona.js
│       ├── dookan.js
│       └── ... (27 total)
│
├── client/
│   ├── public/index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── components/
│       │   ├── Header.jsx
│       │   ├── SearchBar.jsx
│       │   ├── FilterPanel.jsx
│       │   ├── DealCard.jsx
│       │   ├── DealsGrid.jsx
│       │   ├── ShoppingListInput.jsx
│       │   ├── ParsedItemsList.jsx
│       │   ├── RecommendationCard.jsx
│       │   ├── CartTransferModal.jsx
│       │   ├── PostTransferPrompt.jsx
│       │   ├── DeliverySpeedToggle.jsx  # Cheapest/Fastest/Same Day 3-option selector
│       │   ├── SameDayBadge.jsx         # ⚡ badge for postcode-eligible stores
│       │   ├── AlertSubscribeSheet.jsx  # Bottom-sheet: alert type selector + confirm
│       │   ├── StoreBadge.jsx
│       │   ├── CategoryBadge.jsx
│       │   ├── Pagination.jsx
│       │   └── EmptyState.jsx
│       ├── pages/
│       │   ├── HomePage.jsx
│       │   ├── DealsPage.jsx
│       │   ├── StorePage.jsx
│       │   ├── CategoryPage.jsx
│       │   ├── ShoppingListPage.jsx
│       │   ├── SavedListPage.jsx
│       │   ├── RecommendationPage.jsx
│       │   ├── ProfilePage.jsx
│       │   ├── LoginPage.jsx
│       │   └── RegisterPage.jsx
│       ├── hooks/
│       │   ├── useDeals.js
│       │   ├── useStores.js
│       │   ├── useList.js
│       │   ├── useRecommendation.js
│       │   └── useAuth.js
│       └── utils/
│           ├── api.js
│           ├── formatters.js
│           └── voice-input.js    # Web Speech API wrapper
│
└── data/
    └── desiDeals24.db
```

---

## 15. Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production
ADMIN_SECRET=changeme-in-production

# Database
DB_PATH=./data/desiDeals24.db

# Auth
JWT_SECRET=changeme-in-production
JWT_REFRESH_SECRET=changeme-in-production
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/api/v1/auth/google/callback

# Anthropic (NLP parsing + entity resolution)
ANTHROPIC_API_KEY=

# Crawler
CRAWL_FULL_CRON=0 2 * * 0        # Sunday 02:00 UTC
CRAWL_PRICE_SYNC_CRON=0 2 * * *   # Daily 02:00 UTC
CRAWL_ON_STARTUP=true
CRAWLER_CONCURRENCY=3
REQUEST_DELAY_MIN_MS=2000
REQUEST_DELAY_MAX_MS=5000
CRAWLER_TIMEOUT_MS=30000

# Frontend (Vite)
VITE_API_BASE=/api/v1
VITE_GOOGLE_CLIENT_ID=
```

---

## 16. Error Handling & Edge Cases

| Scenario                                               | Behaviour                                                                                                                                                                   |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store website down                                     | Log, skip, continue crawl                                                                                                                                                   |
| Store in maintenance                                   | `crawl_status: maintenance`, skip                                                                                                                                           |
| Product image fails                                    | Placeholder SVG in UI                                                                                                                                                       |
| Price not found                                        | Skip product (don't store incomplete)                                                                                                                                       |
| 0 products returned for a store in full crawl          | Log warning, retain previous records `is_active: true`                                                                                                                      |
| Duplicate product URL in crawl run                     | Keep first, discard duplicate                                                                                                                                               |
| DB locked                                              | Retry ×3 with 1s delay                                                                                                                                                      |
| CORS on image URLs                                     | Proxy via `/api/v1/proxy/image?url=<encoded>`                                                                                                                               |
| Entity resolution: UNSURE                              | Queue for admin manual review; do not block user-facing features                                                                                                            |
| Shopping list item unresolvable                        | Show in UI as amber warning; allow user to manually search and select                                                                                                       |
| Cart transfer partial (not all items supported)        | Show exact count "6 of 8 items pre-filled"; link remaining items individually                                                                                               |
| Shipping tier unknown for store                        | Show "Shipping cost unknown — verify at store" in recommendation UI                                                                                                         |
| User postcode not set                                  | Prompt for postcode before showing recommendation; guest users enter inline                                                                                                 |
| Postcode not eligible for same-day                     | `same_day_if_available` pref returns no results → fallback to `cheapest` + show notice "No same-day delivery available for your postcode. Showing cheapest option instead." |
| All same-day cutoffs passed for the day                | Show same-day options as "Available tomorrow" with next-day cutoff time; do not hide them                                                                                   |
| delivery_options row stale (>45 days)                  | Highlight in admin UI; no automatic change to user-facing data                                                                                                              |
| Store changes same-day policy (detected via user flag) | Admin manually updates `delivery_options.is_active`; flag logged for monthly review                                                                                         |
| Claude API timeout during list parse                   | Return partially parsed items; flag unparsed section for manual input                                                                                                       |
| Shopify variant ID missing                             | Fall back to `tab_burst` method; log for manual adapter fix                                                                                                                 |

---

## 17. Performance Requirements

| Requirement                         | Target                                    |
| ----------------------------------- | ----------------------------------------- |
| Initial page load (4G mobile)       | <3s                                       |
| Search autocomplete response        | <200ms                                    |
| Shopping list parse (Claude API)    | <3s; show spinner                         |
| Recommendation calculation          | <5s (includes DB queries + shipping calc) |
| Deal browse API response            | <200ms (SQLite indexed)                   |
| Full crawl (27 stores)              | <120 min                                  |
| Price-sync crawl                    | <30 min                                   |
| Entity resolution (post full crawl) | <20 min                                   |

---

## 18. Data Collection & Analytics

All events below written to an `events` table (or forwarded to analytics service). No PII in event payloads.

| Event                           | Key Properties                                                        | Purpose                    |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `list_submitted`                | item_count, input_method, language_detected                           | Demand signal              |
| `item_resolved`                 | canonical_id, method (exact/fuzzy/ai/manual)                          | Resolution quality         |
| `item_unresolved`               | raw_item_text, store_searched                                         | Coverage gap tracking      |
| `recommendation_shown`          | winner_store, total, match_pct, method                                | Conversion funnel          |
| `delivery_preference_set`       | pref (cheapest/fastest/same_day), source (toggle/profile)             | Demand signal for same-day |
| `same_day_upsell_shown`         | winner_store, same_day_store, price_diff                              | Upsell effectiveness       |
| `same_day_upsell_accepted`      | same_day_store, price_diff                                            | Conversion on upsell       |
| `same_day_unavailable_postcode` | postcode (hashed), stores_checked                                     | Coverage gap signal        |
| `cart_transfer_clicked`         | store_id, transfer_method, item_count                                 | Conversion tracking        |
| `order_confirmed`               | store_id, self_reported (boolean)                                     | Attribution                |
| `list_saved`                    | list_id, item_count                                                   | Retention signal           |
| `reorder_reminder_set`          | days, list_id                                                         | Habit loop                 |
| `price_alert_triggered`         | canonical_id, store_id, alert_type, price                             | Re-engagement              |
| `alert_created`                 | alert_type, canonical_id, source (deal_card/product_page/list_result) | Demand signal              |
| `fresh_arrived_webhook`         | store_id, product_count, resolution_rate                              | Partnership health         |

**Analytics outputs (monthly):**

- Top 50 searched products with % resolution rate
- Top 20 unresolvable items (→ synonym dictionary updates)
- Store win rate by basket size
- Basket composition clusters (→ store partnership pitch data)

---

## 19. Development Phases

### Phase 1 — Core Infrastructure

1. Express + SQLite setup, schema migrations
2. `price-parser.js`, `weight-parser.js` with unit tests
3. `normaliser.js` + `synonyms.json` seed (top 200 products)
4. `generic-adapter.js` (Shopify + WooCommerce)
5. Full crawl orchestrator against 3 stores
6. Entity resolution pipeline (Layers 1–3)
7. `/api/v1/deals`, `/api/v1/stores`, `/api/v1/canonical` endpoints

### Phase 2 — Store Adapters

8. All 27 store adapters (start: jamoona, dookan, grocera)
9. Platform detection + Shopify variant ID capture
10. Shipping tier seed data for all 27 stores
11. **Delivery options seed data** for all 27 stores (`delivery_options` table) — research each store's same-day/express offering, document eligible postcodes
12. Scheduler: full + price-sync cron

### Phase 3 — Auth + Shopping List

12. JWT auth + Google OAuth
13. User profile, preferences, saved lists DB + API
14. Claude API list parser (`list-parser.js`)
15. Recommendation engine (`recommender.js`) including `delivery.js` postcode eligibility + scoring
16. Cart transfer URL builder (all 4 methods)
17. **Full alert system:** `price_alerts` table (all types), `alert-evaluator.js` (runs post price-sync), `alert-notifier.js` (email dispatch), all `/me/alerts` endpoints
18. **Inbound webhook:** `POST /api/v1/inbound/fresh-stock` — live route with HMAC auth, entity resolution, and `fresh_arrived` alert dispatch

### Phase 4 — Frontend

19. Auth pages (login, register)
20. Deal browse (existing) + deal card updates + **Alert Subscribe button on every card**
21. Shopping list input page (voice + text + parsed items review + delivery speed toggle)
22. Recommendation page + cart transfer modal + same-day upsell row
23. Profile page (lists, **full alert management UI — all four types**, preferences)

### Phase 5 — Polish & Analytics

24. Image proxy route
25. Price alert email templates (HTML, one per alert type)
26. `events` table + analytics queries
27. Admin panel (crawl trigger, entity resolution review queue, delivery options CRUD + staleness highlighting, **alert activity dashboard**)
28. Performance optimisation (query tuning, lazy loading)
29. Responsive QA across devices

---

## 20. Out of Scope (v1)

- Price history charts (v2)
- Multi-store split basket optimisation (v2)
- Email/push notifications for reorder reminders (v2)
- Product comparison view (v2)
- Mobile app (v3)
- Non-Indian grocery stores
- User reviews or ratings
- Any marketplace / hosted checkout functionality
- Invoice upload (PDF/screenshot of past orders from other stores) (v2)
- Email forwarding of order confirmations for automatic list population (v2)
- Sarvam / multi-language STT beyond Web Speech API `en-IN` (v2 — trigger: voice abandonment rate >15pp above text input rate)

### Fresh Produce Arrived Alert — Store Partnership Dependency

The `fresh_arrived` alert type is implemented in v1 (table schema, inbound route, notifier service) but **cannot fire until at least one store partner activates a webhook**. The feature is live and waiting; it requires a commercial agreement, not more code.

Until a store partnership is established, users who subscribe to a `fresh_arrived` alert receive a one-time confirmation email: "We'll notify you the moment [store] tells us fresh [product] has arrived. This alert depends on the store sending us a notification — we'll activate it as soon as they're connected."

All other alert types (`price`, `deal`, `restock_any`, `restock_store`) are fully operational in v1 via the crawl pipeline and require no store cooperation.
