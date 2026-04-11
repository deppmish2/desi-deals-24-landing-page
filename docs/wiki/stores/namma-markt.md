---
title: Namma Markt
last_updated: 2026-04-11
source_count: 1
---

Namma Markt (`nammamarkt.com`) is a Shopify store. The adapter follows the standard Shopify JSON API pattern, fetching from a single `on-sale` collection. It is the simplest of the Shopify adapters.

## Adapter details

- **File:** `crawler/stores/namma-markt.js`
- **Store URL:** `https://www.nammamarkt.com`
- **Method:** Shopify JSON API (`/collections/{handle}/products.json?limit=250`)
- **Collections:** `on-sale` (single collection)
- **Collection resolution:** `resolveCollectionHandles()` verifies the handle exists

## Price handling

Standard Shopify pattern: `variant.price` (sale) and `variant.compare_at_price` (original). English dot-decimal format.

## Deduplication

No cross-collection deduplication needed (single collection). Products are included if `mapProduct()` returns non-null (requires valid sale price).

## Delays

1–2s random delay after each collection fetch.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| 0 deals | `on-sale` collection empty or renamed | Check `nammamarkt.com/collections/` for current sale handle; update `COLLECTIONS` array |
| Fetch error | Shopify rate limit | Wait and retry |

## Related pages

- [Jamoona](jamoona.md) — same Shopify pattern (more complex version)
- [Crawler](../crawler.md) — Shopify adapter type overview
