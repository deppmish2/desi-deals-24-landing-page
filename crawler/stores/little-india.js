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
const { getMaxPages } = require("../utils/crawl-scope");
const { discoverLinksByPatterns } = require("../utils/link-discovery");

const STORE_ID = "little-india";
const STORE_NAME = "Little India";
const STORE_URL = "https://www.littleindia.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const DEFAULT_BASE_URL = `${STORE_URL}/product-category/promotions/`;

function pageUrl(base, page) {
  if (page === 1) return base;
  return `${base.replace(/\/+$/, "")}/page/${page}/`;
}

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

function parseProductCards(html) {
  const $ = cheerio.load(html);
  const deals = [];

  // WooCommerce standard product listing selectors
  const productEls = $("li.product, .product-item, .nasa-product-grid li");

  productEls.each((_, el) => {
    const $el = $(el);

    // Product URL & name
    const link = $el
      .find(
        "a.woocommerce-LoopProduct-link, a.product-img-wrap, h2 a, .woocommerce-loop-product__title a",
      )
      .first();
    const productUrl = link.attr("href") || $el.find("a").first().attr("href");
    const name = $el
      .find(".woocommerce-loop-product__title, .product-title, h2")
      .first()
      .text()
      .trim();

    if (!name || !productUrl) return;

    // Prices — WooCommerce sale items show <ins> for sale, <del> for original
    const salePriceText =
      $el
        .find(".price ins .woocommerce-Price-amount, .price ins bdi")
        .first()
        .text() || $el.find(".woocommerce-Price-amount").first().text();
    const origPriceText = $el
      .find(".price del .woocommerce-Price-amount, .price del bdi")
      .first()
      .text();

    const salePrice = parsePrice(salePriceText);
    const origPrice = parsePrice(origPriceText);

    // Skip products without a price
    if (!salePrice) return;

    const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
    const discountPercent = calcDiscount(salePrice, originalPrice);

    // Image
    const $img = $el.find("img").first();
    const imageUrl = resolveImage($img, STORE_URL);

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
      product_url: productUrl,
      image_url: imageUrl,
      weight_raw: weight?.raw || null,
      weight_value: weight?.value || null,
      weight_unit: weight?.unit || null,
      sale_price: salePrice,
      original_price: originalPrice,
      discount_percent: discountPercent,
      price_per_kg: pricePerKg,
      price_per_unit: null,
      currency: "EUR",
      availability: $el.find(".out-of-stock, .outofstock").length
        ? "out_of_stock"
        : "in_stock",
      bulk_pricing: null,
    });
  });

  // Check if there's a next page
  const hasNextPage = $("a.next.page-numbers, .next.page-numbers a").length > 0;
  return { deals, hasNextPage };
}

async function scrape() {
  const allDeals = [];
  const seen = new Set();
  const maxPages = getMaxPages(5);
  const baseUrls = await discoverLinksByPatterns({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    patterns: [/\/product-category\//i, /\/produkt-kategorie\//i],
    fallback: [DEFAULT_BASE_URL],
    extraSeedUrls: [`${STORE_URL}/shop/`],
  });

  for (const baseUrl of baseUrls) {
    let page = 1;
    while (page <= maxPages) {
      const url = pageUrl(baseUrl, page);
      console.log(`[little-india] Fetching page ${page}: ${url}`);
      let html;
      try {
        html = await fetchPage(url);
      } catch (e) {
        console.warn(`[little-india] Page ${page} failed: ${e.message}`);
        break;
      }

      if (!html) break;

      const { deals, hasNextPage } = parseProductCards(html);
      let pageDeals = 0;
      for (const deal of deals) {
        if (seen.has(deal.product_url)) continue;
        seen.add(deal.product_url);
        allDeals.push(deal);
        pageDeals += 1;
      }
      console.log(`[little-india] Page ${page}: ${pageDeals} deals`);

      if (!hasNextPage) break;
      page++;
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }
  }

  console.log(`[little-india] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
