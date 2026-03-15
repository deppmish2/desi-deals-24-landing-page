"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const path = require("path");
const { execFileSync } = require("child_process");
const { createClient } = require("@libsql/client");

const LOCAL_DB_PATH = path.resolve(
  process.argv[2] || "./data/desiDeals24.db",
);
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
const TABLE_IMPORT_ORDER = [
  "stores",
  "crawl_runs",
  "users",
  "canonical_products",
  "deals",
  "daily_deal_pool_entries",
  "deal_mappings",
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
  const output = execFileSync(
    "sqlite3",
    ["-json", LOCAL_DB_PATH, sql],
    {
      encoding: "utf8",
      maxBuffer: SQLITE_MAX_BUFFER_BYTES,
    },
  ).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteScalar(sql, key = "count") {
  const row = sqliteJson(sql)[0] || {};
  return Number(row[key] || 0);
}

function buildInsertStatement(tableName, columnNames) {
  const quotedColumns = columnNames.map(quoteIdentifier).join(", ");
  const placeholders = columnNames.map(() => "?").join(", ");
  return `INSERT INTO ${quoteIdentifier(tableName)} (${quotedColumns}) VALUES (${placeholders})`;
}

function sortTablesForImport(tables) {
  const order = new Map(
    TABLE_IMPORT_ORDER.map((tableName, index) => [tableName, index]),
  );
  return [...tables].sort((a, b) => {
    const aRank = order.has(a.name) ? order.get(a.name) : Number.MAX_SAFE_INTEGER;
    const bRank = order.has(b.name) ? order.get(b.name) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.name).localeCompare(String(b.name));
  });
}

async function executeBatch(client, statements) {
  if (!statements.length) return;
  if (statements.length === 1) {
    await client.execute(statements[0]);
    return;
  }
  await client.batch(statements, "write");
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
  return sqliteJson(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`,
  ).map((column) => String(column.name));
}

function getTableRowsChunk(tableName, limit, offset) {
  return sqliteJson(
    `SELECT * FROM ${quoteIdentifier(tableName)} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
  );
}

async function copyTableRows(remoteClient, tableName) {
  const columns = getTableColumns(tableName);
  const insertSql = buildInsertStatement(tableName, columns);
  let copied = 0;

  while (true) {
    const rows = getTableRowsChunk(tableName, READ_BATCH_SIZE, copied);
    if (!rows.length) break;

    let batch = [];
    for (const row of rows) {
      batch.push({
        sql: insertSql,
        args: columns.map((columnName) =>
          Object.prototype.hasOwnProperty.call(row, columnName)
            ? row[columnName]
            : null,
        ),
      });

      if (batch.length >= WRITE_BATCH_SIZE) {
        await executeBatch(remoteClient, batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await executeBatch(remoteClient, batch);
    }

    copied += rows.length;
  }

  return copied;
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

  const tableDefs = sortTablesForImport(sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  ));
  const viewDefs = sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'view' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  );
  const indexDefs = sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  );
  const triggerDefs = sqliteJson(
    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY name",
  );

  console.log(`Using local DB: ${LOCAL_DB_PATH}`);
  console.log(`Preparing remote Turso import for ${tableDefs.length} tables`);

  await remoteClient.execute("PRAGMA foreign_keys = OFF");

  const remoteViews = await listRemoteNames(remoteClient, "view");
  for (const viewName of remoteViews) {
    await remoteClient.execute(`DROP VIEW IF EXISTS ${quoteIdentifier(viewName)}`);
  }

  const remoteTables = await listRemoteNames(remoteClient, "table");
  for (const tableName of remoteTables) {
    await remoteClient.execute(
      `DROP TABLE IF EXISTS ${quoteIdentifier(tableName)}`,
    );
  }

  await runStatements(
    remoteClient,
    tableDefs.map((entry) => entry.sql),
  );

  const localCounts = new Map();
  for (const tableDef of tableDefs) {
    const tableName = String(tableDef.name);
    const localCount = sqliteScalar(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`,
    );
    localCounts.set(tableName, localCount);
    const copied = await copyTableRows(remoteClient, tableName);
    console.log(`Copied ${copied} rows into ${tableName}`);
  }

  await syncSqliteSequence(remoteClient);
  await runStatements(
    remoteClient,
    viewDefs.map((entry) => entry.sql),
  );
  await runStatements(
    remoteClient,
    indexDefs.map((entry) => entry.sql),
  );
  await runStatements(
    remoteClient,
    triggerDefs.map((entry) => entry.sql),
  );

  await remoteClient.execute("PRAGMA foreign_keys = ON");

  for (const tableDef of tableDefs) {
    const tableName = String(tableDef.name);
    const remoteCountRs = await remoteClient.execute({
      sql: `SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`,
    });
    const remoteCount = Number(remoteCountRs.rows[0]?.count || 0);
    const localCount = Number(localCounts.get(tableName) || 0);
    if (remoteCount !== localCount) {
      throw new Error(
        `Row count mismatch for ${tableName}: local=${localCount}, remote=${remoteCount}`,
      );
    }
  }

  console.log("Remote Turso database now matches the local SQLite file.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
