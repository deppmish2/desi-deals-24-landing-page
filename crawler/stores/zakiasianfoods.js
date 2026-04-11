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
const { parseDiscountBadge } = require("../utils/discount-badge");

const STORE_ID = "zakiasianfoods";
const STORE_NAME = "Zaki Asian Foods";
const STORE_URL = "https://zakiasianfoods.de";
const SALE_URL = `${STORE_URL}/product-category/sale/`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

function pageUrl(page) {
  if (page === 1) return SALE_URL;
  return `${SALE_URL.replace(/\/+$/, "")}/page/${page}/`;
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

  $(".product").each((_, el) => {
    const $el = $(el);
    const link = $el.find(".product-body a, .product-header a").first();
    const productUrl = link.attr("href");
    const name = $el.find(".product-body h2").first().text().trim();
    const salePriceText =
      $el
        .find(
          ".offer-price ins .woocommerce-Price-amount bdi, .offer-price ins .woocommerce-Price-amount, .offer-price .woocommerce-Price-amount bdi, .offer-price .woocommerce-Price-amount",
        )
        .first()
        .text() || "";
    const origPriceText = $el
      .find(
        ".offer-price del .woocommerce-Price-amount bdi, .offer-price del .woocommerce-Price-amount, .offer-price del bdi",
      )
      .first()
      .text();

    const salePrice = parsePrice(salePriceText);
    const origPrice = parsePrice(origPriceText);
    if (!productUrl || !name || !salePrice) return;

    const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
    const discountPercent =
      calcDiscount(salePrice, originalPrice) ||
      parseDiscountBadge($el.find(".badge, .onsale").first().text());

    if (!originalPrice && !(discountPercent > 0)) {
      return;
    }

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
      availability: /out of stock/i.test($el.text())
        ? "out_of_stock"
        : "in_stock",
      bulk_pricing: null,
    });
  });

  return {
    deals,
    hasNextPage:
      $("a.next.page-numbers, .next.page-numbers a, .page-numbers .next")
        .length > 0,
  };
}

async function scrape() {
  const allDeals = [];
  const seen = new Set();
  const maxPages = getMaxPages(5);

  for (let page = 1; page <= maxPages; page += 1) {
    const url = pageUrl(page);
    console.log(`[${STORE_ID}] Fetching page ${page}: ${url}`);

    let html;
    try {
      // eslint-disable-next-line no-await-in-loop
      html = await fetchPage(url);
    } catch (error) {
      console.warn(`[${STORE_ID}] Fetch failed: ${error.message}`);
      break;
    }

    if (!html) break;

    const { deals, hasNextPage } = parseProductCards(html);
    for (const deal of deals) {
      if (seen.has(deal.product_url)) continue;
      seen.add(deal.product_url);
      allDeals.push(deal);
    }

    if (!hasNextPage) break;
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }

  console.log(`[${STORE_ID}] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
