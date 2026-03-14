# Product Requirements Document

## DesiDeals24 — Indian Grocery Deals Aggregator for Germany

**Version:** 1.0  
**Date:** 2025-02-23  
**Status:** Ready for Development

---

## 1. Product Overview

DesiDeals24 is a responsive web application that automatically crawls Indian grocery stores delivering to Germany, aggregates their current deals/offers/sales, and presents them in a searchable, filterable interface. Users can discover the best prices on Indian grocery products without visiting each store individually. Search offers auto suggest.

---

## 2. Goals & Success Metrics

| Goal                                            | Metric                                       |
| ----------------------------------------------- | -------------------------------------------- |
| Aggregate all live offers from 27 target stores | ≥ 80% of stores successfully crawled per run |
| Enable fast product discovery                   | User finds target product in < 30 seconds    |
| Keep data fresh                                 | Crawl runs at minimum every 24 hours         |
| Mobile-first experience                         | Fully functional on screen widths ≥ 320px    |

---

## 3. Target Stores

The crawler must process all 27 stores from the DesiDeals24 Websites document:

| #   | Store Name                   | URL                             |
| --- | ---------------------------- | ------------------------------- |
| 1   | Jamoona                      | jamoona.com                     |
| 2   | Dookan                       | eu.dookan.com                   |
| 3   | Grocera                      | grocera.de                      |
| 4   | Little India                 | littleindia.de                  |
| 5   | Namma Markt                  | nammamarkt.com                  |
| 6   | Desigros                     | desigros.com                    |
| 7   | Spice Village                | spicevillage.eu                 |
| 8   | Zora Supermarkt              | zorastore.eu                    |
| 9   | MD Store                     | md-store.de                     |
| 10  | Indian Supermarkt            | indiansupermarkt.de             |
| 11  | Indische-Lebensmittel-Online | indische-lebensmittel-online.de |
| 12  | Namaste Deutschland          | namastedeutschland.de           |
| 13  | India Store                  | india-store.de                  |
| 14  | Indian Food Store            | indianfoodstore.de              |
| 15  | Indian Store Stuttgart       | indianstorestuttgart.com        |
| 16  | Indian Food Depot Frankfurt  | indianfooddepot.de              |
| 17  | Swadesh                      | swadesh.eu                      |
| 18  | Spicelands                   | spicelands.de                   |
| 19  | Indian Bazar                 | indianbazar.de                  |
| 20  | India Express Food           | india-express-food.de           |
| 21  | Village Foods Asia           | villagefoods.de                 |
| 22  | AnuHita Groceries            | anuhitagroceries.de             |
| 23  | Annachi Europe               | annachi.fr                      |
| 24  | SAIRAS                       | sairas.de                       |
| 25  | Sona Food Traders            | sonafoodtraders.de              |
| 26  | Masala-Wala                  | masala-wala.com                 |
| 27  | Feines.de                    | feines.de/indien                |

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────┐
│                  Scheduler (cron)                │
│           Runs crawler every 24 hours            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              Crawler Service (Node.js)           │
│  - Playwright/Puppeteer for JS-rendered pages    │
│  - Cheerio for static HTML parsing              │
│  - Per-store adapters for each shop             │
│  - Rate limiting & retry logic                  │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│              SQLite Database                     │
│  Tables: deals, stores, crawl_runs              │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│         REST API (Express.js)                   │
│  GET /api/deals  GET /api/stores                │
│  GET /api/deals/:id  GET /api/search            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           Frontend (React + Tailwind CSS)        │
│  - Search bar, filters, deal cards, store view  │
└─────────────────────────────────────────────────┘
```

**Tech Stack:**

- **Backend:** Node.js + Express.js
- **Crawler:** Playwright (headless Chromium) + Cheerio
- **Database:** SQLite via better-sqlite3 (file-based, zero-config)
- **Frontend:** React + Tailwind CSS (single-page app, served from Express)
- **Scheduler:** node-cron
- **Image proxy:** Simple Express route to proxy product images (avoid CORS issues)

---

## 5. Crawler Requirements

### 5.1 Crawl Trigger Points

For each store, the crawler must identify and navigate to deal/offer sections. It should look for the following patterns (in order of priority):

1. Navigation links containing: `Angebot`, `Angebote`, `Sale`, `Aktionen`, `Offers`, `Deals`, `Rabatt`, `Reduziert`, `Sonderangebote`, `Outlet`, `Special`
2. URL patterns: `/sale`, `/angebote`, `/offers`, `/aktionen`, `/deals`, `/discounts`, `/reduziert`
3. Homepage banners or promotional sections with visually discounted items
4. Product listing pages with crossed-out / strikethrough prices

### 5.2 Per-Store Adapter Pattern

Each store must have a dedicated adapter file at `crawlers/stores/<store-slug>.js` that exports:

```javascript
module.exports = {
  storeId: 'jamoona',
  storeName: 'Jamoona',
  storeUrl: 'https://www.jamoona.com',
  offerUrls: [
    'https://www.jamoona.com/sale',       // known sale pages
    'https://www.jamoona.com/angebote'
  ],
  // Optional: custom logic to find offer pages dynamically
  discoverOfferUrls: async (page) => { ... },
  // Scrape all deals from a given offer listing page
  scrapeListingPage: async (page, url) => [ ...deals ],
  // Optional: scrape additional detail from a product page
  scrapeProductPage: async (page, url) => { ...extraFields },
}
```

A **generic fallback adapter** must also be implemented that handles common e-commerce patterns (Shopify, WooCommerce) for stores without custom adapters.

### 5.3 Data Fields Per Deal (Required)

Each scraped deal must produce a record with the following fields:

| Field              | Type              | Description                                      | Required                       |
| ------------------ | ----------------- | ------------------------------------------------ | ------------------------------ |
| `id`               | UUID              | Auto-generated unique ID                         | Yes                            |
| `crawl_timestamp`  | ISO 8601 datetime | Exact time the item was crawled                  | Yes                            |
| `crawl_run_id`     | UUID              | Groups all deals from one crawl session          | Yes                            |
| `store_id`         | String            | Slug of the store (e.g., `jamoona`)              | Yes                            |
| `store_name`       | String            | Human-readable store name                        | Yes                            |
| `store_url`        | String            | Homepage URL of the store                        | Yes                            |
| `product_name`     | String            | Full product name as listed                      | Yes                            |
| `product_category` | String            | Category (see §5.4 for taxonomy)                 | Yes (inferred if not explicit) |
| `product_url`      | String            | Direct URL to product page                       | Yes                            |
| `image_url`        | String            | URL of the product image                         | Yes (null if unavailable)      |
| `weight_value`     | Float             | Numeric weight (e.g., `500`)                     | No                             |
| `weight_unit`      | Enum              | `g`, `kg`, `ml`, `l`, `units`, `pieces`          | No                             |
| `weight_raw`       | String            | Raw weight string from page (e.g., `"500g"`)     | Yes                            |
| `sale_price`       | Float             | Current sale price in EUR                        | Yes                            |
| `original_price`   | Float             | Struck-out / original price in EUR               | No                             |
| `discount_percent` | Float             | Calculated: `(1 - sale/original) * 100`          | Auto-calculated                |
| `price_per_kg`     | Float             | EUR per kg (calculated or scraped)               | No                             |
| `price_per_unit`   | Float             | EUR per unit if sold by count                    | No                             |
| `currency`         | String            | Always `EUR` for German stores                   | Yes                            |
| `availability`     | Enum              | `in_stock`, `out_of_stock`, `limited`, `unknown` | Yes                            |
| `bulk_pricing`     | JSON              | Array of `{min_qty, price}` objects              | No                             |
| `is_active`        | Boolean           | `true` until next crawl supersedes it            | Yes                            |

### 5.4 Product Category Taxonomy

The crawler should map products to these categories (using keyword matching on product name if no category is provided by the store):

- `Rice & Grains` — rice, basmati, poha, semolina, rava, sooji, oats
- `Flours & Baking` — atta, maida, besan, cornflour, bread
- `Lentils & Pulses` — dal, lentil, chana, moong, urad, rajma, toor
- `Spices & Masalas` — masala, spice, haldi, turmeric, cumin, coriander, chilli
- `Oils & Ghee` — oil, ghee, butter
- `Sauces & Pastes` — chutney, pickle, achar, sauce, paste
- `Snacks & Sweets` — bhujia, mixture, ladoo, halwa, biscuit, namkeen, chakli
- `Beverages` — tea, chai, coffee, lassi, juice, masala drink
- `Dairy & Paneer` — paneer, yogurt, curd, milk, cream
- `Frozen Foods` — paratha, naan, samosa, frozen
- `Fresh Produce` — vegetable, fruit, herb, fresh
- `Noodles & Pasta` — noodle, vermicelli, pasta, sewai
- `Canned & Packaged` — canned, tin, ready meal, instant
- `Personal Care` — soap, shampoo, hair oil, cosmetic
- `Household` — incense, agarbatti, pooja, diyas
- `Other` — fallback category

### 5.5 Crawler Behavior Rules

- **Politeness:** Add a 2–5 second random delay between requests to the same store.
- **User-Agent:** Use a realistic browser user-agent string.
- **Timeout:** 30 seconds per page load; skip the page and log if exceeded.
- **Retry:** Retry failed pages up to 2 times with exponential backoff.
- **JavaScript rendering:** Use Playwright for stores that require JS rendering (detected if price elements are missing from static HTML).
- **Image extraction:** Prefer the highest-resolution image available (`srcset` or `data-zoom-src` attributes preferred over `src`).
- **Price parsing:** Strip currency symbols (€, EUR), handle comma-decimal format (German: `2,99` → `2.99`), handle `ab` (from) prefix.
- **Maintenance mode:** If a store returns HTTP 503, or shows a maintenance page, mark that store as `crawl_status: 'maintenance'` and skip — do not crash.
- **Deduplication:** Within a single crawl run, deduplicate by `(store_id + product_url)`.

### 5.6 Crawl Run Logging

A `crawl_runs` table must record:

| Field              | Description                               |
| ------------------ | ----------------------------------------- |
| `id`               | UUID                                      |
| `started_at`       | ISO 8601                                  |
| `finished_at`      | ISO 8601                                  |
| `status`           | `running`, `completed`, `failed`          |
| `stores_attempted` | Count                                     |
| `stores_succeeded` | Count                                     |
| `deals_found`      | Total deals scraped                       |
| `errors`           | JSON array of `{store_id, error_message}` |

---

## 6. Database Schema

```sql
-- Stores registry
CREATE TABLE stores (
  id          TEXT PRIMARY KEY,       -- slug e.g. 'jamoona'
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  logo_url    TEXT,
  last_crawled_at DATETIME,
  crawl_status TEXT DEFAULT 'active'  -- active | maintenance | error
);

-- Individual deals/offers
CREATE TABLE deals (
  id                TEXT PRIMARY KEY,
  crawl_run_id      TEXT NOT NULL,
  crawl_timestamp   DATETIME NOT NULL,
  store_id          TEXT NOT NULL REFERENCES stores(id),
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
  bulk_pricing      TEXT,             -- JSON string
  is_active         BOOLEAN DEFAULT 1,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Crawl run metadata
CREATE TABLE crawl_runs (
  id                  TEXT PRIMARY KEY,
  started_at          DATETIME NOT NULL,
  finished_at         DATETIME,
  status              TEXT DEFAULT 'running',
  stores_attempted    INTEGER DEFAULT 0,
  stores_succeeded    INTEGER DEFAULT 0,
  deals_found         INTEGER DEFAULT 0,
  errors              TEXT              -- JSON string
);

-- Indexes
CREATE INDEX idx_deals_store_id ON deals(store_id);
CREATE INDEX idx_deals_product_name ON deals(product_name);
CREATE INDEX idx_deals_category ON deals(product_category);
CREATE INDEX idx_deals_is_active ON deals(is_active);
CREATE INDEX idx_deals_sale_price ON deals(sale_price);
CREATE INDEX idx_deals_discount ON deals(discount_percent);
```

---

## 7. REST API Specification

Base path: `/api/v1`

### 7.1 GET `/api/v1/deals`

Returns paginated list of active deals.

**Query Parameters:**

| Parameter      | Type   | Default         | Description                                          |
| -------------- | ------ | --------------- | ---------------------------------------------------- |
| `q`            | string | —               | Full-text search on product name                     |
| `store`        | string | —               | Filter by store slug (comma-separated for multiple)  |
| `category`     | string | —               | Filter by product category                           |
| `min_discount` | float  | —               | Minimum discount percentage                          |
| `max_price`    | float  | —               | Maximum sale price in EUR                            |
| `availability` | string | `in_stock`      | Filter by availability                               |
| `sort`         | string | `discount_desc` | `discount_desc`, `price_asc`, `price_desc`, `newest` |
| `page`         | int    | `1`             | Page number                                          |
| `limit`        | int    | `24`            | Results per page (max 100)                           |

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "crawl_timestamp": "2025-02-23T10:30:00Z",
      "store": {
        "id": "jamoona",
        "name": "Jamoona",
        "url": "https://jamoona.com"
      },
      "product_name": "Toor Dal 1kg",
      "product_category": "Lentils & Pulses",
      "product_url": "https://jamoona.com/products/toor-dal-1kg",
      "image_url": "https://jamoona.com/media/toor-dal.jpg",
      "weight_raw": "1kg",
      "weight_value": 1.0,
      "weight_unit": "kg",
      "sale_price": 2.49,
      "original_price": 3.99,
      "discount_percent": 37.6,
      "price_per_kg": 2.49,
      "currency": "EUR",
      "availability": "in_stock",
      "bulk_pricing": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 24,
    "total": 312,
    "total_pages": 13
  },
  "meta": {
    "last_crawl": "2025-02-23T08:00:00Z",
    "active_stores": 25
  }
}
```

### 7.2 GET `/api/v1/stores`

Returns all stores with their crawl status and deal counts.

**Response:**

```json
{
  "data": [
    {
      "id": "jamoona",
      "name": "Jamoona",
      "url": "https://jamoona.com",
      "logo_url": null,
      "last_crawled_at": "2025-02-23T08:00:00Z",
      "crawl_status": "active",
      "active_deals_count": 47
    }
  ]
}
```

### 7.3 GET `/api/v1/deals/:id`

Returns full detail for a single deal.

### 7.4 GET `/api/v1/categories`

Returns list of categories with deal counts.

### 7.5 POST `/api/v1/crawl/trigger` (Admin)

Manually triggers a crawl run. Protected by `ADMIN_SECRET` env variable in `Authorization: Bearer` header.

### 7.6 GET `/api/v1/crawl/status`

Returns the status of the most recent crawl run.

---

## 8. Frontend Requirements

### 8.1 Pages & Routes

| Route                 | Component      | Description                               |
| --------------------- | -------------- | ----------------------------------------- |
| `/`                   | `HomePage`     | Featured deals, search bar, quick filters |
| `/deals`              | `DealsPage`    | Full browsable/searchable deal list       |
| `/store/:storeId`     | `StorePage`    | All deals from a specific store           |
| `/category/:category` | `CategoryPage` | All deals in a category                   |

### 8.2 Component Specifications

#### Header / Navigation

- Logo + site name "DesiDeals24"
- Search bar (prominent, center or top)
- Navigation links: All Deals | Stores | Categories
- Responsive: hamburger menu on mobile

#### Search Bar

- Autocomplete suggestions after 2 characters (search product names)
- Pressing Enter navigates to `/deals?q=<query>`
- Shows result count as user types

#### Filters Sidebar / Filter Bar

- **Store filter:** Checkbox list of all stores (with deal count badges)
- **Category filter:** Checkbox list of all categories
- **Discount filter:** Slider or preset buttons — `10%+`, `20%+`, `30%+`, `50%+`
- **Price filter:** Max price slider (€0–€50)
- **Availability:** Toggle "In Stock Only"
- **Sort:** Dropdown — Best Discount, Price Low→High, Price High→Low, Newest
- On mobile: filters in a slide-in drawer triggered by a "Filter" button

#### Deal Card Component

Each deal is displayed as a card with:

- Product image (lazy-loaded; fallback to placeholder if missing)
- Store name + favicon/logo
- Product name (truncated to 2 lines)
- Category badge
- Weight (if available)
- **Sale price** (large, prominent, green or red)
- Original price (struck through, greyed out) — shown only if available
- **Discount badge** (e.g., `-37%`) — shown only if discount ≥ 5%
- Price per kg (shown below main price if available)
- Availability indicator (green dot = in stock, grey = unknown, red = out of stock)
- "View Deal" button → opens product URL in new tab
- Timestamp: "Updated X hours ago"

#### Store Page

- Store header with name, URL, logo (if available)
- Count of active deals
- Same deal grid as main page, pre-filtered to that store

#### Deals Grid

- Responsive CSS grid: 1 column (mobile) → 2 columns (tablet) → 3–4 columns (desktop)
- Infinite scroll or pagination (preference: pagination with "Load More" button)
- Empty state with helpful message if no results

#### Last Updated Banner

- Sticky or prominent notice showing when data was last refreshed
- "Data refreshes every 24 hours. Last update: 3 hours ago."

### 8.3 Design Tokens

| Token           | Value                      | Usage                          |
| --------------- | -------------------------- | ------------------------------ |
| Primary color   | `#E85A2B` (saffron-orange) | Buttons, badges, accents       |
| Secondary color | `#2B7A3F` (deep green)     | Sale price, in-stock indicator |
| Background      | `#F9F5F0` (warm off-white) | Page background                |
| Card background | `#FFFFFF`                  | Deal cards                     |
| Text primary    | `#1A1A1A`                  | Main text                      |
| Text secondary  | `#6B6B6B`                  | Metadata, labels               |
| Border          | `#E5E0D8`                  | Card borders                   |
| Font            | `Inter` (Google Fonts)     | All UI text                    |

### 8.4 Responsive Breakpoints

| Breakpoint | Width         | Grid Columns |
| ---------- | ------------- | ------------ |
| Mobile     | < 640px       | 1            |
| Tablet     | 640px–1023px  | 2            |
| Desktop    | 1024px–1279px | 3            |
| Wide       | ≥ 1280px      | 4            |

---

## 9. Project File Structure

```
desi-deals-24/
├── package.json
├── .env.example
├── README.md
│
├── server/
│   ├── index.js              # Express app entry point
│   ├── routes/
│   │   ├── deals.js
│   │   ├── stores.js
│   │   ├── categories.js
│   │   └── admin.js
│   ├── db/
│   │   ├── index.js          # better-sqlite3 setup & migrations
│   │   └── schema.sql
│   └── middleware/
│       └── auth.js           # Admin API key check
│
├── crawler/
│   ├── index.js              # Main crawler orchestrator
│   ├── scheduler.js          # node-cron setup
│   ├── generic-adapter.js    # Fallback for common CMS patterns
│   ├── utils/
│   │   ├── price-parser.js   # Handle EUR, German decimals
│   │   ├── weight-parser.js  # Extract weight from strings
│   │   ├── category-mapper.js
│   │   └── image-resolver.js # srcset, lazy-load attr handling
│   └── stores/               # One file per store
│       ├── jamoona.js
│       ├── dookan.js
│       ├── grocera.js
│       └── ... (27 total)
│
├── client/
│   ├── public/
│   │   └── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── components/
│       │   ├── Header.jsx
│       │   ├── SearchBar.jsx
│       │   ├── FilterPanel.jsx
│       │   ├── DealCard.jsx
│       │   ├── DealsGrid.jsx
│       │   ├── StoreBadge.jsx
│       │   ├── CategoryBadge.jsx
│       │   ├── Pagination.jsx
│       │   └── EmptyState.jsx
│       ├── pages/
│       │   ├── HomePage.jsx
│       │   ├── DealsPage.jsx
│       │   ├── StorePage.jsx
│       │   └── CategoryPage.jsx
│       ├── hooks/
│       │   ├── useDeals.js
│       │   └── useStores.js
│       └── utils/
│           ├── api.js         # Fetch wrappers
│           └── formatters.js  # Price, date, weight formatting
│
└── data/
    └── desiDeals24.db        # SQLite database file
```

---

## 10. Environment Variables

```env
# Server
PORT=3000
NODE_ENV=production
ADMIN_SECRET=changeme-in-production

# Database
DB_PATH=./data/desiDeals24.db

# Crawler
CRAWL_INTERVAL_HOURS=24
CRAWL_ON_STARTUP=true          # Run crawl when server starts
CRAWLER_CONCURRENCY=3          # Max stores crawled simultaneously
REQUEST_DELAY_MIN_MS=2000
REQUEST_DELAY_MAX_MS=5000
CRAWLER_TIMEOUT_MS=30000

# Frontend (Vite build)
VITE_API_BASE=/api/v1
```

---

## 11. Error Handling & Edge Cases

| Scenario                                  | Expected Behavior                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Store website is down                     | Log error, skip store, continue crawl                                                 |
| Store in maintenance mode                 | Mark store `crawl_status: maintenance`, skip                                          |
| Product image fails to load               | Show placeholder SVG image in UI                                                      |
| Price not found on page                   | Skip product (don't store incomplete deal)                                            |
| Crawler finds 0 deals for a store         | Log warning, keep previous deals marked `is_active: true` until next successful crawl |
| Same product URL appears twice in a crawl | Keep first occurrence, discard duplicate                                              |
| Database locked                           | Retry up to 3 times with 1s delay                                                     |
| CORS on image URLs                        | Proxy images through `/api/v1/proxy/image?url=<encoded>`                              |

---

## 12. Performance Requirements

- Initial page load: < 3 seconds on 4G mobile
- Search results appear: < 500ms after typing stops (debounced 300ms)
- Deal cards: lazy-loaded images, above-fold content prioritized
- API responses: < 200ms for paginated deal queries with SQLite FTS
- Crawler: complete full crawl of all 27 stores in < 30 minutes

---

## 13. Deployment Notes

- Single server deployment (no microservices needed)
- Express serves both API and compiled React frontend (static files from `client/dist`)
- SQLite database persists in `data/` directory (mount as volume if containerized)
- Crawler runs in-process via node-cron (no separate worker needed at this scale)
- Optional: Dockerfile provided for containerized deployment

---

## 14. Development Phases

### Phase 1 — Core Infrastructure (Start Here)

1. Set up Express server with SQLite and schema migrations
2. Implement `price-parser.js` and `weight-parser.js` utilities with unit tests
3. Build `generic-adapter.js` (Shopify + WooCommerce patterns)
4. Implement crawl orchestrator and run against 3 stores manually
5. Build `/api/v1/deals` and `/api/v1/stores` endpoints

### Phase 2 — Store Adapters

6. Build custom adapters for all 27 stores, starting with the largest (Jamoona, Dookan, Grocera)
7. Handle JS-rendered stores with Playwright
8. Set up scheduler and test full crawl run

### Phase 3 — Frontend

9. Build React app with deal cards, search, and filter panel
10. Implement store page and category page
11. Connect to API and test end-to-end

### Phase 4 — Polish

12. Add image proxy route
13. Add admin crawl-trigger endpoint
14. Performance optimization (indexes, query tuning)
15. Responsive design QA across devices

---

## 15. Out of Scope (v1)

- User accounts or saved searches
- Price history / price tracking charts
- Email or push notifications
- Comparison across stores for the same product
- Mobile app
- Any non-Indian grocery store
