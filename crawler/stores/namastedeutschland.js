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

const STORE_ID = "namastedeutschland";
const STORE_NAME = "Namaste Deutschland";
const STORE_URL = "https://www.namastedeutschland.de";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

const DEAL_URL = `${STORE_URL}/shop/category/special-sale-585`;
const SHOP_URL = `${STORE_URL}/shop`;

function pageUrl(base, page) {
  if (page === 1) return base;
  return `${base.replace(/\/+$/, "")}/page/${page}`;
}

// Odoo product grid card selectors in priority order
const CARD_SELECTORS = [
  ".o_wsale_product_grid_item",
  ".oe_product_cart",
  "article.o_product_item",
  ".oe_product",
  '[itemtype*="Product"]',
  ".product_price",
  ".card.o_wsale",
];

// Name selectors in priority order
const NAME_SELECTORS = [
  "h6 a",
  ".o_wsale_product_information h6",
  "h5.card-title",
  ".oe_product_name",
];

// Price selectors in priority order
const PRICE_SELECTORS = [
  ".oe_currency_value",
  ".product_price .currency",
  '[itemprop="price"]',
];

function findProductCards($) {
  for (const sel of CARD_SELECTORS) {
    const found = $(sel);
    if (found.length > 0) {
      console.log(
        `[namastedeutschland] Using selector: ${sel} (${found.length} items)`,
      );
      return found;
    }
  }
  // Last resort: any element with a price-like text and an image
  const els = $("*").filter((_, el) => {
    const text = $(el).text();
    return (
      /€\s*\d/.test(text) &&
      $(el).find("img").length > 0 &&
      $(el).children().length >= 2
    );
  });
  if (els.length > 0)
    console.log(
      `[namastedeutschland] Using price+img heuristic (${els.length} items)`,
    );
  return els;
}

function extractName($el) {
  for (const sel of NAME_SELECTORS) {
    const text = $el.find(sel).first().text().trim();
    if (text) return text;
  }
  return "";
}

function extractPrices($, $el) {
  // Try dedicated price selectors first
  for (const sel of PRICE_SELECTORS) {
    const nodes = $el.find(sel);
    if (nodes.length > 0) {
      const prices = [];
      nodes.each((_, n) => {
        const p = parsePrice($(n).text().trim());
        if (p && p > 0) prices.push(p);
      });
      if (prices.length > 0) return prices.sort((a, b) => a - b);
    }
  }
  // Fallback: leaf nodes containing €
  const priceTexts = [];
  $el.find("*").each((_, child) => {
    const text = $(child).text().trim();
    if (/€/.test(text) && $(child).children().length === 0)
      priceTexts.push(text);
  });
  return priceTexts
    .map((t) => parsePrice(t))
    .filter((p) => p !== null && p > 0)
    .sort((a, b) => a - b);
}

function parseCard($, el) {
  const $el = $(el);

  const name = extractName($el);
  if (!name) return null;

  // Product URL — first <a> href in the card
  const href = $el.find("a").first().attr("href") || null;
  const productUrl = href
    ? href.startsWith("http")
      ? href
      : STORE_URL + href
    : STORE_URL;

  const prices = extractPrices($, $el);
  if (prices.length === 0) return null;

  const salePrice = prices[0];
  const originalPrice = prices.length > 1 ? prices[prices.length - 1] : null;
  const discountPercent = calcDiscount(salePrice, originalPrice);

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
  const baseUrls = await discoverLinksByPatterns({
    storeId: STORE_ID,
    storeUrl: STORE_URL,
    ua: UA,
    patterns: [/\/shop\/category\//i],
    fallback: [DEAL_URL, SHOP_URL],
    extraSeedUrls: [SHOP_URL],
  });

  for (const baseUrl of baseUrls) {
    for (let page = 1; page <= maxPages; page++) {
      const url = pageUrl(baseUrl, page);
      console.log(`[namastedeutschland] Fetching page ${page}: ${url}`);
      let html;
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, Accept: "text/html" },
          timeout: 30000,
        });
        if (!res.ok) {
          console.warn(`[namastedeutschland] HTTP ${res.status}`);
          break;
        }
        html = await res.text();
      } catch (e) {
        console.warn(`[namastedeutschland] Fetch failed: ${e.message}`);
        break;
      }

      const $ = cheerio.load(html);
      const cards = findProductCards($);

      if (cards.length === 0) {
        if (page === 1) {
          console.warn(
            `[namastedeutschland] No product cards found — selectors may need updating`,
          );
        }
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

      const hasNext =
        $("a[rel='next'], .pagination .next a, .pagination a.next").length > 0;
      if (!hasNext) break;

      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1500));
    }
  }

  console.log(`[namastedeutschland] Total: ${allDeals.length} deals`);
  return allDeals;
}

module.exports = {
  storeId: STORE_ID,
  storeName: STORE_NAME,
  storeUrl: STORE_URL,
  scrape,
};
