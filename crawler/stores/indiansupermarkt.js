"use strict";
const {
  parsePrice,
  calcDiscount,
  calcPricePerKg,
} = require("../utils/price-parser");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const {
  fetchCollectionProducts,
  resolveCollectionHandles,
} = require("../utils/shopify-catalog");

const STORE_ID = "indiansupermarkt";
const STORE_NAME = "Indian Supermarkt";
const STORE_URL = "https://www.indiansupermarkt.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const COLLECTIONS = ["offers", "stock-clearance", "weekly-offer"];

function mapProduct(p) {
  const variant = p.variants?.[0] || {};
  const salePrice = parsePrice(variant.price);
  const origPrice = parsePrice(variant.compare_at_price);
  if (!salePrice) return null;
  const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
  const discountPercent = calcDiscount(salePrice, originalPrice);
  const weight = parseWeight(p.title) || parseWeight(variant.title);
  const pricePerKg = weight
    ? calcPricePerKg(salePrice, weight.value, weight.unit)
    : null;
  const image = p.images?.[0]?.src?.replace(/\?.*$/, "") || null;
  const availability = variant.available ? "in_stock" : "out_of_stock";
  return {
    store_id: STORE_ID,
    store_name: STORE_NAME,
    store_url: STORE_URL,
    product_name: p.title,
    product_category: mapCategory(p.title),
    product_url: `${STORE_URL}/products/${p.handle}`,
    image_url: image,
    weight_raw: weight?.raw || null,
    weight_value: weight?.value || null,
    weight_unit: weight?.unit || null,
    sale_price: salePrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability,
    bulk_pricing: null,
  };
}

async function scrape() {
  const seen = new Set();
  const deals = [];
  const handles = await resolveCollectionHandles({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    defaultHandles: COLLECTIONS,
  });

  for (const handle of handles) {
    let products;
    try {
      products = await fetchCollectionProducts({
        storeId: STORE_ID,
        storeUrl: STORE_URL,
        ua: UA,
        handle,
      });
    } catch (e) {
      console.warn(`[indiansupermarkt] ${handle}: ${e.message}`);
      continue;
    }
    if (!products) continue;
    for (const p of products) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const deal = mapProduct(p);
      if (deal) deals.push(deal);
    }
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1000));
  }
  console.log(`[indiansupermarkt] Found ${deals.length} deals`);
  return deals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
