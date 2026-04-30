"use strict";

/**
 * product-parser.js  — Layer 1 of The Smartest Architecture
 *
 * Converts a raw product name or search query into structured JSON:
 *   { brand, product_base, quality_variant, weight_value, weight_unit,
 *     pack_count, total_weight_g, normalized_key }
 *
 * The normalized_key is brand + product_base WITHOUT weight or qualifiers.
 * This is the string that gets embedded for similarity comparison, avoiding
 * the classic mistake of matching "1 kg basmati rice" with "5 kg basmati rice"
 * just because the descriptions are textually similar.
 */

const { normalise } = require("../../crawler/entity-resolution/normaliser");
const { parseWeight } = require("../../crawler/utils/weight-parser");

// ── Known Indian grocery brands ───────────────────────────────────────────────
const KNOWN_BRANDS = new Set([
  "trs",
  "rajah",
  "eastern",
  "swad",
  "annam",
  "heera",
  "natco",
  "kohinoor",
  "shangrila",
  "ahmed",
  "shan",
  "aachi",
  "everest",
  "mdh",
  "catch",
  "parampara",
  "ashoka",
  "priya",
  "deep",
  "haldirams",
  "bikano",
  "bambino",
  "aashirvaad",
  "pillsbury",
  "patanjali",
  "amul",
  "daawat",
  "laxmi",
  "nilgiris",
  "mtr",
  "gits",
  "swastik",
  "bansi",
  "sujata",
  "national",
  "shan",
  "ahmed",
  "bikanervala",
  "lijjat",
  "kurkure",
  "maggi",
  "knorr",
  "nestle",
  "heinz",
  "dabur",
  "britannia",
  "parle",
  "sunfeast",
  "itc",
  "godrej",
  "maaza",
  "tropicana",
  "kissan",
  "dr oetker",
  "weikfield",
  "shan",
  "mehran",
]);

// ── Product base patterns (multi-word first, most specific first) ─────────────
const PRODUCT_BASE_PATTERNS = [
  "basmati rice",
  "sona masoori",
  "sona masuri",
  "ponni rice",
  "idli rice",
  "parboiled rice",
  "jasmine rice",
  "brown rice",
  "toor dal",
  "chana dal",
  "moong dal",
  "urad dal",
  "masoor dal",
  "rajma dal",
  "chana masala",
  "biryani masala",
  "garam masala",
  "sambar powder",
  "rasam powder",
  "wheat flour",
  "gram flour",
  "rice flour",
  "corn flour",
  "coconut milk",
  "coconut oil",
  "mustard oil",
  "sesame oil",
  "sunflower oil",
  "groundnut oil",
  "black gram",
  "red lentil",
  "kidney bean",
  "kidney beans",
  "black eyed peas",
  // spices & seeds (multi-word first)
  "jeera cumin",
  "cumin seeds",
  "jeera seeds",
  "coriander seeds",
  "coriander powder",
  "turmeric powder",
  "red chilli",
  "chilli powder",
  "chili powder",
  "mustard seeds",
  "fenugreek seeds",
  "fennel seeds",
  "black pepper",
  "white pepper",
  "cardamom seeds",
  "cumin powder",
  // spices & seeds (single word)
  "jeera",
  "cumin",
  "coriander",
  "turmeric",
  "haldi",
  "dhania",
  "methi",
  "fenugreek",
  "ajwain",
  "saunf",
  "fennel",
  "cardamom",
  "elaichi",
  "cloves",
  "cinnamon",
  "dalchini",
  "pepper",
  "mustard",
  "chilli",
  "chili",
  // single words
  "basmati",
  "rice",
  "dal",
  "dhal",
  "lentil",
  "toor",
  "chana",
  "moong",
  "urad",
  "masoor",
  "rajma",
  "chickpea",
  "atta",
  "maida",
  "besan",
  "flour",
  "oil",
  "ghee",
  "masala",
  "spice",
  "powder",
  "chutney",
  "pickle",
  "achar",
  "sauce",
  "tea",
  "chai",
  "coffee",
  "juice",
  "paneer",
  "yogurt",
  "curd",
  "milk",
  "noodle",
  "vermicelli",
  "pasta",
  "snack",
  "chips",
  "biscuit",
  "namkeen",
  "bhujia",
  "murukku",
  "poha",
  "semolina",
  "rava",
  "sooji",
];

// ── Quality qualifiers (stripped from the embedding key) ─────────────────────
const QUALITY_QUALIFIERS = [
  "premium",
  "extra long",
  "long grain",
  "short grain",
  "aged",
  "organic",
  "pure",
  "whole",
  "split",
  "hulled",
  "unpolished",
  "polished",
  "roasted",
  "raw",
  "super",
  "saver",
  "special",
  "fresh",
  "original",
  "classic",
  "traditional",
];

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "with",
  "for",
  "in",
  "pack",
  "packet",
  "bag",
  "box",
  "tin",
  "jar",
  "bottle",
  "sachet",
  "pouch",
  "value",
  "size",
  "offer",
  "deal",
]);

const UNIT_WORDS = new Set([
  "kg",
  "g",
  "ml",
  "l",
  "ltr",
  "litre",
  "liter",
  "x",
]);

// Pre-compute a flat set of all words that appear in product base patterns,
// so that brand extraction can skip them.
const PRODUCT_BASE_WORDS = new Set(
  PRODUCT_BASE_PATTERNS.flatMap((p) => p.split(/\s+/)),
);

function toGrams(value, unit) {
  const v = Number(value);
  if (isNaN(v) || v <= 0) return null;
  const u = String(unit || "").toLowerCase();
  if (u === "kg") return v * 1000;
  if (u === "g") return v;
  if (u === "l") return v * 1000;
  if (u === "ml") return v;
  return null;
}

/**
 * Parse a product name or search query into structured fields.
 *
 * @param {string} rawName
 * @returns {{
 *   brand: string|null,
 *   product_base: string|null,
 *   quality_variant: string|null,
 *   weight_value: number|null,
 *   weight_unit: string|null,
 *   pack_count: number,
 *   total_weight_g: number|null,
 *   normalized_key: string
 * }}
 */
function parseProductName(rawName) {
  const text = String(rawName || "").trim();
  const lower = text.toLowerCase();

  // ── 1. Weight + pack count ──────────────────────────────────────────────────
  let weight_value = null;
  let weight_unit = null;
  let pack_count = 1;

  // Multi-pack pattern: "2 x 5kg", "3x500g"
  const packMatch = lower.match(
    /(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i,
  );
  if (packMatch) {
    pack_count = parseInt(packMatch[1], 10);
    weight_value = parseFloat(packMatch[2].replace(",", "."));
    weight_unit = packMatch[3].toLowerCase();
  } else {
    const wp = parseWeight(text);
    if (wp) {
      weight_value = wp.value;
      weight_unit = wp.unit;
    }
  }

  const total_weight_g =
    weight_value && weight_unit
      ? (toGrams(weight_value, weight_unit) || 0) * pack_count || null
      : null;

  // ── 2. Product base type ────────────────────────────────────────────────────
  // Use word-boundary matching to avoid "boiled" matching "oil", etc.
  let product_base = null;
  for (const pattern of PRODUCT_BASE_PATTERNS) {
    const re = new RegExp(
      `(?:^|\\s)${pattern.replace(/\s+/g, "\\s+")}(?:\\s|$)`,
    );
    if (re.test(lower)) {
      product_base = pattern;
      break;
    }
  }

  // ── 3. Quality variant ──────────────────────────────────────────────────────
  let quality_variant = null;
  for (const q of QUALITY_QUALIFIERS) {
    if (lower.includes(q)) {
      quality_variant = q;
      break;
    }
  }

  // ── 4. Brand extraction ─────────────────────────────────────────────────────
  // Pass 1: check against known brand dictionary
  let brand = null;
  const words = text.split(/\s+/);
  for (const word of words) {
    const wl = word.toLowerCase().replace(/[^a-z]/g, "");
    if (KNOWN_BRANDS.has(wl)) {
      brand = wl;
      break;
    }
  }

  // Pass 2: first meaningful token that isn't a product type / unit / stop word
  if (!brand) {
    for (const word of words) {
      const wl = word.toLowerCase().replace(/[^a-z]/g, "");
      if (
        !wl ||
        wl.length < 2 ||
        /^\d/.test(word) ||
        UNIT_WORDS.has(wl) ||
        STOP_WORDS.has(wl) ||
        PRODUCT_BASE_WORDS.has(wl)
      ) {
        continue;
      }
      brand = wl;
      break;
    }
  }

  // ── 5. Normalized embedding key ─────────────────────────────────────────────
  // brand + product_base, NO weight, NO qualifiers
  // This is the string used for TF-IDF cosine similarity.
  const keyParts = [];
  if (brand) keyParts.push(brand.toLowerCase());
  if (product_base) keyParts.push(product_base);

  // If neither brand nor product_base found, fall back to normalise() which
  // strips units, qualifiers, and packaging words.
  const normalized_key =
    keyParts.length > 0 ? keyParts.join(" ") : normalise(text);

  return {
    brand,
    product_base,
    quality_variant,
    weight_value,
    weight_unit,
    pack_count,
    total_weight_g,
    normalized_key,
  };
}

module.exports = { parseProductName };
