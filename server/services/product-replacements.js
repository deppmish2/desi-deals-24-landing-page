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

async function getReplacements(db, { canonicalId, storeId, dealId = null }) {
  const src = await db
    .prepare(
      `SELECT id, canonical_name, category FROM canonical_products WHERE id = ? LIMIT 1`
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

  for (const row of rows) {
    if (dealId && row.id === dealId) continue;
    if (row.canonical_id === canonicalId) {
      t1.push(row);
      continue;
    }

    const sameCategory =
      (row.cp_category || row.product_category) === src.category;
    const candBase = resolveBaseProduct(row.cp_canonical_name);
    const cKey = row.canonical_id;

    if (
      srcBaseKey &&
      candBase?.base_key === srcBaseKey &&
      sameCategory &&
      !seen.has(`t2:${cKey}`)
    ) {
      t2.push(row);
      seen.add(`t2:${cKey}`);
      continue;
    }

    if (srcBrand && sameCategory && !seen.has(`t3:${cKey}`)) {
      const candBrand = candBase?.base_key
        ? detectBrandForBase(row.cp_canonical_name, candBase.base_key)
        : null;
      if (candBrand && candBrand === srcBrand) {
        t3.push(row);
        seen.add(`t3:${cKey}`);
        continue;
      }
    }

    if (sameCategory && !seen.has(`t4:${cKey}`)) {
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
    tiers.push({ type: "same_base_product", relevance: 0.85, deals: t2.slice(0, TIER_CAP) });
  if (t3.length)
    tiers.push({ type: "same_brand", relevance: 0.65, deals: t3.slice(0, TIER_CAP) });
  if (!t1.length && !t2.length && !t3.length && t4.length)
    tiers.push({ type: "same_category", relevance: 0.4, deals: t4.slice(0, TIER_CAP) });

  return { tiers };
}

module.exports = { getReplacements };
