"use strict";

const { parseWeight } = require("../../crawler/utils/weight-parser");

// ─── Vocabulary ──────────────────────────────────────────────────────────────

// Each entry: [keyword (lowercase, possibly multi-word), canonical type]
// Multi-word entries must come first so they match before single words.
const ITEM_TYPE_KEYWORDS = [
  ["sona masoori", "rice"],
  ["sona masuri", "rice"],
  ["sona masoor", "rice"],
  ["chana dal", "dal"],
  ["moong dal", "dal"],
  ["biryani masala", "masala"],
  ["sambar powder", "masala"],
  ["chana masala", "masala"],
  ["jal jeera", "masala"],
  ["black gram", "dal"],
  ["black lentil", "dal"],
  ["red lentil", "dal"],
  ["idli rice", "rice"],
  // single-word
  ["rice", "rice"],
  ["basmati", "rice"],
  ["ponni", "rice"],
  ["parboiled", "rice"],
  ["dal", "dal"],
  ["dhal", "dal"],
  ["lentil", "dal"],
  ["toor", "dal"],
  ["arhar", "dal"],
  ["tuvar", "dal"],
  ["moong", "dal"],
  ["mung", "dal"],
  ["urad", "dal"],
  ["masoor", "dal"],
  ["rajma", "dal"],
  ["chana", "dal"],
  ["chickpea", "dal"],
  ["kabuli", "dal"],
  ["masala", "masala"],
  ["spice", "masala"],
  ["jeera", "masala"],
  ["cumin", "masala"],
  ["garam", "masala"],
  ["chaat", "masala"],
  ["chat", "masala"],
  ["rasam", "masala"],
  ["sambar", "masala"],
  ["chole", "masala"],
  ["biryani", "masala"],
  ["jaljira", "masala"],
  ["jaljeera", "masala"],
  ["atta", "flour"],
  ["maida", "flour"],
  ["besan", "flour"],
  ["flour", "flour"],
  ["cornflour", "flour"],
  ["oil", "oil"],
  ["ghee", "oil"],
  ["bhujia", "snack"],
  ["namkeen", "snack"],
  ["chips", "snack"],
  ["murukku", "snack"],
  ["chakli", "snack"],
  ["mixture", "snack"],
  ["tea", "beverage"],
  ["chai", "beverage"],
  ["coffee", "beverage"],
  ["juice", "beverage"],
];

const VARIANT_MAP = {
  rice: {
    basmati: ["basmati"],
    "sona masoori": ["sona masoori", "sona masuri", "sona masoor"],
    ponni: ["ponni"],
    parboiled: ["parboiled", "idli rice"],
  },
  dal: {
    toor: ["toor", "arhar", "tuvar"],
    moong: ["moong", "mung", "moong dal"],
    urad: ["urad", "black gram", "black lentil"],
    masoor: ["masoor", "red lentil"],
    chana: ["chana", "chickpea", "kabuli"],
    rajma: ["rajma"],
  },
  masala: {
    jeera: ["jeera", "cumin"],
    garam: ["garam"],
    chaat: ["chaat", "chat"],
    biryani: ["biryani"],
    rasam: ["rasam"],
    sambar: ["sambar"],
    chole: ["chole", "chana masala"],
    jaljira: ["jaljira", "jaljeera", "jal jeera", "jal jira"],
  },
};

// Flat set of every individual word that appears in any keyword, for brand exclusion
const ALL_TYPE_VARIANT_WORDS = new Set(
  ITEM_TYPE_KEYWORDS.map(([kw]) => kw)
    .concat(
      Object.values(VARIANT_MAP).flatMap((variants) =>
        Object.values(variants).flat(),
      ),
    )
    .flatMap((phrase) => phrase.split(/\s+/)),
);

const UNIT_WORDS = new Set([
  "kg",
  "g",
  "ml",
  "l",
  "liter",
  "litre",
  "ltr",
  "gram",
  "grams",
  "kilogram",
  "milliliter",
  "x",
]);

const COMMON_STOP_WORDS = new Set([
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
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeWeightUnit(u) {
  const map = {
    liter: "l",
    litre: "l",
    ltr: "l",
    kilogram: "kg",
    gram: "g",
    gm: "g",
    milliliter: "ml",
  };
  const lower = String(u || "").toLowerCase();
  return map[lower] || lower;
}

/**
 * Convert value+unit to a base quantity for comparison.
 * Returns { value, type: 'mass'|'volume' } or null.
 */
function toBaseUnit(value, unit) {
  const u = normalizeWeightUnit(String(unit || "").toLowerCase());
  if (u === "kg") return { value, type: "mass" };
  if (u === "g") return { value: value / 1000, type: "mass" };
  if (u === "l") return { value, type: "volume" };
  if (u === "ml") return { value: value / 1000, type: "volume" };
  return null;
}

/**
 * Extract the first likely brand token from a product name string.
 * Returns the first word not matching known type/variant/unit vocabulary.
 */
function extractBrandHint(productName) {
  if (!productName) return "";
  const words = productName.split(/\s+/);
  for (const word of words) {
    const wordLower = word.toLowerCase().replace(/[^a-z]/g, "");
    if (
      wordLower.length < 2 ||
      /^\d/.test(word) ||
      UNIT_WORDS.has(wordLower) ||
      ALL_TYPE_VARIANT_WORDS.has(wordLower) ||
      COMMON_STOP_WORDS.has(wordLower)
    ) {
      continue;
    }
    return word;
  }
  return words[0] || "";
}

function extractBrandTokenFromPhrase(phrase) {
  const words = String(phrase || "").split(/\s+/);
  for (const word of words) {
    const wordLower = word.toLowerCase().replace(/[^a-z]/g, "");
    if (
      wordLower.length < 2 ||
      /^\d/.test(word) ||
      UNIT_WORDS.has(wordLower) ||
      ALL_TYPE_VARIANT_WORDS.has(wordLower) ||
      COMMON_STOP_WORDS.has(wordLower)
    ) {
      continue;
    }
    return word;
  }
  return null;
}

function extractBrandOptions(rawItemText) {
  const text = String(rawItemText || "").trim();
  if (!text) return [];

  const segments = text
    .split(/\s+(?:or|\/|\|)\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length < 2) return [];

  const options = [];
  for (const segment of segments) {
    const brand = extractBrandTokenFromPhrase(segment);
    if (!brand) continue;
    if (!options.some((opt) => opt.toLowerCase() === brand.toLowerCase())) {
      options.push(brand);
    }
  }
  return options;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Parse user-written item text into a structured intent.
 *
 * @param {string} rawItemText  - e.g. "2 kg basmati rice" or "Annam toor dal"
 * @param {number|null} quantity      - pre-parsed quantity (from list_items.quantity)
 * @param {string|null} quantityUnit  - pre-parsed unit (from list_items.quantity_unit)
 * @returns {{ itemType, variant, size, brand, brandOptions }}
 */
function parseItemIntent(rawItemText, quantity, quantityUnit) {
  const text = String(rawItemText || "").trim();
  const lower = text.toLowerCase();

  // 1. Size — prefer pre-parsed quantity/unit; fall back to parseWeight
  let size = null;
  if (quantity != null && quantityUnit) {
    const qty = Number(quantity);
    const normUnit = normalizeWeightUnit(String(quantityUnit).toLowerCase());
    if (!isNaN(qty) && qty > 0 && normUnit) {
      size = { value: qty, unit: normUnit };
    }
  }
  if (!size) {
    const parsed = parseWeight(text);
    if (parsed) size = { value: parsed.value, unit: parsed.unit };
  }

  // 2. Item type — scan ITEM_TYPE_KEYWORDS (multi-word first)
  let itemType = null;
  for (const [keyword, type] of ITEM_TYPE_KEYWORDS) {
    if (lower.includes(keyword)) {
      itemType = type;
      break;
    }
  }

  // 3. Variant — based on item type
  let variant = null;
  if (itemType && VARIANT_MAP[itemType]) {
    outer: for (const [variantName, aliases] of Object.entries(
      VARIANT_MAP[itemType],
    )) {
      for (const alias of aliases) {
        if (lower.includes(alias)) {
          variant = variantName;
          break outer;
        }
      }
    }
  }

  // 4. Brand — first non-vocab token in original text
  let brand = null;
  const words = text.split(/\s+/);
  for (const word of words) {
    const wordLower = word.toLowerCase().replace(/[^a-z]/g, "");
    if (
      wordLower.length < 2 ||
      /^\d/.test(word) ||
      UNIT_WORDS.has(wordLower) ||
      ALL_TYPE_VARIANT_WORDS.has(wordLower) ||
      COMMON_STOP_WORDS.has(wordLower)
    ) {
      continue;
    }
    brand = word;
    break;
  }
  const brandOptions = extractBrandOptions(text);
  if (!brand && brandOptions.length > 0) {
    brand = brandOptions[0];
  }

  return { itemType, variant, size, brand, brandOptions };
}

/**
 * Normalize price to EUR/kg (for dry goods) or EUR/L (for liquids).
 *
 * @returns {{ value: number, label: 'per kg'|'per L' } | null}
 */
function calcPricePerUnit(salePrice, weightValue, weightUnit) {
  const price = Number(salePrice);
  const weight = Number(weightValue);
  if (
    !weightUnit ||
    isNaN(price) ||
    price <= 0 ||
    isNaN(weight) ||
    weight <= 0
  ) {
    return null;
  }

  const unit = normalizeWeightUnit(String(weightUnit).toLowerCase());

  if (unit === "kg")
    return { value: Math.round((price / weight) * 100) / 100, label: "per kg" };
  if (unit === "g")
    return {
      value: Math.round((price / weight) * 1000 * 100) / 100,
      label: "per kg",
    };
  if (unit === "l")
    return { value: Math.round((price / weight) * 100) / 100, label: "per L" };
  if (unit === "ml")
    return {
      value: Math.round((price / weight) * 1000 * 100) / 100,
      label: "per L",
    };

  return null;
}

/**
 * Score and annotate a deal row against a parsed intent.
 *
 * @param {object} deal   - DB row with product_name, weight_value, weight_unit, sale_price
 * @param {object} intent - result of parseItemIntent()
 * @returns {{ price_per_unit, unit_label, match_quality, warnings }}
 */
function scoreAndAnnotateDeal(deal, intent) {
  const warnings = [];
  const productNameLower = String(deal.product_name || "").toLowerCase();

  // Normalized price per unit
  const pricePerUnit = calcPricePerUnit(
    deal.sale_price,
    deal.weight_value,
    deal.weight_unit,
  );

  // Check variant match
  if (intent.variant && intent.itemType && VARIANT_MAP[intent.itemType]) {
    const aliases = VARIANT_MAP[intent.itemType][intent.variant] || [];
    const hasVariant = aliases.some((alias) =>
      productNameLower.includes(alias),
    );
    if (!hasVariant) {
      warnings.push(
        `variant_differs: expected ${intent.variant} not found in product`,
      );
    }
  }

  // Check brand match
  const candidateBrands = Array.isArray(intent.brandOptions)
    ? intent.brandOptions.filter(Boolean)
    : [];
  if (intent.brand && candidateBrands.length === 0) {
    candidateBrands.push(intent.brand);
  }
  if (candidateBrands.length > 0) {
    const hasRequestedBrand = candidateBrands.some((brand) =>
      productNameLower.includes(String(brand).toLowerCase()),
    );
    if (!hasRequestedBrand) {
      const dealBrandHint = extractBrandHint(deal.product_name);
      const foundPart = dealBrandHint ? `found ${dealBrandHint}, ` : "";
      warnings.push(
        `brand_differs: ${foundPart}requested ${candidateBrands.join(" or ")}`,
      );
    }
  }

  // Check size match (only when both sides are known and comparable)
  if (intent.size && deal.weight_value && deal.weight_unit) {
    const intentBase = toBaseUnit(intent.size.value, intent.size.unit);
    const dealBase = toBaseUnit(Number(deal.weight_value), deal.weight_unit);
    if (
      intentBase &&
      dealBase &&
      intentBase.type === dealBase.type &&
      intentBase.value > 0
    ) {
      const ratio =
        Math.abs(intentBase.value - dealBase.value) / intentBase.value;
      if (ratio > 0.15) {
        const intentStr = `${intent.size.value}${intent.size.unit}`;
        const dealStr = `${deal.weight_value}${deal.weight_unit}`;
        warnings.push(`size_differs: found ${dealStr}, requested ${intentStr}`);
      }
    }
  }

  let matchQuality;
  if (warnings.length === 0) matchQuality = "exact";
  else if (warnings.length <= 2) matchQuality = "partial";
  else matchQuality = "low_confidence";

  return {
    price_per_unit: pricePerUnit ? pricePerUnit.value : null,
    unit_label: pricePerUnit ? pricePerUnit.label : null,
    match_quality: matchQuality,
    warnings,
  };
}

/**
 * Compute how many packages to buy and the real basket cost.
 *
 * Example: want 5 kg, package is 500 g at €1.29
 *   → packs_needed = ceil(5000g / 500g) = 10
 *   → effective_price = 10 × €1.29 = €12.90
 *
 * Example: want 2 kg, package is 5 kg at €8.99
 *   → packs_needed = ceil(2 / 5) = 1
 *   → effective_price = 1 × €8.99 = €8.99
 *
 * Falls back to packs_needed=1, effective_price=salePrice when size is unknown
 * or units are incomparable (e.g. requesting kg for a liquid deal).
 *
 * @param {number} salePrice
 * @param {number|null} dealWeightValue  - package weight value
 * @param {string|null} dealWeightUnit   - package weight unit
 * @param {{ value: number, unit: string }|null} intentSize - what user asked for
 * @returns {{ effective_price: number, packs_needed: number }}
 */
function computeEffectivePrice(
  salePrice,
  dealWeightValue,
  dealWeightUnit,
  intentSize,
) {
  if (dealWeightValue && dealWeightUnit && intentSize) {
    const dealBase = toBaseUnit(Number(dealWeightValue), dealWeightUnit);
    const intentBase = toBaseUnit(intentSize.value, intentSize.unit);
    if (
      dealBase &&
      intentBase &&
      dealBase.type === intentBase.type &&
      dealBase.value > 0 &&
      intentBase.value > 0
    ) {
      const packsNeeded = Math.ceil(intentBase.value / dealBase.value);
      return {
        effective_price:
          Math.round(packsNeeded * Number(salePrice) * 100) / 100,
        packs_needed: packsNeeded,
      };
    }
  }
  return {
    effective_price: Math.round(Number(salePrice) * 100) / 100,
    packs_needed: 1,
  };
}

module.exports = {
  parseItemIntent,
  calcPricePerUnit,
  scoreAndAnnotateDeal,
  computeEffectivePrice,
};
