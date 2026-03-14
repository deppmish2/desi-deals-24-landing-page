"use strict";
const {
  parsePrice,
  calcDiscount,
  calcPricePerKg,
} = require("../utils/price-parser");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { parseBestBefore } = require("../utils/best-before-parser");
const {
  fetchCollectionProducts,
  resolveCollectionHandles,
} = require("../utils/shopify-catalog");
const { isFullCatalogEnabled } = require("../utils/crawl-scope");

// Strip "- Sale Item [BBD: DD Month YYYY]" suffix Dookan appends to stock-clearance titles
const BBD_RE = /\s*-?\s*Sale Item\s*\[BBD:[^\]]+\]/i;

const STORE_ID = "dookan";
const STORE_NAME = "Dookan";
const STORE_URL = "https://eu.dookan.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// Primary sale collections to crawl (ordered by reliability)
const SALE_HANDLES = [
  "essential-deals",
  "1-euro-sale",
  "5-euro-sale",
  "bundle-offers",
  "super-deals",
  "daawat-hot-deals",
  "stock-clearance",
  "lowest-offer-price",
];

// Fallback handles to try if none of the above exist
const FALLBACK_HANDLES = [
  "sale",
  "angebote",
  "offers",
  "deals",
  "on-sale",
  "outlet",
];

function mapProduct(p) {
  const variant = p.variants?.[0] || {};
  const salePrice = parsePrice(variant.price);
  const origPrice = parsePrice(variant.compare_at_price);
  if (!salePrice) return null;

  const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
  const discountPercent = calcDiscount(salePrice, originalPrice);

  // Extract best-before from title before stripping the suffix
  const bestBefore = parseBestBefore(p.title);
  const cleanTitle = p.title.replace(BBD_RE, "").trim();

  const weight = parseWeight(cleanTitle) || parseWeight(variant.title);
  const pricePerKg = weight
    ? calcPricePerKg(salePrice, weight.value, weight.unit)
    : null;
  const image = p.images?.[0]?.src?.replace(/\?.*$/, "") || null;

  return {
    store_id: STORE_ID,
    store_name: STORE_NAME,
    store_url: STORE_URL,
    product_name: cleanTitle,
    product_category: mapCategory(cleanTitle),
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
    availability: variant.available ? "in_stock" : "out_of_stock",
    bulk_pricing: null,
    best_before: bestBefore,
  };
}

async function scrape() {
  const seen = new Set();
  const deals = [];
  let fetched = 0;
  const fullCatalog = isFullCatalogEnabled();
  const handles = await resolveCollectionHandles({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    defaultHandles: SALE_HANDLES,
    fallbackHandles: FALLBACK_HANDLES,
  });

  // In full mode this includes discovered collections; otherwise it starts with SALE_HANDLES.
  for (const handle of handles) {
    const products = await fetchCollectionProducts({
      storeId: STORE_ID,
      storeUrl: STORE_URL,
      ua: UA,
      handle,
    });
    if (products === null) continue; // collection doesn't exist

    fetched++;
    for (const p of products) {
      const url = `${STORE_URL}/products/${p.handle}`;
      if (seen.has(url)) continue;
      seen.add(url);
      const mapped = mapProduct(p);
      if (mapped) deals.push(mapped);
    }
    console.log(
      `[dookan] ${handle}: ${products.length} products (${deals.length} unique so far)`,
    );
    await new Promise((r) => setTimeout(r, 800));
  }

  // If nothing found, fall back to dynamic discovery
  if (!fullCatalog && fetched === 0) {
    console.warn(
      "[dookan] No primary handles found — trying dynamic discovery",
    );
    for (const fb of FALLBACK_HANDLES) {
      const products = await fetchCollectionProducts({
        storeId: STORE_ID,
        storeUrl: STORE_URL,
        ua: UA,
        handle: fb,
      });
      if (products !== null) {
        for (const p of products) {
          const url = `${STORE_URL}/products/${p.handle}`;
          if (seen.has(url)) continue;
          seen.add(url);
          const mapped = mapProduct(p);
          if (mapped) deals.push(mapped);
        }
        console.log(`[dookan] fallback ${fb}: ${products.length} products`);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (deals.length === 0) {
    console.warn(
      "[dookan] No deals found — update SALE_HANDLES with current collection slugs.",
    );
  }

  console.log(`[dookan] Total unique deals: ${deals.length}`);
  return deals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
