"use strict";
/**
 * snapshot-prod.js
 *
 * Dumps all tables from the configured database (local or remote Turso) to a
 * timestamped JSON file in ./data/.
 *
 * Usage:
 *   node scripts/snapshot-prod.js
 *
 * With prod Turso creds in .env.local, this snapshots the production DB.
 * Without them, it snapshots the local SQLite file.
 *
 * Output: data/snapshot-<ISO timestamp>.json
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");
const db = require("../server/db");

const TABLES = [
  "stores",
  "deals",
  "crawl_runs",
  "crawl_store_results",
  "deal_price_history",
  "canonical_products",
  "deal_mappings",
  "known_brands",
  "brand_remap_jobs",
  "entity_resolution_queue",
  "product_groups",
  "users",
  "bookmarks",
  "price_alerts",
  "shopping_lists",
  "list_items",
  "events",
  "search_queries",
  "job_runs",
  "app_settings",
];

async function snapshot() {
  await db.ready;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.resolve(`./data/snapshot-${timestamp}.json`);

  const usingRemote = Boolean(
    process.env.TURSO_DATABASE_URL ||
    process.env.DESI_DEALS_DB_TURSO_DATABASE_URL,
  );
  console.log(`Source: ${usingRemote ? "remote Turso (production)" : "local SQLite"}`);

  const result = { created_at: new Date().toISOString(), source: usingRemote ? "production" : "local", tables: {} };

  for (const table of TABLES) {
    try {
      const rows = await db.prepare(`SELECT * FROM ${table}`).all();
      result.tables[table] = rows;
      console.log(`  ${table}: ${rows.length} rows`);
    } catch (err) {
      console.warn(`  ${table}: skipped (${err.message})`);
      result.tables[table] = [];
    }
  }

  const total = Object.values(result.tables).reduce((sum, rows) => sum + rows.length, 0);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nSnapshot saved → ${outPath}`);
  console.log(`Total rows: ${total}`);
}

snapshot().catch((err) => {
  console.error("Snapshot failed:", err.message);
  process.exit(1);
});
