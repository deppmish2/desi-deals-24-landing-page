#!/usr/bin/env node
/**
 * Re-link source deals for already-promoted canonicals.
 *
 * Use after a wipe+partial-promote leaves deals.canonical_id empty for canonicals
 * whose staging rows are marked promoted=1 (phase 1 skips them).
 *
 * Usage:
 *   node scripts/relink-promoted-canonicals.js --db-file data/prod_local.db
 *   node scripts/relink-promoted-canonicals.js --db-file data/prod_local.db --execute
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

function confidenceToScore(conf) {
  if (conf === "high") return 1.0;
  if (conf === "medium") return 0.92;
  return 0.80;
}

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = require("path").resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error("ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set.");
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

const isDryRun = !process.argv.includes("--execute");
const client = getClient();

console.log(`Mode: ${isDryRun ? "DRY RUN" : "EXECUTE"} (add --execute to apply)`);

async function main() {
  // Fetch all promoted staging rows with their source deals
  const rows = await client.execute(`
    SELECT s.id AS staging_id, s.promoted_canonical_id, s.ai_confidence,
           sp.deal_id
    FROM canonical_bootstrap_staging s
    JOIN canonical_bootstrap_source_products sp ON sp.staging_id = s.id
    WHERE s.promoted = 1
      AND s.promoted_canonical_id IS NOT NULL
  `);

  console.log(`Source deal links for promoted canonicals: ${rows.rows.length}`);

  if (isDryRun) {
    // Count how many deals are currently unlinked among these source deals
    const dealIds = [...new Set(rows.rows.map(r => r.deal_id))];
    console.log(`Distinct source deals: ${dealIds.length}`);

    // Sample check
    const placeholders = dealIds.slice(0, 500).map(() => "?").join(",");
    const unlinked = await client.execute({
      sql: `SELECT COUNT(*) as n FROM deals WHERE id IN (${placeholders}) AND canonical_id IS NULL`,
      args: dealIds.slice(0, 500),
    });
    console.log(`[DRY RUN] Unlinked among first 500 source deals: ${unlinked.rows[0].n}`);
    console.log(`[DRY RUN] Would re-insert up to ${rows.rows.length} deal_mappings and update deals.canonical_id`);
    return;
  }

  const now = new Date().toISOString();
  let mappingsInserted = 0;
  let dealsUpdated = 0;

  // Batch into chunks of 500 to avoid huge transactions
  const CHUNK = 500;
  const allRows = rows.rows;
  for (let i = 0; i < allRows.length; i += CHUNK) {
    const chunk = allRows.slice(i, i + CHUNK);
    const tx = await client.transaction("write");
    try {
      for (const row of chunk) {
        const conf = confidenceToScore(row.ai_confidence);
        await tx.execute({
          sql: `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
                VALUES (?, ?, 'bootstrap', ?, ?)
                ON CONFLICT(deal_id, canonical_id) DO NOTHING`,
          args: [row.deal_id, row.promoted_canonical_id, conf, now],
        });
        mappingsInserted++;

        const r = await tx.execute({
          sql: `UPDATE deals SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
          args: [row.promoted_canonical_id, row.deal_id],
        });
        dealsUpdated += r.rowsAffected;
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }

    if (i % 5000 === 0 && i > 0) {
      console.log(`  Progress: ${i}/${allRows.length} links processed...`);
    }
  }

  console.log(`\nDONE:`);
  console.log(`  deal_mappings inserted: ${mappingsInserted}`);
  console.log(`  deals.canonical_id updated: ${dealsUpdated}`);

  // Now run broad name sweep for all canonicals
  console.log(`\nBroad sweep: linking remaining deals by product name...`);

  const canonicalNames = await client.execute(`
    SELECT cp.id AS canonical_id, sp.raw_product_name
    FROM canonical_products cp
    JOIN canonical_bootstrap_source_products sp
      ON sp.staging_id IN (
        SELECT id FROM canonical_bootstrap_staging WHERE promoted_canonical_id = cp.id
      )
    GROUP BY cp.id, sp.raw_product_name
  `);

  const namesByCanonical = new Map();
  for (const r of canonicalNames.rows) {
    if (!namesByCanonical.has(r.canonical_id)) namesByCanonical.set(r.canonical_id, new Set());
    namesByCanonical.get(r.canonical_id).add(r.raw_product_name.toLowerCase().trim());
  }

  let broadMappings = 0;
  let broadDeals = 0;
  let processed = 0;
  const total = namesByCanonical.size;

  for (const [canonicalId, rawNames] of namesByCanonical) {
    if (rawNames.size === 0) { processed++; continue; }

    const placeholders = [...rawNames].map(() => "?").join(", ");
    const matchedDeals = await client.execute({
      sql: `SELECT id FROM deals
            WHERE LOWER(TRIM(product_name)) IN (${placeholders})
              AND canonical_id IS NULL`,
      args: [...rawNames],
    });

    if (matchedDeals.rows.length === 0) { processed++; continue; }

    const tx2 = await client.transaction("write");
    try {
      for (const deal of matchedDeals.rows) {
        await tx2.execute({
          sql: `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
                VALUES (?, ?, 'bootstrap-name-sweep', 0.85, ?)
                ON CONFLICT(deal_id, canonical_id) DO NOTHING`,
          args: [deal.id, canonicalId, now],
        });
        await tx2.execute({
          sql: `UPDATE deals SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
          args: [canonicalId, deal.id],
        });
        broadMappings++;
        broadDeals++;
      }
      await tx2.commit();
    } catch (e) {
      await tx2.rollback();
      console.error(`  ✗ Broad sweep failed for ${canonicalId}: ${e.message}`);
    }

    processed++;
    if (processed % 200 === 0) console.log(`  Progress: ${processed}/${total} canonicals swept...`);
  }

  console.log(`  Broad sweep done: ${broadMappings} additional deal_mappings, ${broadDeals} deals linked`);

  // Final coverage
  const covResult   = await client.execute(`SELECT COUNT(*) as cnt FROM deals WHERE canonical_id IS NOT NULL`);
  const totalResult = await client.execute(`SELECT COUNT(*) as cnt FROM deals`);
  const linkedDeals = covResult.rows[0].cnt;
  const totalDeals  = totalResult.rows[0].cnt;
  const coverage    = totalDeals > 0 ? Math.round((linkedDeals / totalDeals) * 100) : 0;
  console.log(`\nFinal coverage: ${linkedDeals}/${totalDeals} all deals (${coverage}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
