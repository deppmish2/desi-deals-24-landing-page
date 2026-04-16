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
console.log("");

async function main() {
  // Guard: only abort if --execute and canonical_products has rows
  if (!isDryRun) {
    const guardResult = await client.execute("SELECT COUNT(*) as cnt FROM canonical_products");
    const cnt = guardResult.rows[0].cnt;
    if (cnt > 0) {
      console.error(
        `ABORT: canonical_products has ${cnt} rows. Run wipe script first.`
      );
      process.exit(1);
    }
  }

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

  // Track generated canonical IDs to avoid conflicts
  const usedCanonicalIds = new Set();

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
        await tx.execute({
          sql: `INSERT INTO canonical_products
                (id, canonical_name, category, common_aliases, verified, created_at, brand_slots)
                VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`,
          args: [
            canonicalId,
            row.canonical_name,
            row.category || null,
            JSON.stringify(aliases),
            1,
            brandSlots ? JSON.stringify(brandSlots) : null,
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
            sql: `INSERT OR IGNORE INTO deal_mappings
                  (deal_id, canonical_id, match_method, match_confidence, verified_at)
                  VALUES (?, ?, ?, ?, datetime('now'))`,
            args: [dealId, canonicalId, "bootstrap", matchConfidence],
          });
          mappingsInserted++;

          const updateResult = await tx.execute({
            sql: `UPDATE deals SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
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
  } else {
    console.log(`DONE:`);
    console.log(`  canonical_products inserted: ${canonicalsInserted}`);
    console.log(`  deal_mappings inserted:      ${mappingsInserted}`);
    console.log(`  deals.canonical_id updated:  ${dealsUpdated}`);

    // Print coverage
    const covResult = await client.execute(
      `SELECT COUNT(*) as cnt FROM deals WHERE is_active=1 AND canonical_id IS NOT NULL`
    );
    const totalResult = await client.execute(
      `SELECT COUNT(*) as cnt FROM deals WHERE is_active=1`
    );
    const activeDealsCov = covResult.rows[0].cnt;
    const activeDealsTotal = totalResult.rows[0].cnt;
    const coverage =
      activeDealsTotal > 0
        ? Math.round((activeDealsCov / activeDealsTotal) * 100)
        : 0;
    console.log(`  Coverage: ${activeDealsCov}/${activeDealsTotal} (${coverage}%)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
