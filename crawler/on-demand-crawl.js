"use strict";

const fetch = require("node-fetch");
const crypto = require("crypto");
const db = require("../server/db");
const { buildShopifyProductRow } = require("./shopify-full-catalog");
const { buildWooProductRow } = require("./woocommerce-full-catalog");

const CONFIDENCE_THRESHOLD = 80;
const MAX_CONCURRENT = 5;
const INTER_STORE_DELAY_MS = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildOnDemandSearchUrl(platform, storeUrl, baseKey) {
  const base = storeUrl.replace(/\/$/, "");
  const q = encodeURIComponent(baseKey);
  if (platform === "shopify") {
    return `${base}/search/suggest.json?q=${q}&resources[type]=product&resources[limit]=10`;
  }
  return `${base}/wp-json/wc/store/v1/products?search=${q}&per_page=10`;
}

async function searchStoreForCanonical(store, canonical) {
  const { id: storeId, url: storeUrl, platform } = store;
  const baseKey = canonical.base_key || canonical.canonical_name;

  const existing = await db.prepare(
    `SELECT id, sale_price, product_url FROM store_products
     WHERE store_id = ? AND canonical_id = ? AND is_active = 1 LIMIT 1`
  ).get(storeId, canonical.id);

  if (existing) {
    return { storeId, found: true, mode: "3a", price: existing.sale_price, productUrl: existing.product_url };
  }

  if (!["shopify", "woocommerce"].includes(platform)) {
    return { storeId, found: false, mode: "3b_unsupported" };
  }

  const searchUrl = buildOnDemandSearchUrl(platform, storeUrl, baseKey);
  let res;
  try {
    res = await fetch(searchUrl, { headers: { "User-Agent": "DesiDeals24/1.0" }, timeout: 10000 });
  } catch {
    return { storeId, found: false, mode: "3b_error" };
  }

  if (!res.ok) return { storeId, found: false, mode: "3b_error" };

  const data = await res.json();
  let products = [];
  if (platform === "shopify") {
    products = data?.resources?.results?.products || [];
  } else {
    products = Array.isArray(data) ? data : [];
  }

  if (products.length === 0) return { storeId, found: false, mode: "3b_not_found" };

  const first = products[0];
  const title = (first.title || first.name || "").toLowerCase();
  const tokens = baseKey.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const matched = tokens.filter(t => title.includes(t)).length;
  const confidence = tokens.length > 0 ? Math.round((matched / tokens.length) * 100) : 0;

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { storeId, found: false, mode: "3b_low_confidence", confidence };
  }

  const row = platform === "shopify"
    ? buildShopifyProductRow(storeId, storeUrl, first)
    : buildWooProductRow(storeId, first);

  row.crawl_mode = "on_demand";
  row.canonical_id = canonical.id;

  await db.prepare(
    `INSERT INTO store_products
      (id, store_id, crawl_run_id, crawl_timestamp, product_name, product_category,
       product_url, image_url, sale_price, original_price, discount_percent,
       currency, is_active, is_on_deal, crawl_mode, external_product_id, canonical_id, availability)
     VALUES (?,?,?,datetime('now'),?,?,?,?,?,?,?,?,1,?,?,?,?,?)
     ON CONFLICT(id) DO NOTHING`
  ).run(
    row.id, row.store_id, "on_demand_" + Date.now(),
    row.product_name, row.product_category, row.product_url,
    row.image_url, row.sale_price, row.original_price, row.discount_percent,
    row.currency, row.is_on_deal, row.crawl_mode,
    row.external_product_id, row.canonical_id, row.availability
  );

  return { storeId, found: true, mode: "3b", price: row.sale_price, productUrl: row.product_url };
}

async function runOnDemandCrawl(canonicalId, pendingRowId) {
  const canonical = await db.prepare(
    "SELECT id, canonical_name, base_key FROM canonical_products WHERE id = ?"
  ).get(canonicalId);

  if (!canonical) {
    await db.prepare("DELETE FROM pending_on_demand_crawls WHERE id = ?").run(pendingRowId);
    return;
  }

  const stores = await db.prepare(
    "SELECT id, url, platform FROM stores WHERE platform IN ('shopify','woocommerce') ORDER BY id"
  ).all();

  for (let i = 0; i < stores.length; i += MAX_CONCURRENT) {
    const batch = stores.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(s => searchStoreForCanonical(s, canonical)));
    if (i + MAX_CONCURRENT < stores.length) {
      await sleep(INTER_STORE_DELAY_MS);
    }
  }

  await db.prepare("DELETE FROM pending_on_demand_crawls WHERE id = ?").run(pendingRowId);
}

async function drainPendingCrawls() {
  const pending = await db.prepare(
    "SELECT id, canonical_id FROM pending_on_demand_crawls WHERE started_at IS NULL"
  ).all();

  for (const row of pending) {
    await db.prepare(
      "UPDATE pending_on_demand_crawls SET started_at = datetime('now') WHERE id = ?"
    ).run(row.id);
    runOnDemandCrawl(row.canonical_id, row.id).catch(() => {});
  }
}

module.exports = { runOnDemandCrawl, drainPendingCrawls, buildOnDemandSearchUrl };
