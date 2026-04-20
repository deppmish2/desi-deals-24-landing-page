#!/usr/bin/env node
"use strict";
/**
 * backfill-base-product-slots.js
 *
 * Populates base_product_slots (and type_slots=[]) for canonical_products
 * where base_product_slots IS NULL.
 *
 * Strategy: tokenise canonical_name, strip tokens that appear in brand_slots,
 * write remaining tokens as [[t1],[t2],...] (same slot format as tok() in admin UI).
 * Uses existing brand_slots — does NOT consult known_brands, does NOT delete rows.
 *
 * Usage:
 *   node scripts/backfill-base-product-slots.js             # writes to DB
 *   node scripts/backfill-base-product-slots.js --dry-run   # logs only
 */

require("dotenv").config();
const db = require("../server/db");

const TOKEN_NOISE = new Set([
  "kg","g","gm","gram","grams","ml","l","ltr","litre","liter",
  "pack","packs","packet","packets","pc","pcs","piece","pieces",
  "x","of","and","the","a","an",
]);
const TOKEN_MAP = new Map([
  ["daal","dal"],["dhal","dal"],["arhar","toor"],["tuvar","toor"],
  ["tur","toor"],["basmathi","basmati"],["bismati","basmati"],
]);

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .map((t) => TOKEN_MAP.get(t) || t)
    .filter((t) => t.length >= 2 && !TOKEN_NOISE.has(t) && !/\d/.test(t));
}

async function main() {
  await db.ready;

  const DRY_RUN = process.argv.includes("--dry-run");

  const rows = await db
    .prepare(
      "SELECT id, canonical_name, brand_slots FROM canonical_products WHERE base_product_slots IS NULL"
    )
    .all();

  console.log(`[backfill-base-product-slots] ${rows.length} rows to process${DRY_RUN ? " (DRY RUN)" : ""}`);

  let updated = 0, skipped = 0;

  for (const row of rows) {
    // Extract brand tokens from existing brand_slots
    const brandTokens = new Set();
    if (row.brand_slots) {
      try {
        JSON.parse(row.brand_slots)
          .flat()
          .forEach((w) => tokenize(w).forEach((t) => brandTokens.add(t)));
      } catch (_) {
        // malformed brand_slots — skip brand stripping
      }
    }

    const productTokens = tokenize(row.canonical_name).filter(
      (t) => !brandTokens.has(t)
    );

    if (productTokens.length === 0) {
      skipped++;
      continue;
    }

    const baseProductSlots = JSON.stringify(productTokens.map((t) => [t]));
    const typeSlots = JSON.stringify([]);

    if (DRY_RUN) {
      console.log(`  ${row.canonical_name} → ${baseProductSlots}`);
    } else {
      await db.execute(
        "UPDATE canonical_products SET base_product_slots=?, type_slots=? WHERE id=?",
        [baseProductSlots, typeSlots, row.id]
      );
    }
    updated++;
  }

  console.log(`[backfill-base-product-slots] Done. updated=${updated} skipped=${skipped}`);
}

main().catch((e) => {
  console.error("[backfill-base-product-slots] Fatal:", e.message);
  process.exit(1);
});
