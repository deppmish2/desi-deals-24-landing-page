"use strict";
const fetch = require("node-fetch");
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

const STORE_ID = "globalfoodhub";
const STORE_NAME = "Global Food Hub";
const STORE_URL = "https://globalfoodhub.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// Keywords to identify deal collections via dynamic discovery
const DEAL_KEYWORDS = [
  "sale",
  "bogo",
  "deal",
  "off",
  "offer",
  "discount",
  "clearance",
  "combo",
  "bundle",
  "mega",
  "real-deal",
  "reduce",
];

async function discoverDealCollections() {
  try {
    const res = await fetch(`${STORE_URL}/collections.json?limit=250`, {
      headers: { "User-Agent": UA },
      timeout: 15000,
    });
    if (!res.ok) return [];
    const { collections = [] } = await res.json();
    return collections
      .filter((c) =>
        DEAL_KEYWORDS.some(
          (kw) =>
            c.handle.toLowerCase().includes(kw) ||
            c.title.toLowerCase().includes(kw),
        ),
      )
      .map((c) => c.handle);
  } catch (e) {
    console.warn(`[globalfoodhub] Collection discovery failed: ${e.message}`);
    return [];
  }
}

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
    availability: variant.available ? "in_stock" : "out_of_stock",
    bulk_pricing: null,
  };
}

async function scrape() {
  const dealHandles = await discoverDealCollections();
  const handles = await resolveCollectionHandles({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    defaultHandles: dealHandles,
    fallbackHandles: ["sale", "deals", "offers"],
  });

  if (dealHandles.length > 0) {
    console.log(
      `[globalfoodhub] Found ${dealHandles.length} deal collections: ${dealHandles.join(", ")}`,
    );
  }

  const seen = new Set();
  const deals = [];

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
      console.warn(`[globalfoodhub] Failed to fetch ${handle}: ${e.message}`);
      continue;
    }
    if (!products) continue;

    for (const p of products) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      const deal = mapProduct(p);
      if (deal) deals.push(deal);
    }

    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
  }

  console.log(`[globalfoodhub] Found ${deals.length} deals`);
  return deals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
