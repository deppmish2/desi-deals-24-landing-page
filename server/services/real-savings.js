"use strict";
/**
 * real-savings.js
 *
 * Computes a "Real Savings" rating for a deal, answering:
 * "How good is this discount compared to what this product normally costs?"
 *
 * Two evidence layers (used in priority order):
 *   Layer 1 — Historical median: median sale_price for this product_url
 *             over the last 90 days in deal_price_history (non-deal rows only).
 *   Layer 2 — Stated original_price: the original_price field from the deal
 *             itself (store-reported, less reliable).
 *
 * Returns null if there is insufficient evidence to compute a meaningful rating.
 *
 * Requires deal_price_history.is_deal column (added by setup-real-savings-local.js
 * locally, or by the production migration when deployed).
 */

/** @param {number[]} values */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Batch-fetch Real Savings data for a page of deals.
 *
 * @param {object}   db          - The db shim from server/db/index.js
 * @param {string[]} productUrls - product_url values for the current page
 * @returns {Promise<Map<string, object|null>>} - productUrl → real_savings object or null
 */
async function batchGetRealSavings(db, productUrls) {
  const result = new Map();
  if (!productUrls || productUrls.length === 0) return result;

  // Deduplicate
  const urls = [...new Set(productUrls.filter(Boolean))];
  if (urls.length === 0) return result;

  const placeholders = urls.map(() => "?").join(", ");

  // Try with is_deal column first; fall back to query without it if column missing
  let rows;
  const baseQuery = `
    SELECT product_url, sale_price, {IS_DEAL_COL}
    FROM deal_price_history
    WHERE product_url IN (${placeholders})
      AND crawl_date >= date('now', '-90 days')
      AND sale_price IS NOT NULL`;

  try {
    const res = await db.execute(
      baseQuery.replace("{IS_DEAL_COL}", "is_deal"),
      urls,
    );
    rows = res.rows ?? [];
  } catch (e) {
    if (!/no such column/i.test(e.message)) throw e;
    // is_deal column not yet migrated — query without it, treat all rows as non-deal
    try {
      const res = await db.execute(
        baseQuery.replace("{IS_DEAL_COL}", "0 AS is_deal"),
        urls,
      );
      rows = res.rows ?? [];
    } catch (e2) {
      if (/no such table/i.test(e2.message)) return result;
      throw e2;
    }
  }

  // Group by product_url
  const byUrl = new Map();
  for (const row of rows) {
    const url = row.product_url;
    if (!byUrl.has(url)) byUrl.set(url, { allPrices: [], nonDealPrices: [] });
    const entry = byUrl.get(url);
    const price = Number(row.sale_price);
    if (!Number.isFinite(price)) continue;
    entry.allPrices.push(price);
    if (!row.is_deal) entry.nonDealPrices.push(price);
  }

  for (const url of urls) {
    result.set(url, null); // default: no data
    const entry = byUrl.get(url);
    if (!entry) continue;

    // Prefer median of non-deal prices; fall back to all-prices median (need ≥2 observations)
    const refPrice =
      median(entry.nonDealPrices) ??
      (entry.allPrices.length >= 2 ? median(entry.allPrices) : null);

    if (refPrice != null) {
      result.set(url, {
        reference_price: Math.round(refPrice * 100) / 100,
        reference_source: entry.nonDealPrices.length > 0 ? "historical_non_deal" : "historical_all",
        observations: entry.allPrices.length,
      });
    }
  }

  return result;
}

/**
 * Compute Real Savings rating for a single serialised deal object.
 *
 * @param {object}          deal              - Serialised deal (from serializeDeal)
 * @param {object|null}     historyData       - Entry from batchGetRealSavings map
 * @returns {object|null}
 */
function computeRealSavings(deal, historyData) {
  const currentPrice = Number(deal.sale_price);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  // Determine reference price: historical median preferred, then original_price
  let referencePrice = null;
  let referenceSource = null;

  if (historyData?.reference_price) {
    referencePrice = historyData.reference_price;
    referenceSource = historyData.reference_source;
  } else if (deal.original_price && Number(deal.original_price) > currentPrice) {
    referencePrice = Number(deal.original_price);
    referenceSource = "store_original";
  }

  if (!referencePrice || referencePrice <= currentPrice) return null;

  const realDiscountPct = ((referencePrice - currentPrice) / referencePrice) * 100;
  const rounded = Math.round(realDiscountPct * 10) / 10;

  let rating;
  if (rounded >= 25) rating = "great";
  else if (rounded >= 15) rating = "good";
  else if (rounded >= 5)  rating = "low";
  else return null; // discount too small to surface

  return {
    reference_price: referencePrice,
    reference_source: referenceSource,
    real_discount_pct: rounded,
    rating,
    observations: historyData?.observations ?? null,
  };
}

module.exports = { batchGetRealSavings, computeRealSavings };
