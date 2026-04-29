"use strict";
/**
 * migrate-real-savings.js
 *
 * Production migration for the Real Savings feature (two-pass crawler).
 *
 * Adds two columns to the Turso (production) database:
 *   - canonical_products.is_priority  INTEGER DEFAULT 0
 *   - price_history.is_deal      INTEGER DEFAULT 0
 *
 * Run once when merging the real-savings-feature branch to main:
 *
 *   node scripts/migrate-real-savings.js
 *
 * Requires env vars (from .env.local or environment):
 *   DESI_DEALS_DB_TURSO_DATABASE_URL
 *   DESI_DEALS_DB_TURSO_AUTH_TOKEN
 *
 * Safe to re-run — uses ALTER TABLE which Turso silently ignores if
 * the column already exists (caught and reported, not fatal).
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { createClient } = require("@libsql/client");

function readEnv(...keys) {
  for (const key of keys) {
    const value = String(process.env[key] ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return "";
}

const MIGRATIONS = [
  {
    description: "Add is_priority to canonical_products",
    sql: "ALTER TABLE canonical_products ADD COLUMN is_priority INTEGER DEFAULT 0",
    verify: "SELECT is_priority FROM canonical_products LIMIT 1",
    verifyDescription: "canonical_products.is_priority",
  },
  {
    description: "Add is_deal to price_history",
    sql: "ALTER TABLE price_history ADD COLUMN is_deal INTEGER DEFAULT 0",
    verify: "SELECT is_deal FROM price_history LIMIT 1",
    verifyDescription: "price_history.is_deal",
  },
];

async function columnExists(client, migration) {
  try {
    await client.execute(migration.verify);
    return true;
  } catch (_) {
    return false;
  }
}

async function main() {
  const url = readEnv("DESI_DEALS_DB_TURSO_DATABASE_URL", "TURSO_DATABASE_URL");
  const authToken = readEnv("DESI_DEALS_DB_TURSO_AUTH_TOKEN", "TURSO_AUTH_TOKEN");

  if (!url || !authToken) {
    console.error(
      "ERROR: Missing Turso credentials.\n" +
      "Set DESI_DEALS_DB_TURSO_DATABASE_URL and DESI_DEALS_DB_TURSO_AUTH_TOKEN " +
      "in .env.local or your environment.",
    );
    process.exit(1);
  }

  if (!url.startsWith("libsql://") && !url.startsWith("https://")) {
    console.error(`ERROR: URL does not look like a Turso remote URL: ${url}`);
    console.error("This script must run against the production Turso DB, not a local file.");
    process.exit(1);
  }

  console.log(`Connecting to: ${url}`);
  const client = createClient({ url, authToken });

  let allOk = true;

  for (const migration of MIGRATIONS) {
    process.stdout.write(`  ${migration.description} ... `);

    const alreadyExists = await columnExists(client, migration);
    if (alreadyExists) {
      console.log("already exists, skipped");
      continue;
    }

    try {
      await client.execute(migration.sql);
      const nowExists = await columnExists(client, migration);
      if (nowExists) {
        console.log("done");
      } else {
        console.log("FAILED (column not readable after ALTER)");
        allOk = false;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error("\nMigration completed with errors. Check output above.");
    process.exit(1);
  }

  console.log("\nMigration complete. Production DB is ready for the two-pass crawler.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
