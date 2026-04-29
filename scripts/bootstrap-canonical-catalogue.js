"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic();

// ─── DB client (mirrors server/db/index.js logic) ────────────────────────────

const DEFAULT_DB_FILE = "data/prod_local.db";

function getDbClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = path.resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const abs = path.resolve(process.env.DB_FILE || DEFAULT_DB_FILE);
  console.log(`DB: ${abs}`);
  return require("@libsql/client").createClient({ url: `file:${abs}` });
}

const db = getDbClient();

// ─── Logging ─────────────────────────────────────────────────────────────────

const logsDir = path.resolve("./logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
const logFile = path.join(
  logsDir,
  `bootstrap-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.log`
);
const logStream = fs.createWriteStream(logFile, { flags: "a" });

function ts() { return new Date().toISOString().slice(11, 19); }

function log(...args) {
  const line = `[${ts()}] ${args.join(" ")}`;
  console.log(line);
  logStream.write(line + "\n");
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question + " (y/N): ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── System prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a grocery product catalogue expert specialising in Indian grocery
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

RULE 6 — ALL PRODUCTS: Assign every product to the best-fitting category regardless
of cuisine origin. German staples, European brands, cleaning products, cosmetics —
pick the most accurate category from the list. Use "Other" only when genuinely
no other category fits.

════════════════════════════════════════
CONFIDENCE & REVIEW RULES
════════════════════════════════════════

Set ai_confidence to:
  "high"   — brand clearly identifiable AND product type unambiguous
  "medium" — brand detectable but uncertain, OR product type has some ambiguity
  "low"    — brand unclear OR product name heavily transliterated OR
             product type ambiguous OR name contains unrecognised words

Set needs_review to true and populate review_note ONLY if ANY of:
  - Brand is unrecognisable as any known grocery brand
  - Product name is in non-Latin script (Devanagari, Bengali, etc.)
  - Product name is so heavily transliterated you are uncertain of the product
  - The name contains words you genuinely do not recognise

Do NOT set needs_review for:
  - Category choice (always pick the best fit)
  - Non-Indian or non-Asian products (assign best category, no review needed)

════════════════════════════════════════
CATEGORY — assign the single best fit
════════════════════════════════════════

Always assign a category. If ambiguous between two, pick the most likely one.
Use "Other" only when genuinely no other category fits.

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
  "canonical_name":    string,         // Brand + Product Type + Variant (if any)
  "brand":             string | null,  // Brand name only
  "product_type":      string,         // Product without brand or variant
  "variant":           string | null,  // Only genuine variants — see Rule 2
  "category":          string,         // One of the 16 exact strings above
  "weight_kg":         number | null,
  "weight_unit":       string | null,  // "kg" | "g" | "ml" | "l" | null
  "aliases":           string[],       // All confident alt names — can be empty []
  "ai_confidence":     "high" | "medium" | "low",
  "needs_review":      boolean,        // true only per REVIEW RULES above
  "review_note":       string | null,  // Required if needs_review is true
  "raw_names_matched": string[]        // EXACT input lines — copy verbatim from input
}

GROUPING RULE: Multiple input lines may map to the same canonical. Group them.
Do NOT produce one output object per input line.
Do NOT produce separate objects for the same product at different weights.`;

// ─── Step 1: Create tables ────────────────────────────────────────────────────

async function step1_createTables() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS canonical_bootstrap_staging (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id              TEXT NOT NULL,
      batch_item_id         TEXT NOT NULL,
      canonical_name        TEXT NOT NULL,
      brand                 TEXT,
      product_type          TEXT NOT NULL,
      variant               TEXT,
      category              TEXT,
      weight_kg             REAL,
      weight_unit           TEXT,
      aliases               TEXT,
      ai_confidence         TEXT NOT NULL,
      needs_review          INTEGER DEFAULT 0,
      review_note           TEXT,
      promoted              INTEGER DEFAULT 0,
      promoted_canonical_id TEXT,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cbs_batch_id ON canonical_bootstrap_staging(batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cbs_needs_review ON canonical_bootstrap_staging(needs_review)`,
    `CREATE INDEX IF NOT EXISTS idx_cbs_promoted ON canonical_bootstrap_staging(promoted)`,
    `CREATE INDEX IF NOT EXISTS idx_cbs_canonical_name ON canonical_bootstrap_staging(canonical_name COLLATE NOCASE)`,

    `CREATE TABLE IF NOT EXISTS canonical_bootstrap_source_products (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      staging_id            INTEGER NOT NULL
                              REFERENCES canonical_bootstrap_staging(id)
                              ON DELETE CASCADE,
      deal_id               TEXT NOT NULL,
      store_id              TEXT NOT NULL,
      store_name            TEXT,
      raw_product_name      TEXT NOT NULL,
      raw_category          TEXT,
      raw_weight            TEXT,
      raw_weight_value      REAL,
      raw_weight_unit       TEXT,
      store_count_at_crawl  INTEGER,
      created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE INDEX IF NOT EXISTS idx_cbsp_staging_id ON canonical_bootstrap_source_products(staging_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cbsp_deal_id ON canonical_bootstrap_source_products(deal_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cbsp_raw_name ON canonical_bootstrap_source_products(raw_product_name COLLATE NOCASE)`,

    // New: product queue table
    `CREATE TABLE IF NOT EXISTS bootstrap_product_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT    NOT NULL,
      norm_name    TEXT    NOT NULL UNIQUE,
      status       TEXT    NOT NULL DEFAULT 'pending',
      source       TEXT,
      deal_count   INTEGER DEFAULT 0,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME
    )`,
    `CREATE INDEX IF NOT EXISTS idx_bpq_status ON bootstrap_product_queue(status)`,
    `CREATE INDEX IF NOT EXISTS idx_bpq_norm ON bootstrap_product_queue(norm_name)`,
  ];

  for (const sql of statements) {
    await db.execute(sql);
  }
  log("✓ Tables created/verified");
}

// ─── Step 2: Populate product queue ──────────────────────────────────────────
//
// Inserts unique product_names from ALL deals (active + inactive) that are not
// already canonicalized or already staged. Skips names already in the queue.

async function step2_populateQueue() {
  // Already-staged raw names (from previous bootstrap runs)
  const stagedNamesRes = await db.execute(
    `SELECT DISTINCT LOWER(TRIM(raw_product_name)) AS norm
     FROM canonical_bootstrap_source_products`
  );
  const stagedNorms = new Set(stagedNamesRes.rows.map((r) => r.norm));

  // Already-canonicalized product names (deals with canonical_id set)
  const canonicalizedRes = await db.execute(
    `SELECT DISTINCT LOWER(TRIM(product_name)) AS norm
     FROM store_products
     WHERE canonical_id IS NOT NULL AND product_name IS NOT NULL`
  );
  const canonicalizedNorms = new Set(canonicalizedRes.rows.map((r) => r.norm));

  // All distinct product names across ALL deals
  const allNamesRes = await db.execute(
    `SELECT
       product_name,
       LOWER(TRIM(product_name)) AS norm_name,
       COUNT(*) AS deal_count,
       MAX(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS has_active,
       MAX(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS has_inactive
     FROM store_products
     WHERE product_name IS NOT NULL AND TRIM(product_name) != ''
     GROUP BY LOWER(TRIM(product_name))
     ORDER BY deal_count DESC`
  );

  let added = 0;
  let skippedAlreadyStaged = 0;
  let skippedAlreadyCanonicalized = 0;
  let skippedAlreadyQueued = 0;

  for (const row of allNamesRes.rows) {
    const norm = row.norm_name;

    if (stagedNorms.has(norm)) { skippedAlreadyStaged++; continue; }
    if (canonicalizedNorms.has(norm)) { skippedAlreadyCanonicalized++; continue; }

    const source = row.has_active && row.has_inactive ? "both"
      : row.has_active ? "active"
      : "inactive";

    try {
      await db.execute({
        sql: `INSERT INTO bootstrap_product_queue (product_name, norm_name, status, source, deal_count)
              VALUES (?, ?, 'pending', ?, ?)`,
        args: [row.product_name, norm, source, row.deal_count],
      });
      added++;
    } catch (e) {
      if (e.message?.includes("UNIQUE")) { skippedAlreadyQueued++; }
      else throw e;
    }
  }

  log(`✓ Queue populated:`);
  log(`    Added to queue:                ${added}`);
  log(`    Skipped (already staged):      ${skippedAlreadyStaged}`);
  log(`    Skipped (already canonicalized): ${skippedAlreadyCanonicalized}`);
  log(`    Skipped (already in queue):    ${skippedAlreadyQueued}`);

  const pendingRes = await db.execute(
    `SELECT COUNT(*) AS n FROM bootstrap_product_queue WHERE status = 'pending'`
  );
  const pending = pendingRes.rows[0].n;
  log(`    Total pending in queue:        ${pending}`);
  return pending;
}

// ─── Step 3: Build groups from queue ─────────────────────────────────────────

async function step3_buildGroups(limit = 0) {
  // Get pending queue items with representative deal info
  // limit=0 means all pending; limit>0 caps to that many norm_names
  const limitClause = limit > 0
    ? `WHERE q.norm_name IN (SELECT norm_name FROM bootstrap_product_queue WHERE status = 'pending' ORDER BY deal_count DESC, norm_name ASC LIMIT ${limit})`
    : `WHERE q.status = 'pending'`;

  const rows = await db.execute(
    `SELECT
       q.product_name, q.norm_name, q.source, q.deal_count,
       d.id AS deal_id, d.store_id, d.product_category AS raw_category,
       d.weight_raw, d.weight_value, d.weight_unit,
       s.name AS store_name
     FROM bootstrap_product_queue q
     JOIN store_products d
       ON LOWER(TRIM(d.product_name)) = q.norm_name
     JOIN stores s ON s.id = d.store_id
     ${limitClause}
     ORDER BY q.deal_count DESC, q.norm_name ASC`
  );

  log(`✓ Queue join returned ${rows.rows.length} deal rows`);

  // Build groups keyed by norm_name
  const groups = new Map();
  const rawToNormKey = new Map();

  for (const row of rows.rows) {
    const normKey = row.norm_name;
    rawToNormKey.set(row.product_name, normKey);

    if (!groups.has(normKey)) {
      groups.set(normKey, {
        representativeName: row.product_name,
        nameCounts: new Map(),
        rawCategory: null,
        categoryCounts: new Map(),
        weightRaw: null,
        weightCounts: new Map(),
        storeCount: 0,
        storeIds: new Set(),
        dealCount: Number(row.deal_count) || 1,
        sourceDeals: [],
      });
    }

    const g = groups.get(normKey);
    g.nameCounts.set(row.product_name, (g.nameCounts.get(row.product_name) || 0) + 1);
    if (row.raw_category) g.categoryCounts.set(row.raw_category, (g.categoryCounts.get(row.raw_category) || 0) + 1);
    if (row.weight_raw) g.weightCounts.set(row.weight_raw, (g.weightCounts.get(row.weight_raw) || 0) + 1);
    g.storeIds.add(row.store_id);
    g.storeCount = g.storeIds.size;

    g.sourceDeals.push({
      deal_id: row.deal_id,
      store_id: row.store_id,
      store_name: row.store_name,
      raw_product_name: row.product_name,
      raw_category: row.raw_category,
      raw_weight: row.weight_raw,
      raw_weight_value: row.weight_value,
      raw_weight_unit: row.weight_unit,
      storeCount: g.storeCount,
    });
  }

  // Resolve representative name and most-frequent values
  for (const [, g] of groups) {
    let maxCount = 0;
    for (const [name, count] of g.nameCounts) {
      if (count > maxCount || (count === maxCount && (!g.representativeName || name < g.representativeName))) {
        maxCount = count;
        g.representativeName = name;
      }
    }
    if (g.categoryCounts.size > 0) {
      let maxCat = 0;
      for (const [cat, count] of g.categoryCounts) {
        if (count > maxCat) { maxCat = count; g.rawCategory = cat; }
      }
    }
    if (g.weightCounts.size > 0) {
      let maxW = 0;
      for (const [w, count] of g.weightCounts) {
        if (count > maxW) { maxW = count; g.weightRaw = w; }
      }
    }
  }

  log(`✓ Deduplicated to ${groups.size} unique pending product names`);
  return { groups, rawToNormKey };
}

// ─── Step 4: Build batch payloads ────────────────────────────────────────────

function step4_buildBatches(groups) {
  const BATCH_SIZE = 25;
  const entries = [...groups.values()];
  const now = Date.now();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const batches = [];
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const batchNum = batches.length + 1;
    const batchNumStr = String(batchNum).padStart(3, "0");
    const batchItemId = `bootstrap-${dateStr}-batch${batchNumStr}-${now}`;

    const lines = chunk.map((g) => {
      let line = `"${g.representativeName}" | category: ${g.rawCategory || "Unknown"}`;
      if (g.weightRaw) line += ` | weight: ${g.weightRaw}`;
      line += ` | seen in ${g.storeCount} store(s)`;
      return line;
    });

    const userMessage = `Extract canonical products from the ${chunk.length} raw product names below.

Key reminders:
- Group all weight variants of the same product into ONE canonical
- Different brands = always separate canonicals, no exceptions
- Always assign a category — do not skip or leave ambiguous
- Non-Indian/non-grocery products → use category "Other"
- Copy raw_names_matched verbatim from the input lines

Input:
${lines.join("\n")}`;

    batches.push({ batchItemId, userMessage, productCount: chunk.length, entries: chunk });
  }

  log(`✓ ${entries.length} products → ${batches.length} batches of ≤${BATCH_SIZE}`);
  return batches;
}

// ─── Step 5: Submit to Batch API ─────────────────────────────────────────────

async function step5_submitBatches(batches) {
  const requests = batches.map((b) => ({
    custom_id: b.batchItemId,
    params: {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: b.userMessage }],
    },
  }));

  const batchResult = await client.messages.batches.create({ requests });

  const totalProducts = batches.reduce((s, b) => s + b.productCount, 0);
  log(`✓ Submitted ${batches.length} batch requests to Anthropic Batch API`);
  log(`  Batch API ID: ${batchResult.id}`);
  log(`  Estimated products: ${totalProducts}`);
  log("  Polling every 60 seconds...");

  return batchResult.id;
}

// ─── Step 6: Poll for completion ─────────────────────────────────────────────

async function step6_poll(batchId) {
  while (true) {
    const batch = await client.messages.batches.retrieve(batchId);
    const { processing_status, request_counts } = batch;
    log(
      `Status: ${processing_status} — ${request_counts.succeeded} succeeded, ` +
      `${request_counts.errored} errored, ${request_counts.processing} processing`
    );
    if (processing_status === "ended") return batch;
    await sleep(60_000);
  }
}

// ─── Step 7: Parse results → staging ─────────────────────────────────────────

function stripFences(text) {
  let s = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return s;
}

async function insertStagingRow(batchId, batchItemId, obj) {
  const res = await db.execute({
    sql: `INSERT INTO canonical_bootstrap_staging
            (batch_id, batch_item_id, canonical_name, brand, product_type, variant, category,
             weight_kg, weight_unit, aliases, ai_confidence, needs_review, review_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      batchId, batchItemId,
      obj.canonical_name,
      obj.brand || null,
      obj.product_type,
      obj.variant || null,
      obj.category || "Other",
      obj.weight_kg != null ? obj.weight_kg : null,
      obj.weight_unit || null,
      JSON.stringify(obj.aliases || []),
      obj.ai_confidence,
      obj.needs_review ? 1 : 0,
      obj.review_note || null,
    ],
  });
  return Number(res.lastInsertRowid);
}

async function insertSourceRows(stagingId, sourceDeals) {
  for (const sd of sourceDeals) {
    try {
      await db.execute({
        sql: `INSERT INTO canonical_bootstrap_source_products
                (staging_id, deal_id, store_id, store_name, raw_product_name,
                 raw_category, raw_weight, raw_weight_value, raw_weight_unit, store_count_at_crawl)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          stagingId, sd.deal_id, sd.store_id, sd.store_name || null,
          sd.raw_product_name, sd.raw_category || null,
          sd.raw_weight || null,
          sd.raw_weight_value != null ? sd.raw_weight_value : null,
          sd.raw_weight_unit || null,
          sd.storeCount,
        ],
      });
    } catch (e) {
      if (!e.message?.includes("UNIQUE")) throw e;
    }
  }
}

async function step7_parseResults(batchId, groups, rawToNormKey) {
  let inserted = 0;
  let merged = 0;
  let sourceLinks = 0;
  let parseFailures = 0;
  let apiErrors = 0;
  let skipped = 0;

  // Resume: skip already-written batch_item_ids
  const doneRows = await db.execute({
    sql: `SELECT DISTINCT batch_item_id FROM canonical_bootstrap_staging WHERE batch_id = ?`,
    args: [batchId],
  });
  const doneIds = new Set(doneRows.rows.map((r) => r.batch_item_id));
  if (doneIds.size > 0) log(`  Resuming: skipping ${doneIds.size} already-written batch items`);

  // Build lookup: representative name (lower) → group
  const repNameToGroup = new Map();
  for (const [normKey, g] of groups) {
    repNameToGroup.set(g.representativeName.toLowerCase(), g);
    repNameToGroup.set(normKey, g);
  }

  // Track which norm_names get processed (for queue update)
  const processedNorms = new Set();

  for await (const result of await client.messages.batches.results(batchId)) {
    const customId = result.custom_id;
    if (doneIds.has(customId)) { skipped++; continue; }

    if (result.result.type === "errored") {
      const errCode = result.result.error?.error_code || "unknown";
      log(`  ✗ Request ${customId} errored: ${errCode}`);
      apiErrors++;
      if (apiErrors > 3) {
        log(`  ABORT: ${apiErrors} API errors exceeded limit of 3. Log: ${logFile}`);
        logStream.end();
        throw new Error(`Too many API errors (${apiErrors}), limit 3. Log: ${logFile}`);
      }
      try {
        await db.execute({
          sql: `INSERT INTO canonical_bootstrap_staging
                  (batch_id, batch_item_id, canonical_name, brand, product_type, variant, category,
                   weight_kg, weight_unit, aliases, ai_confidence, needs_review, review_note)
                VALUES (?, ?, ?, NULL, ?, NULL, 'Other', NULL, NULL, '[]', 'low', 0, NULL)`,
          args: [batchId, customId, `PARSE_ERROR: ${customId}`, "UNKNOWN"],
        });
        inserted++;
      } catch (e) { log(`  ✗ Failed to insert error row: ${e.message}`); }
      continue;
    }

    if (result.result.type !== "succeeded") continue;

    const rawText = result.result.message.content[0]?.text || "";
    let canonicals;
    try {
      canonicals = JSON.parse(stripFences(rawText));
      if (!Array.isArray(canonicals)) throw new Error("Not an array");
    } catch (e) {
      log(`  ✗ JSON parse failure for ${customId}: ${e.message}`);
      log(`    Raw (500 chars): ${rawText.slice(0, 500)}`);
      parseFailures++;
      if (parseFailures > 3) {
        log(`  ABORT: ${parseFailures} parse failures exceeded limit. Log: ${logFile}`);
        logStream.end();
        throw new Error(`Too many parse failures (${parseFailures}). Log: ${logFile}`);
      }
      try {
        await db.execute({
          sql: `INSERT INTO canonical_bootstrap_staging
                  (batch_id, batch_item_id, canonical_name, brand, product_type, variant, category,
                   weight_kg, weight_unit, aliases, ai_confidence, needs_review, review_note)
                VALUES (?, ?, ?, NULL, ?, NULL, 'Other', NULL, NULL, '[]', 'low', 0, NULL)`,
          args: [batchId, customId, `PARSE_ERROR: ${customId}`, "UNKNOWN"],
        });
        inserted++;
      } catch (e2) { log(`  ✗ Failed to insert parse-error row: ${e2.message}`); }
      continue;
    }

    for (const obj of canonicals) {
      if (!obj.canonical_name || !obj.product_type) continue;

      // Duplicate check within staging
      const existingRes = await db.execute({
        sql: `SELECT id, aliases FROM canonical_bootstrap_staging WHERE LOWER(canonical_name) = LOWER(?) LIMIT 1`,
        args: [obj.canonical_name],
      });
      const existing = existingRes.rows[0];

      let stagingId;
      if (existing) {
        stagingId = Number(existing.id);
        merged++;
        // Merge aliases
        try {
          const existingAliases = JSON.parse(existing.aliases || "[]");
          const merged_aliases = [...new Set([...existingAliases, ...(obj.aliases || [])])];
          await db.execute({
            sql: `UPDATE canonical_bootstrap_staging SET aliases = ? WHERE id = ?`,
            args: [JSON.stringify(merged_aliases), stagingId],
          });
        } catch (_) {}
      } else {
        try {
          stagingId = await insertStagingRow(batchId, customId, obj);
          inserted++;
        } catch (e) {
          log(`  ✗ Failed to insert staging row for "${obj.canonical_name}": ${e.message}`);
          continue;
        }
      }

      // Link source products from raw_names_matched
      const rawNamesMatched = obj.raw_names_matched || [];
      const seenDealIds = new Set();

      for (const rawName of rawNamesMatched) {
        const normKey = rawToNormKey.get(rawName) || rawName.trim().toLowerCase();
        const group = groups.get(normKey) || repNameToGroup.get(rawName.toLowerCase()) || repNameToGroup.get(normKey);
        if (!group) continue;
        processedNorms.add(normKey);

        for (const sd of group.sourceDeals) {
          if (seenDealIds.has(sd.deal_id)) continue;
          seenDealIds.add(sd.deal_id);
          try {
            await insertSourceRows(stagingId, [sd]);
            sourceLinks++;
          } catch (_) {}
        }
      }
    }
  }

  // Mark processed queue items as done
  const now = new Date().toISOString();
  let queueUpdated = 0;
  for (const norm of processedNorms) {
    try {
      await db.execute({
        sql: `UPDATE bootstrap_product_queue SET status = 'done', processed_at = ? WHERE norm_name = ?`,
        args: [now, norm],
      });
      queueUpdated++;
    } catch (_) {}
  }

  log(`✓ Results written to staging`);
  log(`  Staging rows inserted:  ${inserted}`);
  log(`  Staging rows merged:    ${merged}`);
  log(`  Source product rows:    ${sourceLinks}`);
  log(`  Parse failures:         ${parseFailures}`);
  log(`  Queue items marked done: ${queueUpdated}`);
}

// ─── Step 8: Summary report ───────────────────────────────────────────────────

async function step8_report(batchId, uniqueCount, batchCount) {
  const total = (await db.execute(`SELECT COUNT(*) as c FROM canonical_bootstrap_staging`)).rows[0].c;
  const uniqueBrands = (await db.execute(`SELECT COUNT(DISTINCT brand) as c FROM canonical_bootstrap_staging WHERE brand IS NOT NULL`)).rows[0].c;

  const aliasRows = (await db.execute(`SELECT aliases FROM canonical_bootstrap_staging`)).rows;
  let totalAliases = 0;
  for (const r of aliasRows) { try { totalAliases += JSON.parse(r.aliases || "[]").length; } catch {} }

  const confRows = (await db.execute(`SELECT ai_confidence, COUNT(*) as c FROM canonical_bootstrap_staging GROUP BY ai_confidence`)).rows;
  const conf = {};
  for (const r of confRows) conf[r.ai_confidence] = r.c;

  const parseErrors = (await db.execute(`SELECT COUNT(*) as c FROM canonical_bootstrap_staging WHERE canonical_name LIKE 'PARSE_ERROR:%'`)).rows[0].c;
  const catRows = (await db.execute(`SELECT category, COUNT(*) as c FROM canonical_bootstrap_staging GROUP BY category ORDER BY c DESC`)).rows;
  const brandRows = (await db.execute(`SELECT brand, COUNT(*) as c FROM canonical_bootstrap_staging WHERE brand IS NOT NULL GROUP BY brand ORDER BY c DESC LIMIT 10`)).rows;
  const totalSourceLinks = (await db.execute(`SELECT COUNT(*) as c FROM canonical_bootstrap_source_products`)).rows[0].c;
  const coveredDeals = (await db.execute(`SELECT COUNT(DISTINCT deal_id) as c FROM canonical_bootstrap_source_products`)).rows[0].c;

  const queueStats = (await db.execute(`SELECT status, COUNT(*) as c FROM bootstrap_product_queue GROUP BY status`)).rows;
  const queueMap = {};
  for (const r of queueStats) queueMap[r.status] = r.c;

  const pct = (n, d) => d > 0 ? ((n / d) * 100).toFixed(0) : "0";
  const pad = (s, w) => String(s).padEnd(w, " ");

  log(`
══════════════════════════════════════════════════════════
  BOOTSTRAP RUN COMPLETE
══════════════════════════════════════════════════════════

  QUEUE STATE
  ─────────────────────────────────────────────────────
  Pending (not yet processed)     : ${queueMap.pending || 0}
  Done (processed this/prev run)  : ${queueMap.done || 0}

  THIS RUN
  ─────────────────────────────────────────────────────
  Unique product names processed  : ${uniqueCount}
  Batches submitted               : ${batchCount} (25 products/batch)
  Batch API ID                    : ${batchId}

  STAGING TOTALS (all runs)
  ─────────────────────────────────────────────────────
  Total canonical rows in staging : ${total}
  Unique brands detected          : ${uniqueBrands}
  Average aliases per canonical   : ${aliasRows.length > 0 ? (totalAliases / aliasRows.length).toFixed(1) : 0}
  Parse / API errors              : ${parseErrors}

  AI CONFIDENCE BREAKDOWN
  ─────────────────────────────────────────────────────
  HIGH    : ${conf.high || 0}  (${pct(conf.high || 0, total)}%)
  MEDIUM  : ${conf.medium || 0}  (${pct(conf.medium || 0, total)}%)
  LOW     : ${conf.low || 0}  (${pct(conf.low || 0, total)}%)

  CATEGORY BREAKDOWN
  ─────────────────────────────────────────────────────
${catRows.map((r) => `  ${pad(r.category, 38)}: ${r.c}`).join("\n")}

  TOP 10 BRANDS
  ─────────────────────────────────────────────────────
${brandRows.map((r) => `  ${pad(r.brand, 38)}: ${r.c}`).join("\n")}

  SOURCE TRACEABILITY
  ─────────────────────────────────────────────────────
  Source product links            : ${totalSourceLinks}
  Deals covered by staging        : ${coveredDeals}

══════════════════════════════════════════════════════════`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`Log file: ${logFile}`);

  // ── --parse-only <batchId> mode ────────────────────────────────────────────
  const parseOnlyIdx = process.argv.indexOf("--parse-only");
  if (parseOnlyIdx !== -1) {
    const resumeBatchId = process.argv[parseOnlyIdx + 1];
    if (!resumeBatchId) { console.error("Usage: --parse-only <batchId>"); process.exit(1); }
    log(`Resume mode: parsing batch ${resumeBatchId}`);
    await step1_createTables();
    await step2_populateQueue();
    const { groups, rawToNormKey } = await step3_buildGroups();
    await step6_poll(resumeBatchId);
    await step7_parseResults(resumeBatchId, groups, rawToNormKey);
    await step8_report(resumeBatchId, groups.size, 0);
    return;
  }

  // ── --queue-only mode ─────────────────────────────────────────────────────
  if (process.argv.includes("--queue-only")) {
    await step1_createTables();
    const pendingCount = await step2_populateQueue();
    log(`Queue populated. Pending: ${pendingCount}`);
    process.exit(0);
  }

  await step1_createTables();

  const pendingCount = await step2_populateQueue();

  if (pendingCount === 0) {
    log("No pending products in queue — nothing to bootstrap. Run link-deals-by-name.js to improve coverage.");
    process.exit(0);
  }

  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 0;
  if (limitIdx !== -1) log(`--limit ${limit}: processing first ${limit} pending products`);

  const { groups, rawToNormKey } = await step3_buildGroups(limit);

  if (groups.size === 0) {
    log("No groups built from pending queue — exiting.");
    process.exit(0);
  }

  const batches = step4_buildBatches(groups);

  // Idempotency check
  const todayRes = await db.execute(
    `SELECT COUNT(*) as c FROM canonical_bootstrap_staging WHERE date(created_at) = date('now')`
  );
  if (Number(todayRes.rows[0].c) > 0) {
    const proceed = await confirm(
      `⚠ Found ${todayRes.rows[0].c} staging rows from today. Re-submit and add more?`
    );
    if (!proceed) { log("Aborted by user."); process.exit(0); }
  }

  const batchId = await step5_submitBatches(batches);
  await step6_poll(batchId);
  await step7_parseResults(batchId, groups, rawToNormKey);
  await step8_report(batchId, groups.size, batches.length);
}

main().catch((err) => {
  console.error("[FATAL]", err.message || err);
  process.exit(1);
});
