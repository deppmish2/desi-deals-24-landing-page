"use strict";

const { buildCartTransfer } = require("./cart-transfer");
const { normalise } = require("../../crawler/entity-resolution/normaliser");
const { similarity } = require("../../crawler/entity-resolution/fuzzy-matcher");
const { parseWeight } = require("../../crawler/utils/weight-parser");
const { phoneticNormalise, expandQuery } = require("./search-expander");
const {
  parseItemIntent,
  scoreAndAnnotateDeal,
  computeEffectivePrice,
} = require("./item-matcher");
const { parseProductName } = require("./product-parser");
const { rankMatch, reRankDeals } = require("./smart-ranker");
const { toBaseQty, findCheapestExactCombination } = require("./combination-engine");
const {
  resolveBaseProduct,
  detectBrandForBase,
} = require("./base-product-catalog");

const STOP_WORDS = new Set([
  "and",
  "of",
  "for",
  "with",
  "the",
  "a",
  "an",
  "x",
  "pack",
  "packs",
  "packet",
  "packets",
  "gm",
  "gram",
  "grams",
  "kg",
  "g",
  "ml",
  "l",
  "ltr",
  "litre",
  "liter",
  "pcs",
  "pc",
  "units",
  "unit",
]);

const BRAND_WORD_BLOCKLIST = new Set([
  "toor",
  "tur",
  "dal",
  "dhal",
  "rice",
  "basmati",
  "masala",
  "powder",
  "whole",
  "split",
  "gram",
  "flour",
  "oil",
  "ghee",
  "atta",
  "chana",
  "urad",
  "moong",
  "masoor",
  "rajma",
  "jeera",
  "cumin",
  "coriander",
  "turmeric",
  "chili",
  "chilli",
  "instant",
  "noodles",
  "premium",
  "fresh",
  "organic",
  "pack",
  "packet",
  "pcs",
  "unit",
]);

const TOKEN_EQUIVALENTS = {
  jeera: ["cumin"],
  cumin: ["jeera"],
  daal: ["dal"],
  dhal: ["dal"],
  dal: ["daal", "dhal"],
  arhar: ["toor", "tuvar"],
  tuvar: ["toor", "arhar"],
  toor: ["arhar", "tuvar"],
  atta: ["ata", "aata", "wheat", "flour"],
  ataa: ["atta", "aata", "wheat", "flour"],
  aata: ["atta", "ata", "wheat", "flour"],
  attaa: ["atta", "ata", "aata", "wheat", "flour"],
  jaljira: ["jaljeera", "jal jeera", "jal jira"],
  jaljeera: ["jaljira", "jal jeera", "jal jira"],
};

const TOKEN_RELAXED_NOISE = new Set([
  "powder",
  "masala",
  "spice",
  "seasoning",
  "mix",
  "mixed",
  "whole",
  "split",
  "premium",
  "fresh",
  "organic",
]);

// Smart Architecture: minimum combined score (embedding + brand + weight + overlap + phonetic)
// for a deal candidate to be considered a confident match.
// Below this threshold the existing token-based logic acts as a safety net.
const SMART_MATCH_THRESHOLD = 0.45;

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function tokenizeForSearch(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  return normalized
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter((token) => !/^\d+(?:\.\d+)?$/.test(token))
    .filter((token) => !STOP_WORDS.has(token));
}

function tokenVariant(token) {
  if (token.endsWith("ie") && token.length > 4) {
    return `${token.slice(0, -2)}i`;
  }
  return null;
}

function collapsedVowelVariant(token) {
  const collapsed = String(token || "")
    .toLowerCase()
    .replace(/([aeiou])\1+/g, "$1");
  if (!collapsed || collapsed === token) return null;
  return collapsed;
}

function commodityVariant(token) {
  const value = String(token || "").toLowerCase();
  if (!value) return null;
  const collapsed = value.replace(/([aeiou])\1+/g, "$1");
  if (collapsed === "ata") return "atta";
  if (collapsed === "daal" || collapsed === "dhal") return "dal";
  if (collapsed === "tur" || collapsed === "thuvar" || collapsed === "arhar")
    return "toor";
  return null;
}

function singularVariant(token) {
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return null;
}

function tokenForms(token) {
  const forms = [token];
  const alt1 = tokenVariant(token);
  const alt2 = singularVariant(token);
  const alt3 = collapsedVowelVariant(token);
  const alt4 = commodityVariant(token);
  const equivalents = TOKEN_EQUIVALENTS[token] || [];
  if (alt1) forms.push(alt1);
  if (alt2) forms.push(alt2);
  if (alt3) forms.push(alt3);
  if (alt4) forms.push(alt4);
  for (const equivalent of equivalents) forms.push(equivalent);
  return Array.from(new Set(forms.filter(Boolean)));
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeToken(text, token) {
  const target = String(token || "")
    .trim()
    .toLowerCase();
  if (!target) return false;
  const source = String(text || "")
    .trim()
    .toLowerCase();
  if (!source) return false;
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(target)}(?:\\s|$)`);
  return re.test(source);
}

function normalizeBrand(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function brandTokens(value) {
  return normalizeBrand(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function consonantKey(value) {
  return String(value || "").replace(/[aeiou]/g, "");
}

function isBrandMatch(brandCandidate, productName) {
  const brandNorm = normalizeBrand(brandCandidate);
  const productNorm = normalizeBrand(productName);
  if (!brandNorm || !productNorm) return false;
  if (productNorm.includes(brandNorm)) return true;

  const candidateTokens = brandTokens(brandNorm);
  const productTokens = brandTokens(productNorm);
  if (candidateTokens.length === 0 || productTokens.length === 0) return false;

  return candidateTokens.every((candidateToken) => {
    const candidateForms = tokenForms(candidateToken);
    const normalizedForms = candidateForms
      .map((form) => normalizeBrand(form))
      .filter(Boolean);
    if (candidateToken.length < 4) {
      return normalizedForms.some((form) => productTokens.includes(form));
    }

    return normalizedForms.some((form) => {
      const formPhonetic = phoneticNormalise(form);
      const formConsonant = consonantKey(formPhonetic);
      return productTokens.some((productToken) => {
        if (productToken === form) return true;
        const productPhonetic = phoneticNormalise(productToken);
        if (productPhonetic === formPhonetic) return true;
        if (
          formConsonant &&
          formConsonant.length >= 4 &&
          consonantKey(productPhonetic) === formConsonant
        ) {
          return true;
        }
        if (form.length >= 5 && productToken.length >= 5) {
          return similarity(form, productToken) >= 0.84;
        }
        return false;
      });
    });
  });
}

function extractLikelyBrand(productName) {
  const source = String(productName || "").trim();
  if (!source) return null;

  const prefixCandidate = source.split(/[-|[(]/)[0].trim();
  if (prefixCandidate) {
    const prefixWords = prefixCandidate.split(/\s+/).filter(Boolean);
    if (prefixWords.length > 0 && prefixWords.length <= 2) {
      const maybe = prefixWords.join(" ");
      const normalizedMaybe = normalizeBrand(maybe);
      if (
        normalizedMaybe &&
        !/^\d/.test(normalizedMaybe) &&
        !BRAND_WORD_BLOCKLIST.has(normalizedMaybe)
      ) {
        return maybe;
      }
    }
  }

  const tokens = source
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const normalized = normalizeBrand(token);
    if (!normalized) continue;
    if (/^\d/.test(normalized)) continue;
    if (normalized.length < 2) continue;
    if (BRAND_WORD_BLOCKLIST.has(normalized)) continue;
    return token;
  }

  return null;
}

function parseBrandCandidates(requestedBrand, requestedBrandOptions) {
  const options = [];
  const pushUnique = (value) => {
    const v = String(value || "").trim();
    if (!v) return;
    if (!options.some((item) => normalizeBrand(item) === normalizeBrand(v))) {
      options.push(v);
    }
  };

  const explicit = Array.isArray(requestedBrandOptions)
    ? requestedBrandOptions
    : [];
  for (const option of explicit) pushUnique(option);

  const requested = String(requestedBrand || "").trim();
  if (requested) {
    const split = requested
      .split(/\s+(?:or|\/|\|)\s+/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (split.length > 1) {
      for (const part of split) pushUnique(part);
    } else {
      pushUnique(requested);
    }
  }

  return options;
}

function stripBrandCandidatesFromText(text, brandCandidates) {
  let value = String(text || "").trim();
  if (!value) return "";

  const candidates = Array.isArray(brandCandidates)
    ? [...brandCandidates]
        .map((candidate) => String(candidate || "").trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
    : [];

  for (const candidate of candidates) {
    const normalized = normalizeBrand(candidate);
    if (!normalized) continue;
    const re = new RegExp(`(?:^|\\s)${escapeRegExp(normalized)}(?:\\s|$)`, "ig");
    value = normalizeBrand(value).replace(re, " ").replace(/\s+/g, " ").trim();
  }

  return value;
}

function resolveBrandInfo(requestedBrand, productName, requestedBrandOptions) {
  const brandCandidates = parseBrandCandidates(
    requestedBrand,
    requestedBrandOptions,
  );
  const requested = String(requestedBrand || "").trim();
  if (brandCandidates.length === 0) {
    return {
      brand_status: "not_requested",
      requested_brand: null,
      matched_brand: null,
    };
  }

  const normalizedCandidates = brandCandidates.map((brand) =>
    normalizeBrand(brand),
  );
  const requestedNorm = normalizedCandidates[0];
  if (brandCandidates.some((brand) => isBrandMatch(brand, productName))) {
    return {
      brand_status: "exact",
      requested_brand: requested || brandCandidates.join(" or "),
      matched_brand:
        brandCandidates.find((brand) => isBrandMatch(brand, productName)) ||
        brandCandidates[0],
    };
  }

  const inferred = extractLikelyBrand(productName);
  const inferredNorm = normalizeBrand(inferred);
  if (
    inferredNorm &&
    requestedNorm &&
    !normalizedCandidates.includes(inferredNorm)
  ) {
    return {
      brand_status: "changed",
      requested_brand: requested || brandCandidates.join(" or "),
      matched_brand: inferred,
    };
  }

  return {
    brand_status: "unknown",
    requested_brand: requested || brandCandidates.join(" or "),
    matched_brand: inferred || null,
  };
}

function hasCategorySignalOverlap(
  rawItemText,
  requestedBrand,
  requestedBrandOptions,
  productName,
) {
  const productNorm = normalise(productName || "");
  if (!productNorm) return false;

  const productTokenSet = new Set(productNorm.split(/\s+/).filter(Boolean));
  if (productTokenSet.size === 0) return false;

  const requestedBrandTokenSet = new Set(
    parseBrandCandidates(requestedBrand, requestedBrandOptions)
      .flatMap((brand) => brandTokens(brand))
      .flatMap((token) => tokenForms(token)),
  );

  const querySignals = Array.from(
    new Set(
      tokenizeForSearch(rawItemText)
        .flatMap((token) => tokenForms(token))
        .filter(
          (token) =>
            !requestedBrandTokenSet.has(token) &&
            !TOKEN_RELAXED_NOISE.has(token),
        ),
    ),
  );
  if (querySignals.length === 0) return false;

  const matchedSignals = querySignals.filter((signal) => {
    if (productTokenSet.has(signal)) return true;
    return hasWholeToken(productNorm, signal);
  }).length;

  return matchedSignals >= 1;
}

function mapDealCategoryToItemType(categoryValue) {
  const text = String(categoryValue || "")
    .trim()
    .toLowerCase();
  if (!text) return null;

  if (
    /\b(snack|sweets|sweet|chips|namkeen|murukku|mixture|bhujia)\b/.test(text)
  )
    return "snack";
  if (/\b(spice|spices|masala)\b/.test(text)) return "masala";
  if (/\b(lentils?|pulses?|dal|dhal)\b/.test(text)) return "dal";
  if (/\b(rice|grains?)\b/.test(text)) return "rice";
  if (/\b(flour|atta|maida|besan)\b/.test(text)) return "flour";
  if (/\b(oil|ghee)\b/.test(text)) return "oil";
  if (/\b(beverage|drink|tea|coffee|juice)\b/.test(text)) return "beverage";
  if (/\b(fruit|vegetable|produce)\b/.test(text)) return "produce";
  return null;
}

function inferStrictItemTypeFromName(productName) {
  const text = String(productName || "")
    .trim()
    .toLowerCase();
  if (!text) return null;

  if (
    /\b(murukku|chips|namkeen|snack|bhujia|mixture|cracker|sev|chakli)\b/.test(
      text,
    )
  )
    return "snack";
  if (/\b(masala|spice|powder|seasoning|chaat|garam)\b/.test(text))
    return "masala";
  if (
    /\b(dal|dhal|lentil|toor|arhar|tuvar|moong|mung|urad|masoor|rajma|chana)\b/.test(
      text,
    )
  )
    return "dal";
  if (
    /\b(rice|basmati|sona masoori|sona masuri|ponni|idli rice|parboiled)\b/.test(
      text,
    )
  )
    return "rice";
  if (/\b(atta|maida|besan|flour)\b/.test(text)) return "flour";
  if (/\b(oil|ghee)\b/.test(text)) return "oil";
  if (/\b(tea|coffee|juice|drink|beverage)\b/.test(text)) return "beverage";
  if (/\b(vegetable|fruit|produce)\b/.test(text)) return "produce";
  return null;
}

function isCategoryMatchStrict(intent, deal) {
  const expected =
    String(intent?.itemType || "")
      .trim()
      .toLowerCase() || inferStrictItemTypeFromName(intent?.rawItemText);
  const normalizedExpected = String(expected || "")
    .trim()
    .toLowerCase();
  if (!normalizedExpected) return true;

  const nameType = inferStrictItemTypeFromName(deal?.product_name);
  if (nameType && nameType !== normalizedExpected) return false;

  const categoryType = mapDealCategoryToItemType(deal?.product_category);
  if (!nameType && categoryType && categoryType !== normalizedExpected)
    return false;

  if (nameType) return nameType === normalizedExpected;
  if (categoryType) return categoryType === normalizedExpected;
  return true;
}

function buildSearchPhrases(item, options = {}) {
  const includeAliases = options.includeAliases !== false;
  const aliases = parseJson(item.common_aliases, []);
  const phrases = [];

  if (item.raw_item_text) phrases.push(String(item.raw_item_text).trim());
  if (item.canonical_name) phrases.push(String(item.canonical_name).trim());
  if (includeAliases) {
    for (const alias of aliases) {
      const value = String(alias || "").trim();
      if (value) phrases.push(value);
    }
  }

  return Array.from(new Set(phrases.filter(Boolean)));
}

function pickByTokenScore(candidates, tokens) {
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    tokens.length === 0
  )
    return null;

  const scored = candidates.map((candidate) => {
    const normalizedProduct = normalise(candidate.product_name || "");
    const productTokens = normalizedProduct.split(/\s+/).filter(Boolean);

    let exactMatches = 0;
    let weightedCoverage = 0;

    for (const token of tokens) {
      const forms = tokenForms(token);
      let bestTokenScore = 0;

      for (const form of forms) {
        if (hasWholeToken(normalizedProduct, form)) {
          bestTokenScore = Math.max(bestTokenScore, 1);
          continue;
        }

        if (form.length >= 5) {
          for (const productToken of productTokens) {
            if (similarity(form, productToken) >= 0.84) {
              bestTokenScore = Math.max(bestTokenScore, 0.7);
            }
          }
        }
      }

      if (bestTokenScore >= 1) exactMatches += 1;
      if (bestTokenScore > 0) weightedCoverage += bestTokenScore;
    }

    const coverage = exactMatches / tokens.length;
    const quality = weightedCoverage / tokens.length;

    return {
      candidate,
      exactMatches,
      weightedCoverage,
      coverage,
      quality,
    };
  });

  scored.sort((a, b) => {
    if (a.exactMatches !== b.exactMatches)
      return b.exactMatches - a.exactMatches;
    if (a.quality !== b.quality) return b.quality - a.quality;
    return (
      Number(a.candidate.sale_price || 0) - Number(b.candidate.sale_price || 0)
    );
  });

  return scored[0] || null;
}

function isConfidentMatch(best, tokens) {
  if (!best || !Array.isArray(tokens) || tokens.length === 0) return false;

  if (tokens.length >= 4) return best.exactMatches >= 2 && best.quality >= 0.45;
  if (tokens.length === 3)
    return best.exactMatches >= 2 && best.quality >= 0.55;
  if (tokens.length === 2) return best.exactMatches >= 2 || best.quality >= 0.9;

  const [single] = tokens;
  if (!single) return false;
  if (single.length < 5) {
    return best.exactMatches >= 1 && best.quality >= 0.99;
  }
  return best.quality >= 0.8;
}

function durationHours(option) {
  if (option.estimated_hours != null) return option.estimated_hours;
  if (option.estimated_days != null) return option.estimated_days * 24;
  return Number.POSITIVE_INFINITY;
}

function getShippingCost(db, storeId, basketTotal) {
  const tier = db
    .prepare(
      `SELECT cost
     FROM shipping_tiers
     WHERE store_id = ?
       AND min_basket <= ?
       AND (max_basket IS NULL OR max_basket >= ?)
     ORDER BY min_basket DESC
     LIMIT 1`,
    )
    .get(storeId, basketTotal, basketTotal);

  if (tier && typeof tier.cost === "number") {
    return tier.cost;
  }

  const store = db
    .prepare("SELECT free_shipping_min FROM stores WHERE id = ? LIMIT 1")
    .get(storeId);
  if (
    store &&
    typeof store.free_shipping_min === "number" &&
    basketTotal >= store.free_shipping_min
  ) {
    return 0;
  }

  return 0;
}

function getEligibleDeliveryOptions(db, storeId, postcode, now, basketTotal) {
  const rows = db
    .prepare(
      `SELECT *
     FROM delivery_options
     WHERE store_id = ?
       AND is_active = 1
       AND min_basket <= ?`,
    )
    .all(storeId, basketTotal);

  const weekday = now.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "Europe/Berlin",
  });

  const options = rows
    .map((row) => {
      const postcodes = parseJson(row.eligible_postcodes, null);
      const availableDays = parseJson(row.available_days, null);
      const postcodeEligible =
        !postcodes || (postcode ? postcodes.includes(postcode) : false);
      const dayEligible = !availableDays || availableDays.includes(weekday);

      let cutoffPassed = false;
      if (row.cutoff_time && row.delivery_type === "same_day") {
        const [hh, mm] = String(row.cutoff_time).split(":").map(Number);
        if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
          const cutoff = new Date(now);
          cutoff.setHours(hh, mm, 0, 0);
          cutoffPassed = now >= cutoff;
        }
      }

      return {
        ...row,
        postcode_eligible: postcodeEligible,
        day_eligible: dayEligible,
        cutoff_passed: cutoffPassed,
      };
    })
    .filter((row) => row.postcode_eligible && row.day_eligible);

  if (options.length === 0) {
    return [
      {
        delivery_type: "standard",
        label: "Standard Delivery",
        surcharge: 0,
        estimated_days: 3,
        estimated_hours: null,
        cutoff_passed: false,
      },
    ];
  }

  return options;
}

function pickDeliveryOption(options, preference) {
  if (preference === "same_day_if_available") {
    const sameDay = options.find((opt) => opt.delivery_type === "same_day");
    return sameDay || null;
  }

  if (preference === "fastest") {
    return (
      [...options].sort((a, b) => durationHours(a) - durationHours(b))[0] ||
      null
    );
  }

  return (
    [...options].sort((a, b) => (a.surcharge || 0) - (b.surcharge || 0))[0] ||
    null
  );
}

function getPricingIntentSize(intent) {
  // matching_spec.md: pricing must use the exact requested quantity.
  return intent?.size || null;
}

function pickPreferredDealByIntent(candidates, intent) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const intentSize = getPricingIntentSize(intent);
  const targetBase = intentSize
    ? toBaseValue(intentSize.value, intentSize.unit)
    : null;
  if (!targetBase) return candidates[0] || null;

  const compatible = candidates
    .map((candidate) => resolveDealWeightFallback(candidate))
    .map((candidate) => ({
      candidate,
      base: toBaseValue(candidate.weight_value, candidate.weight_unit),
    }))
    .filter(
      (entry) =>
        entry.base &&
        entry.base.type === targetBase.type &&
        entry.base.qty <= targetBase.qty + 0.001,
    );

  if (compatible.length === 0) return null;

  compatible.sort((a, b) => {
    const effectiveA = computeEffectivePrice(
      a.candidate.sale_price,
      a.candidate.weight_value,
      a.candidate.weight_unit,
      intentSize,
    ).effective_price;
    const effectiveB = computeEffectivePrice(
      b.candidate.sale_price,
      b.candidate.weight_value,
      b.candidate.weight_unit,
      intentSize,
    ).effective_price;
    if (effectiveA !== effectiveB) return effectiveA - effectiveB;

    const gapA = Math.abs(targetBase.qty - a.base.qty);
    const gapB = Math.abs(targetBase.qty - b.base.qty);
    if (gapA !== gapB) return gapA - gapB;

    return Number(a.candidate.sale_price || 0) - Number(b.candidate.sale_price || 0);
  });

  return compatible[0].candidate;
}

function loadListItems(db, listId) {
  return db
    .prepare(
      `SELECT li.id,
            li.canonical_id,
            li.raw_item_text,
            li.quantity,
            li.quantity_unit,
            li.item_count,
            li.brand_pref,
            cp.canonical_name,
            cp.common_aliases
     FROM list_items li
     LEFT JOIN canonical_products cp ON cp.id = li.canonical_id
     WHERE li.list_id = ?
     ORDER BY li.id ASC`,
    )
    .all(listId);
}

const MASS_VOLUME_UNITS = new Set(["kg", "g", "l", "ml"]);

/**
 * Returns the quantity in a base unit (grams for mass, ml for volume),
 * or null if unit is not a known mass/volume unit.
 */
function toBaseValue(value, unit) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  const u = String(unit || "").trim().toLowerCase();
  if (u === "kg") return { qty: num * 1000, type: "mass" };
  if (u === "g") return { qty: num, type: "mass" };
  if (u === "l") return { qty: num * 1000, type: "volume" };
  if (u === "ml") return { qty: num, type: "volume" };
  return null;
}

/**
 * Returns true if the deal pack is significantly LARGER than the requested size
 * (i.e. would cause the user to buy more than needed in a single pack).
 * Deals that are smaller than requested are fine — packs_needed handles multi-pack.
 */
function isDealOversized(deal, intentSize) {
  if (!intentSize || !deal.weight_value || !deal.weight_unit) return false;
  const intentBase = toBaseValue(intentSize.value, intentSize.unit);
  const dealBase = toBaseValue(deal.weight_value, deal.weight_unit);
  if (!intentBase || !dealBase || intentBase.type !== dealBase.type) return false;
  // Reject if deal pack is more than 15% larger than what was requested.
  return dealBase.qty > intentBase.qty * 1.15;
}

/**
 * Given a matched deal, find all pack-size variants of the same product
 * at the same store. Used by the Quantity Combination Engine.
 * - If the deal has a canonical_id, fetches all deals sharing it.
 * - Otherwise, falls back to matching the first 2-3 significant product-name tokens.
 */
function findPackSizeVariantsAtStore(db, storeId, deal) {
  if (!deal) return [];

  if (deal.canonical_id) {
    return db
      .prepare(
        `SELECT id, product_name, sale_price, weight_value, weight_unit,
                product_url, image_url, currency, canonical_id
         FROM deals
         WHERE is_active = 1
           AND availability = 'in_stock'
           AND store_id = ?
           AND canonical_id = ?
         ORDER BY sale_price ASC
         LIMIT 30`,
      )
      .all(storeId, deal.canonical_id);
  }

  // Derive significant product-name tokens (skip size/noise words).
  const sizeWords = new Set([
    "g", "kg", "ml", "l", "ltr", "litre", "liter",
    "250", "500", "1kg", "2kg", "5kg", "100", "200", "400",
    "pack", "packs", "packet", "x", "gm", "gram", "grams",
  ]);
  const rawTokens = String(deal.product_name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (t) =>
        t.length >= 3 &&
        !/\d/.test(t) &&
        !sizeWords.has(t) &&
        !STOP_WORDS.has(t),
    );
  const coreTokens = [...new Set(rawTokens)].slice(0, 3);
  if (coreTokens.length === 0) return [deal];

  const whereClause = coreTokens
    .map(() => "lower(product_name) LIKE ?")
    .join(" AND ");
  return db
    .prepare(
      `SELECT id, product_name, sale_price, weight_value, weight_unit,
              product_url, image_url, currency, canonical_id
       FROM deals
       WHERE is_active = 1
         AND availability = 'in_stock'
         AND store_id = ?
         AND ${whereClause}
       ORDER BY sale_price ASC
       LIMIT 30`,
    )
    .all(storeId, ...coreTokens.map((t) => `%${t}%`));
}

function buildStructuredPackOption(deal) {
  const d = resolveDealWeightFallback(deal);
  const structured = parseProductName(d.product_name || "");
  const packCount =
    Number.isFinite(Number(structured?.pack_count)) &&
    Number(structured.pack_count) > 0
      ? Number(structured.pack_count)
      : 1;
  const base = toBaseQty(
    d.weight_value ?? structured.weight_value,
    d.weight_unit ?? structured.weight_unit,
  );
  if (!base) return null;
  return {
    size: base.qty * packCount,
    type: base.type,
    price: Number(d.sale_price),
    deal: d,
    pack_count: packCount,
  };
}

/**
 * Build pack options array for the combination engine from a list of deals.
 * Only includes deals whose weight/volume is compatible with the target unit type.
 */
function buildPackOptions(deals, targetType) {
  const options = [];
  for (const deal of deals) {
    const option = buildStructuredPackOption(deal);
    if (!option || option.type !== targetType) continue;
    const price = Number(option.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    options.push({ size: option.size, price, deal: option.deal });
  }
  return options;
}

function fromBaseQty(qty, type) {
  const value = Number(qty);
  if (!Number.isFinite(value) || value <= 0) return { value: null, unit: null };
  if (type === "mass") {
    if (value % 1000 === 0) return { value: value / 1000, unit: "kg" };
    return { value, unit: "g" };
  }
  if (type === "volume") {
    if (value % 1000 === 0) return { value: value / 1000, unit: "l" };
    return { value, unit: "ml" };
  }
  return { value: null, unit: null };
}

function buildCheckedCandidates({
  dealsAtStore,
  baseMeta,
  targetBase,
  brandCandidates,
  baseCache,
  limit = 8,
}) {
  const basePool = buildBaseMatchedDealPool(dealsAtStore, baseMeta, baseCache);
  const requestedBrands = Array.isArray(brandCandidates) ? brandCandidates : [];
  const seen = new Set();
  const rows = [];

  for (const deal of basePool) {
    const option = buildStructuredPackOption(deal);
    if (!option || option.type !== targetBase.type) continue;
    const key =
      String(option.deal.product_url || option.deal.id || option.deal.product_name) +
      `|${option.size}|${option.price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const total = fromBaseQty(option.size, option.type);
    const brandMatched = requestedBrands.some((brand) =>
      isBrandMatch(brand, option.deal.product_name),
    );
    const matchedBrand =
      detectBrandForBase(option.deal.product_name, baseMeta.base_key) ||
      extractLikelyBrand(option.deal.product_name) ||
      null;
    rows.push({
      id: option.deal.id,
      deal_id: option.deal.id,
      product_name: option.deal.product_name,
      product_category: option.deal.product_category || baseMeta.category || null,
      product_url: option.deal.product_url,
      image_url: option.deal.image_url,
      sale_price: option.deal.sale_price,
      currency: option.deal.currency,
      weight_value: option.deal.weight_value,
      weight_unit: option.deal.weight_unit,
      effective_price: option.deal.sale_price,
      packs_needed: 1,
      combination: [
        {
          product_name: option.deal.product_name,
          product_url: option.deal.product_url,
          sale_price: option.deal.sale_price,
          weight_value: option.deal.weight_value,
          weight_unit: option.deal.weight_unit,
          count: 1,
        },
      ],
      base_product: baseMeta.base_product,
      requested_brand:
        requestedBrands.length > 0 ? requestedBrands.join(" or ") : null,
      matched_brand: matchedBrand,
      requested_quantity: fromBaseQty(targetBase.qty, targetBase.type).value,
      requested_unit: fromBaseQty(targetBase.qty, targetBase.type).unit,
      matched_total_quantity: total.value,
      matched_total_unit: total.unit,
      candidate_total_quantity: total.value,
      candidate_total_unit: total.unit,
      brand_status:
        requestedBrands.length === 0
          ? "not_requested"
          : brandMatched
            ? "exact"
            : "changed",
      exact_quantity: option.size === targetBase.qty,
      quantity_distance: Math.abs(option.size - targetBase.qty),
    });
  }

  return rows
    .sort((a, b) => {
      const brandRankA = a.brand_status === "exact" ? 1 : 0;
      const brandRankB = b.brand_status === "exact" ? 1 : 0;
      if (brandRankA !== brandRankB) return brandRankB - brandRankA;
      if (a.quantity_distance !== b.quantity_distance) {
        return a.quantity_distance - b.quantity_distance;
      }
      return Number(a.sale_price || 0) - Number(b.sale_price || 0);
    })
    .slice(0, limit)
    .map(({ quantity_distance, ...row }) => row);
}

function recalcMatchQuality(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return "exact";
  if (warnings.length <= 2) return "partial";
  return "low_confidence";
}

function toCombinationRows(comboCombinations) {
  return comboCombinations.map((c) => ({
    product_name: c.deal.product_name,
    product_url: c.deal.product_url,
    sale_price: c.deal.sale_price,
    weight_value: c.deal.weight_value,
    weight_unit: c.deal.weight_unit,
    count: c.count,
  }));
}

function resolveBaseMetaCached(cache, text) {
  const key = normalizeBrand(text);
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  const resolved = resolveBaseProduct(text);
  cache.set(key, resolved || null);
  return resolved || null;
}

function buildBaseMatchedDealPool(dealsAtStore, baseMeta, baseCache) {
  if (!Array.isArray(dealsAtStore) || dealsAtStore.length === 0 || !baseMeta) {
    return [];
  }
  return dealsAtStore.filter((deal) => {
    const resolved = resolveBaseMetaCached(baseCache, deal.product_name);
    return resolved && resolved.base_key === baseMeta.base_key;
  });
}

function computeExactComboCandidateForDeals(
  deals,
  targetBase,
  baseMeta,
  brandLabel,
  brandKey,
) {
  const packOptions = buildPackOptions(deals, targetBase.type);
  const combo = findCheapestExactCombination(packOptions, targetBase.qty);
  if (!combo) return null;
  const combination = toCombinationRows(combo.combinations);
  const packsNeeded = combination.reduce(
    (sum, row) => sum + Number(row.count || 0),
    0,
  );
  const representativeDeal = combo.combinations[0]?.deal || deals[0] || null;
  if (!representativeDeal) return null;
  return {
    base_product: baseMeta.base_product,
    brand: brandLabel || null,
    brand_key: brandKey || null,
    representative_deal: representativeDeal,
    combination,
    packs_needed: packsNeeded,
    total_price: combo.total_price,
  };
}

function computeExactScaledSinglePackCandidatesForDeals(
  deals,
  targetBase,
  baseMeta,
  brandLabel,
  brandKey,
) {
  const packOptions = buildPackOptions(deals, targetBase.type);
  const bestBySize = new Map();

  for (const option of packOptions) {
    if (!Number.isFinite(option.size) || option.size <= 0) continue;
    if (targetBase.qty % option.size !== 0) continue;
    const existing = bestBySize.get(option.size);
    if (!existing || Number(option.price) < Number(existing.price)) {
      bestBySize.set(option.size, option);
    }
  }

  return Array.from(bestBySize.values()).map((option) => {
    const count = targetBase.qty / option.size;
    return {
      base_product: baseMeta.base_product,
      brand: brandLabel || null,
      brand_key: brandKey || null,
      representative_deal: option.deal,
      combination: [
        {
          product_name: option.deal.product_name,
          product_url: option.deal.product_url,
          sale_price: option.deal.sale_price,
          weight_value: option.deal.weight_value,
          weight_unit: option.deal.weight_unit,
          count,
        },
      ],
      packs_needed: count,
      total_price: Number((Number(option.price) * count).toFixed(2)),
    };
  });
}

function buildExactReplacementCandidateKey(candidate) {
  const brandKey =
    normalizeBrand(candidate?.brand_key || candidate?.brand || "") || "__brand__";
  const comboKey = (Array.isArray(candidate?.combination)
    ? candidate.combination
    : []
  )
    .map((row) => {
      const productKey = normalizeBrand(row?.product_name || "") || "__item__";
      const weightValue = Number(row?.weight_value || 0);
      const weightUnit = String(row?.weight_unit || "").trim().toLowerCase();
      const count = Number(row?.count || 0);
      return `${productKey}:${weightValue}${weightUnit}:x${count}`;
    })
    .sort()
    .join("|");
  return `${brandKey}|${comboKey}`;
}

function dedupeExactReplacementCandidates(candidates) {
  const seen = new Set();
  const deduped = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const key = buildExactReplacementCandidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped.sort((a, b) => {
    const requestedA = a.requested_brand_matched ? 1 : 0;
    const requestedB = b.requested_brand_matched ? 1 : 0;
    if (requestedA !== requestedB) return requestedB - requestedA;
    if (a.total_price !== b.total_price) return a.total_price - b.total_price;
    if (a.packs_needed !== b.packs_needed) return a.packs_needed - b.packs_needed;
    return (a.combination?.length || 0) - (b.combination?.length || 0);
  });
}

function buildReplacementSearchResultKey(candidate) {
  const combinationKey = (Array.isArray(candidate?.combination)
    ? candidate.combination
    : []
  )
    .map((row) => {
      const productKey =
        String(row?.product_url || row?.product_name || "").trim() ||
        String(candidate?.product_url || candidate?.product_name || "").trim();
      const count = Number(row?.count || 0);
      return `${productKey}:x${count}`;
    })
    .sort()
    .join("|");
  const fallbackKey = String(
    candidate?.product_url ||
      candidate?.deal_id ||
      candidate?.id ||
      candidate?.product_name ||
      "",
  ).trim();
  return combinationKey || fallbackKey;
}

function findStrictExactCandidatesAtStore({
  dealsAtStore,
  baseMeta,
  brandCandidates,
  targetBase,
  baseCache,
}) {
  const basePool = buildBaseMatchedDealPool(dealsAtStore, baseMeta, baseCache);
  if (basePool.length === 0) {
    return { stage: "none", candidates: [] };
  }

  const normalizedBrandCandidates = (Array.isArray(brandCandidates)
    ? brandCandidates
    : []
  )
    .map((brand) => String(brand || "").trim())
    .filter(Boolean);

  const seenBrandKeys = new Set();
  const brandStrictCandidates = [];
  for (const requestedBrand of normalizedBrandCandidates) {
    const matchedDeals = basePool.filter((deal) =>
      isBrandMatch(requestedBrand, deal.product_name),
    );
    if (matchedDeals.length === 0) continue;
    const requestedBrandKey = normalizeBrand(requestedBrand);
    if (requestedBrandKey && seenBrandKeys.has(requestedBrandKey)) continue;
    const candidates = [
      computeExactComboCandidateForDeals(
        matchedDeals,
        targetBase,
        baseMeta,
        requestedBrand,
        requestedBrandKey || null,
      ),
      ...computeExactScaledSinglePackCandidatesForDeals(
        matchedDeals,
        targetBase,
        baseMeta,
        requestedBrand,
        requestedBrandKey || null,
      ),
    ].filter(Boolean);
    if (candidates.length === 0) continue;
    for (const candidate of candidates) {
      brandStrictCandidates.push({
        ...candidate,
        requested_brand_matched: true,
      });
    }
    if (requestedBrandKey) seenBrandKeys.add(requestedBrandKey);
  }

  if (brandStrictCandidates.length > 0) {
    return {
      stage: "brand_strict",
      candidates: dedupeExactReplacementCandidates(brandStrictCandidates),
    };
  }

  const grouped = new Map();
  for (const deal of basePool) {
    const detectedBrand =
      detectBrandForBase(deal.product_name, baseMeta.base_key) ||
      extractLikelyBrand(deal.product_name) ||
      null;
    const key = normalizeBrand(detectedBrand) || "__unknown__";
    if (!grouped.has(key)) {
      grouped.set(key, { brand: detectedBrand, deals: [] });
    }
    grouped.get(key).deals.push(deal);
  }

  const fallbackCandidates = [];
  for (const [brandKey, group] of grouped.entries()) {
    const candidates = [
      computeExactComboCandidateForDeals(
        group.deals,
        targetBase,
        baseMeta,
        group.brand,
        brandKey,
      ),
      ...computeExactScaledSinglePackCandidatesForDeals(
        group.deals,
        targetBase,
        baseMeta,
        group.brand,
        brandKey,
      ),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const requestedMatch = normalizedBrandCandidates.some((brand) =>
        isBrandMatch(brand, candidate.representative_deal.product_name),
      );
      fallbackCandidates.push({
        ...candidate,
        requested_brand_matched: requestedMatch,
      });
    }
  }

  return {
    stage: normalizedBrandCandidates.length > 0 ? "base_fallback" : "base_only",
    candidates: dedupeExactReplacementCandidates(fallbackCandidates),
  };
}

function loadStores(db) {
  return db
    .prepare(
      `SELECT id, name, url, platform, logo_url
     FROM stores
     WHERE crawl_status != 'maintenance'
     ORDER BY name ASC`,
    )
    .all();
}

function findBestDealForItemAtStore(db, storeId, item, intent, options = {}) {
  const skipCanonical = options.skipCanonical === true;
  const includeAliases = options.includeAliases !== false;

  if (item.canonical_id && !skipCanonical) {
    const canonicalMatches = db
      .prepare(
        `SELECT id, product_name, product_category, product_url, sale_price, currency,
                weight_value, weight_unit, price_per_kg, image_url
       FROM deals
       WHERE is_active = 1
         AND availability = 'in_stock'
         AND store_id = ?
         AND canonical_id = ?
       ORDER BY sale_price ASC
       LIMIT 80`,
      )
      .all(storeId, item.canonical_id);

    const canonicalMatch = pickPreferredDealByIntent(canonicalMatches, intent);
    if (canonicalMatch) {
      // Smart Architecture: validate the canonical match actually makes sense
      // for the item text. Stale or wrong canonical_id links (e.g. "jira" → barbunya beans)
      // score very low and should fall through to text-based matching.
      const queryPhrase = String(item.raw_item_text || "").trim();
      if (queryPhrase) {
        const expandedTerms = expandQuery(queryPhrase);
        const { score } = rankMatch(
          queryPhrase,
          canonicalMatch.product_name,
          canonicalMatch.weight_value,
          canonicalMatch.weight_unit,
        );
        const smartScore = Math.max(
          score,
          expandedTerms.reduce((best, term) => {
            const { score: s } = rankMatch(
              term,
              canonicalMatch.product_name,
              canonicalMatch.weight_value,
              canonicalMatch.weight_unit,
            );
            return s > best ? s : best;
          }, 0),
        );
        if (smartScore >= SMART_MATCH_THRESHOLD) return canonicalMatch;
        // Score too low — stale canonical link, fall through to text matching
      } else {
        return canonicalMatch;
      }
    }
  }

  const phrases = buildSearchPhrases(item, { includeAliases });
  const tokens = Array.from(
    new Set(
      phrases
        .flatMap((phrase) => tokenizeForSearch(phrase))
        .sort((a, b) => b.length - a.length),
    ),
  ).slice(0, 6);

  // Smart Architecture: expand the item query to synonym + phonetic variants so
  // that e.g. "jirra" → ["jeera","cumin"] and the smart ranker can score those
  // candidates with brand-match, weight-class, embedding and phonetic signals.
  const primaryQueryPhrase = String(
    item.raw_item_text || phrases[0] || "",
  ).trim();
  const itemExpandedTerms = primaryQueryPhrase
    ? expandQuery(primaryQueryPhrase)
    : [];

  /**
   * Apply smart multi-signal ranking to a SQL candidate pool.
   * Returns the best candidate if its score clears SMART_MATCH_THRESHOLD,
   * otherwise null (caller falls through to legacy token scoring).
   */
  function trySmartMatch(candidates) {
    if (
      !candidates ||
      candidates.length === 0 ||
      itemExpandedTerms.length === 0
    ) {
      return null;
    }
    // reRankDeals tries all expanded terms and returns candidates sorted by best score.
    const smartRanked = reRankDeals(itemExpandedTerms, candidates);
    const best = smartRanked[0];
    if (!best) return null;

    // Score the winner against the primary query phrase for the confidence check.
    const { score } = rankMatch(
      primaryQueryPhrase,
      best.product_name,
      best.weight_value,
      best.weight_unit,
    );

    // If the smart score is confident, skip legacy token scoring entirely.
    if (score >= SMART_MATCH_THRESHOLD) {
      return pickPreferredDealByIntent([best], intent);
    }
    return null;
  }

  if (tokens.length > 0) {
    const attemptTokenMatch = (searchTokens) => {
      if (!Array.isArray(searchTokens) || searchTokens.length === 0)
        return null;
      const strictWhere = searchTokens
        .map(() => "lower(product_name) LIKE ?")
        .join(" AND ");
      const strictParams = [
        storeId,
        ...searchTokens.map((token) => `%${token}%`),
      ];
      const strict = db
        .prepare(
          `SELECT id, product_name, product_category, product_url, sale_price, currency,
                  weight_value, weight_unit, price_per_kg, image_url
         FROM deals
         WHERE is_active = 1
           AND availability = 'in_stock'
           AND store_id = ?
           AND ${strictWhere}
         ORDER BY sale_price ASC
         LIMIT 80`,
        )
        .all(...strictParams);

      // Smart ranking on strict SQL candidates (takes priority over token scoring).
      const smartStrictMatch = trySmartMatch(strict);
      if (smartStrictMatch) return smartStrictMatch;

      // Legacy token scoring as fallback when smart score is too low.
      const strictBest = pickByTokenScore(strict, searchTokens);
      if (isConfidentMatch(strictBest, searchTokens)) {
        return pickPreferredDealByIntent([strictBest.candidate], intent);
      }

      const patternTokens = Array.from(
        new Set(searchTokens.flatMap((token) => tokenForms(token))),
      );
      if (patternTokens.length === 0) return null;

      const relaxedWhere = patternTokens
        .map(() => "lower(product_name) LIKE ?")
        .join(" OR ");
      const relaxedParams = [
        storeId,
        ...patternTokens.map((token) => `%${token}%`),
      ];
      const relaxed = db
        .prepare(
          `SELECT id, product_name, product_category, product_url, sale_price, currency,
                  weight_value, weight_unit, price_per_kg, image_url
         FROM deals
         WHERE is_active = 1
           AND availability = 'in_stock'
           AND store_id = ?
           AND (${relaxedWhere})
         ORDER BY sale_price ASC
         LIMIT 80`,
        )
        .all(...relaxedParams);

      // Smart ranking on relaxed SQL candidates before legacy fallback.
      const smartRelaxedMatch = trySmartMatch(relaxed);
      if (smartRelaxedMatch) return smartRelaxedMatch;

      const relaxedBest = pickByTokenScore(relaxed, searchTokens);
      if (isConfidentMatch(relaxedBest, searchTokens))
        return relaxedBest.candidate;
      return null;
    };

    const primaryByTokens = attemptTokenMatch(tokens);
    if (primaryByTokens) return primaryByTokens;

    const requestedBrandTokens = new Set(
      parseBrandCandidates(
        item.brand_pref || intent?.brand,
        intent?.brandOptions,
      ).flatMap((brand) => brandTokens(brand)),
    );
    const commodityTokens = tokens.filter(
      (token) =>
        !requestedBrandTokens.has(token) && !TOKEN_RELAXED_NOISE.has(token),
    );
    const fallbackTokens = [...commodityTokens]
      .sort((a, b) => b.length - a.length)
      .slice(0, 2);
    if (fallbackTokens.length > 0 && fallbackTokens.length < tokens.length) {
      const fallbackByTokens = attemptTokenMatch(fallbackTokens);
      if (fallbackByTokens) return fallbackByTokens;
    }
  }

  return null;
}

function resolveDealWeightFallback(deal) {
  if (!deal?.product_name || deal.weight_value) return deal;
  const parsedW = parseWeight(deal.product_name);
  if (!parsedW) return deal;
  return {
    ...deal,
    weight_value: parsedW.value,
    weight_unit: parsedW.unit,
  };
}

async function recommendForList(
  db,
  { user, listId, postcode, deliveryPreference },
) {
  const items = loadListItems(db, listId);
  if (items.length === 0) {
    return {
      preference_applied: deliveryPreference,
      winner: null,
      runner_up: null,
      stores: [],
      same_day_option: null,
      reason: "empty_list",
    };
  }

  const stores = loadStores(db);
  const now = new Date();
  const ranked = [];
  const partialRanked = [];
  const requestedItems = items.map((item) =>
    String(item.raw_item_text || "").trim(),
  );
  const baseResolutionCache = new Map();

  for (const store of stores) {
    const matchedItems = [];
    const missingItems = [];
    const storeDeals = db
      .prepare(
        `SELECT id, product_name, product_category, product_url, sale_price, currency,
                weight_value, weight_unit, price_per_kg, image_url, canonical_id
         FROM deals
         WHERE is_active = 1
           AND availability = 'in_stock'
           AND store_id = ?
         ORDER BY sale_price ASC
         LIMIT 1500`,
      )
      .all(store.id)
      .map((deal) => resolveDealWeightFallback(deal));

    for (const item of items) {
      console.log(`[recommender] item: "${item.raw_item_text}" qty=${item.quantity} unit=${item.quantity_unit} count=${item.item_count}`);
      const intent = parseItemIntent(
        item.raw_item_text,
        item.quantity,
        item.quantity_unit,
      );
      const strictIntent = {
        ...intent,
        rawItemText: item.raw_item_text,
      };
      const itemCount = Math.max(1, Number(item.item_count) || 1);
      let pricingSize = getPricingIntentSize(intent);
      // Scale total target by item_count for mass/volume items (e.g. 2×5kg bundle × 5 = 50kg)
      if (
        pricingSize &&
        itemCount > 1 &&
        MASS_VOLUME_UNITS.has(String(pricingSize.unit || "").trim().toLowerCase())
      ) {
        pricingSize = { value: pricingSize.value * itemCount, unit: pricingSize.unit };
      }
      const hasMassVolumePricingTarget =
        pricingSize &&
        MASS_VOLUME_UNITS.has(
          String(pricingSize.unit || "")
            .trim()
            .toLowerCase(),
        );
      const requestedBaseMeta = resolveBaseMetaCached(
        baseResolutionCache,
        item.raw_item_text || item.canonical_name || "",
      );
      const requestedBrandCandidates = parseBrandCandidates(
        item.brand_pref || intent.brand,
        intent.brandOptions,
      );

      // matching_spec.md: for mass/volume requests, base product identity must
      // be resolved from the CSV source-of-truth before any matching.
      if (hasMassVolumePricingTarget && !requestedBaseMeta) {
        missingItems.push(item.raw_item_text);
        continue;
      }

      const isAcceptableDeal = (dealCandidate, options = {}) => {
        const enforceRequestedBrand = options.enforceRequestedBrand !== false;
        const weightedDeal = resolveDealWeightFallback(dealCandidate);
        const candidateBrandInfo = resolveBrandInfo(
          item.brand_pref || intent.brand,
          weightedDeal.product_name,
          intent.brandOptions,
        );
        const candidateAnnotation = scoreAndAnnotateDeal(
          weightedDeal,
          strictIntent,
        );
        const hasRequestedBrand =
          candidateBrandInfo.brand_status !== "not_requested";
        const hasVariantMismatch = candidateAnnotation.warnings.some(
          (warning) => warning.startsWith("variant_differs:"),
        );
        // For exact-quantity pricing, allow any pack size here; the combination engine
        // decides strict validity later. For non-mass/volume items, keep oversize guard.
        const hasMassVolumeRequest =
          intent?.size &&
          MASS_VOLUME_UNITS.has(
            String(intent.size?.unit || "")
              .trim()
              .toLowerCase(),
          );
        const dealOversized = hasMassVolumeRequest
          ? false
          : isDealOversized(weightedDeal, intent.size);
        const categoryMatched = isCategoryMatchStrict(
          strictIntent,
          weightedDeal,
        );
        const dealBaseMeta = resolveBaseMetaCached(
          baseResolutionCache,
          weightedDeal.product_name,
        );
        const baseMatched =
          !requestedBaseMeta ||
          (dealBaseMeta &&
            dealBaseMeta.base_key === requestedBaseMeta.base_key);
        const brandMatched =
          !enforceRequestedBrand ||
          !hasRequestedBrand ||
          candidateBrandInfo.brand_status === "exact";
        const rejectReason = !baseMatched
          ? "base_product"
          : !categoryMatched
          ? "category"
          : hasVariantMismatch
            ? "variant"
            : dealOversized
              ? "size_overlarge"
              : !brandMatched
                ? "brand"
                : null;
        return {
          ok:
            baseMatched &&
            categoryMatched &&
            brandMatched &&
            !hasVariantMismatch &&
            !dealOversized,
          rejectReason,
          deal: weightedDeal,
          baseMeta: dealBaseMeta,
          brandInfo: candidateBrandInfo,
          annotation: candidateAnnotation,
        };
      };

      if (hasMassVolumePricingTarget && requestedBaseMeta) {
        const targetBase = toBaseQty(pricingSize.value, pricingSize.unit);
        if (!targetBase) {
          missingItems.push(item.raw_item_text);
          continue;
        }

        const strictCandidates = findStrictExactCandidatesAtStore({
          dealsAtStore: storeDeals,
          baseMeta: requestedBaseMeta,
          brandCandidates: requestedBrandCandidates,
          targetBase,
          baseCache: baseResolutionCache,
        });
        const selectedStrict = strictCandidates.candidates[0] || null;
        if (!selectedStrict) {
          missingItems.push(item.raw_item_text);
          continue;
        }

        const strictDeal = selectedStrict.representative_deal;
        const strictAnnotation = scoreAndAnnotateDeal(strictDeal, strictIntent);
        const strictWarnings = (strictAnnotation.warnings || []).filter(
          (warning) => !warning.startsWith("size_differs:"),
        );
        const requestedBrandInput =
          item.brand_pref || intent.brand || requestedBrandCandidates.join(" or ") || null;
        const matchedBrandLabel =
          selectedStrict.brand ||
          detectBrandForBase(strictDeal.product_name, requestedBaseMeta.base_key) ||
          extractLikelyBrand(strictDeal.product_name) ||
          null;
        const strictBrandStatus =
          requestedBrandCandidates.length === 0
            ? "not_requested"
            : selectedStrict.requested_brand_matched
              ? "exact"
              : "changed";

        matchedItems.push({
          list_item_id: item.id,
          query: item.raw_item_text,
          brand_pref: item.brand_pref,
          requested_brand_input: requestedBrandInput,
          deal_id: strictDeal.id,
          product_name: strictDeal.product_name,
          product_category:
            strictDeal.product_category || requestedBaseMeta.category || null,
          product_url: strictDeal.product_url,
          image_url: strictDeal.image_url,
          sale_price: strictDeal.sale_price,
          currency: strictDeal.currency,
          weight_value: strictDeal.weight_value,
          weight_unit: strictDeal.weight_unit,
          price_per_unit: strictAnnotation.price_per_unit,
          unit_label: strictAnnotation.unit_label,
          match_quality: recalcMatchQuality(strictWarnings),
          warnings: strictWarnings,
          effective_price: selectedStrict.total_price,
          packs_needed: selectedStrict.packs_needed,
          combination: selectedStrict.combination,
          requested_quantity: intent.size ? intent.size.value : null,
          requested_unit: intent.size ? intent.size.unit : null,
          matched_total_quantity: pricingSize?.value || null,
          matched_total_unit: pricingSize?.unit || null,
          item_count: itemCount,
          item_type: intent.itemType || null,
          base_product: requestedBaseMeta.base_product,
          requested_brand: requestedBrandInput,
          matched_brand: matchedBrandLabel,
          brand_status: strictBrandStatus,
        });
        continue;
      }

      const primaryDeal = findBestDealForItemAtStore(
        db,
        store.id,
        item,
        intent,
      );
      const primaryEvaluation = primaryDeal
        ? isAcceptableDeal(primaryDeal)
        : null;
      let evaluation = primaryEvaluation;

      if (!evaluation?.ok) {
        // Canonical mappings can be over-specific/noisy; retry with raw-text-only search.
        const fallbackDeal = findBestDealForItemAtStore(db, store.id, item, intent, {
          skipCanonical: true,
          includeAliases: false,
        });
        const fallbackEvaluation = fallbackDeal
          ? isAcceptableDeal(fallbackDeal)
          : null;
        if (fallbackEvaluation?.ok) {
          evaluation = fallbackEvaluation;
        }
      }

      if (
        !evaluation?.ok &&
        requestedBaseMeta &&
        requestedBrandCandidates.length > 0
      ) {
        // Brand-strict phase failed: fallback to same base product across brands.
        const baseFallbackItem = {
          ...item,
          canonical_id: null,
          canonical_name: requestedBaseMeta.base_product,
          raw_item_text: requestedBaseMeta.base_product,
          brand_pref: null,
        };
        const baseFallbackIntent = parseItemIntent(
          requestedBaseMeta.base_product,
          item.quantity,
          item.quantity_unit,
        );
        const baseFallbackDeal = findBestDealForItemAtStore(
          db,
          store.id,
          baseFallbackItem,
          baseFallbackIntent,
          {
            skipCanonical: true,
            includeAliases: false,
          },
        );
        const baseFallbackEvaluation = baseFallbackDeal
          ? isAcceptableDeal(baseFallbackDeal, { enforceRequestedBrand: false })
          : null;
        if (baseFallbackEvaluation?.ok) {
          evaluation = {
            ...baseFallbackEvaluation,
            brandInfo: {
              brand_status: "changed",
              requested_brand:
                item.brand_pref || intent.brand || requestedBrandCandidates.join(" or "),
              matched_brand:
                detectBrandForBase(
                  baseFallbackEvaluation.deal.product_name,
                  requestedBaseMeta.base_key,
                ) ||
                extractLikelyBrand(baseFallbackEvaluation.deal.product_name) ||
                null,
            },
          };
        }
      }

      if (!evaluation?.ok) {
        missingItems.push(item.raw_item_text);
        continue;
      }

      const resolvedDeal = evaluation.deal;
      const brandInfo = evaluation.brandInfo;
      const annotation = evaluation.annotation;

      let effective_price = Math.round(Number(resolvedDeal.sale_price) * 100) / 100;
      let packs_needed = 1;
      let combination = null;
      let finalMatchQuality = annotation.match_quality;
      let finalWarnings = Array.isArray(annotation.warnings)
        ? annotation.warnings
        : [];

      // --- Quantity Combination Engine (strict exact mode) ---
      if (hasMassVolumePricingTarget) {
        const targetBase = toBaseQty(pricingSize.value, pricingSize.unit);
        if (!targetBase) {
          missingItems.push(item.raw_item_text);
          continue;
        }

        const variants = findPackSizeVariantsAtStore(db, store.id, resolvedDeal);
        const packOptions = buildPackOptions(variants, targetBase.type);
        const combo = findCheapestExactCombination(packOptions, targetBase.qty);
        if (!combo) {
          missingItems.push(item.raw_item_text);
          continue;
        }

        effective_price = combo.total_price;
        packs_needed = combo.combinations.reduce((sum, c) => sum + c.count, 0);
        combination = combo.combinations.map((c) => ({
          product_name: c.deal.product_name,
          product_url: c.deal.product_url,
          sale_price: c.deal.sale_price,
          weight_value: c.deal.weight_value,
          weight_unit: c.deal.weight_unit,
          count: c.count,
        }));

        // Exact-combination success should not be flagged as a size mismatch.
        finalWarnings = finalWarnings.filter(
          (warning) => !warning.startsWith("size_differs:"),
        );
        finalMatchQuality = recalcMatchQuality(finalWarnings);
      } else {
        ({ effective_price, packs_needed } = computeEffectivePrice(
          resolvedDeal.sale_price,
          resolvedDeal.weight_value,
          resolvedDeal.weight_unit,
          pricingSize,
        ));

        // For items with pcs/unknown unit: item_count directly means number of packs.
        if (
          itemCount > 1 &&
          packs_needed === 1 &&
          (!intent.size ||
            !MASS_VOLUME_UNITS.has(
              String(intent.size?.unit || "")
                .trim()
                .toLowerCase(),
            ))
        ) {
          packs_needed = itemCount;
          effective_price =
            Math.round(itemCount * Number(resolvedDeal.sale_price) * 100) / 100;
        }
      }

      matchedItems.push({
        list_item_id: item.id,
        query: item.raw_item_text,
        brand_pref: item.brand_pref,
        requested_brand_input: item.brand_pref || intent.brand || null,
        deal_id: resolvedDeal.id,
        product_name: resolvedDeal.product_name,
        product_category: resolvedDeal.product_category,
        product_url: resolvedDeal.product_url,
        image_url: resolvedDeal.image_url,
        sale_price: resolvedDeal.sale_price,
        currency: resolvedDeal.currency,
        weight_value: resolvedDeal.weight_value,
        weight_unit: resolvedDeal.weight_unit,
        price_per_unit: annotation.price_per_unit,
        unit_label: annotation.unit_label,
        match_quality: finalMatchQuality,
        warnings: finalWarnings,
        effective_price,
        packs_needed,
        combination,
        requested_quantity: intent.size ? intent.size.value : null,
        requested_unit: intent.size ? intent.size.unit : null,
        matched_total_quantity: pricingSize?.value || null,
        matched_total_unit: pricingSize?.unit || null,
        item_count: itemCount,
        item_type: intent.itemType || null,
        base_product: requestedBaseMeta?.base_product || null,
        ...brandInfo,
      });
    }

    if (matchedItems.length === 0) {
      continue;
    }

    const subtotal = matchedItems.reduce(
      (sum, row) => sum + Number(row.effective_price ?? row.sale_price ?? 0),
      0,
    );
    const shippingCost = getShippingCost(db, store.id, subtotal);
    const deliveryOptions = getEligibleDeliveryOptions(
      db,
      store.id,
      postcode,
      now,
      subtotal,
    );
    const chosenDelivery = pickDeliveryOption(
      deliveryOptions,
      deliveryPreference,
    );

    if (!chosenDelivery && deliveryPreference === "same_day_if_available") {
      continue;
    }

    const surcharge = Number(chosenDelivery?.surcharge || 0);
    const total = subtotal + shippingCost + surcharge;
    const transfer = await buildCartTransfer(store, matchedItems);
    const hasCartUrl = Boolean(transfer?.cart_url);
    const brand_info = matchedItems
      .filter(
        (item) =>
          item.brand_status === "changed" || item.brand_status === "unknown",
      )
      .map((item) => ({
        list_item_id: item.list_item_id,
        query: item.query,
        requested_brand: item.requested_brand,
        matched_brand: item.matched_brand,
        brand_status: item.brand_status,
      }));

    ranked.push({
      store,
      items_matched: matchedItems.length,
      items_total: items.length,
      items_not_found: missingItems,
      subtotal: Number(subtotal.toFixed(2)),
      delivery: {
        type: chosenDelivery?.delivery_type || "standard",
        label: chosenDelivery?.label || "Standard Delivery",
        shipping_cost: Number(shippingCost.toFixed(2)),
        surcharge: Number(surcharge.toFixed(2)),
        total_delivery_cost: Number((shippingCost + surcharge).toFixed(2)),
        estimated_days: chosenDelivery?.estimated_days ?? null,
        estimated_hours: chosenDelivery?.estimated_hours ?? null,
        same_day_eligible: chosenDelivery?.delivery_type === "same_day",
        same_day_cutoff_passed: chosenDelivery?.cutoff_passed ?? null,
      },
      total: Number(total.toFixed(2)),
      cart_transfer_method: transfer?.method || null,
      cart_url: transfer?.cart_url || null,
      auto_cart_supported: hasCartUrl,
      matched_items: matchedItems,
      brand_info,
    });

    if (matchedItems.length !== items.length) {
      partialRanked.push({
        store,
        items_matched: matchedItems.length,
        items_total: items.length,
        items_not_found: missingItems,
        matched_queries: matchedItems.map((row) => row.query),
      });
    }
  }

  ranked.sort((a, b) => {
    const coverageA = a.items_total > 0 ? a.items_matched / a.items_total : 0;
    const coverageB = b.items_total > 0 ? b.items_matched / b.items_total : 0;

    if (coverageA !== coverageB) return coverageB - coverageA;
    if (a.items_matched !== b.items_matched)
      return b.items_matched - a.items_matched;
    if (Boolean(a.cart_url) !== Boolean(b.cart_url)) {
      return Number(Boolean(b.cart_url)) - Number(Boolean(a.cart_url));
    }
    if (a.total !== b.total) return a.total - b.total;
    return a.delivery.total_delivery_cost - b.delivery.total_delivery_cost;
  });

  partialRanked.sort((a, b) => {
    const coverageA = a.items_total > 0 ? a.items_matched / a.items_total : 0;
    const coverageB = b.items_total > 0 ? b.items_matched / b.items_total : 0;
    if (coverageA !== coverageB) return coverageB - coverageA;
    if (a.items_matched !== b.items_matched)
      return b.items_matched - a.items_matched;
    return a.store.name.localeCompare(b.store.name);
  });

  const winner = ranked[0] || null;
  const runnerUp = ranked[1] || null;

  let sameDayOption = null;
  if (deliveryPreference !== "same_day_if_available") {
    const sameDayRanked = ranked.filter(
      (row) => row.delivery.type === "same_day",
    );
    if (sameDayRanked.length > 0) {
      sameDayOption = sameDayRanked.sort((a, b) => a.total - b.total)[0];
      if (winner && sameDayOption) {
        sameDayOption = {
          ...sameDayOption,
          note: `${(sameDayOption.total - winner.total).toFixed(2)} EUR more than cheapest option`,
        };
      }
    }
  }

  return {
    preference_applied: deliveryPreference,
    winner,
    runner_up: runnerUp,
    stores: ranked,
    partial_matches: partialRanked,
    requested_items: requestedItems,
    same_day_option: sameDayOption,
    reason: winner ? null : "no_store_with_any_match",
    summary: {
      items_count: items.length,
      stores_considered: ranked.length,
      stores_with_auto_cart: ranked.filter((row) => Boolean(row.cart_url))
        .length,
    },
    generated_at: new Date().toISOString(),
    user_id: user.id,
  };
}

function searchStrictReplacementOptions(
  db,
  { storeId, listItem, queryOverride, maxResults = 20 },
) {
  const item = listItem || {};
  const originalQueryText = String(
    item.raw_item_text || item.canonical_name || "",
  ).trim();
  const queryText = String(queryOverride || originalQueryText).trim();
  if (!queryText) {
    return {
      stage: "none",
      fallback_applied: false,
      base_product: null,
      requested_brand: null,
      requested_quantity: null,
      requested_unit: null,
      results: [],
      reason: "empty_query",
    };
  }

  const intent = parseItemIntent(queryText, item.quantity, item.quantity_unit);
  const originalIntent = parseItemIntent(
    originalQueryText,
    item.quantity,
    item.quantity_unit,
  );
  const requestedBrandCandidates = parseBrandCandidates(
    item.brand_pref || intent.brand,
    intent.brandOptions,
  );
  const originalBrandCandidates = parseBrandCandidates(
    item.brand_pref || originalIntent.brand,
    originalIntent.brandOptions,
  );
  const mergedBrandCandidates = [];
  for (const candidate of [
    ...requestedBrandCandidates,
    ...originalBrandCandidates,
  ]) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    if (
      !mergedBrandCandidates.some(
        (existing) => normalizeBrand(existing) === normalizeBrand(value),
      )
    ) {
      mergedBrandCandidates.push(value);
    }
  }
  const itemCount = Math.max(1, Number(item.item_count) || 1);
  let pricingSize = getPricingIntentSize(intent);
  if (
    pricingSize &&
    itemCount > 1 &&
    MASS_VOLUME_UNITS.has(String(pricingSize.unit || "").trim().toLowerCase())
  ) {
    pricingSize = { value: pricingSize.value * itemCount, unit: pricingSize.unit };
  }
  if (
    !pricingSize ||
    !MASS_VOLUME_UNITS.has(
      String(pricingSize.unit || "")
        .trim()
        .toLowerCase(),
    )
  ) {
    return {
      stage: "none",
      fallback_applied: false,
      base_product: null,
      requested_brand: null,
      requested_quantity: intent.size ? intent.size.value : null,
      requested_unit: intent.size ? intent.size.unit : null,
      results: [],
      reason: "quantity_required",
    };
  }

  const targetBase = toBaseQty(pricingSize.value, pricingSize.unit);
  if (!targetBase) {
    return {
      stage: "none",
      fallback_applied: false,
      base_product: null,
      requested_brand: null,
      requested_quantity: pricingSize.value,
      requested_unit: pricingSize.unit,
      results: [],
      reason: "invalid_quantity",
    };
  }

  // Replacement search must stay anchored to the original list item's base
  // product. The typed query can help with brand phrasing, but it must not
  // switch the product family or fail on minor spelling variants.
  const baseMeta =
    resolveBaseProduct(originalQueryText) ||
    resolveBaseProduct(queryText) ||
    resolveBaseProduct(
      stripBrandCandidatesFromText(originalQueryText, mergedBrandCandidates),
    ) ||
    resolveBaseProduct(
      stripBrandCandidatesFromText(queryText, mergedBrandCandidates),
    );
  if (!baseMeta) {
    return {
      stage: "none",
      fallback_applied: false,
      base_product: null,
      requested_brand: null,
      requested_quantity: pricingSize.value,
      requested_unit: pricingSize.unit,
      results: [],
      reason: "base_product_not_resolved",
    };
  }

  const storeDeals = db
    .prepare(
      `SELECT id, product_name, product_category, product_url, sale_price, currency,
              weight_value, weight_unit, price_per_kg, image_url, canonical_id
       FROM deals
       WHERE is_active = 1
         AND availability = 'in_stock'
         AND store_id = ?
       ORDER BY sale_price ASC
       LIMIT 1500`,
    )
    .all(storeId)
    .map((deal) => resolveDealWeightFallback(deal));

  const strict = findStrictExactCandidatesAtStore({
    dealsAtStore: storeDeals,
    baseMeta,
    brandCandidates: mergedBrandCandidates,
    targetBase,
    baseCache: new Map(),
  });

  const requestedBrandInput =
    item.brand_pref ||
    originalIntent.brand ||
    intent.brand ||
    mergedBrandCandidates.join(" or ") ||
    null;
  const exactResults = (strict.candidates || []).slice(0, maxResults).map((row) => {
    const deal = row.representative_deal;
    const brandStatus =
      mergedBrandCandidates.length === 0
        ? "not_requested"
        : row.requested_brand_matched
          ? "exact"
          : "changed";
    return {
      id: deal.id,
      deal_id: deal.id,
      product_name: deal.product_name,
      product_category: deal.product_category || baseMeta.category || null,
      product_url: deal.product_url,
      image_url: deal.image_url,
      sale_price: deal.sale_price,
      currency: deal.currency,
      weight_value: deal.weight_value,
      weight_unit: deal.weight_unit,
      effective_price: row.total_price,
      packs_needed: row.packs_needed,
      combination: row.combination,
      base_product: baseMeta.base_product,
      requested_brand: requestedBrandInput,
      matched_brand: row.brand || null,
      brand_status: brandStatus,
      requested_quantity: intent.size ? intent.size.value : null,
      requested_unit: intent.size ? intent.size.unit : null,
      matched_total_quantity: pricingSize.value,
      matched_total_unit: pricingSize.unit,
    };
  });

  const checkedCandidates = buildCheckedCandidates({
    dealsAtStore: storeDeals,
    baseMeta,
    targetBase,
    brandCandidates: mergedBrandCandidates,
    baseCache: new Map(),
    limit: Math.max(maxResults * 2, maxResults),
  });

  const exactKeys = new Set(
    exactResults
      .map((row) => buildReplacementSearchResultKey(row))
      .filter(Boolean),
  );
  const extraResults = checkedCandidates.filter((row) => {
    const key = buildReplacementSearchResultKey(row);
    if (!key) return true;
    return !exactKeys.has(key);
  });

  if (exactResults.length > 0) {
    return {
      stage: strict.stage,
      fallback_applied: strict.stage === "base_fallback",
      base_product: baseMeta.base_product,
      requested_brand: requestedBrandInput,
      requested_quantity: intent.size ? intent.size.value : null,
      requested_unit: intent.size ? intent.size.unit : null,
      results: [...exactResults, ...extraResults].slice(0, maxResults),
      results_mode: "exact",
      more_options_included: extraResults.length > 0,
      reason: null,
    };
  }

  if (checkedCandidates.length > 0) {
    return {
      stage: "base_fallback",
      fallback_applied: true,
      base_product: baseMeta.base_product,
      requested_brand: requestedBrandInput,
      requested_quantity: intent.size ? intent.size.value : null,
      requested_unit: intent.size ? intent.size.unit : null,
      results: checkedCandidates,
      results_mode: "available",
      more_options_included: false,
      reason: "available_non_exact_matches",
    };
  }

  return {
    stage: strict.stage,
    fallback_applied: strict.stage === "base_fallback",
    base_product: baseMeta.base_product,
    requested_brand: requestedBrandInput,
    requested_quantity: intent.size ? intent.size.value : null,
    requested_unit: intent.size ? intent.size.unit : null,
    results: [],
    results_mode: "none",
    more_options_included: false,
    reason: "no_exact_match",
  };
}

module.exports = {
  recommendForList,
  searchStrictReplacementOptions,
};
