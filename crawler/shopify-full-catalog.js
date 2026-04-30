"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");

const DELAY_MS = 500;
const PAGE_SIZE = 250;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildShopifyProductRow(storeId, storeUrl, product) {
  const variant = product.variants[0] || {};
  const salePrice = parseFloat(variant.price) || 0;
  const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;
  const isOnDeal = compareAt && compareAt > salePrice ? 1 : 0;
  const discountPct = isOnDeal ? Math.round((1 - salePrice / compareAt) * 100) : null;
  const imageUrl = (product.images[0] || {}).src || null;
  const productUrl = `${storeUrl.replace(/\/$/, "")}/products/${product.handle}`;

  return {
    id: crypto.randomUUID(),
    store_id: storeId,
    product_name: product.title,
    product_category: "Other",
    product_url: productUrl,
    image_url: imageUrl,
    sale_price: salePrice,
    original_price: compareAt,
    discount_percent: discountPct,
    currency: "EUR",
    is_active: 1,
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
    external_product_id: String(product.id),
    availability: "in_stock",
  };
}

async function crawlShopifyFullCatalog({ storeId, storeUrl }, fromCursor = null) {
  const rows = [];
  let cursor = fromCursor;

  while (true) {
    const url = cursor
      ? `${storeUrl}/products.json?limit=${PAGE_SIZE}&page_info=${cursor}`
      : `${storeUrl}/products.json?limit=${PAGE_SIZE}`;

    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": "DesiDeals24/1.0" } });
    } catch (err) {
      return { rows, cursor, error: err.message };
    }

    if (!res.ok) {
      return { rows, cursor, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const products = data.products || [];

    for (const p of products) {
      rows.push(buildShopifyProductRow(storeId, storeUrl, p));
    }

    const link = res.headers.get("link") || "";
    const nextMatch = link.match(/<[^>]+page_info=([^>&"]+)[^>]*>;\s*rel="next"/);
    if (nextMatch) {
      cursor = nextMatch[1];
      await sleep(DELAY_MS);
    } else {
      cursor = null;
      break;
    }
  }

  return { rows, cursor: null, error: null };
}

module.exports = { crawlShopifyFullCatalog, buildShopifyProductRow };
