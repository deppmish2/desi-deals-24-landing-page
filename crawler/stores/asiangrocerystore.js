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
const { parseDiscountBadge } = require("../utils/discount-badge");

const STORE_ID = "asiangrocerystore";
const STORE_NAME = "Asian Grocery Store";
const STORE_URL = "https://www.asiangrocerystore.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

async function scrape() {
  const res = await fetch(`${STORE_URL}/`, {
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

  $(".product-small, .col").each((_, el) => {
    const $el = $(el);
    const hasDealMarker =
      $el.find(".onsale, del, ins, .badge.on-sale").length > 0 ||
      parseDiscountBadge($el.text()) > 0;
    if (!hasDealMarker) return;

    const link = $el
      .find("a.woocommerce-LoopProduct-link, .product-title a, h2 a, h3 a")
      .first();
    const productUrl = link.attr("href") || $el.find("a").first().attr("href");
    if (!productUrl || seen.has(productUrl)) return;

    const name = $el
      .find(".product-title, .woocommerce-loop-product__title, h2, h3")
      .first()
      .text()
      .trim();
    const salePriceText =
      $el
        .find(
          ".price ins .woocommerce-Price-amount bdi, .price ins .woocommerce-Price-amount, .price ins bdi",
        )
        .first()
        .text() ||
      $el
        .find(
          ".price .woocommerce-Price-amount bdi, .price .woocommerce-Price-amount",
        )
        .first()
        .text();
    const origPriceText = $el
      .find(
        ".price del .woocommerce-Price-amount bdi, .price del .woocommerce-Price-amount, .price del bdi",
      )
      .first()
      .text();

    const salePrice = parsePrice(salePriceText);
    const origPrice = parsePrice(origPriceText);
    if (!name || !salePrice) return;

    const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
    const discountPercent =
      calcDiscount(salePrice, originalPrice) ||
      parseDiscountBadge($el.find(".onsale, .badge").first().text());

    const weight = parseWeight(name);
    const pricePerKg = weight
      ? calcPricePerKg(salePrice, weight.value, weight.unit)
      : null;

    seen.add(productUrl);
    deals.push({
      store_id: STORE_ID,
      store_name: STORE_NAME,
      store_url: STORE_URL,
      product_name: name,
      product_category: mapCategory(name),
      product_url: productUrl,
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
      availability:
        /out of stock|nicht vorrätig/i.test($el.text()) ||
        $el.find(".out-of-stock").length
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
