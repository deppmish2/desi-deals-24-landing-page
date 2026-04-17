"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

const CSV_FILE = process.argv[2];
if (!CSV_FILE) { console.error("Usage: node scripts/import-openai-csv.js <csv-file>"); process.exit(1); }

const DEFAULT_DB_FILE = "data/prod_local.db";
const abs = path.resolve(process.env.DB_FILE || DEFAULT_DB_FILE);
const db = createClient({ url: `file:${abs}` });
console.log(`DB: ${abs}`);

// ── Minimal RFC-4180 CSV parser ───────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let col = "", row = [], inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { col += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { col += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(col); col = ""; }
      else if (ch === '\n') {
        row.push(col); col = "";
        if (row.some(c => c !== "")) rows.push(row);
        row = [];
      } else if (ch !== '\r') { col += ch; }
    }
  }
  if (col || row.length) { row.push(col); if (row.some(c => c !== "")) rows.push(row); }
  return rows;
}

async function main() {
  const text = fs.readFileSync(path.resolve(CSV_FILE), "utf8");
  const rows = parseCSV(text);
  const header = rows[0];

  const EXPECTED = ["canonical_name","brand","product_type","variant","category",
    "weight_kg","weight_unit","aliases","ai_confidence","needs_review","review_note","raw_names_matched"];
  for (const col of EXPECTED) {
    if (!header.includes(col)) { console.error(`Missing column: ${col}`); process.exit(1); }
  }

  const idx = col => header.indexOf(col);
  const BATCH_ID = `openai-import-${new Date().toISOString().slice(0, 10)}`;

  // Check for already-imported rows from this batch_id
  const doneRes = await db.execute({ sql: `SELECT COUNT(*) AS c FROM canonical_bootstrap_staging WHERE batch_id = ?`, args: [BATCH_ID] });
  const alreadyDone = Number(doneRes.rows[0].c);
  if (alreadyDone > 0) {
    console.log(`⚠ ${alreadyDone} rows already imported for batch_id=${BATCH_ID}. Skipping duplicates.`);
  }
  const doneItemsRes = await db.execute({ sql: `SELECT batch_item_id FROM canonical_bootstrap_staging WHERE batch_id = ?`, args: [BATCH_ID] });
  const doneIds = new Set(doneItemsRes.rows.map(r => r.batch_item_id));

  const dataRows = rows.slice(1);
  let inserted = 0, skipped = 0, errors = 0;
  const queueNormsProcessed = new Set();

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const batchItemId = `${BATCH_ID}-row${i + 1}`;

    if (doneIds.has(batchItemId)) { skipped++; continue; }

    const get = col => (row[idx(col)] || "").trim();
    const canonical_name = get("canonical_name");
    if (!canonical_name || canonical_name.startsWith("PARSE_ERROR")) { skipped++; continue; }

    const brand        = get("brand")        || null;
    const product_type = get("product_type") || canonical_name;
    const variant      = get("variant")      || null;
    const category     = get("category")     || "Other";
    const weight_kg    = parseFloat(get("weight_kg")) || null;
    const weight_unit  = get("weight_unit")  || null;
    const aliases      = get("aliases")      || "[]";
    const ai_confidence = get("ai_confidence") || "low";
    const needs_review = get("needs_review") === "1" ? 1 : 0;
    const review_note  = get("review_note")  || null;
    const raw_names_matched = get("raw_names_matched");

    // Store aliases as JSON array (pipe-separated input → JSON)
    let aliasesJson;
    try {
      aliasesJson = aliases.startsWith("[")
        ? aliases
        : JSON.stringify(aliases ? aliases.split("|").map(a => a.trim()).filter(Boolean) : []);
    } catch { aliasesJson = "[]"; }

    try {
      const res = await db.execute({
        sql: `INSERT INTO canonical_bootstrap_staging
                (batch_id, batch_item_id, canonical_name, brand, product_type, variant, category,
                 weight_kg, weight_unit, aliases, ai_confidence, needs_review, review_note)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [BATCH_ID, batchItemId, canonical_name, brand, product_type, variant, category,
               weight_kg, weight_unit, aliasesJson, ai_confidence, needs_review, review_note],
      });
      const stagingId = Number(res.lastInsertRowid);
      inserted++;

      // Insert source product rows for each raw_name_matched
      const rawNames = raw_names_matched.split("|").map(n => n.trim()).filter(Boolean);
      for (const rawName of rawNames) {
        const normName = rawName.toLowerCase().trim();

        // Find matching deals
        const deals = await db.execute({
          sql: `SELECT d.id AS deal_id, d.store_id, s.name AS store_name,
                       d.product_name AS raw_product_name, d.product_category AS raw_category,
                       d.weight_raw, d.weight_value, d.weight_unit AS deal_weight_unit,
                       (SELECT COUNT(*) FROM deals d2 WHERE LOWER(TRIM(d2.product_name)) = LOWER(TRIM(d.product_name))) AS store_count
                FROM deals d
                JOIN stores s ON s.id = d.store_id
                WHERE LOWER(TRIM(d.product_name)) = ?
                LIMIT 50`,
          args: [normName],
        });

        for (const deal of deals.rows) {
          try {
            await db.execute({
              sql: `INSERT OR IGNORE INTO canonical_bootstrap_source_products
                      (staging_id, deal_id, store_id, store_name, raw_product_name,
                       raw_category, raw_weight, raw_weight_value, raw_weight_unit, store_count_at_crawl)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [stagingId, deal.deal_id, deal.store_id, deal.store_name,
                     deal.raw_product_name, deal.raw_category, deal.weight_raw,
                     deal.raw_weight_value, deal.deal_weight_unit, deal.store_count],
            });
          } catch {}
        }

        // Mark queue item done
        await db.execute({
          sql: `UPDATE bootstrap_product_queue SET status = 'done', processed_at = ? WHERE norm_name = ?`,
          args: [new Date().toISOString(), normName],
        });
        queueNormsProcessed.add(normName);
      }
    } catch (e) {
      console.error(`  ✗ Row ${i + 1} (${canonical_name}): ${e.message}`);
      errors++;
    }
  }

  // Final report
  const queueStats = await db.execute(`SELECT status, COUNT(*) AS c FROM bootstrap_product_queue GROUP BY status`);
  const stagingTotal = await db.execute(`SELECT COUNT(*) AS c FROM canonical_bootstrap_staging`);
  const sourceTotal  = await db.execute(`SELECT COUNT(*) AS c FROM canonical_bootstrap_source_products`);

  console.log(`
══════════════════════════════════════════════════
  OPENAI CSV IMPORT COMPLETE
══════════════════════════════════════════════════
  Rows processed  : ${dataRows.length}
  Inserted        : ${inserted}
  Skipped         : ${skipped}
  Errors          : ${errors}
  Queue norms done: ${queueNormsProcessed.size}

  STAGING TOTALS
  Total canonical rows : ${stagingTotal.rows[0].c}
  Source product rows  : ${sourceTotal.rows[0].c}

  QUEUE STATE`);
  for (const r of queueStats.rows) console.log(`  ${r.status.padEnd(10)}: ${r.c}`);
  console.log("══════════════════════════════════════════════════");
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
