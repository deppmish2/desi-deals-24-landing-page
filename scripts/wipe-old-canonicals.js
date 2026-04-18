#!/usr/bin/env node

const readline = require("readline");
const path = require("path");
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) {
      console.error("--db-file requires a path");
      process.exit(1);
    }
    const abs = path.resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url =
    process.env.DESI_DEALS_DB_TURSO_DATABASE_URL ||
    process.env.TURSO_DATABASE_URL;
  const authToken =
    process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN ||
    process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error(
      "ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set."
    );
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

async function main() {
  const isDryRun = !process.argv.includes("--execute");
  const hasDbFile = process.argv.includes("--db-file");

  console.log(isDryRun ? "MODE: DRY RUN" : "MODE: LIVE");
  console.log("");

  const client = getClient();

  try {
    // Count rows that will be wiped
    const counts = {};

    const canonicalRows = await client.execute(
      "SELECT COUNT(*) as c FROM canonical_products"
    );
    counts.canonical_products = canonicalRows.rows[0]?.c || 0;

    const mappingRows = await client.execute(
      "SELECT COUNT(*) as c FROM deal_mappings"
    );
    counts.deal_mappings = mappingRows.rows[0]?.c || 0;

    const erqRows = await client.execute(
      "SELECT COUNT(*) as c FROM entity_resolution_queue"
    );
    counts.entity_resolution_queue = erqRows.rows[0]?.c || 0;

    const dealsRows = await client.execute(
      "SELECT COUNT(*) as c FROM deals WHERE canonical_id IS NOT NULL"
    );
    counts.deals_with_canonical = dealsRows.rows[0]?.c || 0;

    const listItemsRows = await client.execute(
      "SELECT COUNT(*) as c FROM list_items WHERE canonical_id IS NOT NULL"
    );
    counts.list_items_with_canonical = listItemsRows.rows[0]?.c || 0;

    const priceAlertsRows = await client.execute(
      "SELECT COUNT(*) as c FROM price_alerts WHERE canonical_id IS NOT NULL"
    );
    counts.price_alerts_with_canonical = priceAlertsRows.rows[0]?.c || 0;

    console.log("Rows to be wiped:");
    console.log(`  canonical_products: ${counts.canonical_products}`);
    console.log(`  deal_mappings: ${counts.deal_mappings}`);
    console.log(`  entity_resolution_queue: ${counts.entity_resolution_queue}`);
    console.log(`  deals (canonical_id refs): ${counts.deals_with_canonical}`);
    console.log(
      `  list_items (canonical_id refs): ${counts.list_items_with_canonical}`
    );
    console.log(
      `  price_alerts (canonical_id refs): ${counts.price_alerts_with_canonical}`
    );
    console.log("");

    if (isDryRun) {
      console.log("Dry run complete. Add --execute to apply.");
      return;
    }

    // Prompt for confirmation if targeting Turso (production)
    if (!hasDbFile) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      await new Promise((resolve, reject) => {
        rl.question(
          "Type YES to wipe PRODUCTION canonical data: ",
          (answer) => {
            rl.close();
            if (answer !== "YES") {
              reject(new Error("ABORT: Confirmation not received."));
            } else {
              resolve();
            }
          }
        );
      });
    }

    console.log("Executing wipe...");
    console.log("");

    // Execute wipe in FK-safe order, atomically
    await client.batch([
      "UPDATE list_items SET canonical_id = NULL WHERE canonical_id IS NOT NULL",
      "UPDATE price_alerts SET canonical_id = NULL WHERE canonical_id IS NOT NULL",
      "UPDATE deals SET canonical_id = NULL WHERE canonical_id IS NOT NULL",
      "UPDATE entity_resolution_queue SET suggested_canonical_id = NULL WHERE suggested_canonical_id IS NOT NULL",
      "DELETE FROM entity_resolution_queue",
      "DELETE FROM deal_mappings",
      "DELETE FROM canonical_products",
    ], "write");
    console.log("  ✓ All tables wiped atomically");

    console.log("");

    // Verify all three tables are zero
    const afterCp = await client.execute(
      "SELECT COUNT(*) as c FROM canonical_products"
    );
    const afterDm = await client.execute(
      "SELECT COUNT(*) as c FROM deal_mappings"
    );
    const afterErq = await client.execute(
      "SELECT COUNT(*) as c FROM entity_resolution_queue"
    );

    console.log("Verification:");
    console.log(`  canonical_products: ${afterCp.rows[0]?.c || 0} (expect 0)`);
    console.log(`  deal_mappings: ${afterDm.rows[0]?.c || 0} (expect 0)`);
    console.log(`  entity_resolution_queue: ${afterErq.rows[0]?.c || 0} (expect 0)`);
    console.log("");

    console.log("✓ Wipe complete.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
