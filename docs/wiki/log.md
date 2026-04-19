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

## [2026-04-11] bootstrap | Initial wiki created from codebase sources
Pages touched: WIKI.md, index.md, overview.md, backend.md, frontend.md, crawler.md, decisions.md, stores/jamoona.md, stores/dookan.md, stores/grocera.md, stores/little-india.md, stores/namma-markt.md
Sources: CLAUDE.md, docs/crisp-architecture.md, server/index.js, server/db/schema.sql, crawler/index.js, crawler/utils/category-mapper.js, client/src/App.jsx, client/src/hooks/useDeals.js, client/src/utils/api.js, crawler/stores/*.js (5 stores)
