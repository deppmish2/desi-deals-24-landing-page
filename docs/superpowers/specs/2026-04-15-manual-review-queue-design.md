# Manual Review Queue for Low-Confidence Canonical Matches

**Date:** 2026-04-15  
**Branch:** real-savings-feature  
**Status:** Approved

## Problem

Fuzzy matching at ≥0.78 auto-maps deals that are wrong. Example: "Lovely Chana Dal 500gm" matched to canonical "Lovely Toor Dal 500gm" (score ~0.77 → ai-resolver said YES → confidence 0.9 → auto-mapped). Different products, same canonical.

Root cause: threshold too low + ai-resolver token overlap ignores conflicting content tokens.

## Solution

Raise auto-map threshold to **≥0.90 fuzzy score**. Everything below — including no-match — goes to a manual review queue. Admin UI lets admins assign, create, or dismiss queued items.

---

## Section 1 — Pipeline Changes

### `crawler/entity-resolution/fuzzy-matcher.js`
- Raise auto-map tier from `≥0.78` to `≥0.90`
- Below 0.90 returns `{ method: "manual_review", confidence: score }`
- Remove ambiguous (≥0.58) and possible_match (≥0.40) tiers — all become manual_review

### `crawler/entity-resolution/index.js`
- Remove ai-resolver call entirely
- Any score < 0.90 returns `{ match: null, method: "manual_review", confidence: score }`
- `ai-resolver.js` file kept but no longer called from pipeline

### `server/services/canonicalizer.js`
- No-match path (was: auto-create canonical) → now calls `enqueueManualReview` with `suggested_canonical_id = null`, `confidence = 0`
- `enqueueManualReview` writes `store_id` and `category` from deal row

---

## Section 2 — Schema

Two columns added to `entity_resolution_queue`:

```sql
ALTER TABLE entity_resolution_queue ADD COLUMN store_id TEXT REFERENCES stores(id);
ALTER TABLE entity_resolution_queue ADD COLUMN category TEXT;
```

Existing rows get NULL — filter as "unknown" in UI.

Two new indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_queue_store    ON entity_resolution_queue(store_id);
CREATE INDEX IF NOT EXISTS idx_queue_category ON entity_resolution_queue(category);
```

Queue `status` values: `pending`, `confirmed`, `dismissed`.

---

## Section 3 — API Routes

New file: `server/routes/admin-review-queue.js`  
Mounted at: `/api/admin/review-queue`

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Paginated list. Query: `status`, `store`, `category`, `page`, `limit=50` |
| `GET` | `/stats` | Counts by status + breakdown by store/category |
| `POST` | `/:id/assign` | Body: `{ canonical_id }`. Maps deal, marks confirmed |
| `POST` | `/:id/create` | Body: `{ name, category }`. Creates canonical, maps deal, marks confirmed, triggers category re-scan. Returns `{ canonical_id, auto_matched }` |
| `POST` | `/:id/dismiss` | Marks dismissed |
| `POST` | `/bulk-assign` | Body: `{ ids[], canonical_id }`. Batch assign |
| `POST` | `/bulk-dismiss` | Body: `{ ids[] }`. Batch dismiss |

**Re-scan logic** (triggered by `/:id/create`):
1. Query pending queue items WHERE `category = newCanonical.category`
2. Run `combinedSimilarity` (from fuzzy-matcher) against new canonical's normalised name
3. Items scoring ≥ 0.90 → auto-assign to new canonical + mark confirmed
4. Return count as `auto_matched` in response

Mounted in `server/routes/admin.js` alongside existing admin routes.

---

## Section 4 — Admin UI

New "Review Queue" tab in `AdminPage.jsx` with pending count badge.

**Table columns:** Raw Name | Store | Category | Confidence | Suggested Canonical | Status | Actions

**Filter bar:** Status (Pending/Confirmed/Dismissed/All) · Store · Category · Reset

**Per-row actions:**
- **Confirm** — one click, only shown if `suggested_canonical_id` exists
- **Assign** — inline canonical search (type-ahead against existing canonicals)
- **New** — expands row: Name field (pre-filled from `raw_name`), Category dropdown, Save/Cancel
- **Dismiss** — marks dismissed

**Bulk actions** (shown when ≥1 checkbox selected):
- "Assign to canonical…" — searchable dropdown, applies to all selected
- "Dismiss selected"

**After New save:** row shows inline `auto_matched` count (e.g. "✓ Created · 3 additional matched"), moves to confirmed state.

Pagination: 50 per page. No new page/route — fits within existing admin tab structure.

---

## Section 5 — Testing

### `tests/integration/review-queue.test.js`
- Deal with score < 0.90 gets enqueued, not mapped
- No-match deal enqueued with `suggested_canonical_id = null`
- Deal with score ≥ 0.90 still auto-maps (regression guard)

### `tests/integration/admin-review-queue.test.js`
- `POST /:id/assign` maps deal + marks confirmed
- `POST /:id/create` creates canonical + maps deal + re-scans category + returns `auto_matched`
- `POST /:id/dismiss` marks dismissed
- `POST /bulk-assign` maps N deals
- `GET /` returns paginated results filtered by status/store/category

### `tests/integration/fuzzy-matcher.test.js` (extend existing)
- Score < 0.90 returns `manual_review`
- "Lovely Chana Dal 500gm" vs "Lovely Toor Dal 500gm" scores below 0.90 (regression test for original mismatch)

All use in-memory SQLite (`DatabaseSync`) — consistent with existing test infrastructure.

---

## Files Changed

| File | Change |
|------|--------|
| `crawler/entity-resolution/fuzzy-matcher.js` | Raise threshold to 0.90, remove ambiguous/possible_match tiers |
| `crawler/entity-resolution/index.js` | Remove ai-resolver call, all sub-0.90 → manual_review |
| `server/services/canonicalizer.js` | No-match → enqueue; enqueueManualReview writes store_id + category |
| `server/db/schema.sql` | Add store_id, category columns + indexes to entity_resolution_queue |
| `server/routes/admin-review-queue.js` | New file — all queue CRUD + re-scan logic |
| `server/routes/admin.js` | Mount admin-review-queue router |
| `client/src/landing/AdminPage.jsx` | Add Review Queue tab with table, filters, bulk actions, inline create |
| `client/src/utils/api.js` | Add review queue API calls |
| `tests/integration/review-queue.test.js` | New — pipeline queue tests |
| `tests/integration/admin-review-queue.test.js` | New — API route tests |
| `tests/integration/fuzzy-matcher.test.js` | Extend — threshold + chana/toor regression |
