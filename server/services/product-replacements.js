"use strict";

const {
  resolveBaseProduct,
  detectBrandForBase,
} = require("./base-product-catalog");

const TIER_CAP = 4;

const ACTIVE_DEALS_WITH_CANONICAL_SQL = `
  SELECT d.id, d.canonical_id, d.crawl_timestamp, d.store_id,
         s.name AS store_name, s.url AS store_url,
         d.product_name, d.product_category, d.product_url,
         d.image_url, d.weight_raw, d.weight_value, d.weight_unit,
         d.sale_price, d.original_price, d.discount_percent,
         d.price_per_kg, d.currency, d.availability, d.bulk_pricing,
         d.best_before,
         cp.canonical_name AS cp_canonical_name,
         cp.category AS cp_category
  FROM deals d
  JOIN stores s ON s.id = d.store_id
  JOIN canonical_products cp ON cp.id = d.canonical_id
  WHERE d.store_id = ? AND d.is_active = 1 AND d.canonical_id IS NOT NULL
`;

const byDiscountDesc = (a, b) =>
  (b.discount_percent || 0) - (a.discount_percent || 0) ||
  (a.sale_price || 0) - (b.sale_price || 0);

function nameHasBrand(productName, brand) {
  if (!brand || !productName) return false;
  return new RegExp("\\b" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(productName);
}

function parseWeight(value, raw) {
  if (value != null) return value;
  const m = String(raw || "").match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
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
      `SELECT id, canonical_name, category, weight_value, weight_unit FROM canonical_products WHERE id = ? LIMIT 1`
    )
    .get(canonicalId);
  if (!src) return null;

  const srcBase = resolveBaseProduct(src.canonical_name);
  const srcBaseKey = srcBase?.base_key ?? null;
  const srcBrand = srcBaseKey
    ? detectBrandForBase(src.canonical_name, srcBaseKey)
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

    // T1: same brand + same base product + different size (different canonical, different weight)
    if (
      srcBaseKey &&
      srcBrand &&
      candBase?.base_key === srcBaseKey &&
      row.canonical_id !== canonicalId &&
      (srcWeightValue === null || parseWeight(row.weight_value, row.weight_raw) !== srcWeightValue) &&
      sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) &&
      nameHasBrand(row.product_name, srcBrand) &&
      !seen.has(`t1:${cKey}`)
    ) {
      const candBrand = detectBrandForBase(row.cp_canonical_name, candBase.base_key);
      if (candBrand && candBrand === srcBrand) {
        t1.push(row);
        seen.add(`t1:${cKey}`);
        continue;
      }
    }

    // T2: same canonical, unbranded deals only.
    // Canonical IDs encode brand names, so for branded canonicals srcBrand is always present
    // and all same-canonical deals share that brand — the filter excludes them all, leaving T2
    // empty. T2 only fires meaningfully for unbranded/generic canonicals (srcBrand === null),
    // where the short-circuit (!srcBrand) passes all same-canonical deals.
    if (row.canonical_id === canonicalId) {
      if (
        (!srcBrand || !nameHasBrand(row.product_name, srcBrand)) &&
        sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw))
      ) {
        t2.push(row);
      }
      continue; // always block same-canonical from falling through to T3/T4
    }

    // T3: same brand, same category, different base product
    if (srcBrand && sameCategory && nameHasBrand(row.product_name, srcBrand) && sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) && !seen.has(`t3:${cKey}`)) {
      const candBrand = candBase?.base_key
        ? detectBrandForBase(row.cp_canonical_name, candBase.base_key)
        : null;
      if (candBrand && candBrand === srcBrand) {
        t3.push(row);
        seen.add(`t3:${cKey}`);
        continue;
      }
    }

    // T4: same category
    if (sameCategory && sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) && !seen.has(`t4:${cKey}`)) {
      t4.push(row);
      seen.add(`t4:${cKey}`);
    }
  }

  t1.sort((a, b) => (a.weight_value || 0) - (b.weight_value || 0));
  t2.sort(byDiscountDesc);
  t3.sort(byDiscountDesc);
  t4.sort(byDiscountDesc);

  const tiers = [];
  if (t1.length)
    tiers.push({ type: "same_pack", relevance: 1.0, deals: t1.slice(0, TIER_CAP) });
  if (t2.length)
    tiers.push({ type: "same_canonical", relevance: 0.85, deals: t2.slice(0, TIER_CAP) });
  if (t3.length)
    tiers.push({ type: "same_brand", relevance: 0.65, deals: t3.slice(0, TIER_CAP) });
  if (!t1.length && !t2.length && !t3.length && t4.length)
    tiers.push({ type: "same_category", relevance: 0.4, deals: t4.slice(0, TIER_CAP) });

  return { tiers };
}

module.exports = { getReplacements };
