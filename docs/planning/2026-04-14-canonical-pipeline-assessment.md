# Canonical Pipeline Assessment — 2026-04-14

## Architecture (what runs and when)

**After each crawl:**
1. `autoMapDeals()` — slot-based matching against `canonical_products` with `is_match_priority=1 AND brand_slots IS NOT NULL`
2. `canonicalizeDeals(unmappedOnly=true)` — entity-resolution for anything still unmapped

**Entity-resolution stages (per deal):**
- Normalise → exact match (confidence 1.0)
- Fuzzy via Levenshtein+token coverage: score ≥0.78 → direct match; 0.58–0.78 → AI confirms; <0.58 → creates new canonical
- If no match at all → **unconditionally creates new canonical from raw product name**

**After brand remap (admin trigger):**
Same steps after brand table update and canonical slot redecomposition.

---

## Issue 1 — Pipeline broken since April 4 (Critical)

Every crawl run since April 4 has produced **zero deal_mappings**. The entity_resolution_queue also has no April entries. `canonicalizeDeals` is wrapped in a try-catch that swallows errors silently (`logWarn` only).

| Crawl run | Active deals | Mapped | Coverage |
|---|---|---|---|
| 2026-03-11 | 1701 | 1701 | 100% |
| 2026-04-04 | 1050 | 0 | 0% |
| 2026-04-05 | 18 | 0 | 0% |
| 2026-04-08 | 45 | 0 | 0% |
| 2026-04-09 | 262 | 0 | 0% |

Current state: **1375 of 3076 active deals (44.7%) unmapped**. Of those, 244 have a perfect 1.0 fuzzy match to an existing canonical — they would map immediately if the pipeline ran.

**Where to look:** `crawler/index.js` lines ~750-760, the try-catch around `canonicalizeDeals`. Add error re-throw or detailed logging. Check if a schema column added after March 11 causes an INSERT to fail.

---

## Issue 2 — BBD dates baked into canonical names

Many canonical names include "Best Before" dates from the raw crawled name:
- `"Nanak - (Best Before 15/03/2026) 454g (Frozen) Rasmalai 8 Pieces Approx."`
- `"Daawat - 10kg Chakki Atta (Whole Wheat Flour) BBD September 2026"`

The normaliser (`crawler/entity-resolution/normaliser.js`) strips units and qualifiers but **does not strip dates or BBD phrases**. When the same product is recrawled after the BBD changes, entity-resolution sees a different string and creates a duplicate canonical.

---

## Issue 3 — Unconditional canonical creation from raw product names

In `server/services/canonicalizer.js`, `canonicalizeDeals()`: when fuzzy score < 0.58, a new canonical is immediately created using the raw crawled name. No threshold gate, no near-match check before creation.

The 11191 `entity_resolution_queue` entries are **all "pending" (0 resolved)** — manual review was never actioned. Potentially bad mappings from Feb–Mar persist indefinitely.

---

## Issue 4 — Fuzzy false-positives from shared BBD phrases

The normaliser doesn't strip "Best Before" phrases, so two different products sharing a date pattern score 0.58–0.78 similarity:

```
"MDH - (Best Before 31/01/2026) 100g Chutney Masala Podina"
  → best fuzzy: 0.67 → "Maggi - (Best Before 31/03/2026) 70g Instant Masala Noodles"
```

If AI confirms (or fails to respond), these get cross-mapped.

Confirmed in existing data: **175 canonicals (~13%) have deals mapped to them with mutual similarity < 0.4**. Example: canonical `mdh-t-plus-tea-masala-35g` has both `"MDH T-Plus (Tea) Masala (35g)"` and `"Tindori"` (Indian Round Gourd) mapped to it.

---

## Issue 5 — New store brands not in known_brands → auto-mapper blind

Auto-mapper requires `brand_slots IS NOT NULL`. Slots are only populated if the brand token matches a row in `known_brands`. The 9 stores added in April crawls (namastedeutschland, globalfoodhub, desistore, indianspicebasket, yogimart, asiangrocerystore, sairas, zora-supermarkt, others) likely have brands absent from `known_brands`, so their canonical rows get `brand_slots = null` and are skipped by slot-based matching entirely.

---

## Priority fixes

1. **Find why canonicalizeDeals silently fails after Apr 4** — likely a schema change or AI resolver throwing when no API key is set. Add proper error logging or re-throw from the catch block in `crawler/index.js`.
2. **Strip dates and BBD phrases in normaliser** — add `/(best before|bbd|best by|use by)\b[^a-z]*/gi` and date patterns to `normaliser.js`; prevents duplicate canonicals on re-crawl and removes false-positive fuzzy matches.
3. **Add near-match threshold before creating new canonical** — if best fuzzy score ≥ 0.5, queue for manual review instead of auto-creating a new canonical.
4. **Process the 11191 pending manual review queue** — build admin tool to resolve or bulk-dismiss; purge confirmed bad mappings.
5. **Add new store brands to known_brands** — one brand remap run after adding brands will populate slots and fix auto-mapper coverage for all new stores.

---

## Key files

| File | Role |
|---|---|
| `crawler/index.js` ~750 | canonicalizeDeals call (try-catch, silently swallows errors) |
| `server/services/canonicalizer.js` | canonicalizeDeals — creates canonical unconditionally on no-match |
| `crawler/entity-resolution/index.js` | resolveName — 3-stage pipeline (exact → fuzzy → AI) |
| `crawler/entity-resolution/normaliser.js` | normalise — strips units/qualifiers but NOT dates |
| `crawler/entity-resolution/fuzzy-matcher.js` | fuzzyMatch — threshold 0.78 (match) / 0.58 (ambiguous) |
| `crawler/utils/auto-mapper.js` | slot-based matching, requires brand_slots IS NOT NULL |
