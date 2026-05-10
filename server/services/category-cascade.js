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

  // Write canonical update first — loadPriorityCanonicals must see the new category
  await db.prepare("UPDATE canonical_products SET category = ? WHERE id = ?").run(newCategory, canonicalId);

  // Find all active store products mapped to this canonical
  const mapped = await db.prepare(
    `SELECT id, product_name, product_category, weight_value, weight_unit, store_id
     FROM store_products WHERE canonical_id = ? AND is_active = 1`
  ).all(canonicalId);

  if (!mapped.length) return { products_unchanged: 0, products_remapped: 0, products_queued: 0 };

  // Load all priority canonicals for re-matching (sees updated category above)
  const priorityCanonicals = await loadPriorityCanonicals(db);

  let products_unchanged = 0, products_remapped = 0, products_queued = 0;
  const stmts = [];

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
    stmts.push(
      { sql: "DELETE FROM store_product_mappings WHERE deal_id = ?", args: [sp.id] },
      { sql: "UPDATE store_products SET canonical_id = NULL WHERE id = ?", args: [sp.id] },
    );

    // Try to find a new canonical in product's own category
    const normedName = norm(sp.product_name);
    const matched = priorityCanonicals.find(
      (c) => matchesCanonical(normedName, sp.weight_value, sp.weight_unit, c, sp.product_category) === true
    );

    if (matched) {
      stmts.push(
        { sql: "INSERT OR REPLACE INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence) VALUES (?, ?, 'slot_match', 0.85)", args: [sp.id, matched.id] },
        { sql: "UPDATE store_products SET canonical_id = ? WHERE id = ?", args: [matched.id, sp.id] },
      );
      products_remapped++;
    } else {
      // DELETE existing pending entry before INSERT to ensure idempotency
      // (entity_resolution_queue has no UNIQUE constraint on deal_id, so OR IGNORE would not fire)
      stmts.push(
        { sql: "DELETE FROM entity_resolution_queue WHERE deal_id = ? AND status = 'pending'", args: [sp.id] },
        { sql: "INSERT INTO entity_resolution_queue (deal_id, raw_name, normalised_name, status, store_id, category) VALUES (?, ?, ?, 'pending', ?, ?)", args: [sp.id, sp.product_name, normedName, sp.store_id, sp.product_category] },
      );
      products_queued++;
    }
  }

  if (stmts.length > 0) await db.batch(stmts, "write");

  return { products_unchanged, products_remapped, products_queued };
}

module.exports = { cascadeCategoryChange };
