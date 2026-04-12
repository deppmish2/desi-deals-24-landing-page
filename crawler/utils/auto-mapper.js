"use strict";
/**
 * auto-mapper.js
 *
 * After each store's deals are scraped, attempts to match them against
 * canonical products using slot-based matching only:
 *
 *  - Uses brand_slots, base_product_slots, type_slots + weight check.
 *  - Loads only canonicals with is_match_priority = 1 AND brand_slots IS NOT NULL.
 *  - Canonicals without slots are skipped entirely (no legacy fallback).
 *
 * Upserts confirmed matches into deal_mappings so Real Savings can compute
 * Layer 1 savings from canonical price history.
 */

const { v4: uuidv4 } = require("uuid");

/** Normalise a product name for comparison */
function norm(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a JSON slot column value stored in the DB.
 * Returns the parsed array or null if the column is NULL / invalid.
 */
function parseSlots(raw) {
  if (raw == null) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Slot-based canonical matching.
 *
 * Returns:
 *   true  — deal matches this canonical
 *   false — deal does not match
 *   null  — canonical has no slots; caller should fall back to legacy matching
 *
 * @param {string}      normedTitle     - normalised deal product name
 * @param {number|null} dealWeightValue - deal's weight in grams or ml (or null)
 * @param {string|null} dealWeightUnit  - "g" or "ml" (or null)
 * @param {object}      canon           - canonical object with slot arrays
 */
function matchesCanonical(normedTitle, dealWeightValue, dealWeightUnit, canon) {
  const brandSlots = parseSlots(canon.brandSlots);
  const baseProductSlots = parseSlots(canon.baseProductSlots);
  // typeSlots is optional — if absent or empty, skip that group
  const typeSlots = parseSlots(canon.typeSlots) || [];

  // If the canonical has no slots at all, signal the caller to use legacy matching
  if (!brandSlots && !baseProductSlots) return null;

  const allSlots = [
    ...(brandSlots || []),
    ...(baseProductSlots || []),
    ...typeSlots,
  ];

  // All slot groups must have at least one variant present in the title
  for (const slotGroup of allSlots) {
    const found = slotGroup.some((variant) => normedTitle.includes(variant));
    if (!found) return false;
  }

  // Weight check: only when both canonical and deal have a weight AND same unit
  const canonWeight = canon.weightValue ?? canon.weight_value ?? null;
  const canonUnit = canon.weightUnit ?? canon.weight_unit ?? null;

  if (canonWeight != null && dealWeightValue != null) {
    if (canonUnit === dealWeightUnit) {
      const ratio = dealWeightValue / canonWeight;
      if (ratio < 0.9 || ratio > 1.1) return false;
    }
    // Different units (g vs ml) → skip weight check
  }

  return true;
}

/**
 * Load all is_match_priority = 1 canonical products once per crawl run.
 * Falls back to is_priority = 1 if is_match_priority column does not exist yet.
 * Only loads canonicals that have brand_slots set (slot-only matching).
 *
 * Returns array of canonical objects with slot arrays.
 */
async function loadPriorityCanonicals(db) {
  let rows;
  try {
    const res = await db.execute(
      `SELECT id, canonical_name,
              brand_slots, base_product_slots, type_slots,
              weight_value, weight_unit
       FROM canonical_products
       WHERE is_match_priority = 1
         AND brand_slots IS NOT NULL`,
    );
    rows = res.rows ?? [];
  } catch (e) {
    if (/no such column/i.test(e.message)) {
      // is_match_priority not yet added — fall back to is_priority
      try {
        const res2 = await db.execute(
          `SELECT id, canonical_name,
                  brand_slots, base_product_slots, type_slots,
                  weight_value, weight_unit
           FROM canonical_products
           WHERE is_priority = 1
             AND brand_slots IS NOT NULL`,
        );
        rows = res2.rows ?? [];
      } catch (e2) {
        if (/no such column/i.test(e2.message)) return [];
        throw e2;
      }
    } else {
      throw e;
    }
  }

  return rows.map((r) => {
    const brandSlots       = parseSlots(r.brand_slots);
    const baseProductSlots = parseSlots(r.base_product_slots);
    const typeSlots        = parseSlots(r.type_slots) || [];

    return {
      id: r.id,
      canonical_name: r.canonical_name,
      brandSlots,
      baseProductSlots,
      typeSlots,
      weightValue: r.weight_value ?? null,
      weightUnit:  r.weight_unit  ?? null,
    };
  });
}

/**
 * For each scraped deal, attempt to match it to a canonical using slot-based
 * matching only. Canonicals without slots are skipped (no legacy fallback).
 *
 * Upserts confirmed matches into deal_mappings.
 *
 * @param {object} db
 * @param {Array}  deals              - Normalised deal objects
 * @param {Array}  priorityCanonicals - From loadPriorityCanonicals()
 * @returns {Promise<number>}         - Number of mappings upserted
 */
async function autoMapDeals(db, deals, priorityCanonicals) {
  if (!priorityCanonicals.length || !deals.length) return 0;

  let mapped = 0;
  for (const deal of deals) {
    if (!deal.product_url || !deal.product_name) continue;
    const normedName = norm(deal.product_name);

    // Normalise deal weight for matching
    const dealWeightValue = deal.weight_value ?? null;
    const dealWeightUnit = deal.weight_unit ?? null;

    for (const canon of priorityCanonicals) {
      const slotResult = matchesCanonical(normedName, dealWeightValue, dealWeightUnit, canon);

      // null = no slots → skip (no legacy fallback)
      if (slotResult !== true) continue;

      try {
        await db.execute(
          `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence)
           VALUES (?, ?, 'slot_match', 0.85)
           ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
             match_method = 'slot_match', match_confidence = 0.85`,
          [deal.id, canon.id],
        );
        mapped++;
      } catch (_) {
        // FK violation — skip
      }
      break; // one canonical per deal
    }
  }

  return mapped;
}

module.exports = { loadPriorityCanonicals, autoMapDeals, matchesCanonical };
