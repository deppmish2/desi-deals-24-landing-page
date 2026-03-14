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
const { getMaxPages } = require("../utils/crawl-scope");
const { discoverLinksByPatterns } = require("../utils/link-discovery");

const STORE_ID = "annachi";
const STORE_NAME = "Annachi Europe";
const STORE_URL = "https://annachi.fr";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

// Single-page offers URL (Elementor shortcode — loads all products)
const OFFERS_URL = `${STORE_URL}/annachi-offers/`;

// Short-date category — append ?per_page=-1 to load all at once (infinite scroll theme)
const SHORT_DATE_URL = `${STORE_URL}/categorie-produit/short-date/?per_page=-1`;

function pageUrl(base, page) {
  if (page === 1) return base;
  const clean = base.split("?")[0].replace(/\/+$/, "");
  return `${clean}/page/${page}/`;
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7",
    },
    timeout: 30000,
  });
  if (!res.ok) return null;
  return res.text();
}

function parseProductCards(html) {
  const $ = cheerio.load(html);
  const deals = [];

  // Woodmart theme uses .product-grid-item for each card
  $(".product-grid-item").each((_, el) => {
    const $el = $(el);

    // Title and URL from Woodmart's wd-entities-title
    const $titleLink = $el.find("h3.wd-entities-title a").first();
    const name = $titleLink.text().trim();
    const productUrl = $titleLink.attr("href");

    if (!name || !productUrl) return;

    // Prices: Woodmart wraps sale items in <del>/<ins> inside .price
    const salePriceText = $el
      .find(".price ins .woocommerce-Price-amount bdi")
      .first()
      .text()
      .trim();
    const origPriceText = $el
      .find(".price del .woocommerce-Price-amount bdi")
      .first()
      .text()
      .trim();
    // Non-sale: price is a direct .woocommerce-Price-amount (no del/ins)
    const regularText = $el
      .find(".price .woocommerce-Price-amount bdi")
      .first()
      .text()
      .trim();

    const activePriceText = salePriceText || regularText;
    const salePrice = parsePrice(activePriceText);
    const origPrice = salePriceText ? parsePrice(origPriceText) : null;

    if (!salePrice) return;

    const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
    const discountPercent = calcDiscount(salePrice, originalPrice);

    // Woodmart uses lazy loading: real image is in data-src, src is a placeholder SVG
    const $img = $el.find(".product-image-link img").first();
    const imageUrl = $img.attr("data-src") || $img.attr("src") || null;

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

  return deals;
}

async function scrape() {
  const allDeals = [];
  const seen = new Set();
  const maxPages = getMaxPages(5);
  const baseUrls = await discoverLinksByPatterns({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    patterns: [/\/categorie-produit\//i, /\/product-category\//i],
    fallback: [OFFERS_URL, SHORT_DATE_URL],
    extraSeedUrls: [`${STORE_URL}/shop/`],
  });

  function addDeals(deals) {
    for (const d of deals) {
      if (!seen.has(d.product_url)) {
        seen.add(d.product_url);
        allDeals.push(d);
      }
    }
  }

  for (const baseUrl of baseUrls) {
    const singlePageOnly =
      /annachi-offers/i.test(baseUrl) || /\?per_page=-1/i.test(baseUrl);
    const pageLimit = singlePageOnly ? 1 : maxPages;

    for (let page = 1; page <= pageLimit; page++) {
      const url = pageUrl(baseUrl, page);
      console.log(`[annachi] Fetching page ${page}: ${url}`);

      try {
        const html = await fetchPage(url);
        if (!html) break;

        const deals = parseProductCards(html);
        addDeals(deals);
        console.log(`[annachi] ${baseUrl} page ${page}: ${deals.length} deals`);

        if (deals.length === 0) break;
      } catch (e) {
        console.warn(`[annachi] Fetch failed for ${url}: ${e.message}`);
        break;
      }

      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
    }
  }

  console.log(`[annachi] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
