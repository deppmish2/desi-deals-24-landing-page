"use strict";

const { loadPriorityCanonicals, matchesCanonical, norm } = require("../../crawler/utils/auto-mapper");

async function cascadeCategoryChange(db, canonicalId, newCategory) {
  const canonical = await db.prepare(
    "SELECT id, category FROM canonical_products WHERE id = ? LIMIT 1"
  ).get(canonicalId);
  if (!canonical) throw new Error(`Canonical not found: ${canonicalId}`);

  // No-op if category unchanged
  if (canonical.category === newCategory) {
    return { products_unchanged: 0, products_remapped: 0, products_queued: 0 };
  }

  // 1. Update canonical category
  await db.prepare("UPDATE canonical_products SET category = ? WHERE id = ?").run(newCategory, canonicalId);

  // 2. Find all active store products mapped to this canonical
  const mapped = await db.prepare(
    `SELECT id, product_name, product_category, weight_value, weight_unit, store_id
     FROM store_products WHERE canonical_id = ? AND is_active = 1`
  ).all(canonicalId);

  if (!mapped.length) return { products_unchanged: 0, products_remapped: 0, products_queued: 0 };

  // 3. Load all priority canonicals for re-matching
  const priorityCanonicals = await loadPriorityCanonicals(db);

  let products_unchanged = 0, products_remapped = 0, products_queued = 0;

  for (const sp of mapped) {
    // Mirrors matchesCanonical category guard: mismatch only when both sides are non-Other and differ
    const categoryMismatch =
      sp.product_category && sp.product_category !== "Other" &&
      newCategory !== "Other" &&
      sp.product_category !== newCategory;

    if (!categoryMismatch) {
      products_unchanged++;
      continue;
    }

    // Clear invalid mapping
    await db.prepare("DELETE FROM store_product_mappings WHERE deal_id = ?").run(sp.id);
    await db.prepare("UPDATE store_products SET canonical_id = NULL WHERE id = ?").run(sp.id);

    // Try to find a new canonical in product's own category
    const normedName = norm(sp.product_name);
    const matched = priorityCanonicals.find(
      (c) => matchesCanonical(normedName, sp.weight_value, sp.weight_unit, c, sp.product_category) === true
    );

    if (matched) {
      await db.prepare(
        "INSERT OR REPLACE INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence) VALUES (?, ?, 'slot_match', 0.85)"
      ).run(sp.id, matched.id);
      await db.prepare("UPDATE store_products SET canonical_id = ? WHERE id = ?").run(matched.id, sp.id);
      products_remapped++;
    } else {
      await db.prepare(
        `INSERT OR IGNORE INTO entity_resolution_queue
         (deal_id, raw_name, normalised_name, status, store_id, category)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      ).run(sp.id, sp.product_name, normedName, sp.store_id, sp.product_category);
      products_queued++;
    }
  }

  return { products_unchanged, products_remapped, products_queued };
}

module.exports = { cascadeCategoryChange };
