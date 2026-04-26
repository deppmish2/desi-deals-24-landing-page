#!/usr/bin/env node
"use strict";
/**
 * recompute-base-keys-local.js
 *
 * Re-runs resolveBaseProduct() against every canonical_products row using the
 * fixed base-product-catalog code (hasWholePhrase() instead of includes()).
 *
 * Updates base_key where:
 *   - Current value is wrong (differs from what the fixed code returns)
 *   - Current value is NULL and the fixed code finds a match
 *   - Fixed code returns NULL (no catalog match) → clears any wrong existing value
 *
 * Safety: writes only to prod_local.db, never to Turso.
 *
 * Usage:
 *   node scripts/recompute-base-keys-local.js --dry-run
 *   node scripts/recompute-base-keys-local.js
 */

const path = require("path");

const LOCAL_DB = path.resolve(__dirname, "../data/prod_local.db");
process.env.DB_FILE = LOCAL_DB;
delete process.env.TURSO_DATABASE_URL;
delete process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;

const db = require("../server/db");
const { resolveBaseProduct } = require("../server/services/base-product-catalog");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await db.ready;
  console.log(`[recompute-base-keys] Target DB : ${LOCAL_DB}`);
  console.log(`[recompute-base-keys] Mode      : ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  const res = await db.execute(
    `SELECT id, canonical_name, base_key FROM canonical_products ORDER BY id`
  );
  const canonicals = res.rows ?? [];
  console.log(`[recompute-base-keys] Canonicals: ${canonicals.length}`);

  const toUpdate = [];   // { id, old_key, new_key }
  const toClear  = [];   // { id, old_key } — had wrong key, now no match
  const toFill   = [];   // { id, new_key } — was NULL, now has a match

  for (const row of canonicals) {
    const result = resolveBaseProduct(row.canonical_name);
    const newKey = result?.base_key ?? null;
    const oldKey = row.base_key ?? null;

    if (oldKey === newKey) continue;

    if (oldKey !== null && newKey !== null && oldKey !== newKey) {
      toUpdate.push({ id: row.id, canonical_name: row.canonical_name, old_key: oldKey, new_key: newKey });
    } else if (oldKey !== null && newKey === null) {
      toClear.push({ id: row.id, canonical_name: row.canonical_name, old_key: oldKey });
    } else if (oldKey === null && newKey !== null) {
      toFill.push({ id: row.id, canonical_name: row.canonical_name, new_key: newKey });
    }
  }

  console.log(`\n[recompute-base-keys] Changes:`);
  console.log(`  Wrong key → corrected key : ${toUpdate.length}`);
  console.log(`  Wrong key → NULL (cleared) : ${toClear.length}`);
  console.log(`  NULL → new key (filled)   : ${toFill.length}`);

  if (toUpdate.length > 0) {
    console.log(`\n[recompute-base-keys] Sample corrected (wrong → right):`);
    toUpdate.slice(0, 10).forEach((r) =>
      console.log(`  "${r.canonical_name}" : "${r.old_key}" → "${r.new_key}"`)
    );
  }

  if (toClear.length > 0) {
    console.log(`\n[recompute-base-keys] Sample cleared (wrong → NULL):`);
    toClear.slice(0, 10).forEach((r) =>
      console.log(`  "${r.canonical_name}" : "${r.old_key}" → NULL`)
    );
  }

  if (toFill.length > 0) {
    console.log(`\n[recompute-base-keys] Sample filled (NULL → key):`);
    toFill.slice(0, 10).forEach((r) =>
      console.log(`  "${r.canonical_name}" → "${r.new_key}"`)
    );
  }

  if (DRY_RUN) {
    console.log(`\n[recompute-base-keys] DRY RUN — no writes made.`);
    return;
  }

  const BATCH = 500;
  let written = 0;

  const allChanges = [
    ...toUpdate.map((r) => ({ sql: "UPDATE canonical_products SET base_key = ? WHERE id = ?", args: [r.new_key, r.id] })),
    ...toClear.map((r)  => ({ sql: "UPDATE canonical_products SET base_key = NULL WHERE id = ?", args: [r.id] })),
    ...toFill.map((r)   => ({ sql: "UPDATE canonical_products SET base_key = ? WHERE id = ?", args: [r.new_key, r.id] })),
  ];

  for (let i = 0; i < allChanges.length; i += BATCH) {
    await db.batch(allChanges.slice(i, i + BATCH), "write");
    written += Math.min(BATCH, allChanges.length - i);
    process.stdout.write(`\r[recompute-base-keys] Written ${written} / ${allChanges.length}`);
  }
  console.log();

  // Verify
  const after = await db.execute(
    `SELECT COUNT(*) as with_key FROM canonical_products WHERE base_key IS NOT NULL AND base_key != ''`
  );
  console.log(`\n[recompute-base-keys] Done.`);
  console.log(`[recompute-base-keys] Canonicals with base_key: ${after.rows[0].with_key} / ${canonicals.length}`);
}

main().catch((e) => {
  console.error("[recompute-base-keys] Fatal:", e);
  process.exit(1);
});
