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

const STORE_ID = "india-store";
const STORE_NAME = "India Store";
const STORE_URL = "https://www.india-store.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const DEAL_URL = `${STORE_URL}/deals-offers/angebote/`;

function parseCard($, el) {
  const $el = $(el);

  // XONIC platform: name and URL from a.card-title
  const $titleLink = $el.find("a.card-title").first();
  const name = $titleLink.text().trim();
  if (!name) return null;

  // Strip session xoid param from URL
  const rawHref = $titleLink.attr("href") || "";
  const productUrl = rawHref ? rawHref.replace(/\?xoid=[^&]*/, "") : STORE_URL;

  // Skip music / entertainment products (Bollywood DVDs, CDs, films)
  if (/\/bollywood\//i.test(productUrl)) return null;

  // XONIC price format: "7,99EUR" (German comma decimal, EUR suffix, no € symbol)
  const salePriceText = $el.find(".xo-has-special-price").first().text().trim();
  const origPriceText = $el.find(".oldprice").first().text().trim();

  const salePrice = parsePrice(salePriceText);
  if (!salePrice) return null;

  const origPrice = parsePrice(origPriceText);
  const originalPrice = origPrice && origPrice > salePrice ? origPrice : null;
  const discountPercent = calcDiscount(salePrice, originalPrice);

  // Image: data-src is a relative path — prepend STORE_URL
  const dataSrc = $el.find("img.lazy").first().attr("data-src") || "";
  const imageUrl = dataSrc
    ? dataSrc.startsWith("http")
      ? dataSrc
      : `${STORE_URL}/${dataSrc}`
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
    original_price: originalPrice,
    discount_percent: discountPercent,
    price_per_kg: pricePerKg,
    price_per_unit: null,
    currency: "EUR",
    availability: "unknown",
    bulk_pricing: null,
  };
}

function pageUrl(base, page) {
  return page === 1 ? base : `${base}?page=${page}`;
}

async function scrape() {
  const allDeals = [];
  const seen = new Set();
  const maxPages = getMaxPages(20);
  const baseUrls = await discoverLinksByPatterns({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    patterns: [/\/deals-offers\//i, /\/lebensmittel\//i],
    fallback: [DEAL_URL],
  });

  for (const baseUrl of baseUrls) {
    for (let page = 1; page <= maxPages; page++) {
      const url = pageUrl(baseUrl, page);
      console.log(`[india-store] Fetching page ${page}: ${url}`);
      let html;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "text/html" },
          timeout: 30000,
        });
        if (!res.ok) {
          console.warn(`[india-store] HTTP ${res.status} for page ${page}`);
          break;
        }
        html = await res.text();
      } catch (e) {
        console.warn(`[india-store] Page ${page} failed: ${e.message}`);
        break;
      }

      const $ = cheerio.load(html);
      const cards = $("article.product");

      if (cards.length === 0) {
        console.log(`[india-store] No cards on page ${page} — stopping`);
        break;
      }

      let pageDeals = 0;
      cards.each((_, el) => {
        const deal = parseCard($, el);
        if (!deal) return;
        if (seen.has(deal.product_url)) return;
        seen.add(deal.product_url);
        allDeals.push(deal);
        pageDeals++;
      });
      console.log(`[india-store] Page ${page}: ${pageDeals} deals`);

      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
      }
    }
  }

  console.log(`[india-store] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
