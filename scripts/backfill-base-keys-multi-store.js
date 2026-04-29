#!/usr/bin/env node
"use strict";
/**
 * backfill-base-keys-multi-store.js
 *
 * Assigns base_key to canonicals that appear in 2+ stores but have no base_key.
 * These are the products where cross-store comparison is broken right now.
 *
 * Strategy (no AI, no CSV lookup):
 *   1. Try resolveBaseProduct() — picks up any new CSV entries added since last run.
 *   2. Fall back to normalised canonical_name — groups same-product-same-brand
 *      across stores even when not in the popular products CSV.
 *
 * The fallback base_key is brand-inclusive (e.g. "wagh bakri premium tea"),
 * which means it enables same-brand cross-store comparison. Cross-brand grouping
 * (e.g. Wagh Bakri ↔ Red Label) requires CSV catalog coverage.
 *
 * Usage:
 *   node scripts/backfill-base-keys-multi-store.js --dry-run
 *   node scripts/backfill-base-keys-multi-store.js
 */

const path = require("path");

const LOCAL_DB = path.resolve(__dirname, "../data/prod_local.db");
process.env.DB_FILE = LOCAL_DB;
delete process.env.TURSO_DATABASE_URL;
delete process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;

const db = require("../server/db");
const { resolveBaseProduct, normalizeCatalogText } = require("../server/services/base-product-catalog");

const DRY_RUN = process.argv.includes("--dry-run");
const MIN_STORES = parseInt(process.argv.find((a) => a.startsWith("--min-stores="))?.split("=")[1] ?? "2", 10);

async function main() {
  await db.ready;
  console.log(`[backfill-base-keys-multi-store] Target DB  : ${LOCAL_DB}`);
  console.log(`[backfill-base-keys-multi-store] Mode       : ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`[backfill-base-keys-multi-store] Min stores : ${MIN_STORES}`);

  // Load canonicals in 2+ stores with no base_key
  const res = await db.execute(`
    SELECT cp.id, cp.canonical_name, cp.category, COUNT(DISTINCT d.store_id) as store_count
    FROM canonical_products cp
    JOIN store_products d ON d.canonical_id = cp.id AND d.is_active = 1
    WHERE (cp.base_key IS NULL OR cp.base_key = '')
    GROUP BY cp.id
    HAVING store_count >= ${MIN_STORES}
    ORDER BY store_count DESC, cp.canonical_name
  `);
  const canonicals = res.rows ?? [];
  console.log(`[backfill-base-keys-multi-store] Canonicals : ${canonicals.length} (in ${MIN_STORES}+ stores, no base_key)\n`);

  const viaCatalog = [];
  const viaName    = [];

  for (const row of canonicals) {
    // 1. Try CSV catalog first
    const catalogResult = resolveBaseProduct(row.canonical_name);
    if (catalogResult?.base_key) {
      viaCatalog.push({ ...row, new_key: catalogResult.base_key, method: "catalog" });
      continue;
    }

    // 2. Fall back to normalised canonical_name
    const normalised = normalizeCatalogText(row.canonical_name);
    if (normalised) {
      viaName.push({ ...row, new_key: normalised, method: "name" });
    }
  }

  const all = [...viaCatalog, ...viaName];

  console.log(`[backfill-base-keys-multi-store] Via CSV catalog    : ${viaCatalog.length}`);
  console.log(`[backfill-base-keys-multi-store] Via canonical name : ${viaName.length}`);
  console.log(`[backfill-base-keys-multi-store] Total to assign    : ${all.length}`);

  if (viaCatalog.length > 0) {
    console.log(`\nSample — via catalog:`);
    viaCatalog.slice(0, 8).forEach((r) =>
      console.log(`  [${r.store_count} stores] "${r.canonical_name}" → "${r.new_key}"`)
    );
  }

  if (viaName.length > 0) {
    console.log(`\nSample — via name normalisation:`);
    viaName.slice(0, 8).forEach((r) =>
      console.log(`  [${r.store_count} stores] "${r.canonical_name}" → "${r.new_key}"`)
    );
  }

  if (DRY_RUN) {
    console.log(`\n[backfill-base-keys-multi-store] DRY RUN — no writes made.`);
    return;
  }

  const BATCH = 500;
  const stmts = all.map((r) => ({
    sql:  "UPDATE canonical_products SET base_key = ? WHERE id = ?",
    args: [r.new_key, r.id],
  }));

  let written = 0;
  for (let i = 0; i < stmts.length; i += BATCH) {
    await db.batch(stmts.slice(i, i + BATCH), "write");
    written += Math.min(BATCH, stmts.length - i);
  }

  console.log(`\n[backfill-base-keys-multi-store] Done. ${written} base_keys written.`);

  // Verify
  const after = await db.execute(`
    SELECT COUNT(DISTINCT cp.id) as still_missing
    FROM canonical_products cp
    JOIN store_products d ON d.canonical_id = cp.id AND d.is_active = 1
    WHERE (cp.base_key IS NULL OR cp.base_key = '')
    GROUP BY cp.id HAVING COUNT(DISTINCT d.store_id) >= ${MIN_STORES}
  `);
  console.log(`[backfill-base-keys-multi-store] Still missing (${MIN_STORES}+ stores): ${after.rows?.length ?? 0}`);
}

main().catch((e) => {
  console.error("[backfill-base-keys-multi-store] Fatal:", e);
  process.exit(1);
});
