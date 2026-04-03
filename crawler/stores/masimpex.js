"use strict";
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const {
  parsePrice,
  calcPricePerKg,
} = require("../utils/price-parser");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
const { resolveImage } = require("../utils/image-resolver");

const STORE_ID = "masimpex";
const STORE_NAME = "MAS Impex";
const STORE_URL = "https://www.masimpex.com";
const CATEGORY_URLS = [
  `${STORE_URL}/c/aktionsprodukte`,
  `${STORE_URL}/c/monats-angebote`,
];
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    },
    timeout: 30000,
  });
  if (!res.ok) return null;
  return res.text();
}

function parseProducts(html) {
  const $ = cheerio.load(html);
  const deals = [];

  $(".product-item").each((_, el) => {
    const $el = $(el);
    const titleLink = $el.find("a.product-item-link").first();
    const productUrl = titleLink.attr("href");
    const name = $el.find(".product-item-title").first().text().trim();
    const salePrice = parsePrice(
      $el.find(".product-item-price-new").first().text(),
    );

    if (!productUrl || !name || !salePrice) return;

    const absoluteUrl = productUrl.startsWith("http")
      ? productUrl
      : `${STORE_URL}${productUrl}`;
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
      original_price: null,
      discount_percent: null,
      price_per_kg: pricePerKg,
      price_per_unit: null,
      currency: "EUR",
      availability: /auf lager/i.test($el.text()) ? "in_stock" : "unknown",
      bulk_pricing: null,
    });
  });

  return deals;
}

async function scrape() {
  const allDeals = [];
  const seen = new Set();

  for (const url of CATEGORY_URLS) {
    // eslint-disable-next-line no-await-in-loop
    const html = await fetchPage(url);
    if (!html) continue;

    const deals = parseProducts(html);
    for (const deal of deals) {
      if (seen.has(deal.product_url)) continue;
      seen.add(deal.product_url);
      allDeals.push(deal);
    }
  }

  console.log(`[${STORE_ID}] Total: ${allDeals.length} promotional items`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
