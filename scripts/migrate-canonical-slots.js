#!/usr/bin/env node
"use strict";
/**
 * migrate-canonical-slots.js
 *
 * One-time migration: backfills brand_slots, base_product_slots, type_slots,
 * product_group_id, weight_value, weight_unit, and is_match_priority=1 for
 * all rows in canonical_products.
 *
 * Safe to re-run — uses UPDATE (not INSERT); idempotent.
 *
 * Usage:
 *   node scripts/migrate-canonical-slots.js
 *   node scripts/migrate-canonical-slots.js --dry-run   (logs only, no writes)
 */

require("dotenv").config();
const db = require("../server/db");
const { decomposeCanonical } = require("../crawler/utils/canonical-decomposer");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await db.ready;

  // Load brands from DB
  const brandRows = await db.prepare(`SELECT name, aliases FROM known_brands`).all();
  const brands = brandRows.map((r) => ({
    name: r.name,
    aliases: JSON.parse(String(r.aliases || "[]")),
  }));
  console.log(`[migrate-canonical-slots] Loaded ${brands.length} known brands`);

  const rows = await db.prepare(
    `SELECT id, canonical_name, common_aliases FROM canonical_products`,
  ).all();

  console.log(`[migrate-canonical-slots] Processing ${rows.length} canonical rows…`);
  if (DRY_RUN) console.log("[migrate-canonical-slots] DRY RUN — no writes will be made");

  let updated = 0;
  let deleted = 0;
  let weightExtracted = 0;
  let weightMissed = 0;
  const productGroupsSeen = new Set();

  for (const row of rows) {
    const aliases = row.common_aliases
      ? String(row.common_aliases).split(",").map((a) => a.trim()).filter(Boolean)
      : [];

    let decomposed;
    try {
      decomposed = decomposeCanonical(row.canonical_name, aliases, brands);
    } catch (err) {
      console.warn(`[migrate] SKIP id=${row.id} name="${row.canonical_name}" error=${err.message}`);
      continue;
    }

    const {
      brandSlots,
      baseProductSlots,
      typeSlots,
      productGroupId,
      weightValue,
      weightUnit,
    } = decomposed;

    if (brandSlots === null) {
      if (DRY_RUN) {
        console.log(`[dry-run] WOULD DELETE (no brand): "${row.canonical_name}"`);
      } else {
        // Clear canonical_id on deals first (no ON DELETE CASCADE on this FK)
        await db.execute(`UPDATE store_products SET canonical_id = NULL WHERE canonical_id = ?`, [row.id]);
        await db.execute(`DELETE FROM canonical_products WHERE id = ?`, [row.id]);
        console.log(`[migrate] DELETED (no brand): "${row.canonical_name}"`);
        deleted++;
      }
      continue;
    }

    if (weightValue != null) {
      weightExtracted++;
    } else {
      weightMissed++;
      console.log(`[migrate] no-weight: "${row.canonical_name}"`);
    }

    if (DRY_RUN) {
      console.log(`[dry-run] id=${row.id} brand=${JSON.stringify(brandSlots)} base=${JSON.stringify(baseProductSlots)} weight=${weightValue}${weightUnit} group=${productGroupId}`);
      updated++;
      continue;
    }

    // Upsert product group
    if (!productGroupsSeen.has(productGroupId)) {
      productGroupsSeen.add(productGroupId);
      try {
        await db.execute(
          `INSERT OR IGNORE INTO product_groups (id, group_name, category)
           VALUES (?, ?, ?)`,
          [productGroupId, productGroupId.replace(/-/g, " "), row.category || null],
        );
      } catch (e) {
        console.warn(`[migrate] product_group upsert failed for ${productGroupId}: ${e.message}`);
      }
    }

    // Update canonical row
    try {
      await db.execute(
        `UPDATE canonical_products
         SET brand_slots        = ?,
             base_product_slots = ?,
             type_slots         = ?,
             product_group_id   = ?,
             weight_value       = ?,
             weight_unit        = ?,
             is_match_priority  = 1
         WHERE id = ?`,
        [
          JSON.stringify(brandSlots),
          JSON.stringify(baseProductSlots),
          JSON.stringify(typeSlots),
          productGroupId,
          weightValue,
          weightUnit,
          row.id,
        ],
      );
      updated++;
    } catch (e) {
      console.warn(`[migrate] UPDATE failed for id=${row.id}: ${e.message}`);
    }
  }

  console.log(`[migrate-canonical-slots] Done.`);
  console.log(`  updated:          ${updated} / ${rows.length}`);
  console.log(`  deleted:          ${deleted}`);
  console.log(`  weight extracted: ${weightExtracted}`);
  console.log(`  weight missed:    ${weightMissed}`);
  console.log(`  product groups:   ${productGroupsSeen.size}`);
}

main().catch((e) => {
  console.error("[migrate-canonical-slots] Fatal:", e);
  process.exit(1);
});
