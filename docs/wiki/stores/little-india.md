---
title: Little India
last_updated: 2026-04-11
source_count: 1
---

Little India (`littleindia.de`) is a WooCommerce store. The adapter uses Cheerio to scrape HTML product listing pages, paginating via `/page/N/` URLs. It uses link discovery to find the promotions category URL dynamically before scraping.

## Adapter details

- **File:** `crawler/stores/little-india.js`
- **Store URL:** `https://www.littleindia.de`
- **Method:** WooCommerce HTML + Cheerio; pagination via `/page/N/`
- **Default base URL:** `https://www.littleindia.de/product-category/promotions/`
- **Link discovery:** Scans the store for URLs matching `/product-category/` or `/produkt-kategorie/` patterns; falls back to the default if none found
- **Max pages:** 5 (configurable via `getMaxPages()`)

## HTML selectors

WooCommerce standard product listing:
- **Products:** `li.product`, `.product-item`, `.nasa-product-grid li`
- **Link/name:** `a.woocommerce-LoopProduct-link`, `h2 a`, `.woocommerce-loop-product__title a`
- **Sale price:** `.price ins .woocommerce-Price-amount` or `.price ins bdi`
- **Original price:** `.price del .woocommerce-Price-amount` or `.price del bdi`
- **Next page:** `a.next.page-numbers`

## Price handling

WooCommerce uses German comma-decimal format (`3,29`). `parsePrice()` handles this correctly. Only products with a sale price (`<ins>`) are included; products without an explicit discount are filtered out unless `original_price > sale_price`.

## Delays

2–4s random delay between page fetches.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| 0 deals | WooCommerce HTML structure changed | Inspect `littleindia.de/product-category/promotions/` and update selectors |
| Wrong prices | WooCommerce format changed or different theme | Check `parsePrice()` handles the observed format |
| Pagination broken | Site changed URL pattern | Update `pageUrl()` function or the `page-numbers` selector |
| Link discovery finds wrong URLs | Site added new category pages | Tighten the pattern regex or update the fallback URL |

## Related pages

- [Crawler](../crawler.md) — WooCommerce adapter type overview
