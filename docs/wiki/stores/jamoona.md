---
title: Jamoona
last_updated: 2026-04-11
source_count: 1
---

Jamoona is a Shopify store targeting the German desi grocery market. The adapter uses the Shopify undocumented JSON API to fetch products from curated deal collections. It is one of the most reliable adapters in the fleet.

## Adapter details

- **File:** `crawler/stores/jamoona.js`
- **Store URL:** `https://www.jamoona.com`
- **Method:** Shopify JSON API (`/collections/{handle}/products.json?limit=250`)
- **Collections crawled:** `weekly-deals`, `value-deals`, `save-food`
- **Collection resolution:** `resolveCollectionHandles()` from `crawler/utils/shopify-catalog.js` — verifies each handle exists before fetching; falls back gracefully if a collection is missing

## Price handling

- `sale_price` from `variant.price` (dot-decimal, English format)
- `original_price` from `variant.compare_at_price`; only set if strictly greater than sale price
- `discount_percent` computed via `calcDiscount()`

## Known quirks

- Deduplicates across collections by Shopify product ID (not URL) — a product in both `weekly-deals` and `value-deals` is counted once
- 1-second polite delay between collection fetches
- Image URLs have query strings stripped (`?v=...` removed)
- Availability from `variant.available` boolean

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| 0 deals | All 3 collections empty or renamed | Check `jamoona.com/collections/` for current sale handle names; update `COLLECTIONS` array |
| Fetch error | Shopify rate limit or IP block | Wait and retry; add a new User-Agent string if blocked |
| Wrong prices | Shopify changed price format | Check `parsePrice()` in `price-parser.js` |

## Related pages

- [Crawler](../crawler.md) — Shopify adapter pattern
- [Decisions](../decisions.md) — price parsing dual-format decision
