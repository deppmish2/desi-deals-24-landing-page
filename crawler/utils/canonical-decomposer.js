"use strict";
/**
 * canonical-decomposer.js
 *
 * Decomposes a canonical product name into token-slot arrays used for
 * order-independent, weight-aware matching in the auto-mapper.
 *
 * Used by:
 *  - scripts/migrate-canonical-slots.js  (one-time backfill)
 *  - scripts/seed-priority-canonicals.js (seeder)
 *  - server/services/canonicalizer.js    (dynamic canonical creation)
 */

const { parseWeight } = require("./weight-parser");

/**
 * Slugify a string to a hyphen-separated identifier.
 */
function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalise a parsed weight to a canonical unit:
 *   g / gm / kg  → grams  (weightUnit = "g")
 *   ml / l       → millilitres (weightUnit = "ml")
 */
function normalizeWeight(value, unit) {
  switch (unit) {
    case "g":
      return { weightValue: value, weightUnit: "g" };
    case "kg":
      return { weightValue: value * 1000, weightUnit: "g" };
    case "ml":
      return { weightValue: value, weightUnit: "ml" };
    case "l":
      return { weightValue: value * 1000, weightUnit: "ml" };
    default:
      return { weightValue: null, weightUnit: null };
  }
}

/**
 * Decompose a canonical product name into token slots for matching.
 *
 * @param {string}   canonicalName   - e.g. "Daawat Basmati Rice Extra Long 5kg"
 * @param {string[]} [commonAliases] - optional alias strings (reserved for future use)
 * @returns {{
 *   brandSlots:       string[][],   // e.g. [["daawat", "dawat"]]
 *   baseProductSlots: string[][],   // e.g. [["basmati","basmatireis"],["rice","reis"],...]
 *   typeSlots:        string[][],   // always [] from decomposer; populated by seeder
 *   productGroupId:   string,       // weight-agnostic slug, e.g. "basmati-rice-extra-long"
 *   weightValue:      number|null,  // pack size in grams or ml
 *   weightUnit:       string|null   // "g" or "ml"
 * }}
 */
function decomposeCanonical(canonicalName, commonAliases = []) {
  const name = String(canonicalName || "");

  if (!name.trim()) {
    return {
      brandSlots: [],
      baseProductSlots: [],
      typeSlots: [],
      productGroupId: "unknown",
      weightValue: null,
      weightUnit: null,
    };
  }

  // 1. Extract weight — reuse the crawler's weight parser
  const wt = parseWeight(name);
  const { weightValue, weightUnit } = wt
    ? normalizeWeight(wt.value, wt.unit)
    : { weightValue: null, weightUnit: null };

  // 2. Strip weight raw string, parenthetical notes, dashes, then normalise
  let stripped = name;
  if (wt && wt.raw) {
    // Replace only the first occurrence of the exact raw match
    stripped = stripped.replace(wt.raw, " ");
  }
  stripped = stripped
    .replace(/\([^)]*\)/g, " ") // remove (BBD 2025), (48pc x ...), etc.
    .replace(/-+/g, " ")        // dashes → space
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripped.split(" ").filter(Boolean);

  if (tokens.length === 0) {
    return {
      brandSlots: [[slugify(name)]],
      baseProductSlots: [],
      typeSlots: [],
      productGroupId: "unknown",
      weightValue,
      weightUnit,
    };
  }

  // 3. First token = brand; remaining = product words
  const [brand, ...productTokens] = tokens;

  // 4. Each product word becomes its own slot group (word-level, order-independent)
  //    Seeder/admin can later expand each group with language variants.
  const baseProductSlots = productTokens.map((t) => [t]);

  // 5. product_group_id: weight-agnostic slug of all product words (no brand)
  const productGroupId = productTokens.length > 0
    ? productTokens.join("-")
    : "unknown";

  return {
    brandSlots: [[brand]],
    baseProductSlots,
    typeSlots: [], // populated by seeder for curated canonicals
    productGroupId,
    weightValue,
    weightUnit,
  };
}

module.exports = { decomposeCanonical };
