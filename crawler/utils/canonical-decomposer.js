"use strict";
/**
 * canonical-decomposer.js
 *
 * Decomposes a canonical product name into token-slot arrays for matching.
 *
 * Used by:
 *  - scripts/migrate-canonical-slots.js
 *  - server/services/canonicalizer.js
 *  - server/routes/admin-dashboard.js (remap job)
 *
 * @param {string}   canonicalName
 * @param {string[]} commonAliases  - reserved for future use
 * @param {Array}    brands         - from known_brands table: [{name, aliases: string[]}]
 */

const { parseWeight } = require("./weight-parser");

// Patterns to strip before processing: "Best before 12/2025", "BBD 2025", "MHD 12.25", etc.
const BBD_RE = /\b(?:best\s+before|best\s+by|bb[d]?|exp\.?|expires?|mhd)\b[\s:]*[\d\/\.\-a-zA-Z]*/gi;

function normalizeWeight(value, unit) {
  switch (unit) {
    case "g":  return { weightValue: value,        weightUnit: "g" };
    case "kg": return { weightValue: value * 1000, weightUnit: "g" };
    case "ml": return { weightValue: value,        weightUnit: "ml" };
    case "l":  return { weightValue: value * 1000, weightUnit: "ml" };
    default:   return { weightValue: null,         weightUnit: null };
  }
}

function decomposeCanonical(canonicalName, commonAliases = [], brands = []) {
  let name = String(canonicalName || "");

  if (!name.trim()) {
    return {
      brandSlots: null,
      baseProductSlots: [],
      typeSlots: [],
      productGroupId: "unknown",
      weightValue: null,
      weightUnit: null,
    };
  }

  // 1. Strip BBD/expiry patterns before any tokenisation
  name = name.replace(BBD_RE, " ");

  // 2. Extract weight
  const wt = parseWeight(name);
  const { weightValue, weightUnit } = wt
    ? normalizeWeight(wt.value, wt.unit)
    : { weightValue: null, weightUnit: null };

  // 3. Strip weight, parentheticals, dashes — then normalise
  let stripped = name;
  if (wt && wt.raw) stripped = stripped.replace(wt.raw, " ");
  stripped = stripped
    .replace(/\([^)]*\)/g, " ")
    .replace(/-+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripped.split(" ").filter(Boolean);

  if (tokens.length === 0) {
    return {
      brandSlots: null,
      baseProductSlots: [],
      typeSlots: [],
      productGroupId: "unknown",
      weightValue,
      weightUnit,
    };
  }

  // 4. Scan ALL tokens for a known brand alias match
  let brandEntry = null;
  let brandTokenIndex = -1;
  outer: for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    for (const b of brands) {
      if (b.aliases.some((alias) => t === alias)) {
        brandEntry = b;
        brandTokenIndex = i;
        break outer;
      }
    }
  }

  // 5. Build slot arrays
  const productTokens = tokens.filter((_, i) => i !== brandTokenIndex);

  // Deduplicate in case name.toLowerCase() already appears in aliases
  const brandSlots = brandEntry
    ? [[...new Set([brandEntry.name.toLowerCase(), ...brandEntry.aliases])]]
    : null;

  const baseProductSlots = productTokens.map((t) => [t]);

  const productGroupId =
    productTokens.length > 0 ? productTokens.join("-") : "unknown";

  return {
    brandSlots,
    baseProductSlots,
    typeSlots: [],
    productGroupId,
    weightValue,
    weightUnit,
  };
}

module.exports = { decomposeCanonical };
