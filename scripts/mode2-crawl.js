#!/usr/bin/env node
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { crawlShopifyFullCatalog } = require("../crawler/shopify-full-catalog");
const { crawlWooCommerceFullCatalog } = require("../crawler/woocommerce-full-catalog");
const { rebuildAll } = require("../crawler/fts-rebuild");
const { getZonedParts, BERLIN_TIME_ZONE } = require("../server/services/berlin-time");

const INTER_STORE_DELAY_MS = 1000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Day 0 = Sunday, 1 = Monday, ..., 6 = Saturday
const DAY_GROUPS = {
  0: ["anuhita-groceries", "zora-supermarkt"],
  1: ["dookan", "sairas"],
  2: ["globalfoodhub", "md-store"],
  3: ["indiansupermarkt", "bajwa-shop"],
  4: ["namma-markt", "indianspicebasket"],
  5: ["jamoona", "transfoodlev"],
  6: ["desigros", "villagefoods"],
};

function getBerlinWeekday() {
  const parts = getZonedParts(new Date(), BERLIN_TIME_ZONE);
  const berlinDate = new Date(`${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T12:00:00`);
  return berlinDate.getDay();
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes("--all")) return { mode: "all" };
  const dayIdx = args.indexOf("--day");
  if (dayIdx !== -1 && args[dayIdx + 1] != null) {
    const day = parseInt(args[dayIdx + 1], 10);
    if (day >= 0 && day <= 6) return { mode: "day", day };
    console.error("Error: --day must be 0-6");
    process.exit(1);
  }
  return { mode: "day", day: getBerlinWeekday() };
}

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

  const opts = parseArgs();
  let storeIds;

  if (opts.mode === "all") {
    storeIds = Object.values(DAY_GROUPS).flat();
    console.log(`[mode2] --all: crawling all ${storeIds.length} stores`);
  } else {
    storeIds = DAY_GROUPS[opts.day] || [];
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    console.log(`[mode2] day=${opts.day} (${dayNames[opts.day]}): crawling ${storeIds.length} stores: ${storeIds.join(", ")}`);
  }

  if (storeIds.length === 0) {
    console.log("[mode2] no stores for today, exiting");
    process.exit(0);
  }

  const placeholders = storeIds.map(() => "?").join(",");
  const stores = await db.prepare(
    `SELECT id, url, platform FROM stores WHERE id IN (${placeholders}) ORDER BY id`
  ).all(...storeIds);

  if (stores.length === 0) {
    console.log("[mode2] no matching stores found in DB (check stores.platform or store IDs)");
    process.exit(0);
  }

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
    } else if (store.platform === "woocommerce") {
      result = await crawlWooCommerceFullCatalog(
        { storeId: store.id, storeUrl: store.url },
        state?.catalog_cursor ? parseInt(state.catalog_cursor, 10) : 1
      );
    } else {
      console.log(`[mode2] ${store.id}: skipping (platform=${store.platform}, no catalog crawler)`);
      continue;
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

    if (stores.indexOf(store) < stores.length - 1) {
      await sleep(INTER_STORE_DELAY_MS);
    }
  }

  await rebuildAll();
  console.log("[mode2] done");
  process.exit(0);
})().catch(err => {
  console.error("[mode2] fatal:", err);
  process.exit(1);
});
