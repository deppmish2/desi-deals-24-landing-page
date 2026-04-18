# DesiDeals24 — Phase 0: AI-Powered Canonical Product Catalogue Bootstrap
## Claude Code Prompt

---

## CONTEXT

You are working on the DesiDeals24 codebase — an Indian grocery deals aggregator
for the Indian diaspora in Germany. The database is a Turso (libSQL) instance
accessed via `server/db/index.js` using the compatibility shim:

```js
await db.prepare(sql).all(...args)   // → row[]
await db.prepare(sql).get(...args)   // → row | undefined
await db.prepare(sql).run(...args)   // → { changes, lastInsertRowid }
await db.execute(sql, args)          // → ResultSet
await db.batch(statements, mode)     // → atomic batch
```

The Anthropic client is available as the standard SDK. Use the model
`claude-haiku-4-5-20251001` for all Batch API calls in this task.

Relevant existing tables you will READ from (do not modify these):
- `deals` — columns: id, product_name, product_category, store_id, product_url,
  weight_raw, weight_value, weight_unit, sale_price, is_active
- `stores` — columns: id, name, url

Relevant existing tables you will WRITE to later (do not touch yet):
- `canonical_products` — you will NOT write here during this task
- `deal_mappings` — you will NOT write here during this task

**This task ends before any writes to production tables.**
**All output goes to new staging tables only.**

---

## OBJECTIVE

Bootstrap a high-quality canonical product catalogue by:
1. Reading all active, deduplicated raw product names from `deals`
2. Sending them in batches to Claude Haiku via the Batch API for structured
   extraction
3. Storing the AI output — with full traceability back to source deals — in two
   new staging tables
4. Running a post-processing quality pass
5. Printing a summary report and stopping

Do NOT promote anything to `canonical_products` or `deal_mappings`.
Do NOT modify any existing table.
Stop after the summary report and wait for human review.

---

## STEP 1 — Create staging tables

Create both tables if they do not already exist. These are safe to re-run
idempotently — use `CREATE TABLE IF NOT EXISTS` throughout.

```sql
-- Primary staging table: one row per canonical product the AI identified
CREATE TABLE IF NOT EXISTS canonical_bootstrap_staging (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id              TEXT NOT NULL,        -- Anthropic Batch API batch id
  batch_item_id         TEXT NOT NULL,        -- per-request id within the batch
  canonical_name        TEXT NOT NULL,        -- e.g. "Heera Toor Dal"
  brand                 TEXT,                 -- e.g. "Heera" — NULL if undetectable
  product_type          TEXT NOT NULL,        -- e.g. "Toor Dal" (no brand, no variant)
  variant               TEXT,                 -- e.g. "Split", "Organic" — NULL if none
  category              TEXT,                 -- one of the 16 categories
  weight_kg             REAL,                 -- most common weight seen, or NULL
  weight_unit           TEXT,                 -- "kg" | "g" | "ml" | "l" | NULL
  aliases               TEXT,                 -- JSON array of alt names / synonyms
  ai_confidence         TEXT NOT NULL,        -- "high" | "medium" | "low"
  needs_review          INTEGER DEFAULT 0,    -- 1 = flagged for human review
  review_note           TEXT,                 -- reason for needs_review flag
  promoted              INTEGER DEFAULT 0,    -- 1 after promotion to canonical_products
  promoted_canonical_id TEXT,                 -- canonical_products.id after promotion
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbs_batch_id
  ON canonical_bootstrap_staging(batch_id);
CREATE INDEX IF NOT EXISTS idx_cbs_needs_review
  ON canonical_bootstrap_staging(needs_review);
CREATE INDEX IF NOT EXISTS idx_cbs_promoted
  ON canonical_bootstrap_staging(promoted);
CREATE INDEX IF NOT EXISTS idx_cbs_canonical_name
  ON canonical_bootstrap_staging(canonical_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_cbs_brand
  ON canonical_bootstrap_staging(brand COLLATE NOCASE);


-- Source traceability table: one row per raw deal that maps to a staging canonical
-- This is the full audit trail: store product name → what the AI made of it
CREATE TABLE IF NOT EXISTS canonical_bootstrap_source_products (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  staging_id            INTEGER NOT NULL
                          REFERENCES canonical_bootstrap_staging(id)
                          ON DELETE CASCADE,
  deal_id               TEXT NOT NULL,        -- deals.id — direct FK to source
  store_id              TEXT NOT NULL,        -- deals.store_id
  store_name            TEXT,                 -- stores.name — denormalised for readability
  raw_product_name      TEXT NOT NULL,        -- EXACT value from deals.product_name
  raw_category          TEXT,                 -- deals.product_category
  raw_weight            TEXT,                 -- deals.weight_raw
  raw_weight_value      REAL,                 -- deals.weight_value
  raw_weight_unit       TEXT,                 -- deals.weight_unit
  store_count_at_crawl  INTEGER,              -- how many stores carry this raw name
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cbsp_staging_id
  ON canonical_bootstrap_source_products(staging_id);
CREATE INDEX IF NOT EXISTS idx_cbsp_deal_id
  ON canonical_bootstrap_source_products(deal_id);
CREATE INDEX IF NOT EXISTS idx_cbsp_store_id
  ON canonical_bootstrap_source_products(store_id);
CREATE INDEX IF NOT EXISTS idx_cbsp_raw_name
  ON canonical_bootstrap_source_products(raw_product_name COLLATE NOCASE);
```

After creating the tables, log:
```
✓ Staging tables created (or already exist)
```

---

## STEP 2 — Extract and deduplicate raw products

Run this query to build your working set:

```sql
SELECT
  d.id                                        AS deal_id,
  d.product_name                              AS raw_name,
  d.product_category                          AS raw_category,
  d.store_id,
  s.name                                      AS store_name,
  d.weight_raw,
  d.weight_value,
  d.weight_unit,
  COUNT(DISTINCT d.store_id) OVER (
    PARTITION BY LOWER(TRIM(d.product_name))
  )                                           AS store_count
FROM deals d
JOIN stores s ON s.id = d.store_id
WHERE d.is_active = 1
  AND d.product_name IS NOT NULL
  AND TRIM(d.product_name) != ''
ORDER BY store_count DESC, LOWER(TRIM(d.product_name)) ASC;
```

Then deduplicate in memory: for each unique `LOWER(TRIM(raw_name))`, keep ALL
matching rows (you need every deal_id for source traceability), but treat the
group as a single product unit for batching purposes. The representative name
sent to the AI is the most frequently occurring casing variant within the group.
If tied, use the first alphabetically.

Build an in-memory map:
```
normalisedName → {
  representativeName: string,
  rawCategory: string (most frequent),
  weightRaw: string (most frequent non-null),
  storeCount: number,
  sourceDeals: [{ deal_id, store_id, store_name, raw_product_name,
                  raw_category, raw_weight, raw_weight_value, raw_weight_unit }]
}
```

Log:
```
✓ Raw query returned {N} rows
✓ Deduplicated to {M} unique product names
  Top 5 by store count:
    "{name}" — {n} stores
    ...
```

---

## STEP 3 — Build batch request payloads

Split the deduplicated working set into batches of **150 products** each.
150 is a deliberate safety margin — some Indian grocery names are long.

For each product in a batch, format the input line as:
```
"{representativeName}" | category: {rawCategory} | weight: {weightRaw} | seen in {storeCount} store(s)
```

If weightRaw is null, omit the weight segment:
```
"{representativeName}" | category: {rawCategory} | seen in {storeCount} store(s)
```

Generate a deterministic batch_item_id for each request:
```
bootstrap-{YYYYMMDD}-batch{batchNumber}-{timestamp_ms}
```

Example for batch 3 submitted on 15 April 2026:
```
bootstrap-20260415-batch003-1713182400000
```

Log:
```
✓ {N} unique products → {B} batches of ≤150
```

---

## STEP 4 — Submit all batches to the Anthropic Batch API

Use `POST /v1/messages/batches` with the following structure for each batch.

### System prompt (identical for every batch request)

```
You are a grocery product catalogue expert specialising in Indian grocery
products sold in Germany. Your task is to extract structured canonical product
records from raw product names scraped from Indian grocery store websites.

════════════════════════════════════════
IDENTITY RULES — non-negotiable
════════════════════════════════════════

RULE 1 — BRAND: Different brands are ALWAYS different canonical products.
"MDH Toor Dal" and "TRS Toor Dal" MUST NEVER be merged into one canonical.
"Heera" and "TRS" and "East End" are different brands even if the product type
is identical. If no brand is detectable, set brand to null — do not invent one.

RULE 2 — VARIANT: The following words define a genuinely distinct product.
Never strip them, never treat them as mere qualifiers:
  whole, split, hulled, dehulled, washed, polished, roasted, puffed, pressed,
  popped, flaked, beaten, organic, aged, smoked, raw, cooked, dried, freeze-dried,
  extra-fine, coarse, medium, fine, strong, mild, light, dark, double-cream
"Whole Urad Dal" and "Split Urad Dal" are two different canonical products.
"Fine Semolina" and "Coarse Semolina" are two different canonical products.

RULE 3 — WEIGHT IS NOT IDENTITY: A 500g and a 1kg pack of the same product are
the SAME canonical. Weight is a packaging variant, not product identity.
Set weight_kg to the most common weight seen in the input for that product, or
null if weights vary widely. Do not create separate canonicals per weight.

RULE 4 — PACKAGING IS NOT IDENTITY: pouch, bag, box, tin, can, jar, bottle,
sachet, carton, tub — ignore these entirely when determining identity.

RULE 5 — ALIASES: Capture every spelling variant, transliteration and common
English synonym you are confident about. Be generous — aliases directly improve
matching quality. Examples:
  "Toor Dal" → ["Arhar Dal", "Tuvar Dal", "Toovar Dal", "Tuar Dal",
                 "Pigeon Pea Lentils", "Yellow Pigeon Peas"]
  "Besan"    → ["Gram Flour", "Chickpea Flour", "Chana Flour", "Bengal Gram Flour"]
  "Rava"     → ["Sooji", "Suji", "Semolina"]
Do NOT hallucinate aliases you are not confident about. Accuracy over coverage.

════════════════════════════════════════
CONFIDENCE RULES
════════════════════════════════════════

Set ai_confidence to:
  "high"   — brand clearly identifiable AND product type unambiguous
  "medium" — brand detectable but uncertain, OR product type has some ambiguity
  "low"    — brand unclear OR product name heavily transliterated OR
             product type ambiguous OR name contains unrecognised words

Set needs_review to true and populate review_note if ANY of:
  - Brand is unrecognisable as a known Indian/Asian grocery brand
  - Product name is in non-Latin script (Devanagari, Bengali, etc.)
  - Product name is so heavily transliterated you are uncertain of the product
  - Category assignment is ambiguous between two categories
  - The name contains words you genuinely do not recognise
  - The product appears to be a non-grocery item (cleaning products, cosmetics)

════════════════════════════════════════
CATEGORY — use exactly one of these 16
════════════════════════════════════════

  Lentils & Pulses
  Rice & Grains
  Flour & Semolina
  Spices & Masalas
  Oils & Ghee
  Pickles & Chutneys
  Snacks & Namkeen
  Sweets & Mithai
  Beverages & Drinks
  Dairy & Paneer
  Frozen Foods
  Ready Meals & Mixes
  Fresh Produce
  Condiments & Sauces
  Pooja & Incense
  Other

════════════════════════════════════════
OUTPUT FORMAT — critical
════════════════════════════════════════

Return ONLY a valid JSON array. No markdown, no backticks, no prose, no comments.
The array may be empty [] if no valid products are found.

Each element must have EXACTLY these fields — no extras, no omissions:
{
  "canonical_name":  string,         // Brand + Product Type + Variant (if any)
                                     // Examples: "Heera Toor Dal",
                                     //           "TRS Split Urad Dal",
                                     //           "East End Basmati Rice"
                                     //           "MDH Chana Masala"
  "brand":           string | null,  // Brand name only, no product type
  "product_type":    string,         // Product without brand or variant
                                     // e.g. "Toor Dal", "Basmati Rice"
  "variant":         string | null,  // Only genuine variants — see Rule 2
  "category":        string,         // One of the 16 exact strings above
  "weight_kg":       number | null,  // Most common weight in kg, or null
  "weight_unit":     string | null,  // "kg" | "g" | "ml" | "l" | null
  "aliases":         string[],       // All confident alt names — can be empty []
  "ai_confidence":   "high" | "medium" | "low",
  "needs_review":    boolean,
  "review_note":     string | null,  // Required if needs_review is true
  "raw_names_matched": string[]      // The EXACT input lines that map to this
                                     // canonical — copy them verbatim from input
}

GROUPING RULE: Multiple input lines may map to the same canonical. Group them.
Do NOT produce one output object per input line.
Do NOT produce separate objects for the same product at different weights.
```

### User message for each batch request

```
Extract canonical products from the {N} raw product names below.

Key reminders:
- Group all weight variants of the same product into ONE canonical
- Different brands = always separate canonicals, no exceptions
- Copy raw_names_matched verbatim from the input lines

Input:
{formatted product list — one line per product, as specified in Step 3}
```

### Submission

Submit all batch requests in a single Batch API call (`requests` array).
The Batch API accepts up to 10,000 requests per batch submission — all your
batches will fit in one submission.

After submitting, log:
```
✓ Submitted {B} batch requests to Anthropic Batch API
  Batch API ID: {id}
  Estimated products: {N}
  Polling every 60 seconds...
```

Save the Batch API ID — you will need it for polling.

---

## STEP 5 — Poll for completion

Poll `GET /v1/messages/batches/{id}` every **60 seconds**.

On each poll, log:
```
  [{timestamp}] Status: {processing_status} — {request_counts.succeeded} succeeded,
  {request_counts.errored} errored, {request_counts.processing} processing
```

Continue polling until `processing_status === "ended"`.

If `request_counts.errored > 0` after completion, log a warning:
```
  ⚠ {n} requests errored — these will be flagged needs_review in staging
```
This is not a fatal error — continue to Step 6.

---

## STEP 6 — Parse results and write to staging tables

Retrieve results from `GET /v1/messages/batches/{id}/results` (streaming JSONL).

For each result line in the JSONL stream:

**If result.result.type === "succeeded":**

1. Extract the text content from `result.result.message.content[0].text`
2. Strip any accidental markdown fences:
   - Remove leading ` ```json ` or ` ``` ` if present
   - Remove trailing ` ``` ` if present
   - Trim whitespace
3. Parse as JSON array
4. For each canonical object in the array:

   a. **Duplicate check**: query staging for an existing row where
      `LOWER(canonical_name) = LOWER(object.canonical_name)`. If found:
      - Do NOT insert a new staging row
      - Insert source product rows into `canonical_bootstrap_source_products`
        pointing to the existing staging row's id
      - Append any new aliases from object.aliases to the existing row's aliases
        JSON array (merge, deduplicate, update in place)
      - Log: `  ↔ Merged duplicate: "{canonical_name}" into existing staging id {id}`
      - Continue to next object

   b. **New canonical**: INSERT into `canonical_bootstrap_staging`:
      ```
      batch_id              ← the Anthropic Batch API id
      batch_item_id         ← result.custom_id
      canonical_name        ← object.canonical_name
      brand                 ← object.brand
      product_type          ← object.product_type
      variant               ← object.variant
      category              ← object.category
      weight_kg             ← object.weight_kg
      weight_unit           ← object.weight_unit
      aliases               ← JSON.stringify(object.aliases)
      ai_confidence         ← object.ai_confidence
      needs_review          ← object.needs_review ? 1 : 0
      review_note           ← object.review_note
      ```
      Capture the new row's `id` as `staging_id`.

   c. **Source product rows**: for each name in `object.raw_names_matched`,
      look up the corresponding entry in your in-memory working set map
      (match on the representative name or any sourceDeals raw_product_name).
      For each matching source deal, INSERT into
      `canonical_bootstrap_source_products`:
      ```
      staging_id            ← staging_id from step b (or existing id from step a)
      deal_id               ← sourceDeals[i].deal_id
      store_id              ← sourceDeals[i].store_id
      store_name            ← sourceDeals[i].store_name
      raw_product_name      ← sourceDeals[i].raw_product_name  (EXACT — verbatim)
      raw_category          ← sourceDeals[i].raw_category
      raw_weight            ← sourceDeals[i].raw_weight
      raw_weight_value      ← sourceDeals[i].raw_weight_value
      raw_weight_unit       ← sourceDeals[i].raw_weight_unit
      store_count_at_crawl  ← sourceDeals[i].storeCount
      ```

**If result.result.type === "errored":**

Insert a single fallback row into `canonical_bootstrap_staging`:
```
batch_id          ← Batch API id
batch_item_id     ← result.custom_id
canonical_name    ← "PARSE_ERROR: " + result.custom_id
product_type      ← "UNKNOWN"
category          ← "Other"
ai_confidence     ← "low"
needs_review      ← 1
review_note       ← "API error: " + result.result.error.error_code
```
Log: `  ✗ Request {custom_id} errored: {error_code}`

**If JSON.parse throws for a succeeded result:**

Insert the same fallback row format with:
```
review_note       ← "JSON parse failure — check logs for raw response"
```
Log the raw response text (truncated to 500 chars) and the batch_item_id.

After processing all results, log:
```
✓ All results written to staging
  Staging rows inserted:  {n}
  Staging rows merged:    {n}
  Source product rows:    {n}
  Parse failures:         {n}
```

---

## STEP 7 — Post-processing quality pass

Run the following SQL operations in order. Each is independent — a failure in
one should be logged and skipped, not abort the whole pass.

### 7a — Flag cross-batch name duplicates that survived the merge check

```sql
UPDATE canonical_bootstrap_staging
SET
  needs_review = 1,
  review_note  = TRIM(COALESCE(review_note || ' | ', '') ||
                 'Possible duplicate — similar canonical name found in staging')
WHERE id IN (
  SELECT s1.id
  FROM canonical_bootstrap_staging s1
  JOIN canonical_bootstrap_staging s2
    ON s1.id <> s2.id
   AND LOWER(TRIM(s1.canonical_name)) = LOWER(TRIM(s2.canonical_name))
   AND s1.id > s2.id  -- only flag the later one to avoid double-flagging
);
```

### 7b — Flag single-store products with non-high confidence

```sql
UPDATE canonical_bootstrap_staging
SET
  needs_review = 1,
  review_note  = TRIM(COALESCE(review_note || ' | ', '') ||
                 'Single-store product with medium/low confidence — verify before promoting')
WHERE id IN (
  SELECT staging_id
  FROM canonical_bootstrap_source_products
  GROUP BY staging_id
  HAVING COUNT(DISTINCT store_id) = 1
)
AND ai_confidence <> 'high'
AND needs_review = 0;
```

### 7c — Flag branded categories with no brand detected

```sql
UPDATE canonical_bootstrap_staging
SET
  needs_review = 1,
  review_note  = TRIM(COALESCE(review_note || ' | ', '') ||
                 'Branded category but no brand detected — check if generic or brand missed')
WHERE brand IS NULL
  AND category IN (
    'Lentils & Pulses',
    'Rice & Grains',
    'Flour & Semolina',
    'Spices & Masalas',
    'Snacks & Namkeen',
    'Sweets & Mithai',
    'Ready Meals & Mixes'
  )
  AND needs_review = 0;
```

### 7d — Flag products where AI confidence is low regardless of other flags

```sql
UPDATE canonical_bootstrap_staging
SET
  needs_review = 1,
  review_note  = TRIM(COALESCE(review_note || ' | ', '') ||
                 'Low AI confidence')
WHERE ai_confidence = 'low'
  AND needs_review = 0;
```

### 7e — Flag canonicals with no source products linked (data integrity check)

```sql
UPDATE canonical_bootstrap_staging
SET
  needs_review = 1,
  review_note  = TRIM(COALESCE(review_note || ' | ', '') ||
                 'DATA INTEGRITY: no source products linked — investigate')
WHERE id NOT IN (
  SELECT DISTINCT staging_id FROM canonical_bootstrap_source_products
)
AND needs_review = 0;
```

After all passes, log:
```
✓ Post-processing quality pass complete
```

---

## STEP 8 — Print summary report

Print the following to console. Query the staging tables for each figure.

```
══════════════════════════════════════════════════════════
  DESIDEALS24 — PHASE 0 BOOTSTRAP COMPLETE
══════════════════════════════════════════════════════════

  SOURCE DATA
  ─────────────────────────────────────────────────────
  Raw active deals processed      : {n}
  Unique product names (deduped)   : {n}
  Batches submitted                : {n} (150 products/batch)
  Batch API ID                     : {id}

  CANONICAL CATALOGUE PRODUCED
  ─────────────────────────────────────────────────────
  Total canonical rows in staging  : {n}
  Unique brands detected           : {n}
  Average aliases per canonical    : {n:.1f}

  AI CONFIDENCE BREAKDOWN
  ─────────────────────────────────────────────────────
  HIGH confidence                  : {n}  ({pct:.0f}%)
  MEDIUM confidence                : {n}  ({pct:.0f}%)
  LOW confidence                   : {n}  ({pct:.0f}%)

  REVIEW FLAGS
  ─────────────────────────────────────────────────────
  Flagged needs_review = 1         : {n}  ({pct:.0f}%)
  Parse / API errors               : {n}

  CATEGORY BREAKDOWN (all staging rows)
  ─────────────────────────────────────────────────────
  {category}                       : {count}
  ... (all 16 categories, sorted by count desc)

  TOP 10 BRANDS BY PRODUCT COUNT
  ─────────────────────────────────────────────────────
  {brand}                          : {n} canonicals
  ...

  SOURCE TRACEABILITY
  ─────────────────────────────────────────────────────
  Total source product links       : {n}
  Deals with no canonical link yet : {n}
    (these remain as deals.canonical_id = NULL until promotion)

══════════════════════════════════════════════════════════
  USEFUL REVIEW QUERIES
══════════════════════════════════════════════════════════

-- See what the AI made of any set of raw store names:
SELECT
  s.canonical_name,
  s.brand,
  s.product_type,
  s.variant,
  s.category,
  s.ai_confidence,
  s.needs_review,
  s.review_note,
  sp.store_id,
  sp.store_name,
  sp.raw_product_name,
  sp.raw_category,
  sp.raw_weight
FROM canonical_bootstrap_staging s
JOIN canonical_bootstrap_source_products sp ON sp.staging_id = s.id
WHERE s.needs_review = 1
ORDER BY s.ai_confidence ASC, s.canonical_name, sp.store_id;

-- Review all canonicals for a specific category:
SELECT s.*, COUNT(sp.id) AS source_count
FROM canonical_bootstrap_staging s
LEFT JOIN canonical_bootstrap_source_products sp ON sp.staging_id = s.id
WHERE s.category = 'Lentils & Pulses'
GROUP BY s.id
ORDER BY s.ai_confidence DESC, source_count DESC;

-- See all raw names from a specific store and what they mapped to:
SELECT
  sp.raw_product_name,
  sp.raw_weight,
  s.canonical_name,
  s.brand,
  s.ai_confidence,
  s.needs_review
FROM canonical_bootstrap_source_products sp
JOIN canonical_bootstrap_staging s ON s.id = sp.staging_id
WHERE sp.store_id = 'jamoona'  -- replace with any store_id
ORDER BY s.canonical_name;

-- Summary: how many source deals are covered vs not yet mapped:
SELECT
  'Covered by staging'    AS status,
  COUNT(DISTINCT sp.deal_id) AS deal_count
FROM canonical_bootstrap_source_products sp
UNION ALL
SELECT
  'Not yet mapped'        AS status,
  COUNT(*) AS deal_count
FROM deals
WHERE is_active = 1
  AND id NOT IN (SELECT deal_id FROM canonical_bootstrap_source_products);

══════════════════════════════════════════════════════════
  NEXT STEP (run manually after review)
══════════════════════════════════════════════════════════

After reviewing flagged items and correcting any staging rows:

  1. Promote clean rows to canonical_products:
     Run: scripts/promote-bootstrap-staging.js
     (to be written in Phase 0 Step 2)

  2. This will:
     - INSERT canonical_bootstrap_staging (needs_review=0, promoted=0)
       → canonical_products
     - INSERT canonical_bootstrap_source_products
       → deal_mappings (match_method='bootstrap', match_confidence=1.0
          for high confidence; 0.92 for medium)
     - UPDATE deals.canonical_id
     - SET canonical_bootstrap_staging.promoted = 1

DO NOT promote automatically. Human review required first.
══════════════════════════════════════════════════════════
```

---

## ERROR HANDLING REQUIREMENTS

Throughout all steps:

- **Never abort on a single batch failure.** Log the error, mark affected
  rows as `needs_review = 1`, continue.
- **Never abort on a JSON parse failure.** Log raw response (truncated to
  500 chars), insert error row, continue.
- **Log every significant operation** with a timestamp prefix:
  `[HH:MM:SS] message`
- **Wrap all database writes in transactions** where multiple related rows
  are inserted together (staging row + its source product rows = one transaction).
- **If the process is interrupted** (Ctrl+C, timeout), it must be safe to
  re-run. The `CREATE TABLE IF NOT EXISTS` and the duplicate check in Step 6
  ensure idempotency. Add a check at the start of Step 4: if staging rows
  already exist for this run date, ask for confirmation before proceeding.

---

## IMPORTANT CONSTRAINTS

1. **Model**: `claude-haiku-4-5-20251001` — do not substitute
2. **Batch size**: 150 products per request — do not increase
3. **No writes to**: `canonical_products`, `deal_mappings`, `deals`,
   `canonical_tokens`, `canonical_attributes`, or any other existing table
4. **No automatic promotion**: the script ends at the summary report
5. **The ANTHROPIC_API_KEY** is available in the environment — do not hardcode
6. **Use the Batch API** (`/v1/messages/batches`) — not individual messages
7. **Turso/libSQL syntax**: SQLite-compatible SQL only. No `RETURNING` clause
   in INSERT (not supported) — use `db.prepare(...).run()` then query
   `last_insert_rowid` for the new id.

---
*Phase 0 Bootstrap — v1.0*
*Produces: canonical_bootstrap_staging + canonical_bootstrap_source_products*
*Does not modify any existing production table*
