#!/usr/bin/env node
/**
 * Mirrors prod_local.db into the production Turso DB under a "local_" prefix.
 * Creates local_<table> for every table in prod_local.db and inserts all rows.
 * Safe to re-run — uses INSERT OR IGNORE so existing rows are skipped.
 *
 * Usage:
 *   node scripts/migrate-local-to-turso.js            # migrate all tables
 *   node scripts/migrate-local-to-turso.js --dry-run  # show what would be done
 *   node scripts/migrate-local-to-turso.js --table deals  # single table
 */
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const Database = require("better-sqlite3");
const { createClient } = require("@libsql/client");
const path = require("path");

const LOCAL_DB_PATH = path.resolve(process.env.DB_FILE || "data/prod_local.db");
const TURSO_URL     = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const TURSO_TOKEN   = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;
const PREFIX        = "local_";
const BATCH_SIZE    = 200;

const isDryRun      = process.argv.includes("--dry-run");
const forceRecreate = process.argv.includes("--force"); // drop + recreate tables before inserting
const targetTable   = process.argv.includes("--table")
  ? process.argv[process.argv.indexOf("--table") + 1]
  : null;

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("Missing DESI_DEALS_DB_TURSO_DATABASE_URL or DESI_DEALS_DB_TURSO_AUTH_TOKEN in env");
  process.exit(1);
}

const local = new Database(LOCAL_DB_PATH, { readonly: true });
const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

function adaptCreateSql(sql, originalName, prefixedName) {
  // Replace table name in CREATE TABLE statement
  let adapted = sql.replace(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`']?[\w]+["`']?/i,
    `CREATE TABLE IF NOT EXISTS "${prefixedName}"`,
  );
  // Strip inline column-level REFERENCES (e.g. col TEXT REFERENCES other(id) ON DELETE CASCADE)
  adapted = adapted.replace(
    /\s+REFERENCES\s+\S+\s*\([^)]+\)(?:\s+ON\s+(?:DELETE|UPDATE)\s+\w+(?:\s+\w+)?)*\s*/gi,
    " ",
  );
  // Strip table-level FOREIGN KEY ... REFERENCES ... constraints
  adapted = adapted.replace(
    /,\s*FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s*\S+(?:\s*\([^)]+\))?(?:\s+ON\s+(?:DELETE|UPDATE)\s+\w+(?:\s+\w+)?)*\s*/gi,
    " ",
  );
  return adapted.replace(/\s{2,}/g, " ").trim();
}

async function ensureTable(originalName, createSql) {
  const prefixedName = `${PREFIX}${originalName}`;
  const adapted = adaptCreateSql(createSql, originalName, prefixedName);
  if (isDryRun) {
    console.log(`  [dry-run] CREATE TABLE IF NOT EXISTS "${prefixedName}"`);
    return prefixedName;
  }
  if (forceRecreate) {
    await turso.execute(`DROP TABLE IF EXISTS "${prefixedName}"`);
    console.log(`  ⚠ Dropped "${prefixedName}"`);
  }
  await turso.execute(adapted);
  return prefixedName;
}

async function migrateTable(tableName, prefixedName) {
  const rows = local.prepare(`SELECT * FROM "${tableName}"`).all();
  if (rows.length === 0) {
    console.log(`  ↳ 0 rows — skipped`);
    return 0;
  }

  const columns     = Object.keys(rows[0]);
  const colList     = columns.map(c => `"${c}"`).join(", ");
  const placeholders = columns.map(() => "?").join(", ");
  const insertSql   = `INSERT OR IGNORE INTO "${prefixedName}" (${colList}) VALUES (${placeholders})`;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map(row => ({
      sql: insertSql,
      args: columns.map(c => row[c] ?? null),
    }));

    if (isDryRun) {
      inserted += batch.length;
      process.stdout.write(`\r  [dry-run] would insert ${inserted}/${rows.length} rows`);
      continue;
    }

    await turso.batch(batch, "write");
    inserted += batch.length;
    process.stdout.write(`\r  ↑ ${inserted}/${rows.length}`);
  }
  process.stdout.write("\n");
  return inserted;
}

async function main() {
  console.log(`Source : ${LOCAL_DB_PATH}`);
  console.log(`Target : ${TURSO_URL.replace(/\/\/.*@/, "//***@")}`);
  console.log(`Prefix : ${PREFIX}`);
  console.log(`Mode   : ${isDryRun ? "DRY RUN" : "EXECUTE"}${forceRecreate ? " + FORCE RECREATE" : ""}`);
  if (targetTable) console.log(`Table  : ${targetTable} only`);
  console.log("");

  const allTables = local
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();

  const tables = targetTable
    ? allTables.filter(t => t.name === targetTable)
    : allTables;

  if (targetTable && tables.length === 0) {
    console.error(`Table "${targetTable}" not found in ${LOCAL_DB_PATH}`);
    process.exit(1);
  }

  let totalInserted = 0;

  for (const { name, sql } of tables) {
    const count = local.prepare(`SELECT COUNT(*) as c FROM "${name}"`).get().c;
    console.log(`── ${name} → ${PREFIX}${name}  (${count.toLocaleString()} rows)`);

    const prefixedName = await ensureTable(name, sql);
    const inserted     = await migrateTable(name, prefixedName);
    totalInserted     += inserted;
  }

  console.log("");
  console.log(`Done. ${totalInserted.toLocaleString()} rows ${isDryRun ? "would be" : ""} inserted across ${tables.length} tables.`);
}

main().catch(e => {
  console.error("[FATAL]", e.message);
  process.exit(1);
});
