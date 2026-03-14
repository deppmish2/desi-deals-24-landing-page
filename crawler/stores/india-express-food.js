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

const STORE_ID = "india-express-food";
const STORE_NAME = "India Express Food";
const STORE_URL = "https://www.india-express-food.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const SALE_BASE_URL = `${STORE_URL}/sale/`;

function pageUrl(base, page) {
  if (page === 1) return base;
  const clean = base.split("?")[0];
  return `${clean}?p=${page}`;
}

function parseCard($, el) {
  const $el = $(el);

  // Shopware: full product name is in the title attribute of a.product--title
  const $titleLink = $el.find("a.product--title").first();
  const name = $titleLink.attr("title")?.trim() || $titleLink.text().trim();
  if (!name) return null;

  // Product URL
  const href =
    $titleLink.attr("href") ||
    $el.find("a.product--image").first().attr("href") ||
    "";
  const productUrl = href.startsWith("http") ? href : STORE_URL + href;

  // Shopware price: ".price--default" contains e.g. "11,99\xa0€ *"
  const priceText = $el.find(".price--default").first().text().trim();
  const salePrice = parsePrice(priceText);
  if (!salePrice) return null;

  // Shopware sale pages don't show original price in static HTML
  const originalPrice = null;
  const discountPercent = null;

  // Image: first srcset entry
  const $img = $el.find("img").first();
  const imageUrl = resolveImage($img, STORE_URL);

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

async function scrape() {
  const allDeals = [];
  const seen = new Set();
  const maxPages = getMaxPages(5);
  const ignoreRe =
    /^\/(hilfe|checkout|index|amazonpay|offamazonpayments|frontend|plugins|views|css|media|engine|controllername|getcategory|lpa)\/?$/i;
  const baseCandidates = await discoverLinksByPatterns({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    patterns: [/^\/[a-z0-9-]+\/$/i, /\/sale\//i],
    fallback: [SALE_BASE_URL],
  });
  const baseUrls = baseCandidates.filter((candidate) => {
    const pathname = new URL(candidate).pathname;
    return !ignoreRe.test(pathname);
  });

  for (const baseUrl of baseUrls) {
    for (let page = 1; page <= maxPages; page++) {
      const url = pageUrl(baseUrl, page);
      console.log(`[india-express-food] Fetching page ${page}: ${url}`);
      let html;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "text/html" },
          timeout: 30000,
        });
        if (!res.ok) {
          console.warn(
            `[india-express-food] HTTP ${res.status} for page ${page}`,
          );
          break;
        }
        html = await res.text();
      } catch (e) {
        console.warn(`[india-express-food] Page ${page} failed: ${e.message}`);
        break;
      }

      const $ = cheerio.load(html);
      const cards = $(".product--box");

      if (cards.length === 0) {
        console.warn(
          `[india-express-food] No product cards on page ${page} — stopping pagination`,
        );
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

      console.log(`[india-express-food] Page ${page}: ${pageDeals} deals`);

      // Shopware doesn't always have a reliable next-page indicator in static HTML,
      // so stop when a page returns no results.
      if (pageDeals === 0) break;

      if (page < maxPages) {
        await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));
      }
    }
  }

  console.log(`[india-express-food] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
