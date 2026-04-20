#!/usr/bin/env node
"use strict";
/**
 * backfill-price-per-litre.js
 *
 * Populates price_per_kg (price per litre) for deals where
 * weight_unit IN ('ml','l') and price_per_kg IS NULL.
 *
 * ⚠️  MERGE NOTE: Run this against the production Turso DB when merging
 * the compare-stores branch to main. Existing liquid deals (oils, drinks, etc.)
 * have no price/L stored — this is a one-time data backfill.
 *
 *   node scripts/backfill-price-per-litre.js --turso             # production Turso DB
 *   node scripts/backfill-price-per-litre.js --turso --dry-run   # preview only
 *   node scripts/backfill-price-per-litre.js                     # local SQLite (dev)
 *   node scripts/backfill-price-per-litre.js --dry-run           # local preview
 *
 * Requires (for --turso):
 *   DESI_DEALS_DB_TURSO_DATABASE_URL
 *   DESI_DEALS_DB_TURSO_AUTH_TOKEN
 * (in .env.local or environment)
 *
 * Safe to re-run — only touches rows where price_per_kg IS NULL.
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const dryRun   = process.argv.includes("--dry-run");
const useTurso = process.argv.includes("--turso");

const SQL_COUNT_ML  = `SELECT COUNT(*) AS cnt FROM deals WHERE weight_unit = 'ml' AND weight_value > 0 AND sale_price > 0 AND price_per_kg IS NULL`;
const SQL_COUNT_L   = `SELECT COUNT(*) AS cnt FROM deals WHERE weight_unit = 'l'  AND weight_value > 0 AND sale_price > 0 AND price_per_kg IS NULL`;
const SQL_SAMPLE_ML = `SELECT product_name, sale_price, weight_value, ROUND(sale_price / weight_value * 1000 * 100) / 100 AS computed FROM deals WHERE weight_unit = 'ml' AND weight_value > 0 AND sale_price > 0 AND price_per_kg IS NULL LIMIT 5`;
const SQL_SAMPLE_L  = `SELECT product_name, sale_price, weight_value, ROUND(sale_price / weight_value * 100) / 100 AS computed FROM deals WHERE weight_unit = 'l'  AND weight_value > 0 AND sale_price > 0 AND price_per_kg IS NULL LIMIT 5`;
const SQL_UPDATE_ML = `UPDATE deals SET price_per_kg = ROUND(sale_price / weight_value * 1000 * 100) / 100 WHERE weight_unit = 'ml' AND weight_value > 0 AND sale_price > 0 AND price_per_kg IS NULL`;
const SQL_UPDATE_L  = `UPDATE deals SET price_per_kg = ROUND(sale_price / weight_value * 100) / 100 WHERE weight_unit = 'l'  AND weight_value > 0 AND sale_price > 0 AND price_per_kg IS NULL`;

function readEnv(...keys) {
  for (const key of keys) {
    const v = String(process.env[key] ?? "").trim().replace(/^['"]|['"]$/g, "");
    if (v) return v;
  }
  return "";
}

function printSamples(mlRows, lRows) {
  console.log("\nSample ml deals:");
  mlRows.forEach(r => console.log(`  ${r.product_name}: €${r.sale_price}/${r.weight_value}ml → €${r.computed}/L`));
  console.log("\nSample l deals:");
  lRows.forEach(r => console.log(`  ${r.product_name}: €${r.sale_price}/${r.weight_value}L → €${r.computed}/L`));
}

async function runTurso() {
  const { createClient } = require("@libsql/client");
  const url       = readEnv("DESI_DEALS_DB_TURSO_DATABASE_URL", "TURSO_DATABASE_URL");
  const authToken = readEnv("DESI_DEALS_DB_TURSO_AUTH_TOKEN", "TURSO_AUTH_TOKEN");

  if (!url || !authToken) {
    console.error(
      "ERROR: Missing Turso credentials.\n" +
      "Set DESI_DEALS_DB_TURSO_DATABASE_URL and DESI_DEALS_DB_TURSO_AUTH_TOKEN in .env.local.",
    );
    process.exit(1);
  }
  if (!url.startsWith("libsql://") && !url.startsWith("https://")) {
    console.error(`ERROR: URL does not look like a Turso remote URL: ${url}`);
    process.exit(1);
  }

  console.log(`Connecting to Turso: ${url}`);
  const client = createClient({ url, authToken });

  const cntMl = (await client.execute(SQL_COUNT_ML)).rows[0].cnt;
  const cntL  = (await client.execute(SQL_COUNT_L)).rows[0].cnt;
  console.log(`Deals to update — ml: ${cntMl}, l: ${cntL}`);

  if (dryRun) {
    const sampleMl = (await client.execute(SQL_SAMPLE_ML)).rows;
    const sampleL  = (await client.execute(SQL_SAMPLE_L)).rows;
    printSamples(sampleMl, sampleL);
    console.log("\nDry run — no changes written.");
    return;
  }

  const rMl = await client.execute(SQL_UPDATE_ML);
  const rL  = await client.execute(SQL_UPDATE_L);
  const total = (rMl.rowsAffected ?? 0) + (rL.rowsAffected ?? 0);
  console.log(`Updated ml: ${rMl.rowsAffected ?? 0}, l: ${rL.rowsAffected ?? 0}. Total: ${total}`);
}

function runLocal() {
  // Use better-sqlite3 directly — bypasses server/db so Turso env vars are ignored.
  const path = require("path");
  const Database = require("better-sqlite3");
  const dbPath = path.resolve("./data/desiDeals24.db");
  console.log(`Using local SQLite: ${dbPath}`);
  const db = new Database(dbPath);

  const cntMl = db.prepare(SQL_COUNT_ML).get().cnt;
  const cntL  = db.prepare(SQL_COUNT_L).get().cnt;
  console.log(`Deals to update — ml: ${cntMl}, l: ${cntL}`);

  if (dryRun) {
    const sampleMl = db.prepare(SQL_SAMPLE_ML).all();
    const sampleL  = db.prepare(SQL_SAMPLE_L).all();
    printSamples(sampleMl, sampleL);
    console.log("\nDry run — no changes written.");
    db.close();
    return;
  }

  const update = db.transaction(() => {
    const rMl = db.prepare(SQL_UPDATE_ML).run();
    const rL  = db.prepare(SQL_UPDATE_L).run();
    return { ml: rMl.changes, l: rL.changes };
  });

  const { ml, l } = update();
  console.log(`Updated ml: ${ml}, l: ${l}. Total: ${ml + l}`);
  db.close();
}

if (useTurso) {
  runTurso().catch(err => { console.error(err); process.exit(1); });
} else {
  runLocal();
}
