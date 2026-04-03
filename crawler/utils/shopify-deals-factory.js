"use strict";

const {
  parsePrice,
  calcDiscount,
  calcPricePerKg,
} = require("./price-parser");
const { parseWeight } = require("./weight-parser");
const { mapCategory } = require("./category-mapper");
const {
  fetchCollectionProducts,
  resolveCollectionHandles,
} = require("./shopify-catalog");

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function mapShopifyProduct({ storeId, storeName, storeUrl }, product) {
  const variant = product.variants?.[0] || {};
  const salePrice = parsePrice(variant.price);
  const compareAtPrice = parsePrice(variant.compare_at_price);

  if (!salePrice) return null;

  const originalPrice =
    compareAtPrice && compareAtPrice > salePrice ? compareAtPrice : null;
  const discountPercent = calcDiscount(salePrice, originalPrice);

  // Deals-only crawler: keep only real discounted items.
  if (!originalPrice || !(discountPercent > 0)) {
    return null;
  }

  const weight = parseWeight(product.title) || parseWeight(variant.title);
  const pricePerKg = weight
    ? calcPricePerKg(salePrice, weight.value, weight.unit)
    : null;

  return {
    store_id: storeId,
    store_name: storeName,
    store_url: storeUrl,
    product_name: product.title,
    product_category: mapCategory(product.title),
    product_url: `${storeUrl}/products/${product.handle}`,
    image_url: product.images?.[0]?.src?.replace(/\?.*$/, "") || null,
    weight_raw: weight?.raw || null,
    weight_value: weight?.value || null,
    weight_unit: weight?.unit || null,
    sale_price: salePrice,
    original_price: originalPrice,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability: variant.available ? "in_stock" : "out_of_stock",
    bulk_pricing: null,
  };
}

function createShopifyDealsAdapter({
  storeId,
  storeName,
  storeUrl,
  defaultHandles = ["all"],
  fallbackHandles = [],
  ua = DEFAULT_UA,
}) {
  async function scrape() {
    const seen = new Set();
    const deals = [];
    const handles = await resolveCollectionHandles({
      storeId,
      storeUrl,
      ua,
      defaultHandles,
      fallbackHandles,
    });

    for (const handle of handles) {
      let products;
      try {
        // eslint-disable-next-line no-await-in-loop
        products = await fetchCollectionProducts({
          storeId,
          storeUrl,
          ua,
          handle,
        });
      } catch (error) {
        console.warn(`[${storeId}] ${handle}: ${error.message}`);
        continue;
      }

      if (!products) continue;

      for (const product of products) {
        if (seen.has(product.id)) continue;
        seen.add(product.id);

        const deal = mapShopifyProduct({ storeId, storeName, storeUrl }, product);
        if (deal) deals.push(deal);
      }
    }

    console.log(`[${storeId}] Found ${deals.length} deals`);
    return deals;
  }

  return {
    storeId,
    storeName,
    storeUrl,
    scrape,
  };
}

module.exports = {
  createShopifyDealsAdapter,
};
