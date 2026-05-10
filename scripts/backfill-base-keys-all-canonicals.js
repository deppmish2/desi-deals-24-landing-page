#!/usr/bin/env node
"use strict";
/**
 * Backfills canonical_products.base_key from CSV for all canonicals where
 * base_key IS NULL. Also backfills store_products.canonical_id from
 * store_product_mappings for active products with NULL canonical_id.
 *
 * Usage:
 *   DB_FILE=data/prod_local.db node scripts/backfill-base-keys-all-canonicals.js
 *   DB_FILE=data/prod_local.db node scripts/backfill-base-keys-all-canonicals.js --apply
 *   node scripts/backfill-base-keys-all-canonicals.js  # Turso prod (needs .env)
 *   node scripts/backfill-base-keys-all-canonicals.js --apply  # Turso prod apply
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");
const { resolveBaseProduct } = require("../server/services/base-product-catalog");

const APPLY = process.argv.includes("--apply");
const BATCH = 500;

const dbFile    = process.env.DB_FILE;
const tursoUrl  = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN  || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;

if (!dbFile && !tursoUrl) {
  console.error("Error: set DB_FILE (local) or TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (prod)");
  process.exit(1);
}

const client = dbFile
  ? createClient({ url: `file:${dbFile}` })
  : createClient({ url: tursoUrl, authToken: tursoToken });

async function query(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}

async function batchWrite(stmts) {
  await client.batch(stmts, "write");
}

async function main() {
  console.log(`[backfill] mode=${APPLY ? "APPLY" : "DRY RUN"} target=${dbFile ?? tursoUrl}`);

  // ── 1. base_key backfill ────────────────────────────────────────────────
  const canonicals = await query(
    `SELECT id, canonical_name, base_key FROM canonical_products
     WHERE base_key IS NULL OR base_key = ''
     ORDER BY id`
  );
  console.log(`[backfill] ${canonicals.length} canonicals with NULL base_key`);

  const proposed = [];
  for (const row of canonicals) {
    const match = resolveBaseProduct(row.canonical_name);
    if (match?.base_key) {
      proposed.push({
        id: row.id,
        canonical_name: row.canonical_name,
        old_base_key: row.base_key ?? null,
        proposed_base_key: match.base_key,
      });
    }
  }
  console.log(`[backfill] ${proposed.length} canonicals will receive a base_key from CSV`);

  if (!APPLY) {
    const outDir = path.join(__dirname, "out");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, "base-key-backfill-preview.json");
    fs.writeFileSync(outPath, JSON.stringify(proposed, null, 2));
    console.log(`[backfill] Preview written to ${outPath}`);
  } else {
    for (let i = 0; i < proposed.length; i += BATCH) {
      const chunk = proposed.slice(i, i + BATCH);
      const stmts = chunk.map((r) => ({
        sql: `UPDATE canonical_products SET base_key = ? WHERE id = ? AND (base_key IS NULL OR base_key = '')`,
        args: [r.proposed_base_key, r.id],
      }));
      await batchWrite(stmts);
      console.log(`[backfill] wrote chunk ${Math.floor(i / BATCH) + 1} (${chunk.length} rows)`);
    }
    console.log(`[backfill] base_key backfill complete`);
  }

  // ── 2. sp.canonical_id gap backfill ────────────────────────────────────
  const gapCount = await query(
    `SELECT COUNT(*) AS n FROM store_products sp
     WHERE sp.canonical_id IS NULL AND sp.is_active = 1
       AND EXISTS (SELECT 1 FROM store_product_mappings WHERE deal_id = sp.id)`
  );
  console.log(`[backfill] ${gapCount[0].n} active products with NULL canonical_id but have spm entry`);

  if (!APPLY) {
    console.log("[backfill] DRY RUN — no writes. Re-run with --apply to commit.");
    return;
  }

  await client.execute({
    sql: `UPDATE store_products
          SET canonical_id = (
            SELECT canonical_id FROM store_product_mappings
            WHERE deal_id = store_products.id
            ORDER BY match_confidence DESC
            LIMIT 1
          )
          WHERE canonical_id IS NULL
            AND is_active = 1
            AND EXISTS (SELECT 1 FROM store_product_mappings WHERE deal_id = store_products.id)`,
    args: [],
  });
  console.log("[backfill] sp.canonical_id gap backfill complete");
}

main().catch((e) => {
  console.error("[backfill] Fatal:", e);
  process.exit(1);
});
