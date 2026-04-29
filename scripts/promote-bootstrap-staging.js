#!/usr/bin/env node
/**
 * Promote AI-bootstrapped canonical data from staging into production tables.
 *
 * Usage:
 *   node scripts/promote-bootstrap-staging.js                    # Dry run on env DB
 *   node scripts/promote-bootstrap-staging.js --execute           # Apply to env DB
 *   node scripts/promote-bootstrap-staging.js --db-file <path>    # Dry run on local SQLite
 *   node scripts/promote-bootstrap-staging.js --db-file <path> --execute  # Apply to local SQLite
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const path = require("path");
const { resolveBaseProduct } = require("../server/services/base-product-catalog");

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "item";
}

function nextUniqueId(baseName, usedSet) {
  const base = slugify(baseName);
  let id = base;
  let counter = 2;
  while (usedSet.has(id)) { id = `${base}-${counter++}`; }
  usedSet.add(id);
  return id;
}

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
  const abs = require("path").resolve(process.env.DB_FILE || "data/prod_local.db");
  console.log(`DB: ${abs}`);
  return require("@libsql/client").createClient({ url: `file:${abs}` });
}

const isDryRun = !process.argv.includes("--execute");
const client = getClient();

console.log(`Mode: ${isDryRun ? "DRY RUN" : "EXECUTE"} (add --execute to apply)`);
console.log("");

async function main() {
  // No guard needed — query filters WHERE needs_review=0 AND promoted=0,
  // so already-promoted rows are skipped automatically on re-runs.

  // Fetch staging rows
  const stagingResult = await client.execute(
    `SELECT id, canonical_name, brand, product_type, variant, category,
            weight_kg, weight_unit, aliases, ai_confidence
     FROM canonical_bootstrap_staging
     WHERE needs_review = 0 AND promoted = 0
     ORDER BY id`
  );
  const stagingRows = stagingResult.rows;

  // Fetch source product links
  const sourceLinkResult = await client.execute(
    `SELECT sp.staging_id, sp.deal_id
     FROM canonical_bootstrap_source_products sp
     JOIN canonical_bootstrap_staging s ON s.id = sp.staging_id
     WHERE s.needs_review = 0 AND s.promoted = 0`
  );
  const sourceLinkRows = sourceLinkResult.rows;

  // Build map: staging_id → [deal_id, ...]
  const dealsByStaging = new Map();
  for (const row of sourceLinkRows) {
    if (!dealsByStaging.has(row.staging_id)) {
      dealsByStaging.set(row.staging_id, []);
    }
    dealsByStaging.get(row.staging_id).push(row.deal_id);
  }

  console.log(`Staging rows to promote: ${stagingRows.length}`);
  console.log("");

  // Track counts
  let canonicalsInserted = 0;
  let mappingsInserted = 0;
  let dealsUpdated = 0;

  // Seed usedCanonicalIds with all existing canonical_products IDs
  const existingIds = await client.execute(`SELECT id FROM canonical_products`);
  const usedCanonicalIds = new Set(existingIds.rows.map(r => r.id));

  if (!isDryRun) {
    const tx = await client.transaction("write");
    try {
      for (const row of stagingRows) {
        // Generate unique canonical ID
        const canonicalId = nextUniqueId(row.canonical_name, usedCanonicalIds);

        // Parse aliases
        let aliases = [];
        if (row.aliases) {
          try {
            aliases = JSON.parse(row.aliases);
          } catch {
            aliases = [];
          }
        }

        // Calculate match confidence
        const matchConfidence = confidenceToScore(row.ai_confidence);

        // Build brand_slots
        let brandSlots = null;
        if (row.brand) {
          const words = row.brand.split(/\s+/);
          brandSlots = words.map((w) => [w]);
        }

        // Insert canonical_products
        const baseKey = resolveBaseProduct(row.canonical_name)?.base_key ?? null;
        await tx.execute({
          sql: `INSERT INTO canonical_products
                (id, canonical_name, category, common_aliases, verified, created_at, brand_slots, base_key)
                VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
          args: [
            canonicalId,
            row.canonical_name,
            row.category || null,
            JSON.stringify(aliases),
            1,
            brandSlots ? JSON.stringify(brandSlots) : null,
            baseKey,
          ],
        });
        canonicalsInserted++;

        if (canonicalsInserted % 100 === 0) {
          console.log(`  Progress: ${canonicalsInserted}/${stagingRows.length} canonicals processed...`);
        }

        // Get deal links and insert mappings
        const dealLinks = dealsByStaging.get(row.id) || [];
        for (const dealId of dealLinks) {
          await tx.execute({
            sql: `INSERT OR IGNORE INTO store_product_mappings
                  (deal_id, canonical_id, match_method, match_confidence, verified_at)
                  VALUES (?, ?, ?, ?, datetime('now'))`,
            args: [dealId, canonicalId, "bootstrap", matchConfidence],
          });
          mappingsInserted++;

          const updateResult = await tx.execute({
            sql: `UPDATE store_products SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
            args: [canonicalId, dealId],
          });
          dealsUpdated += updateResult.rowsAffected;
        }

        // Mark as promoted
        await tx.execute({
          sql: `UPDATE canonical_bootstrap_staging
                SET promoted = 1, promoted_canonical_id = ?
                WHERE id = ?`,
          args: [canonicalId, row.id],
        });
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
  } else {
    // Dry run: just count
    for (const row of stagingRows) {
      const canonicalId = nextUniqueId(row.canonical_name, usedCanonicalIds);

      canonicalsInserted++;
      const dealLinks = dealsByStaging.get(row.id) || [];
      mappingsInserted += dealLinks.length;
      dealsUpdated += dealLinks.length;
    }
  }

  // Print summary
  if (isDryRun) {
    console.log(`[DRY RUN] Would:`);
    console.log(`  canonical_products inserted: ${canonicalsInserted}`);
    console.log(`  deal_mappings inserted:      ${mappingsInserted}`);
    console.log(`  deals.canonical_id updated:  ${dealsUpdated}`);
    return;
  }

  console.log(`DONE:`);
  console.log(`  canonical_products inserted: ${canonicalsInserted}`);
  console.log(`  deal_mappings inserted:      ${mappingsInserted}`);
  console.log(`  deals.canonical_id updated:  ${dealsUpdated}`);

  // ── Broad sweep: link ALL deals (active + inactive) by product name ──────
  // For each canonical, collect all known raw product names from source
  // products, then match against every deal in the table regardless of
  // is_active status.
  console.log(`\nBroad sweep: linking all deals by product name...`);

  const canonicalNames = await client.execute(
    `SELECT cp.id AS canonical_id, sp.raw_product_name
     FROM canonical_products cp
     JOIN canonical_bootstrap_source_products sp
       ON sp.staging_id IN (
         SELECT id FROM canonical_bootstrap_staging WHERE promoted_canonical_id = cp.id
       )
     GROUP BY cp.id, sp.raw_product_name`
  );

  // Build map: canonical_id → Set of lowercased raw names
  const namesByCanonical = new Map();
  for (const r of canonicalNames.rows) {
    if (!namesByCanonical.has(r.canonical_id)) namesByCanonical.set(r.canonical_id, new Set());
    namesByCanonical.get(r.canonical_id).add(r.raw_product_name.toLowerCase().trim());
  }

  const now = new Date().toISOString();
  let broadMappings = 0;
  let broadDeals = 0;
  let processed = 0;
  const total = namesByCanonical.size;

  for (const [canonicalId, rawNames] of namesByCanonical) {
    if (rawNames.size === 0) continue;

    // Fetch all deals matching any of the raw names (case-insensitive)
    const placeholders = [...rawNames].map(() => "?").join(", ");
    const matchedDeals = await client.execute({
      sql: `SELECT id FROM store_products
            WHERE LOWER(TRIM(product_name)) IN (${placeholders})
              AND canonical_id IS NULL`,
      args: [...rawNames],
    });

    if (matchedDeals.rows.length === 0) { processed++; continue; }

    const tx2 = await client.transaction("write");
    try {
      for (const deal of matchedDeals.rows) {
        await tx2.execute({
          sql: `INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
                VALUES (?, ?, 'bootstrap-name-sweep', 0.85, ?)
                ON CONFLICT(deal_id, canonical_id) DO NOTHING`,
          args: [deal.id, canonicalId, now],
        });
        await tx2.execute({
          sql: `UPDATE store_products SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
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
  const covResult   = await client.execute(`SELECT COUNT(*) as cnt FROM store_products WHERE canonical_id IS NOT NULL`);
  const totalResult = await client.execute(`SELECT COUNT(*) as cnt FROM store_products`);
  const linkedDeals = covResult.rows[0].cnt;
  const totalDeals  = totalResult.rows[0].cnt;
  const coverage    = totalDeals > 0 ? Math.round((linkedDeals / totalDeals) * 100) : 0;
  console.log(`\nFinal coverage: ${linkedDeals}/${totalDeals} all deals (${coverage}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
