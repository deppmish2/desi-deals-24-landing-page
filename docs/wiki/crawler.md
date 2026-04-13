---
title: Crawler
last_updated: 2026-04-13
source_count: 2
---

The crawler is a sequential Node.js orchestrator (`crawler/index.js`) that runs all store adapters in order, normalizes their output, reconciles against the existing DB, and updates display ordering. It uses a two-pass architecture: Pass 2 (the main crawl) fetches on-sale products; Pass 1 fetches non-sale prices for priority canonical products to enable Real Savings comparisons.

## Running

```bash
npm run crawl          # manual one-shot
```

Or triggered automatically by the scheduler (local dev) or GitHub Actions (production).

## Orchestrator flow (`crawler/index.js`)

1. **Acquire crawl lock** — `crawl_locks` table; skips if another crawl is running
2. **Load priority canonicals** — for Pass 1 auto-mapping
3. **Pass 2 (per-store loop)**:
   - Call `adapter.scrape()` → raw deal array
   - `buildNormalizedScrapedDeals()` — normalize fields, deduplicate by product URL within the run
   - `reconcileStoreDeals()` — diff against active DB records; insert new, deactivate removed, update changed
   - `recordStoreHistory()` — write to `deal_price_history` (is_deal=1)
   - `autoMapDeals()` — map scraped deals to priority canonical products
   - Update `stores.last_crawled_at`, `crawl_status`
   - Record per-store result in `crawl_store_results`
   - Random 2–5s delay before next store
4. **Pass 1** — fetch non-deal prices for priority canonicals; write to `deal_price_history` (is_deal=0) using `INSERT OR IGNORE` so Pass 2 records take precedence
5. **Purge old history** — delete `deal_price_history` rows older than 180 days
6. **Refresh display order** — `refreshDailyDisplayOrder()`: clears existing order, re-ranks all active in-stock deals using `buildStableDisplayOrder()`
7. **Update `crawl_runs`** record with final stats and any warnings
8. **Release lock**

## Display ordering

`server/services/deal-order.js` — `buildStableDisplayOrder(rows, pageSize, seed, opts)`:
- **Max store ratio**: no more than 25% of any page from a single store
- **Quality floor**: pages 1 & 2 must have ≥ 40% of deals with discount > 25%
- **Deterministic seed**: based on the crawl date, so ordering is stable within a day but rotates daily
- Dookan is excluded from display ordering (products shown in browse/search, not homepage)

## Category mapping

`crawler/utils/category-mapper.js` — `mapCategory(productName)`: keyword-based lookup, first match wins. 15 named categories + "Other".

Categories: Rice & Grains, Flours & Baking, Lentils & Pulses, Spices & Masalas, Oils & Ghee, Sauces & Pastes, Snacks & Sweets, Beverages, Dairy & Paneer, Frozen Foods, Fresh Produce, Noodles & Pasta, Canned & Packaged, Personal Care, Household, Other.

## Price parsing

`crawler/utils/price-parser.js`:
- `parsePrice(value)` — handles both English dot-decimal (`3.29`) and German comma-decimal (`3,29`)
- `calcDiscount(salePrice, originalPrice)` — returns percent as a decimal (0–1 range) or null
- `calcPricePerKg(price, weightValue, weightUnit)` — normalizes to kg; handles g, ml, l, pieces

## Weight parsing

`crawler/utils/weight-parser.js` — extracts weight from product titles. Matches patterns like `500g`, `1kg`, `1.5 kg`, `2x500ml`, `480gm`.

The `gm` (Indian abbreviation) pattern uses `matchAll` and returns the **last** match in the string. This ensures multi-pack titles like `(48pc x 10gm) 480gm` return the total weight (480g) rather than the per-unit weight (10g). Earlier versions used `match()` (first match only), causing phantom `€399/kg` reference prices for bouillon cubes.

## Canonical products & auto-mapping

`crawler/utils/auto-mapper.js`:
- `loadPriorityCanonicals(db)` — loads canonicals where `is_match_priority=1 AND brand_slots IS NOT NULL`. For each canonical, **pre-compiles one `RegExp` per slot group** (brand, base-product, type) by joining all variants with `|`. This avoids per-alias `.includes()` iteration inside `matchesCanonical()`.
- `autoMapDeals(db, deals, canonicals)` — slot-based matching only (no legacy fallback). Computes all matches in memory (pure JS, no DB per deal), then flushes all `INSERT INTO deal_mappings` statements in a **single `db.batch()` call**.
- `matchesCanonical(title, weightValue, weightUnit, canon)` — uses pre-compiled regexes when available (loaded path), falls back to `.some()` iteration for ad-hoc use (tests).

**Slot-based matching:** A deal matches a canonical when every slot group has at least one variant present in the normalised title, and the weight is within ±10% (when both are known and share the same unit). Brand slot is checked first — fails fast when the brand isn't in the title.

**Brand anchor check (added 2026-04-11):** alias matches require the brand token to appear in the deal name. Without this, brand-free aliases incorrectly matched competitor products (Jumbo → Knorr canonical), poisoning reference price history.

`crawler/utils/canonical-decomposer.js`:
- `decomposeCanonical(name, aliases, brands, aliasMap?)` — strips BBD patterns, extracts weight, tokenises, finds brand via alias lookup, builds `brand_slots`, `base_product_slots`, `product_group_id`.
- `buildBrandAliasMap(brands)` — builds a `Map<lowercase_alias → brand>` from the brands array. **Pass this into `decomposeCanonical` as the 4th argument** when calling in a loop (e.g. the remap re-decompose step) — avoids rebuilding the map per canonical. Without this, the inner brand scan is O(tokens × brands × aliases_per_brand); with the map it is O(tokens).

`crawler/utils/pass1-fetcher.js` — for each priority canonical, fetches the current (non-sale) price from the store. Used to compute "Real Savings" — how much you actually save vs. the everyday price, not just vs. an inflated `compare_at_price`.

## Crawl warnings

At the end of each run, `buildCrawlWarnings()` checks:
- `dealsFound === 0` → `zero_deals`
- Success rate < 80% → `low_store_success_rate`
- Deal count dropped > 50% vs previous run → `abnormally_low_deal_count`

Warnings are logged and stored in `crawl_runs.errors`.

## Adapter interface

Each store adapter exports:
```js
module.exports = { storeId, storeName, storeUrl, scrape }
```
`scrape()` is async, returns an array of deal objects. Required fields per deal: `store_id`, `product_name`, `product_category`, `product_url`, `sale_price`. Optional but important: `original_price`, `discount_percent`, `image_url`, `weight_*`, `price_per_kg`, `availability`, `best_before`.

## Adapter types

| Type | Stores | Method |
|---|---|---|
| Shopify JSON | jamoona, namma-markt, and most others | `GET /collections/{handle}/products.json?limit=250` via `shopify-catalog.js` |
| WooCommerce HTML | little-india | Cheerio scraping of product listing pages; pagination via `/page/N/` |
| Typesense API | grocera | Queries public Typesense search index with deal filter |
| Custom | varies | Per-store HTML scraping with multi-selector fallback |

## Scheduling

`crawler/scheduler.js` — runs in local/dev mode only. Uses `node-cron` to trigger at Berlin morning time. In production (Vercel), this module is not loaded — GitHub Actions runs the crawl externally.

## Related pages

- [Stores](stores/) — per-store adapter details
- [Decisions](decisions.md) — why sequential, why GitHub Actions
- [Backend](backend.md) — DB schema for crawl tables
