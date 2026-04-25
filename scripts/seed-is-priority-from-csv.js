#!/usr/bin/env node
"use strict";
/**
 * seed-is-priority-from-csv.js
 *
 * Sets is_priority = 1 on canonical_products whose base product matches
 * any entry in the Most Popular Indian Groceries CSV.
 *
 * Matching strategy (in order):
 *   1. Normalised canonical_name contains normalised CSV base product
 *   2. Normalised canonical_name contains any normalised CSV search variation
 *   3. Normalised canonical_name contains any normalised CSV misspelling/regional term
 *   4. Any normalised alias in common_aliases matches any of the above terms
 *
 * Usage:
 *   node scripts/seed-is-priority-from-csv.js           (live — prod_local.db only)
 *   node scripts/seed-is-priority-from-csv.js --dry-run
 */

const path = require("path");
const fs   = require("fs");

// Safety: force local DB
const LOCAL_DB = path.resolve(__dirname, "../data/prod_local.db");
process.env.DB_FILE = LOCAL_DB;
delete process.env.TURSO_DATABASE_URL;
delete process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;

const db = require("../server/db");

const CSV_PATH = path.resolve(
  __dirname,
  "../data/Most Popular Indian Groceries - indian_grocery_1000_items.csv"
);
const DRY_RUN = process.argv.includes("--dry-run");

// ── Normalisation ────────────────────────────────────────────────────────────

const WEIGHT_RE  = /\b\d+(?:[.,]\d+)?(?:\s*x\s*\d+)?\s*(?:kg|g|gram|ml|l|oz|lb)\b/gi;
const BRACKET_RE = /\([^)]*\)|\[[^\]]*\]/g;

function norm(str) {
  return String(str || "")
    .toLowerCase()
    .replace(BRACKET_RE, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(WEIGHT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── CSV parsing (no external deps) ──────────────────────────────────────────

function parseCSVLine(line) {
  const fields = [];
  let current  = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function loadCSV(csvPath) {
  const lines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
  const [headerLine, ...dataLines] = lines;
  const headers = parseCSVLine(headerLine).map((h) => h.trim());

  return dataLines.map((line) => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

// ── Build match terms per CSV row ────────────────────────────────────────────

function csvRowToTerms(row) {
  const terms = new Set();
  const add = (str) => {
    if (!str) return;
    str.split(",").forEach((s) => {
      const n = norm(s);
      if (n.length >= 3) terms.add(n);
    });
  };
  add(row["Base Product"]);
  add(row["Search Variations"]);
  add(row["Misspellings/Regional"]);
  return [...terms];
}

// ── Match canonical against CSV terms ────────────────────────────────────────

function matchesAnyTerm(normedName, normedAliases, terms) {
  for (const term of terms) {
    if (normedName.includes(term)) return term;
    for (const alias of normedAliases) {
      if (alias.includes(term) || term.includes(alias)) return term;
    }
  }
  return null;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await db.ready;
  console.log(`[seed-priority] Target DB : ${LOCAL_DB}`);
  console.log(`[seed-priority] Mode      : ${DRY_RUN ? "DRY RUN" : "LIVE"}`);

  // Load CSV
  const rows = loadCSV(CSV_PATH);
  console.log(`[seed-priority] CSV rows  : ${rows.length}`);

  // Build per-row term sets
  const csvEntries = rows.map((row) => ({
    baseProduct:     row["Base Product"],
    popularityIndex: parseInt(row["Popularity Index (1-100)"] || "0", 10),
    terms:           csvRowToTerms(row),
  }));

  // Load all canonicals
  const res = await db.execute(
    `SELECT id, canonical_name, common_aliases FROM canonical_products`
  );
  const canonicals = res.rows ?? [];
  console.log(`[seed-priority] Canonicals: ${canonicals.length}`);

  // Match
  const toMark   = new Set();  // canonical IDs to set is_priority = 1
  const matched  = [];         // for reporting
  const unmatched = [];        // CSV rows that hit nothing

  for (const entry of csvEntries) {
    let hitCount = 0;
    for (const canon of canonicals) {
      const normedName = norm(canon.canonical_name);
      let normedAliases = [];
      try {
        const parsed = JSON.parse(canon.common_aliases || "[]");
        normedAliases = Array.isArray(parsed)
          ? parsed.filter((a) => typeof a === "string").map(norm)
          : [];
      } catch {}

      const hit = matchesAnyTerm(normedName, normedAliases, entry.terms);
      if (hit) {
        toMark.add(canon.id);
        hitCount++;
      }
    }

    if (hitCount > 0) {
      matched.push({ ...entry, hitCount });
    } else {
      unmatched.push(entry);
    }
  }

  console.log(`\n[seed-priority] CSV rows matched    : ${matched.length} / ${csvEntries.length}`);
  console.log(`[seed-priority] CSV rows unmatched   : ${unmatched.length}`);
  console.log(`[seed-priority] Canonicals to mark   : ${toMark.size}`);

  // Sample unmatched (worth reviewing — products not in canonical list at all)
  if (unmatched.length > 0) {
    console.log("\n[seed-priority] Unmatched CSV products (no canonical found):");
    unmatched.slice(0, 20).forEach((e) =>
      console.log(`  [${e.popularityIndex}] ${e.baseProduct}`)
    );
    if (unmatched.length > 20) {
      console.log(`  … and ${unmatched.length - 20} more`);
    }
  }

  if (DRY_RUN) {
    console.log("\n[seed-priority] DRY RUN — no writes made.");
    return;
  }

  // Write via batch of individual UPDATE statements (libsql doesn't support
  // dynamic IN-clause binding with array args)
  const ids = [...toMark];
  const BATCH = 500;
  for (let i = 0; i < ids.length; i += BATCH) {
    const stmts = ids.slice(i, i + BATCH).map((id) => ({
      sql:  "UPDATE canonical_products SET is_priority = 1 WHERE id = ?",
      args: [id],
    }));
    await db.batch(stmts, "write");
  }

  // Verify
  const check = await db.execute(
    `SELECT COUNT(*) as n FROM canonical_products WHERE is_priority = 1`
  );
  console.log(`\n[seed-priority] Done. is_priority = 1 set on ${check.rows[0].n} canonicals.`);
}

main().catch((e) => {
  console.error("[seed-priority] Fatal:", e);
  process.exit(1);
});
