#!/usr/bin/env node
"use strict";
/**
 * backfill-unmapped-deals-local.js
 *
 * Runs the fixed slot-based auto-mapper against all unmapped deals in
 * prod_local.db only. Never touches Turso or any remote DB.
 *
 * Usage:
 *   node scripts/backfill-unmapped-deals-local.js
 *   node scripts/backfill-unmapped-deals-local.js --dry-run
 */

// Safety: force local DB regardless of any env vars already set
const path = require("path");
const LOCAL_DB = path.resolve(__dirname, "../data/prod_local.db");
process.env.DB_FILE = LOCAL_DB;
delete process.env.TURSO_DATABASE_URL;
delete process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;

const db = require("../server/db");
const { loadPriorityCanonicals, autoMapDeals, matchesCanonical, norm } = require("../crawler/utils/auto-mapper");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await db.ready;

  console.log(`[backfill] Target DB: ${LOCAL_DB}`);
  console.log(`[backfill] Mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  // Baseline stats
  const before = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN canonical_id IS NULL THEN 1 ELSE 0 END) as unmapped
    FROM store_products WHERE is_active = 1
  `);
  const { total, unmapped } = before.rows[0];
  console.log(`[backfill] Active deals: ${total} total, ${unmapped} unmapped`);

  // Load canonicals eligible for slot matching
  console.log("[backfill] Loading is_match_priority canonicals…");
  const canonicals = await loadPriorityCanonicals(db);
  console.log(`[backfill] Loaded ${canonicals.length} canonicals`);

  if (canonicals.length === 0) {
    console.log("[backfill] No match-priority canonicals found. Exiting.");
    return;
  }

  // Load only unmapped deals
  const res = await db.execute(`
    SELECT id, product_url, product_name, weight_value, weight_unit
    FROM store_products
    WHERE is_active = 1
      AND canonical_id IS NULL
  `);
  const deals = res.rows ?? [];
  console.log(`[backfill] Unmapped deals to process: ${deals.length}`);

  if (DRY_RUN) {
    let wouldMap = 0;
    const sampleMatches = [];

    for (const deal of deals) {
      const normed = norm(deal.product_name);
      for (const canon of canonicals) {
        if (matchesCanonical(normed, deal.weight_value, deal.weight_unit, canon) === true) {
          wouldMap++;
          if (sampleMatches.length < 20) {
            sampleMatches.push({ deal: deal.product_name, canonical: canon.canonical_name });
          }
          break;
        }
      }
    }

    console.log(`[backfill] DRY RUN: would map ${wouldMap} of ${deals.length} unmapped deals`);
    console.log(`[backfill] Recovery rate: ${((wouldMap / deals.length) * 100).toFixed(1)}%`);
    console.log("\n[backfill] Sample matches:");
    for (const { deal, canonical } of sampleMatches) {
      console.log(`  "${deal}" → "${canonical}"`);
    }
    return;
  }

  // Run the mapper
  const mapped = await autoMapDeals(db, deals, canonicals);
  console.log(`[backfill] Created ${mapped} new deal_mappings`);

  // Sync deals.canonical_id from new mappings (first match per deal wins)
  await db.execute(`
    UPDATE store_products
    SET canonical_id = (
      SELECT canonical_id FROM store_product_mappings
      WHERE deal_id = store_products.id
        AND match_method = 'slot_match'
      LIMIT 1
    )
    WHERE is_active = 1
      AND canonical_id IS NULL
  `);

  // Final stats
  const after = await db.execute(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN canonical_id IS NULL THEN 1 ELSE 0 END) as still_unmapped
    FROM store_products WHERE is_active = 1
  `);
  const { total: total2, still_unmapped } = after.rows[0];
  const resolved = unmapped - still_unmapped;
  console.log(`\n[backfill] Done.`);
  console.log(`[backfill]   Resolved: ${resolved} deals`);
  console.log(`[backfill]   Still unmapped: ${still_unmapped} of ${total2}`);
  console.log(`[backfill]   Recovery rate: ${((resolved / unmapped) * 100).toFixed(1)}%`);
}

main().catch((e) => {
  console.error("[backfill] Fatal:", e);
  process.exit(1);
});
