---
title: Dookan
last_updated: 2026-04-11
source_count: 1
---

Dookan is a Shopify store (`eu.dookan.com`) focused on South Asian groceries for the European market. The adapter uses a curated list of known sale collection handles with dynamic discovery as a fallback. Dookan is intentionally **excluded from homepage display ordering** — its products appear only in browse/search results.

## Adapter details

- **File:** `crawler/stores/dookan.js`
- **Store URL:** `https://eu.dookan.com`
- **Method:** Shopify JSON API (`/collections/{handle}/products.json?limit=250`)
- **Primary handles** (in order of reliability):
  - `essential-deals`, `1-euro-sale`, `5-euro-sale`, `bundle-offers`, `super-deals`, `daawat-hot-deals`, `stock-clearance`, `lowest-offer-price`
- **Fallback handles:** `sale`, `angebote`, `offers`, `deals`, `on-sale`, `outlet`

## Price handling

Standard Shopify pattern: `variant.price` (sale) and `variant.compare_at_price` (original).

## Title cleaning

Dookan appends `- Sale Item [BBD: DD Month YYYY]` to stock-clearance product titles. The adapter strips this suffix via `BBD_RE` regex before storing the product name. The best-before date is extracted first via `parseBestBefore()` and stored in `best_before`.

## Full catalog mode

Supports `isFullCatalogEnabled()` (`crawler/utils/crawl-scope.js`) — when enabled, includes discovered collections beyond the hardcoded list. Used for data analysis, not standard crawls.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| 0 deals, warning logged | All primary handles missing | Check `eu.dookan.com/collections.json` for current sale handles; update `SALE_HANDLES` |
| Partial results | Some handles 404'd | Normal — collections go in/out of stock; fallbacks kick in |
| `[dookan] No deals found` console warning | None of primary or fallback handles exist | Requires manual handle update |

## Why excluded from display order

Dookan's product mix and discount structure differs from other stores — its items are better suited for browse/search discovery than the curated homepage deal feed. Exclusion is set in `crawler/index.js` via `EXCLUDED_DISPLAY_STORE_IDS_SQL = "'dookan'"`.

## Related pages

- [Crawler](../crawler.md) — Shopify adapter pattern, display ordering
- [Decisions](../decisions.md) — Dookan exclusion decision
