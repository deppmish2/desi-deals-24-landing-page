"use strict";

const db = require("../server/db");

let cachedSuggestIndex = null;
let cachedAt = 0;
const CACHE_TTL_MS = 3600 * 1000;

async function rebuildFtsIndex() {
  await db.execute("DELETE FROM fts_canonicals");
  await db.execute(`
    INSERT INTO fts_canonicals (canonical_id, canonical_name, base_key, aliases_text, category, brands_text)
    SELECT
      cp.id,
      cp.canonical_name,
      COALESCE(cp.base_key, ''),
      COALESCE(cp.base_product_slots, ''),
      COALESCE(cp.category, ''),
      COALESCE(cp.brand_slots, '')
    FROM canonical_products cp
    WHERE EXISTS (
      SELECT 1 FROM store_products sp
      WHERE sp.canonical_id = cp.id AND sp.is_active = 1
    )
  `);
}

async function generateSuggestIndex() {
  const products = await db.prepare(`
    SELECT
      cp.id,
      cp.canonical_name AS name,
      COALESCE(cp.base_product_slots, '') AS aliases,
      COALESCE(cp.category, 'Other') AS category,
      COALESCE(cp.brand_slots, '') AS brand,
      MIN(sp.sale_price) AS cheapest_price,
      sp.image_url AS img
    FROM canonical_products cp
    JOIN store_products sp ON sp.canonical_id = cp.id AND sp.is_active = 1
    GROUP BY cp.id
    ORDER BY cp.canonical_name
  `).all();

  const brandMap = new Map();
  const categoryMap = new Map();

  for (const p of products) {
    if (p.brand) {
      const b = p.brand.replace(/["\[\]]/g, "").trim();
      if (b) brandMap.set(b, (brandMap.get(b) || 0) + 1);
    }
    if (p.category) {
      categoryMap.set(p.category, (categoryMap.get(p.category) || 0) + 1);
    }
  }

  return {
    products: products.map(p => ({
      id: p.id,
      name: p.name,
      aliases: p.aliases ? p.aliases.split(/\s+/).filter(Boolean) : [],
      category: p.category,
      brand: p.brand,
      cheapest_price: p.cheapest_price,
      img: p.img,
    })),
    brands: [...brandMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    categories: [...categoryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  };
}

function getCachedSuggestIndex() { return cachedSuggestIndex; }

async function rebuildAll() {
  await rebuildFtsIndex();
  cachedSuggestIndex = await generateSuggestIndex();
  cachedAt = Date.now();
  console.log(`[fts] rebuilt: ${cachedSuggestIndex.products.length} products`);
}

module.exports = { rebuildFtsIndex, generateSuggestIndex, getCachedSuggestIndex, rebuildAll };
