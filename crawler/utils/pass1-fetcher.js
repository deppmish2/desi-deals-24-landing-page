"use strict";
/**
 * pass1-fetcher.js
 *
 * Pass 1 of the two-pass crawler.
 *
 * For every is_priority = 1 canonical product that has at least one entry
 * in deal_mappings, fetches the current price from the product's stored URL —
 * regardless of whether it's currently on sale.
 *
 * Platform detection:
 *   Shopify  — appends .json to product URL, parses variants[0].price
 *   WooCommerce / custom — Cheerio scrapes .price / [class*="price"]
 *
 * Returns an array of price-snapshot objects ready for price-history-recorder.
 */

const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { v4: uuidv4 } = require("uuid");

const PASS1_DELAY_MS = 200; // polite delay between fetches

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** True if the URL looks like a Shopify product page */
function isShopifyUrl(url) {
  return /\/products\/[^/?#]+/.test(url);
}

/** Fetch current price from a Shopify product JSON endpoint */
async function fetchShopifyPrice(productUrl) {
  const jsonUrl = productUrl.replace(/\?.*$/, "").replace(/\/$/, "") + ".json";
  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": "DesiDeals24-PriceBot/1.0" },
    timeout: 10000,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const variant = data?.product?.variants?.[0];
  if (!variant) return null;
  const price = parseFloat(variant.price);
  return Number.isFinite(price) ? price : null;
}

/** Parse a price string like "€3.99" or "3,99 €" → number */
function parseHtmlPrice(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/[€$£]/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const num = parseFloat(cleaned);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** Fetch current price by scraping the product page HTML */
async function fetchHtmlPrice(productUrl) {
  const res = await fetch(productUrl, {
    headers: { "User-Agent": "DesiDeals24-PriceBot/1.0" },
    timeout: 12000,
  });
  if (!res.ok) return null;
  const html = await res.text();
  const $ = cheerio.load(html);

  // Try common price selectors in priority order
  const selectors = [
    ".price--sale .price__current",
    ".price__sale .price-item--sale",
    ".price__regular .price-item--regular",
    ".woocommerce-Price-amount",
    "[class*='price'][class*='sale']",
    "[class*='current-price']",
    "[class*='product-price']",
    "[itemprop='price']",
    ".price",
  ];

  for (const sel of selectors) {
    const text = $(sel).first().text().trim();
    const price = parseHtmlPrice(text);
    if (price) return price;
  }

  // Last resort: look for JSON-LD
  const jsonLd = $('script[type="application/ld+json"]').first().text();
  if (jsonLd) {
    try {
      const data = JSON.parse(jsonLd);
      const offers = data?.offers ?? data?.["@graph"]?.[0]?.offers;
      const offerPrice = Array.isArray(offers) ? offers[0]?.price : offers?.price;
      if (offerPrice) {
        const p = parseFloat(offerPrice);
        if (Number.isFinite(p) && p > 0) return p;
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Run Pass 1: fetch non-deal prices for all mapped priority products.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.crawlRunId
 * @param {string} opts.crawlDate        - YYYY-MM-DD
 * @param {string} opts.crawlTimestamp   - ISO datetime
 * @param {Function} opts.logInfo
 * @param {Function} opts.logWarn
 * @returns {Promise<Array>}  - Array of price-snapshot objects (for price-history-recorder)
 */
async function runPass1(db, { crawlRunId, crawlDate, crawlTimestamp, logInfo, logWarn }) {
  // Load all deal_mappings for priority products
  let mappings;
  try {
    const res = await db.execute(
      `SELECT dm.deal_id, dm.canonical_id, d.product_url, d.product_name,
              d.product_category, d.store_id, d.weight_raw, d.weight_value,
              d.weight_unit, d.currency
       FROM deal_mappings dm
       JOIN deals d ON d.id = dm.deal_id
       JOIN canonical_products cp ON cp.id = dm.canonical_id
       WHERE cp.is_priority = 1
         AND d.product_url IS NOT NULL`,
    );
    mappings = res.rows ?? [];
  } catch (e) {
    if (/no such (table|column)/i.test(e.message)) {
      logWarn("pass1", "Skipping Pass 1 — deal_mappings or is_priority not ready");
      return [];
    }
    throw e;
  }

  if (mappings.length === 0) {
    logInfo("pass1", "Pass 1: no priority product mappings found — skipping");
    return [];
  }

  logInfo("pass1", `Pass 1: fetching non-deal prices for ${mappings.length} mapped products`);

  const snapshots = [];
  let fetched = 0;
  let failed = 0;

  for (const row of mappings) {
    await sleep(PASS1_DELAY_MS);
    try {
      const price = isShopifyUrl(row.product_url)
        ? await fetchShopifyPrice(row.product_url)
        : await fetchHtmlPrice(row.product_url);

      if (price == null) {
        failed++;
        continue;
      }

      snapshots.push({
        id: uuidv4(),
        crawl_run_id: crawlRunId,
        crawl_timestamp: crawlTimestamp,
        store_id: row.store_id,
        product_name: row.product_name,
        product_category: row.product_category,
        product_url: row.product_url,
        weight_raw: row.weight_raw,
        weight_value: row.weight_value,
        weight_unit: row.weight_unit,
        sale_price: price,
        original_price: null,
        discount_percent: null,
        price_per_kg: null,
        price_per_unit: null,
        currency: row.currency || "EUR",
        availability: "unknown",
        bulk_pricing: null,
        best_before: null,
        is_deal: 0,
      });
      fetched++;
    } catch (e) {
      failed++;
      logWarn("pass1", `Failed to fetch price for ${row.product_url}: ${e.message}`);
    }
  }

  logInfo("pass1", `Pass 1 complete: ${fetched} fetched, ${failed} failed`);
  return snapshots;
}

module.exports = { runPass1 };
