---
title: Grocera
last_updated: 2026-04-11
source_count: 1
---

Grocera (`grocera.de`) is a German online grocery store. Unlike other adapters which use Shopify or HTML scraping, Grocera's adapter queries a **public Typesense search index** directly. This is the most unusual adapter in the fleet and returns a good volume of deals when the `deal` tag filter is active.

## Adapter details

- **File:** `crawler/stores/grocera.js`
- **Store URL:** `https://grocera.de`
- **Method:** Typesense REST API (public search key)
- **Typesense host:** `3uovdibf50nlxkrtp-1.a1.typesense.net`
- **Collection:** `prod-products-new`
- **API key:** `4gpobkq7OLuOLEvRpMVL2u1aR3BLeCUZ` (public, embedded in store's frontend JS)
- **Page size:** 250 results per page; paginates automatically

## Deal filtering

**Default mode:** filters `tags.en:=[deal] && inventory.hidden:=false` — only products tagged `deal`.

**Full catalog mode** (`isFullCatalogEnabled()`): filters `inventory.hidden:=false` — fetches all visible products. Useful for price history and canonical mapping.

## Product name construction

`brand + name.en + size` joined with spaces. If any part is empty it's omitted.

## Price handling

Prices come from Typesense document fields:
- `price.deals.single.gross` → sale price (preferred)
- `price.gross` → fallback sale price
- `price.deals.single.gross_before` → original price
- `price.deals.single.percentage` → discount percentage (string, parsed as float)

## Best-before dates

For products tagged `soon-exp-deal`, the `timestamp.expires_at` Unix timestamp is converted to a `YYYY-MM` string and stored as `best_before`.

## Known quirks

- The Typesense API key is public (extracted from the store's own frontend JavaScript) — it's a read-only search key, not an admin key
- The Typesense collection name (`prod-products-new`) could change during a reindex — if it does, requests will 404
- Image URLs come from a `images` array; takes the first entry's `url` or `thumbnail_url`

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `Typesense HTTP 401` | API key rotated | Extract new key from `grocera.de/static/js/search/typesense.js` |
| `Typesense HTTP 404` | Collection renamed | Find new collection name from store's network requests |
| 0 deals | `deal` tag not applied to products | Try full catalog mode to verify store is reachable |
| Low deal count | Grocera has few tagged deals that day | Normal — their deal tagging is inconsistent |

## Related pages

- [Crawler](../crawler.md) — adapter interface
- [Overview](../overview.md) — known issue: Cheerio approach replaced by Typesense
