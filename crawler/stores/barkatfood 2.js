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
const { parseDiscountBadge } = require("../utils/discount-badge");

const STORE_ID = "barkatfood";
const STORE_NAME = "Barkat Food";
const STORE_URL = "https://barkatfood.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

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

  const productEls = $(
    "li.product, div.product, .product-grid-item, .wd-product, .products .product",
  );

  productEls.each((_, el) => {
    const $el = $(el);
    const link = $el
      .find(
        "a.wd-product-img-link, a.product-image-link, .wd-entities-title a, a.woocommerce-LoopProduct-link, h2 a, h3 a",
      )
      .first();
    const productUrl = link.attr("href") || $el.find("a").first().attr("href");
    const name = $el
      .find(
        ".wd-entities-title, .woocommerce-loop-product__title, .product-title, h2, h3",
      )
      .first()
      .text()
      .trim();

    if (!name || !productUrl) return;

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
    if (!salePrice) return;

    const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
    const badgeDiscount = parseDiscountBadge(
      $el.find(".onsale, .badge, .product-label").first().text(),
    );
    const discountPercent =
      calcDiscount(salePrice, originalPrice) || badgeDiscount;

    if (!originalPrice && !(discountPercent > 0)) {
      return;
    }

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
      availability:
        $el.hasClass("outofstock") || $el.find(".out-of-stock").length
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
  const baseUrls = await discoverLinksByPatterns({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    patterns: [/\/product-category\//i],
    fallback: [STORE_URL],
    extraSeedUrls: [`${STORE_URL}/shop/`],
  });

  for (const baseUrl of baseUrls) {
    for (let page = 1; page <= maxPages; page += 1) {
      const url = pageUrl(baseUrl, page);
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
