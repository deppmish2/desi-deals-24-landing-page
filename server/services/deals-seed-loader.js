"use strict";

const path = require("path");

const DEFAULT_SEED_PATH = path.join(__dirname, "..", "deals-seed.json");

function readDealsSeed(seedPath = DEFAULT_SEED_PATH) {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const deals = require(seedPath);
    if (!Array.isArray(deals)) return [];
    return deals;
  } catch {
    return [];
  }
}

function restoreDealsFromSeed(db, options = {}) {
  const seedPath = options.seedPath || DEFAULT_SEED_PATH;
  const deals = readDealsSeed(seedPath);
  if (!Array.isArray(deals) || deals.length === 0) {
    return { ok: false, reason: "empty_seed" };
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, image_url, weight_raw, weight_value, weight_unit,
       sale_price, original_price, discount_percent, price_per_kg, price_per_unit,
       currency, availability, bulk_pricing, best_before, is_active, created_at)
    VALUES
      (@id, @crawl_run_id, @crawl_timestamp, @store_id, @product_name, @product_category,
       @product_url, @image_url, @weight_raw, @weight_value, @weight_unit,
       @sale_price, @original_price, @discount_percent, @price_per_kg, @price_per_unit,
       @currency, @availability, @bulk_pricing, @best_before, @is_active, @created_at)
  `);

  const writeRows = (items) => {
    for (const row of items) {
      insert.run(row);
    }
  };

  if (typeof db.transaction === "function") {
    db.transaction(writeRows)(deals);
  } else {
    writeRows(deals);
  }

  const activeDeals =
    db.prepare("SELECT COUNT(*) AS n FROM deals WHERE is_active = 1").get()
      ?.n || 0;

  return {
    ok: activeDeals > 0,
    reason: activeDeals > 0 ? "loaded" : "no_active_deals",
    loadedRows: deals.length,
    activeDeals,
  };
}

module.exports = {
  restoreDealsFromSeed,
};
