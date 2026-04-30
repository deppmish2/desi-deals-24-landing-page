#!/usr/bin/env node
"use strict";

const db = require("../server/db");
const { crawlShopifyFullCatalog } = require("../crawler/shopify-full-catalog");
const { crawlWooCommerceFullCatalog } = require("../crawler/woocommerce-full-catalog");
const { rebuildAll } = require("../crawler/fts-rebuild");

const INTER_STORE_DELAY_MS = 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function upsertRows(rows, runId) {
  for (const r of rows) {
    await db.prepare(`
      INSERT INTO store_products
        (id, store_id, crawl_run_id, crawl_timestamp, product_name, product_category,
         product_url, image_url, sale_price, original_price, discount_percent,
         currency, is_active, is_on_deal, crawl_mode, external_product_id, availability)
      VALUES (?,?,?,datetime('now'),?,?,?,?,?,?,?,?,1,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        sale_price = excluded.sale_price,
        original_price = excluded.original_price,
        is_on_deal = excluded.is_on_deal,
        is_active = 1,
        crawl_mode = 'catalog'
    `).run(
      r.id, r.store_id, runId, r.product_name, r.product_category,
      r.product_url, r.image_url, r.sale_price, r.original_price,
      r.discount_percent, r.currency, r.is_on_deal, r.crawl_mode,
      r.external_product_id, r.availability
    );
  }
}

(async () => {
  await new Promise(r => setTimeout(r, 2000));

  const stores = await db.prepare(
    "SELECT id, url, platform FROM stores WHERE platform IN ('shopify','woocommerce') ORDER BY platform, id"
  ).all();

  console.log(`[mode2] crawling ${stores.length} stores`);

  const runId = "mode2_" + Date.now();

  for (const store of stores) {
    console.log(`[mode2] ${store.id} (${store.platform})`);

    const state = await db.prepare(
      "SELECT catalog_cursor FROM store_crawl_state WHERE store_id = ?"
    ).get(store.id);

    let result;
    if (store.platform === "shopify") {
      result = await crawlShopifyFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor || null
      );
    } else {
      result = await crawlWooCommerceFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor ? parseInt(state.catalog_cursor, 10) : 1
      );
    }

    if (result.rows.length) {
      await upsertRows(result.rows, runId);
    }

    await db.prepare(`
      INSERT INTO store_crawl_state (store_id, last_catalog_crawl, crawl_status, updated_at)
      VALUES (?, datetime('now'), ?, datetime('now'))
      ON CONFLICT(store_id) DO UPDATE SET
        last_catalog_crawl = datetime('now'),
        crawl_status = excluded.crawl_status,
        catalog_cursor = NULL,
        error_message = ?,
        updated_at = datetime('now')
    `).run(
      store.id,
      result.error ? "error" : "idle",
      result.error || null
    );

    console.log(`[mode2] ${store.id}: ${result.rows.length} products, ${result.error || "ok"}`);
    await sleep(INTER_STORE_DELAY_MS);
  }

  await rebuildAll();
  console.log("[mode2] done");
  process.exit(0);
})().catch(err => {
  console.error("[mode2] fatal:", err);
  process.exit(1);
});
