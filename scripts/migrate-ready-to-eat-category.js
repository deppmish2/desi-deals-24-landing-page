#!/usr/bin/env node
"use strict";
/**
 * Fixes Ready Meals & Mixes category mis-mappings in two phases.
 *
 * Phase 1: Update canonical_products.category to "Ready Meals & Mixes"
 *          for canonicals with RTE signals in their name.
 * Phase 2: Clear wrong store_product_mappings for mis-mapped RTE store
 *          products, re-run slot matching against RTE canonicals, and
 *          send unmatched products to entity_resolution_queue.
 *
 * Dry run (default):
 *   DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js
 *   node scripts/migrate-ready-to-eat-category.js          # prod Turso
 *
 * Apply:
 *   DB_FILE=data/prod_local.db node scripts/migrate-ready-to-eat-category.js --apply
 *   node scripts/migrate-ready-to-eat-category.js --apply  # prod Turso
 *
 * For prod Turso: comment out DB_FILE in .env.local first.
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { createClient } = require("@libsql/client");
const { matchesCanonical, norm } = require("../crawler/utils/auto-mapper");

const APPLY = process.argv.includes("--apply");
const TARGET_CATEGORY = "Ready Meals & Mixes";

const RTE_STANDALONE = ["ready to eat", "ready-to-eat", "ready meal", "ready-meal"];
const RTE_QUICK_TOKENS = ["quick", "instant"];
const RTE_GRAIN_TOKENS = ["poha", "upma", "khichdi", "biryani", "pulao", "dosa", "idli", "rava", "semolina"];

function hasRteSignal(name) {
  const lower = (name || "").toLowerCase();
  if (RTE_STANDALONE.some((s) => lower.includes(s))) return true;
  const words = lower.split(/[\s-]+/);
  return (
    RTE_QUICK_TOKENS.some((t) => words.includes(t)) &&
    RTE_GRAIN_TOKENS.some((t) => words.includes(t))
  );
}

function parseSlots(json) {
  if (!json || json === "null" || json === "[]") return null;
  try { return JSON.parse(json); } catch { return null; }
}

const dbFile    = process.env.DB_FILE;
const tursoUrl  = process.env.TURSO_DATABASE_URL || process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN  || process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN;

if (!dbFile && !tursoUrl) {
  console.error("Error: set DB_FILE (local) or TURSO_DATABASE_URL + TURSO_AUTH_TOKEN (prod)");
  process.exit(1);
}

const client = dbFile
  ? createClient({ url: `file:${dbFile}` })
  : createClient({ url: tursoUrl, authToken: tursoToken });

async function query(sql, args = []) {
  const r = await client.execute({ sql, args });
  return r.rows;
}

async function main() {
  console.log(`[migrate-rte] mode=${APPLY ? "APPLY" : "DRY RUN"} target=${dbFile ?? tursoUrl}`);

  // ── Phase 1: Canonical category updates ──────────────────────────────────
  const allCanonicals = await query(
    `SELECT id, canonical_name, category FROM canonical_products`
  );

  const toUpdateCat = allCanonicals.filter(
    (r) => hasRteSignal(r.canonical_name) && r.category !== TARGET_CATEGORY
  );

  console.log(`\n[Phase 1] ${toUpdateCat.length} canonical(s) to move to '${TARGET_CATEGORY}':`);
  for (const r of toUpdateCat) {
    console.log(`  ${(r.category || "null").padEnd(25)} → ${TARGET_CATEGORY}  |  ${r.canonical_name}`);
  }

  if (APPLY && toUpdateCat.length > 0) {
    await client.batch(
      toUpdateCat.map((r) => ({
        sql: `UPDATE canonical_products SET category = ? WHERE id = ?`,
        args: [TARGET_CATEGORY, r.id],
      })),
      "write"
    );
    console.log(`[Phase 1] Updated ${toUpdateCat.length} canonical(s).`);
  }

  // ── Phase 2: Store product re-mapping ────────────────────────────────────
  const misMapped = await query(
    `SELECT sp.id, sp.product_name, sp.canonical_id,
            sp.weight_value, sp.weight_unit, sp.store_id,
            cp.category AS canonical_category
     FROM store_products sp
     JOIN canonical_products cp ON cp.id = sp.canonical_id
     WHERE sp.is_active = 1
       AND cp.category != ?`,
    [TARGET_CATEGORY]
  );

  const rteProducts = misMapped.filter((r) => hasRteSignal(r.product_name));

  console.log(`\n[Phase 2] ${rteProducts.length} active RTE product(s) mapped to wrong canonical category:`);
  for (const r of rteProducts) {
    console.log(`  [${r.canonical_category}]  ${r.product_name}`);
  }

  if (!APPLY || rteProducts.length === 0) {
    if (!APPLY) console.log("\n[migrate-rte] DRY RUN — no writes. Re-run with --apply to commit.");
    return;
  }

  // Load RTE canonicals for re-mapping.
  // Phase 1 has already updated canonical categories above, so these now exist.
  const rteCanonicalRows = await query(
    `SELECT id, canonical_name, category,
            brand_slots, base_product_slots, type_slots,
            weight_value, weight_unit
     FROM canonical_products
     WHERE is_match_priority = 1
       AND category = ?
       AND brand_slots IS NOT NULL
       AND brand_slots != 'null'
       AND brand_slots != '[]'`,
    [TARGET_CATEGORY]
  );

  const rteCanonicalsForMatch = rteCanonicalRows.map((r) => ({
    id: r.id,
    canonical_name: r.canonical_name,
    category: TARGET_CATEGORY,
    brandSlots: parseSlots(r.brand_slots),
    baseProductSlots: parseSlots(r.base_product_slots),
    typeSlots: parseSlots(r.type_slots) || [],
    weightValue: r.weight_value ?? null,
    weightUnit:  r.weight_unit  ?? null,
  }));

  console.log(`[Phase 2] ${rteCanonicalsForMatch.length} RTE canonical(s) available for re-mapping`);

  const remapped = [];
  const sentToReview = [];
  const stmts = [];

  for (const sp of rteProducts) {
    stmts.push({
      sql: `DELETE FROM store_product_mappings WHERE deal_id = ?`,
      args: [sp.id],
    });
    stmts.push({
      sql: `UPDATE store_products SET canonical_id = NULL WHERE id = ?`,
      args: [sp.id],
    });

    const normedName = norm(sp.product_name);
    let matched = null;
    for (const canon of rteCanonicalsForMatch) {
      if (matchesCanonical(normedName, sp.weight_value, sp.weight_unit, canon, TARGET_CATEGORY) === true) {
        matched = canon;
        break;
      }
    }

    if (matched) {
      stmts.push({
        sql: `INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence)
              VALUES (?, ?, 'slot_match', 0.85)
              ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
                match_method = 'slot_match', match_confidence = 0.85`,
        args: [sp.id, matched.id],
      });
      stmts.push({
        sql: `UPDATE store_products SET canonical_id = ? WHERE id = ?`,
        args: [matched.id, sp.id],
      });
      remapped.push({ product_name: sp.product_name, canonical_name: matched.canonical_name });
    } else {
      stmts.push({
        sql: `INSERT OR IGNORE INTO entity_resolution_queue
              (deal_id, raw_name, normalised_name, status, store_id, category)
              VALUES (?, ?, ?, 'pending', ?, ?)`,
        args: [sp.id, sp.product_name, normedName, sp.store_id, TARGET_CATEGORY],
      });
      sentToReview.push({ product_name: sp.product_name });
    }
  }

  await client.batch(stmts, "write");

  console.log(`\n[Phase 2] Remapped: ${remapped.length}, sent to review: ${sentToReview.length}`);
  for (const r of remapped) console.log(`  ✓ ${r.product_name} → ${r.canonical_name}`);
  for (const r of sentToReview) console.log(`  ⚠ ${r.product_name} → entity_resolution_queue`);
}

main().catch((e) => {
  console.error("[migrate-rte] Fatal:", e);
  process.exit(1);
});
