"use strict";

const {
  resolveBaseProduct,
  detectBrandForBase,
} = require("./base-product-catalog");

const TIER_CAP = 4;

// Tokens that distinguish preparation variants of the same base product.
// Whole mung ≠ split mung ≠ chilka mung — they share a base_key but differ here.
const VARIANT_TOKENS = new Set([
  "whole", "sabut",
  "split",
  "chilka",
  "washed", "dhuli",
  "roasted",
  "flour",
]);

// Normalise Hindi/regional synonyms to a single canonical variant label
// so "sabut" and "whole" compare as equal.
const VARIANT_NORMALISE = {
  sabut: "whole",
  dhuli: "washed",
};

function getVariantTokens(slotSet) {
  if (!slotSet) return new Set();
  const out = new Set();
  for (const t of slotSet) {
    if (VARIANT_TOKENS.has(t)) out.add(VARIANT_NORMALISE[t] ?? t);
  }
  return out;
}

// Returns true only when source and candidate agree on variant tokens.
// Both empty → compatible. Disjoint or one-sided → not compatible.
function variantTokensMatch(srcSlotSet, candSlotsJson) {
  if (!candSlotsJson) return true;
  const candSet = new Set(JSON.parse(candSlotsJson).flat());
  const srcV = getVariantTokens(srcSlotSet);
  const candV = getVariantTokens(candSet);
  if (srcV.size === 0 && candV.size === 0) return true;
  if (srcV.size !== candV.size) return false;
  for (const v of srcV) if (!candV.has(v)) return false;
  return true;
}

const ACTIVE_DEALS_WITH_CANONICAL_SQL = `
  SELECT d.id, d.canonical_id, d.crawl_timestamp, d.store_id,
         s.name AS store_name, s.url AS store_url,
         d.product_name, d.product_category, d.product_url,
         d.image_url, d.weight_raw, d.weight_value, d.weight_unit,
         d.sale_price, d.original_price, d.discount_percent,
         d.price_per_kg, d.currency, d.availability, d.bulk_pricing,
         d.best_before,
         cp.canonical_name AS cp_canonical_name,
         cp.category AS cp_category,
         cp.base_product_slots AS cp_base_product_slots
  FROM deals d
  JOIN stores s ON s.id = d.store_id
  JOIN canonical_products cp ON cp.id = d.canonical_id
  WHERE d.store_id = ? AND d.is_active = 1 AND d.canonical_id IS NOT NULL
    AND (
      d.original_price IS NULL OR d.original_price = 0 OR d.sale_price IS NULL OR d.discount_percent IS NULL OR
      ABS(d.discount_percent - ROUND((1.0 - d.sale_price / d.original_price) * 100.0)) <= 10
    )
`;

const byValueAsc = (a, b) => {
  const aUnit = a.price_per_kg ?? Infinity;
  const bUnit = b.price_per_kg ?? Infinity;
  if (aUnit !== bUnit) return aUnit - bUnit;
  return (a.sale_price || 0) - (b.sale_price || 0);
};

function nameHasBrand(productName, brand) {
  if (!brand || !productName) return false;
  return new RegExp("\\b" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(productName);
}

function parseWeight(value, raw) {
  if (value != null) return value;
  const m = String(raw || "").match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

// T2: exact set equality of product token slots (cross-brand same-spec matching).
// srcSlotSet is pre-computed as a flat Set from src.base_product_slots.
function baseProductSlotsMatch(srcSlotSet, candSlotsJson) {
  if (!srcSlotSet || !candSlotsJson) return false;
  const candSet = new Set(JSON.parse(candSlotsJson).flat());
  if (srcSlotSet.size !== candSet.size) return false;
  for (const v of srcSlotSet) if (!candSet.has(v)) return false;
  return true;
}

// T3: subset check — catches same-product variants (e.g. "Urid Flour" ↔ "Urid Flour Roasted")
// for brands not in the CSV catalog. One slot set must be fully contained in the other.
function baseProductSlotsSubset(srcSlotSet, candSlotsJson) {
  if (!srcSlotSet || !candSlotsJson) return false;
  const candSet = new Set(JSON.parse(candSlotsJson).flat());
  const srcInCand = [...srcSlotSet].every((v) => candSet.has(v));
  const candInSrc = [...candSet].every((v) => srcSlotSet.has(v));
  return srcInCand || candInSrc;
}

// Bug fix: use epsilon-based ratio check to avoid float modulo errors (e.g. 0.3 % 0.1 === 0.09999...)
function sizeCompatible(srcWeight, candWeight) {
  if (!srcWeight || !candWeight) return true;
  if (candWeight > srcWeight) return false;
  const ratio = srcWeight / candWeight;
  return Math.abs(Math.round(ratio) - ratio) < 0.01;
}

async function getReplacements(db, { canonicalId, storeId, dealId = null }) {
  const src = await db
    .prepare(
      `SELECT id, canonical_name, category, weight_value, weight_unit, base_product_slots, brand_slots FROM canonical_products WHERE id = ? LIMIT 1`
    )
    .get(canonicalId);
  if (!src) return null;

  const srcBase = resolveBaseProduct(src.canonical_name);
  const srcBaseKey = srcBase?.base_key ?? null;
  const srcBrandFromCatalog = srcBaseKey
    ? detectBrandForBase(src.canonical_name, srcBaseKey)
    : null;
  // Fall back to brand_slots when the CSV catalog doesn't know this brand
  // (e.g. Anjappar — in known_brands/brand_slots but absent from the product catalog).
  const srcBrand = srcBrandFromCatalog
    ?? (src.brand_slots ? (JSON.parse(src.brand_slots)[0]?.[0] ?? null) : null);
  const srcBrandFromCatalogOnly = !!srcBrandFromCatalog;
  const srcBaseSlots = src.base_product_slots
    ? new Set(JSON.parse(src.base_product_slots).flat())
    : null;

  const rows = await db.prepare(ACTIVE_DEALS_WITH_CANONICAL_SQL).all(storeId);

  const t1 = [],
    t2 = [],
    t3 = [],
    t4 = [];
  const seen = new Set();
  const srcRow = dealId ? rows.find((r) => r.id === dealId) : null;
  // Bug fix: fall back to canonical_products.weight_value when no dealId is provided,
  // so T1 "different size" check and sizeCompatible() work without a specific source deal.
  const srcWeightValue = srcRow
    ? parseWeight(srcRow.weight_value, srcRow.weight_raw)
    : (src.weight_value ?? null);

  for (const row of rows) {
    if (dealId && row.id === dealId) continue;

    const sameCategory =
      (row.cp_category || row.product_category) === src.category;
    const candBase = resolveBaseProduct(row.cp_canonical_name);
    const cKey = row.canonical_id;

    // T1: same brand + same exact product spec + different size.
    // Uses exact base_product_slots match so variants (split vs whole) don't qualify —
    // only true size variants of identical product spec (e.g. 500g vs 1kg of same item).
    const sameSpec = srcBaseSlots
      ? baseProductSlotsMatch(srcBaseSlots, row.cp_base_product_slots)
      : (srcBaseKey && candBase?.base_key === srcBaseKey);
    if (
      srcBrand &&
      sameSpec &&
      row.canonical_id !== canonicalId &&
      (srcWeightValue === null || parseWeight(row.weight_value, row.weight_raw) !== srcWeightValue) &&
      sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) &&
      nameHasBrand(row.product_name, srcBrand) &&
      !seen.has(`t1:${cKey}`)
    ) {
      const candBrand = candBase?.base_key
        ? detectBrandForBase(row.cp_canonical_name, candBase.base_key)
        : null;
      const brandMatch = srcBrandFromCatalogOnly
        ? (candBrand === srcBrand)
        : nameHasBrand(row.product_name, srcBrand);
      if (brandMatch) {
        t1.push(row);
        seen.add(`t1:${cKey}`);
        continue;
      }
    }

    // Skip same canonical — don't surface the same product as its own replacement.
    if (row.canonical_id === canonicalId) continue;

    // T2: cross-brand alternative for the same product spec.
    // Primary: exact base_product_slots set match.
    // Fallback: catalog base_key equality — handles Hindi/English terminology
    // differences (e.g. "Mung Sabut Whole" ↔ "TRS Mung Beans" both → "moong dal yellow").
    const sameBaseProduct =
      (srcBaseSlots && baseProductSlotsMatch(srcBaseSlots, row.cp_base_product_slots)) ||
      (srcBaseKey && candBase?.base_key === srcBaseKey && sameCategory &&
        variantTokensMatch(srcBaseSlots, row.cp_base_product_slots));
    const isSameBrandT2 = !!srcBrand && (
      nameHasBrand(row.product_name, srcBrand) ||
      (candBase?.base_key ? detectBrandForBase(row.cp_canonical_name, candBase.base_key) === srcBrand : false)
    );
    if (
      sameBaseProduct &&
      !isSameBrandT2 &&
      sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) &&
      !seen.has(`t2:${cKey}`)
    ) {
      t2.push(row);
      seen.add(`t2:${cKey}`);
      continue;
    }

    // T3: same brand + same product group (variants like "extra long" vs "original").
    // Product group matched via base_key (catalog brands) or slot overlap ≥60% (non-catalog brands).
    const sameProductGroup =
      (srcBaseKey && candBase?.base_key === srcBaseKey) ||
      baseProductSlotsSubset(srcBaseSlots, row.cp_base_product_slots);
    if (srcBrand && sameProductGroup && nameHasBrand(row.product_name, srcBrand) && sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) && !seen.has(`t3:${cKey}`)) {
      const candBrand = candBase?.base_key
        ? detectBrandForBase(row.cp_canonical_name, candBase.base_key)
        : null;
      const t3BrandMatch = srcBrandFromCatalogOnly
        ? (candBrand === srcBrand)
        : nameHasBrand(row.cp_canonical_name, srcBrand);
      if (t3BrandMatch) {
        t3.push(row);
        seen.add(`t3:${cKey}`);
        continue;
      }
    }

    // T4: same category
    if (sameCategory && !seen.has(`t4:${cKey}`)) {
      t4.push(row);
      seen.add(`t4:${cKey}`);
    }
  }

  t1.sort((a, b) => (a.weight_value || 0) - (b.weight_value || 0));
  t2.sort(byValueAsc);
  t3.sort(byValueAsc);
  t4.sort(byValueAsc);

  const tiers = [];
  if (t1.length)
    tiers.push({ type: "same_pack", relevance: 1.0, deals: t1.slice(0, TIER_CAP) });
  if (t2.length)
    tiers.push({ type: "same_spec", relevance: 0.85, deals: t2.slice(0, TIER_CAP) });
  if (t3.length)
    tiers.push({ type: "same_brand", relevance: 0.65, deals: t3.slice(0, TIER_CAP) });
  if (t4.length)
    tiers.push({ type: "same_category", relevance: 0.4, deals: t4.slice(0, TIER_CAP) });

  return { tiers };
}

module.exports = { getReplacements, variantTokensMatch };
