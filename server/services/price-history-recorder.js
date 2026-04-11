"use strict";
/**
 * price-history-recorder.js
 *
 * Snapshots current deal prices into deal_price_history after each crawl.
 * Extracted so the crawler and any future jobs can call it without duplicating
 * the INSERT logic.
 *
 * Requires: deal_price_history.is_deal column (added by setup-real-savings-local.js
 * locally, or by the production migration when deployed).
 */

const { randomUUID } = require("crypto");

/**
 * Record a set of deals into deal_price_history for the given crawl run.
 *
 * @param {object} db        - The db shim from server/db/index.js
 * @param {object} opts
 * @param {string} opts.crawlRunId
 * @param {string} opts.crawlDate       - YYYY-MM-DD
 * @param {string} opts.crawlTimestamp  - ISO datetime string
 * @param {string} opts.storeId
 * @param {Array}  opts.deals           - Normalised deal objects
 * @returns {Promise<number>}           - Number of rows written
 */
async function recordStoreHistory(db, { crawlRunId, crawlDate, crawlTimestamp, storeId, deals }) {
  if (!Array.isArray(deals) || deals.length === 0) return 0;

  // Replace today's history for this store (same behaviour as crawler's existing logic)
  await db.execute(
    `DELETE FROM deal_price_history WHERE crawl_date = ? AND store_id = ?`,
    [crawlDate, storeId],
  );

  let written = 0;
  for (const deal of deals) {
    const price = deal.sale_price ?? deal.current_price;
    if (price == null) continue;

    const isDeal =
      deal.is_deal != null
        ? deal.is_deal
        : deal.original_price && deal.original_price > price
          ? 1
          : 0;

    try {
      await db.execute(
        `INSERT OR IGNORE INTO deal_price_history
           (id, crawl_date, crawl_run_id, crawl_timestamp, store_id,
            product_name, product_category, product_url, image_url,
            weight_raw, weight_value, weight_unit,
            sale_price, original_price, discount_percent,
            price_per_kg, price_per_unit, currency, availability,
            bulk_pricing, best_before, is_deal)
         VALUES
           (?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?)`,
        [
          randomUUID(),
          crawlDate,
          crawlRunId,
          crawlTimestamp,
          storeId,
          deal.product_name ?? null,
          deal.product_category ?? null,
          deal.product_url ?? null,
          deal.image_url ?? null,
          deal.weight_raw ?? null,
          deal.weight_value ?? null,
          deal.weight_unit ?? null,
          price,
          deal.original_price ?? null,
          deal.discount_percent ?? null,
          deal.price_per_kg ?? null,
          deal.price_per_unit ?? null,
          deal.currency ?? "EUR",
          deal.availability ?? "unknown",
          deal.bulk_pricing ? JSON.stringify(deal.bulk_pricing) : null,
          deal.best_before ?? null,
          isDeal,
        ],
      );
      written++;
    } catch (_) {
      // UNIQUE constraint (crawl_date, store_id, product_url) — skip duplicate
    }
  }

  return written;
}

/**
 * Purge price history older than maxDays (default 180).
 *
 * @param {object} db
 * @param {number} [maxDays=180]
 */
async function purgeOldHistory(db, maxDays = 180) {
  await db.execute(
    `DELETE FROM deal_price_history WHERE crawl_date < date('now', ?)`,
    [`-${maxDays} days`],
  );
}

module.exports = { recordStoreHistory, purgeOldHistory };
