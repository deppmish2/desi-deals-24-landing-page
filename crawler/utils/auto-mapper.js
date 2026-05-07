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
 * Upserts confirmed matches into store_product_mappings so Real Savings can compute
 * Layer 1 savings from canonical price history.
 */

const { v4: uuidv4 } = require("uuid");

// Strips weights in "Brand - 100g Name" and "Name 200g" formats
const WEIGHT_RE = /\b\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?\s*(?:kg|kilo|gram|gramm|gm?|ml|ltr?|litre?|liter|oz|lb|l)\b/gi;
const BRACKET_RE = /\([^)]*\)|\[[^\]]*\]/g;

/** Normalise a product name for comparison */
function norm(str) {
  return String(str || "")
    .toLowerCase()
    .replace(BRACKET_RE, " ")       // strip (parenthetical) and [bracketed] content
    .replace(/[^a-z0-9\s]/g, " ")  // strip special chars including dashes
    .replace(WEIGHT_RE, " ")        // strip weight values e.g. "100g", "1.5kg", "2x250g"
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
/** Normalise kg→g and l→ml so cross-unit weight comparisons work correctly. */
function toBaseUnit(value, unit) {
  if (unit === "kg") return { value: value * 1000, unit: "g" };
  if (unit === "l")  return { value: value * 1000, unit: "ml" };
  return { value, unit };
}

function matchesCanonical(normedTitle, dealWeightValue, dealWeightUnit, canon, dealCategory) {
  const brandSlots = parseSlots(canon.brandSlots);
  const baseProductSlots = parseSlots(canon.baseProductSlots);
  const typeSlots = parseSlots(canon.typeSlots) || [];

  if (!brandSlots && !baseProductSlots) return null;

  if (
    dealCategory && dealCategory !== "Other" &&
    canon.category && canon.category !== "Other" &&
    dealCategory !== canon.category
  ) return null;

  // Use pre-compiled regexes when available (loaded via loadPriorityCanonicals),
  // fall back to per-call iteration for ad-hoc use (e.g. tests).
  if (canon.brandRegexes || canon.baseProductRegexes) {
    const regexGroups = [
      ...(canon.brandRegexes || []),
      ...(canon.baseProductRegexes || []),
      ...(canon.typeRegexes || []),
    ];
    for (const re of regexGroups) {
      if (!re.test(normedTitle)) return false;
    }
  } else {
    const allSlots = [...(brandSlots || []), ...(baseProductSlots || []), ...typeSlots];
    for (const slotGroup of allSlots) {
      if (!slotGroup.some((v) => normedTitle.includes(v.toLowerCase()))) return false;
    }
  }

  // Weight check: normalize kg→g and l→ml so cross-unit comparisons work.
  // Skipped only for truly incompatible units (g vs ml).
  const canonWeight = canon.weightValue ?? canon.weight_value ?? null;
  const canonUnit = canon.weightUnit ?? canon.weight_unit ?? null;

  if (canonWeight != null && dealWeightValue != null) {
    const dw = toBaseUnit(dealWeightValue, dealWeightUnit);
    const cw = toBaseUnit(canonWeight, canonUnit);
    if (dw.unit === cw.unit) {
      const ratio = dw.value / cw.value;
      if (ratio < 0.9 || ratio > 1.1) return false;
    }
    // Truly incompatible units (g vs ml) → skip
  }

  return true;
}

/** Escape a string for use in a RegExp */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      `SELECT id, canonical_name, category,
              brand_slots, base_product_slots, type_slots,
              weight_value, weight_unit
       FROM canonical_products
       WHERE is_match_priority = 1
         AND brand_slots IS NOT NULL
         AND brand_slots != 'null'
         AND brand_slots != '[]'`,
    );
    rows = res.rows ?? [];
  } catch (e) {
    if (/no such column/i.test(e.message)) {
      // is_match_priority not yet added — fall back to is_priority
      try {
        const res2 = await db.execute(
          `SELECT id, canonical_name, category,
                  brand_slots, base_product_slots, type_slots,
                  weight_value, weight_unit
           FROM canonical_products
           WHERE is_priority = 1
             AND brand_slots IS NOT NULL
             AND brand_slots != 'null'
             AND brand_slots != '[]'`,
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

    // Pre-compile one regex per slot group — avoids per-deal alias iteration
    function slotRegexes(groups) {
      if (!groups) return null;
      return groups.map((g) => {
        const aliases = Array.isArray(g) ? g : [g];
        return new RegExp(aliases.map(escapeRe).join("|"), "i");
      });
    }

    return {
      id: r.id,
      canonical_name: r.canonical_name,
      category: r.category ?? null,
      brandSlots,
      baseProductSlots,
      typeSlots,
      brandRegexes:       slotRegexes(brandSlots),
      baseProductRegexes: slotRegexes(baseProductSlots),
      typeRegexes:        slotRegexes(typeSlots.length ? typeSlots : null),
      weightValue: r.weight_value ?? null,
      weightUnit:  r.weight_unit  ?? null,
    };
  });
}

/**
 * For each scraped deal, attempt to match it to a canonical using slot-based
 * matching only. Canonicals without slots are skipped (no legacy fallback).
 *
 * Upserts confirmed matches into store_product_mappings.
 *
 * @param {object} db
 * @param {Array}  deals              - Normalised deal objects
 * @param {Array}  priorityCanonicals - From loadPriorityCanonicals()
 * @returns {Promise<number>}         - Number of mappings upserted
 */
async function autoMapDeals(db, deals, priorityCanonicals) {
  if (!priorityCanonicals.length || !deals.length) return 0;

  // Compute all matches in memory (pure JS — no DB calls per deal)
  const stmts = [];
  for (const deal of deals) {
    if (!deal.product_url || !deal.product_name) continue;
    const normedName = norm(deal.product_name);
    const dealWeightValue = deal.weight_value ?? null;
    const dealWeightUnit = deal.weight_unit ?? null;

    for (const canon of priorityCanonicals) {
      if (matchesCanonical(normedName, dealWeightValue, dealWeightUnit, canon, deal.product_category ?? null) !== true) continue;
      stmts.push({
        sql: `INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence)
              VALUES (?, ?, 'slot_match', 0.85)
              ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
                match_method = 'slot_match', match_confidence = 0.85`,
        args: [deal.id, canon.id],
      });
      break; // one canonical per deal
    }
  }

  if (stmts.length === 0) return 0;
  await db.batch(stmts, "write");
  return stmts.length;
}

module.exports = { loadPriorityCanonicals, autoMapDeals, matchesCanonical, norm };
