"use strict";
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const {
  parsePrice,
  calcDiscount,
  calcPricePerKg,
} = require("../utils/price-parser");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { resolveImage } = require("../utils/image-resolver");

const STORE_ID = "yogimart";
const STORE_NAME = "Yogi Mart";
const STORE_URL = "https://yogimart.de";
const DEAL_URL = `${STORE_URL}/saveme`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

async function scrape() {
  const res = await fetch(DEAL_URL, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    },
    timeout: 30000,
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);
  const deals = [];
  const seen = new Set();

  $(".item-box").each((_, el) => {
    const $el = $(el);
    const titleLink = $el.find(".product-title a").first();
    const productUrl = titleLink.attr("href");
    const name = titleLink.text().trim();
    const salePrice = parsePrice($el.find(".actual-price").first().text());
    const originalPriceRaw = parsePrice($el.find(".old-price").first().text());

    if (!productUrl || !name || !salePrice) return;

    const absoluteUrl = productUrl.startsWith("http")
      ? productUrl
      : `${STORE_URL}${productUrl}`;
    if (seen.has(absoluteUrl)) return;
    seen.add(absoluteUrl);

    const originalPrice =
      originalPriceRaw && originalPriceRaw > salePrice ? originalPriceRaw : null;
    const discountPercent = calcDiscount(salePrice, originalPrice);
    if (!originalPrice || !(discountPercent > 0)) return;

    const weight = parseWeight(name);
    const pricePerKg = weight
      ? calcPricePerKg(salePrice, weight.value, weight.unit)
      : null;

    deals.push({
      store_id: STORE_ID,
      store_name: STORE_NAME,
      store_url: STORE_URL,
      product_name: name,
      product_category: mapCategory(name),
      product_url: absoluteUrl,
      image_url: resolveImage($el.find("img").first(), STORE_URL),
      weight_raw: weight?.raw || null,
      weight_value: weight?.value || null,
      weight_unit: weight?.unit || null,
      sale_price: salePrice,
      original_price: originalPrice,
      discount_percent: discountPercent,
      price_per_kg: pricePerKg,
      price_per_unit: null,
      currency: "EUR",
      availability: /Nicht auf Lager|out of stock/i.test($el.text())
        ? "out_of_stock"
        : "in_stock",
      bulk_pricing: null,
    });
  });

  console.log(`[${STORE_ID}] Total: ${deals.length} deals`);
  return deals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
