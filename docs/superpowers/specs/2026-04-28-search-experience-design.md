# Search Experience — Design Spec

**Date:** 2026-04-28
**Branch:** compare-stores
**Status:** APPROVED

---

## Goal

A fast, intuitive search experience where users can find specific Indian grocery products or browse deals by category. Auto-suggest responds instantly as the user types, surfacing products, brands, and categories. Submitting a query returns canonical-level product cards showing the cheapest available price, the store, expiring-soon prices, and a way to explore all store prices.

---

## Key Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Architecture | FTS5 (server) for full search + client-side JSON index for auto-suggest | Auto-suggest needs zero-latency; full search needs accurate ranking. Best of both without new infra. |
| Auto-suggest scope | Products + brands + categories | Three distinct entry points matching how users think about groceries. |
| Auto-suggest index | Lightweight JSON (~200KB gzipped) fetched once, cached client-side | No per-keystroke network round-trip. Instant response. |
| Alias coverage | Suggest index includes aliases (regional names, misspellings, Hindi synonyms) | "Arhar dal" finds Toor Dal. "Basmathi" finds Basmati. Uses existing alias catalog. |
| Full search engine | SQLite FTS5 virtual table over canonicals | No new infra. Handles 14k canonicals comfortably. Swappable for Meilisearch if scale demands. |
| Search result unit | Canonical (one card per product) | Avoids duplicate cards for same product across stores. Cheapest price surfaced per card. |
| Cheapest price shown | Lowest `sale_price` across active deals with no BBD info | BBD products shown separately as "expiring soon" — they're cheaper but not comparable. |
| Expiring soon | Shown on card as a secondary price block, clearly flagged with BBD date | Useful signal, never hidden, but not the headline price. |
| Default sort | Relevance (FTS5 BM25 + coverage boost) | Most intuitive starting point. |
| Sort options | Relevance / Cheapest / Biggest discount / Most stores | User chooses priority. |
| Filters | Category, brand, store | Refine results without a new search. |
| FTS5 index rebuild | End of every Mode 1 (daily) and Mode 2 (weekly) crawl | Always reflects latest canonical data. |
| Suggest index rebuild | Same trigger as FTS5 — generated post-crawl, served as static JSON | Single endpoint, cached by browser. |

---

## Architecture

```
User types               → Client-side suggest index (JSON, loaded once)
                            → Instant suggestions: products, brands, categories

User submits query       → GET /api/v1/search?q=<term>&sort=<sort>&filters=<filters>
                            → Server: FTS5 query → canonical_ids
                            → JOIN deals for cheapest price + BBD prices per canonical
                            → Return ranked product cards

User clicks category     → Pre-filtered search results for that category
User clicks brand        → Pre-filtered search results for that brand
User clicks product      → Canonical product page (all store prices)
```

---

## Client-Side Suggest Index

### Endpoint

```
GET /api/v1/search/suggest-index
Response: gzipped JSON, Cache-Control: max-age=3600
```

Fetched once on first page load (or first focus on search input). Cached by browser for 1 hour. Regenerated server-side after each crawl.

### Index Format

```json
{
  "products": [
    {
      "id": "trs-toor-dal-500g",
      "name": "TRS Toor Dal",
      "aliases": ["toor dal", "arhar dal", "tuvar dal", "toor daal"],
      "category": "Lentils & Dal",
      "brand": "TRS",
      "img": "https://..."
    }
  ],
  "brands": [
    { "name": "TRS", "count": 45 },
    { "name": "Aashirvaad", "count": 23 }
  ],
  "categories": [
    { "name": "Lentils & Dal", "count": 120 },
    { "name": "Rice & Grains", "count": 95 }
  ]
}
```

Products: all canonicals with at least one active deal.
Brands: deduplicated from `brand_slots` across all active canonicals, sorted by product count.
Categories: all active categories sorted by product count.
Aliases: pulled from `canonical_products.base_product_slots` + existing alias catalog.

### Client-Side Matching

On each keystroke (debounced 80ms):

1. Lowercase and tokenise query
2. Score each product: exact name match → 100, name starts with query → 90, alias match → 80, token overlap → 60
3. Score each brand: starts with query → 90, contains query → 70
4. Score each category: starts with query → 90, contains query → 70
5. Return top 5 products, top 3 brands, top 3 categories (if score > 0)

### Auto-Suggest UI

Dropdown below search input, grouped into three sections:

```
┌─────────────────────────────────────────┐
│ 🔍 toor dal                             │
├─────────────────────────────────────────┤
│ PRODUCTS                                │
│ [img] TRS Toor Dal          €3.49/kg ▸  │
│ [img] East End Toor Dal     €3.80/kg ▸  │
│ [img] Heera Toor Dal        €4.10/kg ▸  │
├─────────────────────────────────────────┤
│ BRANDS                                  │
│ TRS  →                                  │
│ East End  →                             │
├─────────────────────────────────────────┤
│ CATEGORIES                              │
│ Lentils & Dal  →                        │
└─────────────────────────────────────────┘
```

- Keyboard navigable (↑ ↓ Enter Escape)
- Product rows show thumbnail + name + cheapest price (from suggest index, pre-computed at index build time)
- Brand / category rows open a filtered search results page
- Clicking a product row goes directly to the canonical product page

---

## Full Search (FTS5)

### FTS5 Virtual Table

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS fts_canonicals USING fts5(
  canonical_id,
  canonical_name,
  base_key,
  aliases_text,   -- space-separated aliases flattened from base_product_slots + catalog
  category,
  brands_text     -- space-separated brand names
);
```

Rebuilt after each Mode 1 / Mode 2 crawl:

```sql
DELETE FROM fts_canonicals;
INSERT INTO fts_canonicals (canonical_id, canonical_name, base_key, aliases_text, category, brands_text)
SELECT
  cp.id,
  cp.canonical_name,
  cp.base_key,
  cp.aliases_text,  -- pre-flattened column or generated at insert time
  cp.category,
  cp.brands_text
FROM canonical_products cp
WHERE EXISTS (
  SELECT 1 FROM deals d WHERE d.canonical_id = cp.id AND d.is_active = 1
);
```

### Search Query

```sql
SELECT
  cp.id,
  cp.canonical_name,
  cp.category,
  cp.image_url,
  fts_canonicals.rank,
  COUNT(DISTINCT d.store_id) AS store_count
FROM fts_canonicals
JOIN canonical_products cp ON cp.id = fts_canonicals.canonical_id
JOIN deals d ON d.canonical_id = cp.id AND d.is_active = 1
WHERE fts_canonicals MATCH ?        -- FTS5 query
GROUP BY cp.id
ORDER BY <sort>
LIMIT 40;
```

Cheapest price and BBD prices fetched in a second query for the returned canonical_ids (avoids inflating GROUP BY).

### Ranking

**Default (relevance):**
```
score = fts5_bm25_rank + (store_count * 0.1)
```
Coverage boost ensures products available at more stores surface higher when relevance is equal.

**Sort options:**

| Option | ORDER BY |
|---|---|
| Relevance (default) | score DESC |
| Cheapest | min_sale_price ASC |
| Biggest discount | max_discount_percent DESC |
| Most stores | store_count DESC |

### Filters

Applied as WHERE clauses on the search query:

| Filter | Column |
|---|---|
| Category | `cp.category = ?` |
| Brand | `cp.brand_slots LIKE '%"brand"%'` |
| Store | `d.store_id = ?` |

---

## Search Result Card

One card per canonical product:

```
┌──────────────────────────────────────────────────┐
│ [img]  TRS Toor Dal 5kg                          │
│        Lentils & Dal                             │
│                                                  │
│  Cheapest: €14.99  at Dookan          [+ Cart]  │
│  €2.99/kg                                        │
│                                                  │
│  ⏰ Expiring soon: €11.50 at Swadesh             │
│     Best before: June 2026                       │
│                                                  │
│  Available at 6 stores  [Compare prices →]       │
└──────────────────────────────────────────────────┘
```

**Cheapest price block:**
- `MIN(sale_price)` across active deals where `best_before IS NULL OR best_before > now + 60 days`
- Store name linked to the product page at that store
- Price per kg shown below

**Expiring soon block** (shown only if exists):
- `MIN(sale_price)` across active deals where `best_before IS NOT NULL AND best_before <= now + 60 days`
- BBD date shown
- Visually distinct (muted, amber icon) — clearly not the headline price

**"Compare prices" link:**
- Opens a drawer or navigates to the canonical product page showing all store prices ranked cheapest first

**[+ Cart] button:**
- Adds this canonical to the shopping list (brand-specific, at the weight of the cheapest deal)
- If anonymous: saves to localStorage
- If logged in: saves to server-side shopping list + triggers on-demand crawl

---

## Data Flow: Index Rebuild

After each Mode 1 / Mode 2 crawl completes:

```
1. Rebuild fts_canonicals (DELETE + INSERT)
2. Generate suggest-index JSON:
   a. Query all active canonicals with brand, category, aliases, cheapest price
   b. Aggregate brands and categories with counts
   c. Gzip and write to static file or in-memory cache
   d. Invalidate browser cache (bump cache-busting query param on next page load)
3. Log: "Search index rebuilt: X canonicals, Y brands, Z categories"
```

---

## Out of Scope (this spec)

- Voice search
- Image search ("find this product")
- Personalised ranking based on user purchase history
- Search analytics / popular searches
- Meilisearch migration (future — drop-in if FTS5 proves insufficient)
- Saved searches
