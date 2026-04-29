# Search Improvements Plan

**Created:** 2026-04-18  
**Status:** Pending

## Problem

Current search (`server/services/deal-search.js`) is a JS loop over all deals with word-by-word
Levenshtein scoring. Known gaps:
- Hindi/English alias misses: user types "dal", product stored as "lentil"
- Transliteration variants: "haldirams" vs "haldiram's", "daawat" vs "dawat"
- Scales poorly — iterates all 47k deals on every search

## Implementation Plan (priority order)

### 1. Synonym/alias expansion
**Effort:** 1–2 hours  
**File:** new `server/services/search-synonyms.js` (reuse `crawler/entity-resolution/synonyms.json`)

Before scoring, expand the query through a bidirectional lookup:
- `dal` → also match `dhal`, `lentil`
- `atta` → also `flour`, `wheat flour`
- `besan` → also `chickpea flour`, `gram flour`
- `sooji` → also `semolina`, `rava`
- `chai` → also `tea`
- `haldi` → also `turmeric`

Bidirectional: if the product name contains the synonym, it matches the query too.

### 2. SQLite FTS5 index
**Effort:** 2–3 hours  
**Files:** `server/db/schema.sql`, `server/services/deal-search.js`, `server/routes/deals.js`

Replace the JS scoring loop with a proper full-text index. FTS5 is built into SQLite/Turso,
handles prefix queries, uses BM25 ranking, runs in microseconds on 47k rows.

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS deals_fts USING fts5(
  product_name, store_name, category,
  content='deals', content_rowid='rowid'
);

-- Keep in sync via triggers on deals INSERT/UPDATE/DELETE
CREATE TRIGGER deals_fts_insert AFTER INSERT ON deals BEGIN
  INSERT INTO deals_fts(rowid, product_name, store_name, category)
  VALUES (new.rowid, new.product_name, new.store_name, new.product_category);
END;
```

Query pattern:
```sql
SELECT d.* FROM deals d
JOIN deals_fts ON deals_fts.rowid = d.rowid
WHERE deals_fts MATCH ?
ORDER BY rank
```

Synonym-expanded query feeds into FTS5 MATCH with prefix wildcards.

### 3. Transliteration normalization
**Effort:** 1 hour  
**File:** `server/services/deal-search.js` (pre-processing layer)

Collapse common romanization variants before matching:
- Double vowels: `aa→a`, `oo→o`, `ee→e` (daawat→dawat, toor→tor)
- Strip trailing possessive `s`: `haldirams→haldiram`
- Normalize apostrophes: `haldiram's→haldiram`
- `ch→c` variants (optional, lower priority)

Apply to both query and indexed content so variants always converge.

### 4. Phonetic zero-results fallback
**Effort:** 2 hours  
**File:** new `server/services/phonetic-search.js`

Only fires when FTS5 + synonyms return 0 results. Run Soundex/Metaphone match against
canonical product names in `canonical_products` table.

Handles genuine misspellings: `tumeric→turmeric`, `corriander→coriander`, `musterd→mustard`.

Do NOT run on every query — only as recovery for zero-results.

## What NOT to build
- **Embedding/vector search**: overkill for a catalogue. FTS5 + synonyms covers 95% of cases.
- **Edit distance on full product names**: too slow as primary strategy; keep as tiebreaker only.

## Current bug fixed (2026-04-18)
Single-char tokens from punctuation (e.g. `P&D` → `d`) were matching query prefixes.
Fixed by requiring both sides of startsWith/includes checks to be ≥ 4 chars in `scoreWordMatch`.
