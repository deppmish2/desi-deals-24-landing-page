---
title: Architecture Decisions
last_updated: 2026-04-11
source_count: 2
---

Key decisions made in the DesiDeals24 codebase — the what, why, and trade-offs. Update this page when a significant architectural choice is made or reversed.

---

## CommonJS throughout server/crawler

**Decision:** All server and crawler code uses `require()`/`module.exports`. No ESM in the backend.

**Why:** `node-fetch` v2 (the required version) is CommonJS-only. v3 is ESM-only and would require restructuring the entire backend. The consistency constraint (CommonJS everywhere in backend) was explicitly documented to prevent accidental ESM imports that cause runtime errors.

**Trade-off:** Frontend is ESM (React/Vite). The two worlds are separate — frontend uses `import/export`, backend uses `require`.

---

## Turso (libSQL) as the database

**Decision:** Production uses Turso (a libSQL-compatible cloud DB), not local SQLite.

**Why:** Vercel serverless functions are stateless — local SQLite files are not persistent between invocations. Turso provides a persistent SQLite-compatible DB with edge replicas and a free tier suitable for this scale.

**Trade-off:** Local dev uses `better-sqlite3` (synchronous); production uses the Turso async client. The `db.ready` promise pattern bridges this difference. Never `await` a `better-sqlite3` call — it's synchronous. Always `await` Turso calls.

---

## GitHub Actions for crawl scheduling (not Vercel Cron)

**Decision:** The daily crawl is triggered by GitHub Actions, not Vercel Cron.

**Why:** Vercel functions have a 60-second execution limit. A full crawl across 32 stores (with 2–5s delays) takes ~3–5 minutes — well over the limit. GitHub Actions runners have no such constraint.

**Trade-off:** Creates an operational blind spot — if GitHub Actions is disabled or hits quota, crawls silently stop. The proposed fix (from `crisp-architecture.md`) is a health endpoint + UptimeRobot monitor checking `last_successful_crawl_at`.

---

## Sequential crawl (not parallel)

**Decision:** Store adapters run one at a time, in order, with a 2–5s random delay between them.

**Why:** Politeness — avoids hammering stores simultaneously. Also simplicity: sequential crawls are easier to reason about and debug than parallel ones with partial failures.

**Trade-off:** Crawl takes ~3–5 minutes total. Parallel crawling with `p-limit` (mentioned in `crisp-architecture.md` §8.1) could reduce this to ~30s but adds complexity.

---

## No ORM

**Decision:** All DB queries are raw SQL via `db.prepare()`. No Prisma, Sequelize, or similar.

**Why:** better-sqlite3 is synchronous and lightweight. The query patterns are specific enough (dynamic filter building in `server/routes/deals.js`) that an ORM would add complexity without benefit.

---

## Two-pass crawler (Real Savings feature)

**Decision:** The crawler runs in two passes. Pass 2 fetches on-sale products (the main crawl). Pass 1 fetches the non-sale (everyday) price for priority canonical products.

**Why:** Store-reported discounts are often inflated — the `compare_at_price` can be an artificial reference price. The Real Savings rating compares the current sale price against the product's own historical non-sale price, giving a more honest discount signal.

**Trade-off:** Pass 1 adds extra requests per crawl run. Only priority canonicals (tagged `is_priority=1`) are fetched in Pass 1 — this keeps the overhead bounded.

**Real Savings computation** (`server/services/real-savings.js`):
- **Layer 1** (preferred): median `price_per_kg` from `deal_price_history` rows where `is_deal=0` (Pass 1 non-deal prices), joined via `deal_mappings → canonical_products`. `realSavings = (refPpk − dealPpk) / refPpk × 100`.
- **Layer 2** (fallback): `(original_price − sale_price) / original_price × 100` from the store-reported `compare_at_price`.
- Ratings: ≥ 25% → "great", ≥ 15% → "good", ≥ 5% → "low", < 5% → null.

**`is_deal` flag in `deal_price_history`:** Pass 2 records use `is_deal=1`; Pass 1 records use `is_deal=0`. The `recordStoreHistory()` function accepts a `defaultIsDeal` option (default `0`); the Pass-2 crawl call passes `defaultIsDeal: 1` so deal-collection products without `compare_at_price` are not mistakenly treated as reference prices.

**Known past bugs fixed 2026-04-11:**
1. Weight parser matched first `gm` occurrence (per-unit) instead of last (total) in multi-pack titles → inflated `price_per_kg` poisoned reference history
2. Auto-mapper alias without brand matched wrong-brand products → cross-contaminated canonical reference prices
3. `recordStoreHistory` defaulted `is_deal=0` for Pass-2 products lacking `compare_at_price` → deal prices leaked into the reference price pool

---

## Price parsing: dual format support

**Decision:** `parsePrice()` handles both `3.29` (English dot-decimal, from Shopify) and `3,29` (German comma-decimal, from WooCommerce/custom sites). This logic must not be simplified.

**Why:** German stores use comma as decimal separator. Shopify returns English format. Both appear in the codebase. Stripping the dual-format logic would silently break German-format price parsing.

---

## Dookan excluded from display ordering

**Decision:** Dookan (`store_id = 'dookan'`) is excluded from the homepage `display_order` ranking.

**Why:** Dookan's products appear in browse/search but not in the curated homepage deal feed. The exclusion is hardcoded in `crawler/index.js` via `EXCLUDED_DISPLAY_STORE_IDS_SQL`.

---

## Canonical products for entity resolution

**Decision:** A `canonical_products` table maps real-world products to a canonical identity. Deal rows reference canonicals via `deal_mappings`.

**Why:** The same product (e.g., "Aashirvaad Atta 5kg") appears under slightly different names across stores. Canonicals enable price comparison across stores, the Real Savings feature, and future features like price alerts per product.

**Status:** The entity resolution system is scaffolded (tables exist, auto-mapper runs). Full resolution with admin review UI is a future epic.

---

## Related pages

- [Overview](overview.md) — project summary and constraints
- [Backend](backend.md) — DB schema
- [Crawler](crawler.md) — crawl pipeline details
