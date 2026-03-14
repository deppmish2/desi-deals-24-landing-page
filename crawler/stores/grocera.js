"use strict";
const fetch = require("node-fetch");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { calcPricePerKg } = require("../utils/price-parser");
const { isFullCatalogEnabled } = require("../utils/crawl-scope");

const STORE_ID = "grocera";
const STORE_NAME = "Grocera";
const STORE_URL = "https://grocera.de";

// Typesense credentials (public search key from /static/js/search/typesense.js)
const TS_HOST = "3uovdibf50nlxkrtp-1.a1.typesense.net";
const TS_API_KEY = "4gpobkq7OLuOLEvRpMVL2u1aR3BLeCUZ";
const TS_COLLECTION = "prod-products-new";
const TS_URL = `https://${TS_HOST}/collections/${TS_COLLECTION}/documents/search`;
const PER_PAGE = 250;

async function fetchPage(page, fullCatalog) {
  const filterBy = fullCatalog
    ? "inventory.hidden:=false"
    : "tags.en:=[deal] && inventory.hidden:=false";

  const params = new URLSearchParams({
    q: "*",
    query_by: "brand",
    filter_by: filterBy,
    include_fields:
      "slug.en,name.en,brand,size,price.gross,price.deals,inventory.out_of_stock,inventory.quantity,images,tags.en,timestamp.expires_at",
    sort_by: "inventory.out_of_stock:asc",
    per_page: PER_PAGE,
    page,
  });

  const res = await fetch(`${TS_URL}?${params}`, {
    headers: { "X-TYPESENSE-API-KEY": TS_API_KEY },
    timeout: 30000,
  });

  if (!res.ok) throw new Error(`Typesense HTTP ${res.status}`);
  return res.json();
}

function buildDeal(doc) {
  // Build product name from brand + name + size
  const parts = [doc.brand, doc["name.en"] || doc.name?.en, doc.size]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  const name = parts.join(" ");
  if (!name) return null;

  // Prices — prefer deals.single, fall back to price.gross
  const deal = doc["price.deals"]?.single || doc.price?.deals?.single;
  const salePrice = deal?.gross ?? doc["price.gross"] ?? doc.price?.gross;
  const originalPrice = deal?.gross_before ?? null;
  const discountStr = deal?.percentage ?? null;

  if (!salePrice) return null;

  const discountPercent = discountStr ? parseFloat(discountStr) : null;

  // Product URL
  const slug = doc["slug.en"] || doc.slug?.en;
  const productUrl = slug ? `${STORE_URL}/product/${slug}` : STORE_URL;

  // Image — images is an array; take first entry
  const images = doc.images || [];
  const imageUrl = images[0]?.url || images[0]?.thumbnail_url || null;

  // Availability
  const outOfStock =
    doc["inventory.out_of_stock"] ?? doc.inventory?.out_of_stock ?? false;
  const availability = outOfStock ? "out_of_stock" : "in_stock";

  // Best-before date from expires_at (set for soon-exp-deal / save-food products)
  const tags = doc["tags.en"] || doc.tags?.en || [];
  const expiresAt = doc["timestamp.expires_at"] || doc.timestamp?.expires_at;
  const best_before =
    tags.includes("soon-exp-deal") && expiresAt
      ? new Date(expiresAt * 1000).toISOString().slice(0, 7) // 'YYYY-MM'
      : null;

  const weight = parseWeight(name);
  const pricePerKg = weight
    ? calcPricePerKg(salePrice, weight.value, weight.unit)
    : null;

  return {
    store_id: STORE_ID,
    store_name: STORE_NAME,
    store_url: STORE_URL,
    product_name: name,
    product_category: mapCategory(name),
    product_url: productUrl,
    image_url: imageUrl,
    weight_raw: weight?.raw || null,
    weight_value: weight?.value || null,
    weight_unit: weight?.unit || null,
    sale_price: salePrice,
    original_price:
      originalPrice && originalPrice > salePrice ? originalPrice : null,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability,
    bulk_pricing: null,
    best_before,
  };
}

async function scrape() {
  const allDeals = [];
  let page = 1;
  const fullCatalog = isFullCatalogEnabled();
  console.log(
    `[grocera] Mode: ${fullCatalog ? "full catalog" : "deals-only filter"}`,
  );

  while (true) {
    console.log(`[grocera] Fetching Typesense page ${page}...`);
    let result;
    try {
      result = await fetchPage(page, fullCatalog);
    } catch (e) {
      console.warn(`[grocera] Page ${page} failed: ${e.message}`);
      break;
    }

    const hits = result.hits || [];
    console.log(
      `[grocera] Page ${page}: ${hits.length} hits (found=${result.found})`,
    );

    let pageDeals = 0;
    for (const hit of hits) {
      const deal = buildDeal(hit.document);
      if (deal) {
        allDeals.push(deal);
        pageDeals++;
      }
    }
    console.log(`[grocera] Page ${page}: ${pageDeals} deals extracted`);

    if (hits.length < PER_PAGE) break;
    page++;
  }

  console.log(`[grocera] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
