"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");

const DELAY_MS = 500;
const PAGE_SIZE = 100;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function buildWooProductRow(storeId, product) {
  const minorUnit = product.prices?.currency_minor_unit ?? 2;
  const divisor = Math.pow(10, minorUnit);
  const salePrice = parseInt(product.prices?.sale_price || product.prices?.price || "0", 10) / divisor;
  const regularPrice = parseInt(product.prices?.regular_price || "0", 10) / divisor;
  const isOnDeal = salePrice < regularPrice ? 1 : 0;
  const discountPct = isOnDeal ? Math.round((1 - salePrice / regularPrice) * 100) : null;
  const imageUrl = (product.images?.[0] || {}).src || null;

  return {
    id: crypto.randomUUID(),
    store_id: storeId,
    product_name: product.name,
    product_category: "Other",
    product_url: product.permalink,
    image_url: imageUrl,
    sale_price: salePrice,
    original_price: isOnDeal ? regularPrice : null,
    discount_percent: discountPct,
    currency: "EUR",
    is_active: 1,
    is_on_deal: isOnDeal,
    crawl_mode: "catalog",
    external_product_id: String(product.id),
    availability: "in_stock",
  };
}

async function crawlWooCommerceFullCatalog({ storeId, storeUrl }, fromPage = 1) {
  const rows = [];
  let page = fromPage;

  while (true) {
    const url = `${storeUrl}/wp-json/wc/store/v1/products?per_page=${PAGE_SIZE}&page=${page}`;

    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": "DesiDeals24/1.0" } });
    } catch (err) {
      return { rows, page, error: err.message, needsSitemapFallback: false };
    }

    if (res.status === 404) {
      return { rows, page, error: "wc/store/v1 unavailable", needsSitemapFallback: true };
    }

    if (!res.ok) {
      return { rows, page, error: `HTTP ${res.status}`, needsSitemapFallback: false };
    }

    const products = await res.json();
    if (!Array.isArray(products) || products.length === 0) break;

    for (const p of products) {
      rows.push(buildWooProductRow(storeId, p));
    }

    if (products.length < PAGE_SIZE) break;
    page += 1;
    await sleep(DELAY_MS);
  }

  return { rows, page: null, error: null, needsSitemapFallback: false };
}

module.exports = { crawlWooCommerceFullCatalog, buildWooProductRow };
