"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const path = require("path");
const { execFileSync } = require("child_process");
const { createClient } = require("@libsql/client");

const LOCAL_DB_PATH = path.resolve(process.argv[2] || "./data/prod_local.db");
const READ_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.TURSO_IMPORT_READ_BATCH_SIZE || "500", 10),
);
const WRITE_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.TURSO_IMPORT_WRITE_BATCH_SIZE || "50", 10),
);
const SQLITE_MAX_BUFFER_BYTES = Math.max(
  4 * 1024 * 1024,
  parseInt(process.env.TURSO_IMPORT_SQLITE_MAX_BUFFER_BYTES || "33554432", 10),
);
// Number of tables to upsert concurrently (FK is OFF during import so order doesn't matter)
const TABLE_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.TURSO_IMPORT_TABLE_CONCURRENCY || "5", 10),
);
// Number of write batches to fire concurrently within a single table
const BATCH_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.TURSO_IMPORT_BATCH_CONCURRENCY || "4", 10),
);
const TABLE_IMPORT_ORDER = [
  "stores",
  "crawl_runs",
  "price_history",
  "users",
  "canonical_products",
  "store_products",
  "store_product_mappings",
  "entity_resolution_queue",
  "email_auth_tokens",
  "waitlist_referrals",
  "refresh_tokens",
  "shopping_lists",
  "list_items",
  "shipping_tiers",
  "delivery_options",
  "price_alerts",
  "alert_notifications",
  "events",
];
const EXCLUDED_TABLES = new Set(["daily_deal_pool_entries"]);

function normalizeEnvValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const wrappedInDoubleQuotes = text.startsWith('"') && text.endsWith('"');
  const wrappedInSingleQuotes = text.startsWith("'") && text.endsWith("'");
  if ((wrappedInDoubleQuotes || wrappedInSingleQuotes) && text.length >= 2) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function readEnv(...keys) {
  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value) return value;
  }
  return "";
}

function quoteIdentifier(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function sqliteJson(sql) {
  const output = execFileSync("sqlite3", ["-json", LOCAL_DB_PATH, sql], {
    encoding: "utf8",
    maxBuffer: SQLITE_MAX_BUFFER_BYTES,
  }).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteScalar(sql, key = "count") {
  const row = sqliteJson(sql)[0] || {};
  return Number(row[key] || 0);
}

function buildInsertStatement(tableName, columnNames) {
  const quotedColumns = columnNames.map(quoteIdentifier).join(", ");
  const placeholders = columnNames.map(() => "?").join(", ");
  return `INSERT OR REPLACE INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES (${placeholders})`;
}

function sortTablesForImport(tables) {
  const order = new Map(
    TABLE_IMPORT_ORDER.map((tableName, index) => [tableName, index]),
  );
  return [...tables]
    .filter((table) => !EXCLUDED_TABLES.has(String(table?.name || "")))
    .sort((a, b) => {
      const aRank = order.has(a.name)
        ? order.get(a.name)
        : Number.MAX_SAFE_INTEGER;
      const bRank = order.has(b.name)
        ? order.get(b.name)
        : Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.name).localeCompare(String(b.name));
    });
}

function referencesExcludedTable(entry) {
  const sql = String(entry?.sql || "").toLowerCase();
  for (const tableName of EXCLUDED_TABLES) {
    if (sql.includes(String(tableName).toLowerCase())) {
      return true;
    }
  }
  return false;
}

async function executeBatch(client, statements) {
  if (!statements.length) return;
  if (statements.length === 1) {
    await client.execute(statements[0]);
    return;
  }
  await client.batch(statements, "write");
}

function isFkError(err) {
  return /FOREIGN KEY constraint failed/i.test(String(err?.message || ""));
}

/** Run up to `limit` async tasks concurrently from an array of thunks. */
async function runConcurrent(thunks, limit) {
  const queue = [...thunks];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const thunk = queue.shift();
      if (thunk) await thunk();
    }
  });
  await Promise.all(workers);
}

async function runStatements(client, sqlStatements) {
  for (const sql of sqlStatements) {
    await client.execute(sql);
  }
}

async function listRemoteNames(client, type) {
  const rs = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%' ORDER BY name",
    args: [type],
  });
  return rs.rows.map((row) => String(row.name));
}

function getTableColumns(tableName) {
  return sqliteJson(`PRAGMA table_info(${quoteIdentifier(tableName)})`).map(
    (column) => String(column.name),
  );
}

function getTableColumnDefs(tableName) {
  return sqliteJson(`PRAGMA table_info(${quoteIdentifier(tableName)})`).map((col) => ({
    name: String(col.name),
    type: String(col.type || "TEXT"),
  }));
}

/** Ensure remote table exists and has all local columns (adds missing ones). */
async function ensureTableSchema(remoteClient, tableName, createSql) {
  // Rewrite CREATE TABLE / CREATE VIRTUAL TABLE → IF NOT EXISTS variant
  const safeCreate = createSql
    .replace(
      /^CREATE\s+VIRTUAL\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
      "CREATE VIRTUAL TABLE IF NOT EXISTS ",
    )
    .replace(
      /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
      "CREATE TABLE IF NOT EXISTS ",
    );
  await remoteClient.execute(safeCreate);

  // Add any columns that exist locally but not remotely
  const localCols = getTableColumnDefs(tableName);
  const remoteInfo = await remoteClient.execute(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  const remoteCols = new Set((remoteInfo.rows ?? []).map((r) => String(r.name)));
  for (const col of localCols) {
    if (!remoteCols.has(col.name)) {
      try {
        await remoteClient.execute(
          `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(col.name)} ${col.type}`,
        );
        console.log(`  + added column ${tableName}.${col.name}`);
      } catch (_) {
        // already exists or incompatible — skip
      }
    }
  }
}

function getTableRowsChunk(tableName, limit, offset) {
  return sqliteJson(
    `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
  );
}

async function copyTableRows(remoteClient, tableName, totalRows) {
  const columns = getTableColumns(tableName);
  const insertSql = buildInsertStatement(tableName, columns);

  // Read all rows in chunks, split into write-sized batches, then flush concurrently
  const writeBatches = [];
  let offset = 0;
  while (true) {
    const rows = getTableRowsChunk(tableName, READ_BATCH_SIZE, offset);
    if (!rows.length) break;
    offset += rows.length;

    let batch = [];
    for (const row of rows) {
      batch.push({
        sql: insertSql,
        args: columns.map((col) =>
          Object.prototype.hasOwnProperty.call(row, col) ? row[col] : null,
        ),
      });
      if (batch.length >= WRITE_BATCH_SIZE) {
        writeBatches.push(batch);
        batch = [];
      }
    }
    if (batch.length > 0) writeBatches.push(batch);
  }

  if (writeBatches.length === 0) return { done: 0, deferred: [] };

  // Show progress as batches complete; collect FK-failed batches for a retry pass
  let done = 0;
  const deferred = [];
  const showProgress = totalRows > READ_BATCH_SIZE;
  const thunks = writeBatches.map((batch) => async () => {
    try {
      await executeBatch(remoteClient, batch);
      done += batch.length;
    } catch (err) {
      if (isFkError(err)) {
        deferred.push(batch); // retry after all tables are loaded
      } else {
        throw err;
      }
    }
    if (showProgress) {
      const pct = Math.round(((done + deferred.length * WRITE_BATCH_SIZE) / totalRows) * 100);
      process.stdout.write(`\r  ↑ ${done.toLocaleString()} / ${totalRows.toLocaleString()} rows (${pct}%)`);
    }
  });

  await runConcurrent(thunks, BATCH_CONCURRENCY);
  if (showProgress) process.stdout.write("\n");
  return { done, deferred };
}

async function syncSqliteSequence(remoteClient) {
  const sqliteSequenceExists = sqliteScalar(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'sqlite_sequence'",
  );
  if (!sqliteSequenceExists) return;

  const rows = sqliteJson("SELECT name, seq FROM sqlite_sequence");
  if (!rows.length) return;

  try {
    await remoteClient.execute("DELETE FROM sqlite_sequence");
  } catch (_) {
    return;
  }

  const statements = rows.map((row) => ({
    sql: "INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)",
    args: [row.name, row.seq],
  }));
  await executeBatch(remoteClient, statements);
}

async function main() {
  if (!require("fs").existsSync(LOCAL_DB_PATH)) {
    throw new Error(`Local DB not found: ${LOCAL_DB_PATH}`);
  }

  const remoteUrl = readEnv(
    "TURSO_DATABASE_URL",
    "DESI_DEALS_DB_TURSO_DATABASE_URL",
  );
  const remoteAuthToken = readEnv(
    "TURSO_AUTH_TOKEN",
    "DESI_DEALS_DB_TURSO_AUTH_TOKEN",
  );

  if (!remoteUrl || !remoteAuthToken) {
    throw new Error(
      "Missing Turso credentials. Set TURSO_DATABASE_URL/TURSO_AUTH_TOKEN or DESI_DEALS_DB_TURSO_DATABASE_URL/DESI_DEALS_DB_TURSO_AUTH_TOKEN.",
    );
  }

  const remoteClient = createClient({
    url: remoteUrl,
    authToken: remoteAuthToken,
  });

  const tableDefs = sortTablesForImport(
    sqliteJson(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
    ),
  );
  const viewDefs = sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  ).filter((entry) => !referencesExcludedTable(entry));
  const indexDefs = sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  ).filter((entry) => !referencesExcludedTable(entry));
  const triggerDefs = sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  ).filter((entry) => !referencesExcludedTable(entry));

  // Pre-compute row counts so we can show totals and progress %
  const localCounts = new Map();
  let totalLocalRows = 0;
  for (const tableDef of tableDefs) {
    const tableName = String(tableDef.name);
    const n = sqliteScalar(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`);
    localCounts.set(tableName, n);
    totalLocalRows += n;
  }

  console.log(`Using local DB  : ${LOCAL_DB_PATH}`);
  console.log(`Tables          : ${tableDefs.length}`);
  console.log(`Total local rows: ${totalLocalRows.toLocaleString()}`);
  console.log(`Target Turso    : ${remoteUrl.replace(/\/\/.*@/, "//***@")}`);
  console.log("");

  await remoteClient.execute("PRAGMA foreign_keys = OFF");

  // ── Phase 1: schema sync — ensure tables & columns exist remotely ──────────
  console.log("Phase 1/3 — schema sync");
  for (const tableDef of tableDefs) {
    await ensureTableSchema(remoteClient, String(tableDef.name), tableDef.sql);
  }
  console.log("  schema up to date\n");

  // ── Phase 2: upsert rows (INSERT OR REPLACE) — idempotent, never deletes ───
  console.log(`Phase 2/3 — upserting rows (${TABLE_CONCURRENCY} tables concurrently, ${BATCH_CONCURRENCY} batches/table)`);
  let tablesDone = 0;
  const allDeferred = []; // FK-failed batches to retry after all tables are loaded
  const tableThunks = tableDefs.map((tableDef) => async () => {
    const tableName = String(tableDef.name);
    const localCount = localCounts.get(tableName);
    const idx = ++tablesDone;
    if (localCount === 0) {
      console.log(`  [${idx}/${tableDefs.length}] ${tableName} — skipped (empty)`);
      return;
    }
    console.log(`  [${idx}/${tableDefs.length}] ${tableName} (${localCount.toLocaleString()} rows)`);
    const { done, deferred } = await copyTableRows(remoteClient, tableName, localCount);
    if (deferred.length > 0) {
      allDeferred.push(...deferred);
      console.log(`  ✓ ${tableName}: ${done.toLocaleString()} rows upserted, ${deferred.length} batch(es) deferred (FK)`);
    } else {
      console.log(`  ✓ ${tableName}: ${done.toLocaleString()} rows upserted`);
    }
  });
  await runConcurrent(tableThunks, TABLE_CONCURRENCY);

  // Phase 2b: retry FK-deferred batches now that all parent tables are loaded
  if (allDeferred.length > 0) {
    console.log(`\n  Retrying ${allDeferred.length} deferred batch(es) (FK pass)...`);
    let retried = 0;
    for (const batch of allDeferred) {
      await executeBatch(remoteClient, batch);
      retried += batch.length;
    }
    console.log(`  ✓ ${retried.toLocaleString()} deferred rows upserted`);
  }
  console.log("");

  await syncSqliteSequence(remoteClient);

  // Views/indexes/triggers have no data — safe to drop+recreate for schema freshness
  const remoteViews = await listRemoteNames(remoteClient, "view");
  for (const viewName of remoteViews) {
    await remoteClient.execute(`DROP VIEW IF EXISTS ${quoteIdentifier(viewName)}`);
  }
  await runStatements(remoteClient, viewDefs.map((entry) => entry.sql));

  for (const indexDef of indexDefs) {
    const safeIndex = String(indexDef.sql).replace(
      /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
      (m) => m.replace(/INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, "INDEX IF NOT EXISTS "),
    );
    try { await remoteClient.execute(safeIndex); } catch (_) {}
  }
  for (const triggerDef of triggerDefs) {
    const safeTrigger = triggerDef.sql.replace(
      /^CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?/i,
      "CREATE TRIGGER IF NOT EXISTS ",
    );
    try { await remoteClient.execute(safeTrigger); } catch (_) {}
  }
  console.log(`  ${viewDefs.length} views, ${indexDefs.length} indexes, ${triggerDefs.length} triggers synced\n`);

  await remoteClient.execute("PRAGMA foreign_keys = ON");

  // ── Phase 3: verify row counts ────────────────────────────────────────────
  console.log("Phase 3/3 — verifying row counts");
  let mismatches = 0;
  for (const tableDef of tableDefs) {
    const tableName = String(tableDef.name);
    const remoteCountRs = await remoteClient.execute({
      sql: `SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`,
    });
    const remoteCount = Number(remoteCountRs.rows[0]?.count || 0);
    const localCount = Number(localCounts.get(tableName) || 0);
    if (remoteCount < localCount) {
      console.warn(`  ✗ ${tableName}: local=${localCount}, remote=${remoteCount} (missing ${localCount - remoteCount})`);
      mismatches++;
    } else {
      console.log(`  ✓ ${tableName}: ${remoteCount.toLocaleString()} rows`);
    }
  }
  console.log("");

  if (mismatches > 0) {
    throw new Error(`${mismatches} table(s) have fewer rows on remote than local. Check output above.`);
  }

  console.log(`Done. ${totalLocalRows.toLocaleString()} rows across ${tableDefs.length} tables synced to Turso.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
