#!/usr/bin/env node
"use strict";
/**
 * Backfills canonical_products.image_url from store_products where NULL.
 * Prefers: is_active=1 > Shopify CDN > most recent crawl_timestamp.
 *
 * Usage (dry-run):
 *   node scripts/backfill-images.js
 *   DB_FILE=data/prod_local.db node scripts/backfill-images.js
 *
 * Usage (apply):
 *   node scripts/backfill-images.js --apply
 *   DB_FILE=data/prod_local.db node scripts/backfill-images.js --apply
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { createClient } = require("@libsql/client");

const apply = process.argv.includes("--apply");
const dbFile = process.env.DB_FILE;
const tursoUrl = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;

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
  console.log(`Mode: ${apply ? "APPLY" : "DRY-RUN"} | DB: ${dbFile || tursoUrl}`);

  // Fetch all canonicals missing image_url that have candidates in store_products
  // Order: active first, Shopify CDN first (most reliable), newest crawl
  const candidates = await query(`
    SELECT
      cp.id AS canonical_id,
      (
        SELECT sp.image_url
        FROM store_product_mappings spm
        JOIN store_products sp ON sp.id = spm.deal_id
        WHERE spm.canonical_id = cp.id
          AND sp.image_url IS NOT NULL
          AND sp.image_url != ''
        ORDER BY
          sp.is_active DESC,
          CASE WHEN sp.image_url LIKE '%cdn.shopify.com%' THEN 0 ELSE 1 END ASC,
          sp.crawl_timestamp DESC
        LIMIT 1
      ) AS best_image_url
    FROM canonical_products cp
    WHERE cp.image_url IS NULL
  `);

  const toUpdate = candidates.filter(r => r.best_image_url);
  const noImage  = candidates.length - toUpdate.length;

  console.log(`Canonicals with NULL image_url: ${candidates.length}`);
  console.log(`  -> backfillable: ${toUpdate.length}`);
  console.log(`  -> no image in any store listing: ${noImage}`);

  if (!apply) {
    console.log("\nDry-run done. Pass --apply to write.");
    // Show sample
    console.log("\nSample (first 5):");
    toUpdate.slice(0, 5).forEach(r => console.log(`  ${r.canonical_id}: ${r.best_image_url}`));
    return;
  }

  // Batch updates in chunks of 100
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK);
    const stmts = chunk.map(r => ({
      sql: "UPDATE canonical_products SET image_url = ? WHERE id = ?",
      args: [r.best_image_url, r.canonical_id],
    }));
    await batchWrite(stmts);
    updated += chunk.length;
    process.stdout.write(`\rUpdated ${updated}/${toUpdate.length}...`);
  }

  console.log(`\nDone. ${updated} canonical_products.image_url backfilled.`);

  // Verify
  const remaining = await query("SELECT COUNT(*) AS n FROM canonical_products WHERE image_url IS NULL");
  console.log(`Remaining NULL image_url: ${remaining[0].n}`);
}

main().catch(err => { console.error(err); process.exit(1); });
