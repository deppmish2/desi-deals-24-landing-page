# Tiered Mode 2 Catalog Crawl

**Date:** 2026-05-05
**Status:** Approved
**Scope:** Split the weekly full catalog crawl across 7 days to avoid rate limits

## Problem

The Mode 2 full catalog crawl (`npm run crawl:mode2`) currently attempts all Shopify/WooCommerce stores in a single Sunday run. This risks rate limiting from stores and creates a large single burst of Turso writes. Additionally, the `stores.platform` column is unpopulated in production (`'unknown'` for all 32 stores), making Mode 2 a no-op.

## Solution

1. Assign Shopify stores to day-of-week groups (~2 stores/day)
2. Mode 2 script auto-detects today's Berlin weekday and crawls only that day's stores
3. GitHub Actions workflow changes from weekly to daily
4. Backfill `stores.platform` with actual values

## Store Platform Classification

| Platform | Count | Store IDs |
|---|---|---|
| shopify | 14 | jamoona, dookan, namma-markt, globalfoodhub, indiansupermarkt, desigros, md-store, sairas, anuhita-groceries, bajwa-shop, indianspicebasket, transfoodlev, villagefoods, zora-supermarkt |
| woocommerce | 0 | (little-india uses HTML scraping, not WC REST API) |
| cheerio | 17 | annachi, asiangrocerystore, asiatischer-lebensmittelladen, barkatfood, desistore, india-express-food, india-store, indische-lebensmittel-online, indianfoodstore, little-india, masimpex, namastedeutschland, spicelands, swadesh, yogimart, zakiasianfoods |
| custom-api | 1 | grocera (Typesense) |

Only Shopify stores have a Mode 2 full catalog implementation. Cheerio and custom-api stores are skipped.

## Day-of-Week Assignment

Heavy stores (by deal count) spread across different days:

| Day | Weekday | Stores |
|---|---|---|
| 0 | Sunday | anuhita-groceries, zora-supermarkt |
| 1 | Monday | dookan, sairas |
| 2 | Tuesday | globalfoodhub, md-store |
| 3 | Wednesday | indiansupermarkt, bajwa-shop |
| 4 | Thursday | namma-markt, indianspicebasket |
| 5 | Friday | jamoona, transfoodlev |
| 6 | Saturday | desigros, villagefoods |

## Changes

### 1. `scripts/mode2-crawl.js`

- Add `DAY_GROUPS` config object mapping day number (0-6) to store ID arrays
- On startup, determine Berlin weekday via `Intl.DateTimeFormat` or existing `formatBerlinDateKey`
- Filter stores to only those in today's group
- CLI flags:
  - `--day N` — override day (for testing)
  - `--all` — crawl all stores (preserves current full-run behavior)
- Remove the `WHERE platform IN (...)` filter; use the day group list directly as the store filter
- Keep: `store_crawl_state` updates, FTS rebuild, upsert logic

### 2. `.github/workflows/weekly-catalog-crawl.yml`

- Rename to `daily-catalog-crawl.yml`
- Change cron from `0 1 * * 0` (Sunday only) to `0 1 * * *` (daily)
- Update job name and description
- Command stays `npm run crawl:mode2` (script self-determines day)
- Reduce `timeout-minutes` from 360 to 60 (only 2 stores/day)

### 3. Platform backfill migration

Add a one-time script or SQL to update `stores.platform`:
```sql
UPDATE stores SET platform = 'shopify' WHERE id IN ('jamoona','dookan','namma-markt','globalfoodhub','indiansupermarkt','desigros','md-store','sairas','anuhita-groceries','bajwa-shop','indianspicebasket','transfoodlev','villagefoods','zora-supermarkt');
UPDATE stores SET platform = 'cheerio' WHERE id IN ('annachi','asiangrocerystore','asiatischer-lebensmittelladen','barkatfood','desistore','india-express-food','india-store','indische-lebensmittel-online','indianfoodstore','little-india','masimpex','namastedeutschland','spicelands','swadesh','yogimart','zakiasianfoods');
UPDATE stores SET platform = 'custom-api' WHERE id = 'grocera';
```

This can be added to `server/db/schema.sql` seed logic or run as part of the existing migration script.

## Behavior Matrix

| Invocation | Stores crawled |
|---|---|
| `npm run crawl:mode2` | Today's 2 stores (auto-detect Berlin weekday) |
| `npm run crawl:mode2 -- --day 3` | Wednesday's stores (indiansupermarkt, bajwa-shop) |
| `npm run crawl:mode2 -- --all` | All 14 Shopify stores |
| GitHub Actions (daily 01:00 UTC) | Today's 2 stores |

## What Stays Unchanged

- Daily deal crawl (`npm run crawl`) — all 32 stores at 08:00 Berlin
- `store_crawl_state` table tracking
- FTS rebuild after each batch
- `crawl_store_results` recording
- Upsert logic in Mode 2

## Risk

- None for existing daily crawl — completely separate code path
- If a day's run fails, those 2 stores wait until next week for a retry (acceptable; daily deal crawl still covers them for on-sale items)
