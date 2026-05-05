# Wiki Log

Append-only. One entry per ingest, auto-update, lint, or notable query.
Parseable: `grep "^## \[" docs/wiki/log.md | tail -10`

---

## [2026-04-13] auto-update | Brand management, admin panel remap, perf optimisations
Pages touched: backend.md, crawler.md, frontend.md, decisions.md
Sources: server/routes/admin-dashboard.js, crawler/utils/auto-mapper.js, crawler/utils/canonical-decomposer.js, client/src/landing/AdminPage.jsx, client/src/pages/DealsPage.jsx, client/src/utils/api.js, server/db/schema.sql

---

## [2026-04-17] auto-update | OpenAI batch processing for pending canonical queue
Pages touched: crawler.md
Sources: scripts/process-pending-queue-openai-batch.js, package.json

---

## [2026-04-17] auto-update | Cleanup pass for OpenAI pending-queue batch output
Pages touched: crawler.md
Sources: scripts/cleanup-pending-queue-batch-output.js, package.json

---

## [2026-04-17] auto-update | Pruned obvious junk from pending-queue review output
Pages touched: crawler.md
Sources: scripts/prune-pending-queue-review-junk.js, package.json

---

## [2026-04-19] update | Fake-deal detection, price/L for liquids, replacement modal improvements

Pages touched: backend.md, frontend.md, crawler.md, compare-stores.md
Sources: server/routes/deals.js, crawler/utils/price-parser.js, client/src/utils/formatters.js, client/src/utils/share.js, client/src/pages/DealSharePage.jsx, client/src/pages/DealsPage.jsx, scripts/backfill-price-per-litre.js

**Changes recorded:**

- `FAKE_DEAL_THRESHOLD_PP = 10` in `server/routes/deals.js` — single source of truth for fake deal classification. `is_fake_deal` boolean now attached to every deal row in all API responses.
- `calcPricePerKg` fixed for liquid units: `ml` → price/litre, `l` → price/litre. Previously returned null. `price_per_kg` DB field stores price/L for liquids; `weight_unit` distinguishes at display time.
- `formatPricePerKg(ppkg, weightUnit)` — now accepts `weightUnit`; shows `/L` for ml/l, `/kg` otherwise. All call sites updated.
- `DealSharePage`: amber warning banner for fake deals, conditional WhatsApp share text (exposes gap vs genuine copy), secondary CTA ("See more inflated deals →" or "See more genuine deals →").
- `DealsPage` WA share branches on `deal.is_fake_deal` (removed hardcoded 10pp threshold).
- Replacement modal: kg-saving % badge shows vs source deal price/kg (not store's claimed discount); hidden for T4 category tier; T4 always rendered last (after "Same Product, Other Stores").
- `scripts/backfill-price-per-litre.js` — one-off backfill for existing liquid deals. Supports `--turso` for prod. ⚠️ Must be run against Turso on merge: `node scripts/backfill-price-per-litre.js --turso`.
- Discovery: `server/db` connects to Turso when `DESI_DEALS_DB_TURSO_DATABASE_URL` is in env — localhost dev runs against Turso, not local SQLite.

---

## [2026-04-17] auto-update | Final refinement pass for pending-queue manual review
Pages touched: crawler.md
Sources: scripts/refine-pending-queue-manual-review.js, package.json

---

## [2026-04-11] auto-update | Real Savings bug investigation + three-bug fix
Pages touched: crawler.md, decisions.md
Sources: server/services/real-savings.js, server/services/price-history-recorder.js, crawler/utils/weight-parser.js, crawler/utils/auto-mapper.js, crawler/index.js, Turso production DB query

---

## [2026-04-21] update | base_key column, cross-store SQL join, category guard, snack phrase fix

Pages touched: backend.md, crawl-pipeline.md
Sources: server/routes/deals.js, server/services/product-replacements.js, crawler/utils/category-mapper.js, server/db/schema.sql, server/db/index.js, data/prod_local.db

**Changes recorded:**

- `canonical_products.base_key TEXT` — new column stores resolved catalog base product key (`resolveBaseProduct(canonical_name)?.base_key`). Populated at write time by canonicalizer, admin-review-queue, and brand remap. Indexed (`idx_canonical_base_key`). Backfilled 3,003 of 14,598 rows in prod_local.db. Added to `alwaysMigrations` so Turso picks it up on next deploy.
- `product-replacements.js` T2: extended with `base_key` fallback alongside exact slot match. Handles Hindi/English terminology divergence (e.g. "Mung Sabut Whole" and "TRS Mung Beans" both resolve to `"moong dal yellow"` and now surface as T2 same-spec within a store).
- `same-product-other-stores` route: replaced 14k-row JS scan with SQL `JOIN canonical_products ON cp.base_key = ? AND cp.category = ?`. Category guard prevents cross-category false positives (fried snack vs raw lentil). Falls back to exact `canonical_id` match when `base_key` is null.
- `category-mapper.js` `SNACK_PHRASES`: pre-check for `"moong dal masala"`, `"moong dal plain"`, `"mung dal masala"`, `"mung dal plain"` before lentil keyword matching. Prevents Haldiram fried snacks from landing in "Lentils & Pulses".
- `prod_local.db` canonical categories fixed: Haldiram Moong/Mung Dal Masala/Plain canonicals recategorized to "Snacks & Sweets". Non-standard category names normalised (Snacks & Namkeen → Snacks & Sweets). False positives (condensed milk, sweet potato, drinks) reverted to correct categories.

---

## [2026-04-20] update | Weight parser multi-pack fixes, DB canonicalization cleanup, prod_local.db prep

Pages touched: crawler.md, backend.md, index.md, crawl-pipeline.md
Sources: crawler/utils/weight-parser.js, scripts/promote-bootstrap-staging.js, data/prod_local.db

**Changes recorded:**

- `weight-parser.js` fix 1: `N x Munit` pattern was returning per-unit weight (multiplier ignored). Now returns `N × M` total. `isMultiPack: true` flag prevents double-multiplication.
- `weight-parser.js` fix 2: New `packMultiplier()` detects `(N Pack)` / `Pack of N` patterns and multiplies against extracted unit weight. Backfilled 1,760 + 51 deals and 2,299 + 31 `deal_price_history` rows.
- `prod_local.db` canonicalization state fixed: 119 bootstrap staging rows approved and promoted (→ 14,598 total canonicals); `is_match_priority` was 0 for all — set to 1 for 12,443 canonicals with `brand_slots`; 25 active drift cases resolved; 22 unmapped active deals queued in `entity_resolution_queue`.
- `crawl-pipeline.md` T3 tier description corrected: was "subset slot match", now reflects actual same-brand + product-group logic (commit 358217e).
- `crawl-pipeline.md` added to wiki index.
- `docs/knowledge/` HTML files added: `dd24_overview.html` (project knowledge hub) and updated `dd24_db_explorer.html` (30-table schema).
- DealSharePage CTA restructured for fake vs genuine deal branching; real savings sort ungated; low-rating badge green styling; badge subtext contrast; mobile header button hidden.

---

## [2026-04-21] update | base_key propagation fixes, T2 category guard, deal category drift repair

Pages touched: crawl-pipeline.md, backend.md
Sources: scripts/promote-bootstrap-staging.js, scripts/seed-priority-canonicals.js, server/services/product-replacements.js, data/prod_local.db

**Changes recorded:**

- `scripts/promote-bootstrap-staging.js`: INSERT into `canonical_products` now sets `base_key` via `resolveBaseProduct(canonical_name)?.base_key`. Previously omitted — every batch promotion created base_key-null rows, silently breaking cross-store expansion for all bootstrap-promoted products.
- `scripts/seed-priority-canonicals.js`: same fix — `base_key` added to INSERT and to `ON CONFLICT DO UPDATE SET` so re-runs refresh the value.
- `server/services/product-replacements.js` T2 `base_key` fallback: added `sameCategory` guard. Exact `base_product_slots` match branch unchanged. Only the catalog-level `base_key` equality branch (which can span naming conventions) now requires categories to agree — prevents same-store cross-category false positives (e.g. fried dal snack matched as replacement for raw lentils).
- `data/prod_local.db`: 18,507 deal rows synced — `deals.product_category` updated to match `canonical_products.category`. Active drift: 0.

---

## [2026-04-24] update | Product replacement bug fixes — sort, T2 brand guard, T4 gating, fake-deal filter, fresh-produce guard

Pages touched: compare-stores.md
Sources: server/services/product-replacements.js, server/routes/deals.js, server/services/base-product-catalog.js, tests/integration/product-replacements.test.js, scripts/fix-fresh-produce-base-keys.js, data/prod_local.db

**Changes recorded:**

- `product-replacements.js` sort: T2/T3/T4 changed from discount% descending to `byValueAsc` (price_per_kg ascending, fallback sale_price ascending). Best value appears first.
- `product-replacements.js` T4 gating removed: T4 now always emits alongside T1–T3, not only as last resort.
- `product-replacements.js` T2 brand guard: `isSameBrandT2` check prevents same-brand items leaking into the cross-brand T2 tier.
- `product-replacements.js` fake-deal SQL filter: arithmetic discount guard in `ACTIVE_DEALS_WITH_CANONICAL_SQL`; null/zero pass-throughs protect deals without original_price.
- `product-replacements.js` T4 size gate removed: `sizeCompatible()` no longer applied to T4.
- `base-product-catalog.js` fresh produce guard: `resolveBaseProduct()` returns null for names starting with "Fresh " — prevents fresh veg from inheriting spice/lentil base_keys.
- `server/routes/deals.js` `/same-product-other-stores`: sort changed from `sale_price ASC` to `price_per_kg ASC NULLS LAST, sale_price ASC`; same arithmetic fake-deal filter added to both query branches.
- `data/prod_local.db`: 23 Fresh Produce canonicals had `base_key` cleared via `scripts/fix-fresh-produce-base-keys.js`.
- `tests/integration/product-replacements.test.js`: new file — 4 tests covering T2 sort, T4 larger packs, T2 brand guard, and fake-deal filter.

---

## [2026-04-11] bootstrap | Initial wiki created from codebase sources
Pages touched: WIKI.md, index.md, overview.md, backend.md, frontend.md, crawler.md, decisions.md, stores/jamoona.md, stores/dookan.md, stores/grocera.md, stores/little-india.md, stores/namma-markt.md
Sources: CLAUDE.md, docs/crisp-architecture.md, server/index.js, server/db/schema.sql, crawler/index.js, crawler/utils/category-mapper.js, client/src/App.jsx, client/src/hooks/useDeals.js, client/src/utils/api.js, crawler/stores/*.js (5 stores)

---

## [2026-05-03] update | Platform v1 wiki — routes, recommender, sub-variant filter, brand-stripping fix, weight badge

Pages touched: backend.md, frontend.md
Sources: server/index.js, server/routes/catalog.js, server/routes/lists.js, server/routes/recommend.js, server/routes/compare.js, server/routes/orders.js, server/services/recommender.js, server/services/smart-ranker.js, client/src/App.jsx, client/src/hooks/useCart.js, client/src/hooks/CartContext.js, client/src/utils/api.js, client/src/components/comparison/StoreComparisonCard.jsx, client/src/components/ProductCard.jsx

**Changes recorded:**

- `backend.md`: Added Platform v1 API routes — `/api/v1/catalog` (paginated canonical product catalog + suggest + brands), `/api/v1/lists` (CRUD + items), `/api/v1/lists/:id/recommend` (recommender), `/api/v1/lists/:id/cart-transfer`, `/api/v1/lists/:id/replacement-search`, `/api/v1/compare/cart`, `/api/v1/orders`. Fixed stale table names: `deals` → `store_products`, `deal_mappings` → `store_product_mappings`, `deal_price_history` → `price_history`. Expanded `canonical_products` description. Added full Recommender service section: two-path matching (Path 1 brand-stripping for any-brand items, Path 2 brand-aware), combination engine with `applySubVariantPreference`, `SUB_VARIANT_KEYWORDS`, smart-ranker weights, response shape.
- `frontend.md`: Updated routing table with `/cart` (CartPage), `/products` (CatalogPage), `/compare/:id` (ComparePage), `/orders` (OrdersPage), `/list` redirect, `/list/:id/compare` redirect. Added Cart section: `useCart` hook, `CartContext`, cart item shape, weight display rule. Updated API client section with Platform v1 functions: `fetchCatalog`, `fetchCatalogSuggest`, `fetchLists`, `createList`, `fetchList`, `addListItem`, `mergeCartIntoList`, `runComparison`, `fetchOrders`. Added `StoreComparisonCard` section (weight badge, coverage bar, missing banner). Added `ProductCard` section (brand extraction, any-brand mode, image proxy).
- **Bug fixes documented:** (1) Brand-stripping fix: any-brand items strip brand token from `raw_item_text` before text search — prevents brand triple-counting in smart-ranker (MDH Amchur Powder was scoring MDH Karahi Gosht Masala at 0.571; drops to 0.075 after fix). (2) Sub-variant filtering: `applySubVariantPreference` post-filters base pool by keywords extracted from cart item text — "Extra Long Basmati Rice" no longer matches "Everyday" variant. (3) Weight badge: shows total weight (value × packs), normalized g→kg / ml→l.

---

## [2026-05-03] update | Orders History — full lifecycle backend + frontend

Pages touched: backend.md, frontend.md
Sources: server/routes/orders.js, server/middleware/user-auth.js, server/utils/jwt.js, server/db/schema.sql (alwaysMigrations), client/src/pages/OrdersPage.jsx, client/src/utils/api.js, tests/integration/orders.test.js

**Changes recorded:**

- `backend.md`: Expanded orders routes — added 5 missing endpoints (PATCH /handoff, PATCH /confirm, DELETE /:id, PATCH /rating, PATCH /status). Expanded `shopping_lists` description with 7 lifecycle columns added via `alwaysMigrations` (order_status, savings_eur, total_eur, rating, eta_date, issue_text, tracking_url). Clarified Auth section: split `auth.js` (admin ADMIN_SECRET) from `user-auth.js` (user JWT, HS256, `type:"access"` required); documented `server/utils/jwt.js` signJwt/verifyJwt.
- `frontend.md`: Added 4 order API functions (handoffOrder, confirmOrder, cancelOrder, rateOrder) with notes on Infinity-clamp gotcha. Added full `OrdersPage` section: shared atoms (StoreLogo, StatusPill, Stars, SavingsSparkline, formatters), Dir2 mobile timeline components (D2Order, D2Footer, recap strip, grouping), Dir4 desktop two-pane components (D4Row, D4Detail, dashboard, CSV export), optimistic handler pattern.

---

## [2026-05-04] auto-update | Search/Filters/Sort parity, ProductCard weight badge, catalog sort param

Pages touched: frontend.md, backend.md
Sources: client/src/components/SortDropdown.jsx, client/src/components/FiltersModal.jsx, client/src/components/SearchWithSuggest.jsx, client/src/components/ProductCard.jsx, client/src/pages/CatalogPage.jsx, client/src/pages/DealsPage.jsx, server/routes/catalog.js, docs/superpowers/plans/2026-05-03-search-filters-sort-parity.md

**Changes recorded:**

- `frontend.md`: Removed `/saved` route + `SavedDealsPage` (commit 81b0b57). Added "Shared search / filters / sort (search-parity)" section documenting `SortDropdown` (default + `SORT_OPTIONS`), `FiltersModal` (default + `CATEGORIES`, auth-gated apply with sessionStorage draft preservation across OAuth), `SearchWithSuggest` (debounced typeahead, keyboard nav, `controlRef` guards from commits 407d7af / cb882c0 / 6c29aaa). Noted `DealsPage` mounts `SearchWithSuggest` twice (mobile + desktop toolbar zones). Updated `ProductCard` section: weight/pack-size badge now `[weight_raw, formatPricePerKg(price_per_kg, weight_unit)].filter(Boolean).join(" | ")`, mirrors `DealsPage` deal-card pattern (e.g. `62g | 0.32 €/kg`).
- `backend.md`: `/api/v1/catalog` row updated — added `sort` param (`price` default, `price_per_kg`, `discount`, `real_savings`); `store` filter now case-insensitive via `JOIN stores ... ON lower(s.name) = lower(?)`.
- **Bug fixes documented:** ProductCard previously rendered only `formatPricePerKg(price_per_kg)` — `weight_raw` was dropped, so cards in the "All Products" view showed `€/kg` only or nothing when `price_per_kg` was null. Fixed by mirroring the DealsPage composition; `weight_raw` like `"62g"` now always shown alongside per-kg/L price when both available.
