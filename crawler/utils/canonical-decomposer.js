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

// Non-anchored regex covering all BBD/expiry keyword variants (aligns with best-before-parser.js KW).
// Matches keyword + optional date fragment and strips mid-string occurrences.
const BBD_RE =
  /\b(?:mhd|bbe|b\.b\.e|best[\s-]?before|bbd|bb|expiry(?:[\s-]?date)?|exp\.?|mhb|mindestens[\s-]?haltbar[\s-]?bis|mindesthaltbarkeitsdatum|haltbarkeitsdatum|mindesthaltbarkeit|ablauf)\b[\s:]*[\d/.\-a-zA-Z]*/gi;

// Words that mark a parenthetical as logistics/packaging noise rather than product variant signal.
const PAREN_NOISE_WORDS_RE =
  /^(?:export|pack|order|bundle|only|bbe|mhd|stay|fresh|sealed|pieces?|pcs?|units?|multi|combo|offer|value|family|economy|bulk|free|save|size|bag|box|tin|jar|bottle|pouch|sachet)$/i;

/**
 * Classify each (...) block in a name string.
 * - Blocks with digits → noise (stripped).
 * - Blocks of 1–4 all-alpha words, none matching PAREN_NOISE_WORDS_RE → signal;
 *   signal words are returned as signalTokens (lowercase) to add as required slots.
 * - All other blocks → noise (stripped).
 * Returns { cleaned: string (parens removed), signalTokens: string[] }.
 */
function classifyParens(name) {
  const signalTokens = [];
  const cleaned = name.replace(/\(([^)]*)\)/g, (_, inner) => {
    if (/\d/.test(inner)) return " ";
    const words = inner.trim().split(/[^a-zA-Z]+/).filter(Boolean);
    const isSignal =
      words.length >= 1 &&
      words.length <= 4 &&
      words.every((w) => !PAREN_NOISE_WORDS_RE.test(w));
    if (isSignal) signalTokens.push(...words.map((w) => w.toLowerCase()));
    return " ";
  });
  return { cleaned, signalTokens };
}

function normalizeWeight(value, unit) {
  switch (unit) {
    case "g":  return { weightValue: value,        weightUnit: "g" };
    case "kg": return { weightValue: value * 1000, weightUnit: "g" };
    case "ml": return { weightValue: value,        weightUnit: "ml" };
    case "l":  return { weightValue: value * 1000, weightUnit: "ml" };
    default:   return { weightValue: null,         weightUnit: null };
  }
}

/**
 * Build a flat Map<lowercase_alias → brand> from a brands array.
 * Pass the result into decomposeCanonical to avoid rebuilding per call.
 */
function buildBrandAliasMap(brands) {
  const map = new Map();
  for (const b of brands) {
    map.set(b.name.toLowerCase(), b);
    for (const alias of b.aliases) {
      if (alias) map.set(alias.toLowerCase(), b);
    }
  }
  return map;
}

function decomposeCanonical(canonicalName, commonAliases = [], brands = [], aliasMap = null) {
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

  // 1. Strip BBD/expiry patterns and promotional suffixes before any tokenisation
  name = name.replace(BBD_RE, " ");
  // Strip "- Sale Item" / "– Sale Item" suffixes added by stores for clearance listings
  // (e.g. "Priya Fish Masala 50g - Sale Item [BBD: Sep 2023]" → "Priya Fish Masala 50g")
  name = name.replace(/\s*[-–]\s*sale\s*item\b/gi, " ");

  // 2. Extract weight
  const wt = parseWeight(name);
  const { weightValue, weightUnit } = wt
    ? normalizeWeight(wt.value, wt.unit)
    : { weightValue: null, weightUnit: null };

  // 3. Strip weight; classify parentheticals (noise stripped, signal kept as extra tokens)
  let stripped = name;
  if (wt && wt.raw) stripped = stripped.replace(wt.raw, " ");
  const { cleaned, signalTokens } = classifyParens(stripped);
  stripped = cleaned
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

  // 4. Scan ALL tokens for a known brand alias match — O(1) per token via Map
  const lookup = aliasMap || buildBrandAliasMap(brands);
  let brandEntry = null;
  let brandTokenIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    const match = lookup.get(tokens[i]);
    if (match) { brandEntry = match; brandTokenIndex = i; break; }
  }

  // 5. Build slot arrays
  const productTokens = tokens.filter((_, i) => i !== brandTokenIndex);

  // Deduplicate in case name.toLowerCase() already appears in aliases
  const brandSlots = brandEntry
    ? [[...new Set([brandEntry.name.toLowerCase(), ...brandEntry.aliases])]]
    : null;

  // Signal tokens from parentheticals (e.g. "butter" from "(Butter)") become
  // required slot groups so variant canonicals don't cross-match each other.
  const baseProductSlots = [
    ...productTokens.map((t) => [t]),
    ...signalTokens.map((t) => [t]),
  ];

  const allProductTokens = [...productTokens, ...signalTokens];
  const productGroupId =
    allProductTokens.length > 0 ? allProductTokens.join("-") : "unknown";

  return {
    brandSlots,
    baseProductSlots,
    typeSlots: [],
    productGroupId,
    weightValue,
    weightUnit,
  };
}

module.exports = { decomposeCanonical, buildBrandAliasMap };
