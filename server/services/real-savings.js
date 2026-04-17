"use strict";
/**
 * real-savings.js
 *
 * Computes a "Real Savings" rating for a deal answering:
 * "How good is this discount compared to what this brand normally costs per kg?"
 *
 * Reference price is canonical-level: we aggregate price_per_kg across ALL
 * pack sizes of the same brand+product (e.g. all Aashirvaad Chakki Atta SKUs
 * across all stores), then compare the deal's price_per_kg against that median.
 * This correctly handles 2 kg vs 5 kg comparisons without needing separate
 * canonicals per pack size.
 *
 * Evidence layers (priority order):
 *   Layer 1 — Canonical median price_per_kg: non-deal rows in deal_price_history
 *             linked to the same canonical via deal_mappings, last 90 days.
 *   Layer 2 — Stated original_price: store-reported, less reliable.
 *             Only used when no canonical price_per_kg history exists.
 *
 * Requires ≥ 3 non-deal observations for Layer 1 — a single observation from the
 * deal's own URL (same store, same product, previously not on sale) is not
 * trustworthy enough to call "market price".
 *
 * Returns null if there is insufficient evidence.
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
 * Batch-fetch Real Savings reference data for a page of deals.
 *
 * For each deal that has a canonical mapping, fetches the median price_per_kg
 * of non-deal historical rows for that canonical (all brands+sizes pooled by
 * canonical = same brand+product). Falls back to product_url-level sale_price
 * history when no canonical or no price_per_kg data exists.
 *
 * @param {object}   db    - DB shim from server/db/index.js
 * @param {Array}    deals - Deal objects; each must have { id, product_url, price_per_kg }
 * @returns {Promise<Map<string, object|null>>} - deal.id → reference data or null
 */
async function batchGetRealSavings(db, deals) {
  const result = new Map();
  if (!deals || deals.length === 0) return result;

  for (const deal of deals) result.set(deal.id, null);

  // ── Layer 1: canonical price_per_kg history ──────────────────────────────

  // Fetch canonical mappings for all deals in one query
  const dealIds = deals.map((d) => d.id).filter(Boolean);
  if (dealIds.length === 0) return result;

  let canonicalMap; // deal.id → canonical_id
  try {
    const placeholders = dealIds.map(() => "?").join(", ");
    const mappingRes = await db.execute(
      `SELECT id AS deal_id, canonical_id FROM deals WHERE id IN (${placeholders}) AND canonical_id IS NOT NULL`,
      dealIds,
    );
    canonicalMap = new Map((mappingRes.rows ?? []).map((r) => [r.deal_id, r.canonical_id]));
  } catch (_) {
    canonicalMap = new Map();
  }

  // Collect unique canonical_ids that have deals on this page
  const canonicalIds = [...new Set([...canonicalMap.values()].filter(Boolean))];

  if (canonicalIds.length > 0) {
    try {
      const placeholders = canonicalIds.map(() => "?").join(", ");
      // Join through deals table (product_url links deal_price_history ↔ deals)
      const histRes = await db.execute(
        `SELECT dm.canonical_id, dph.price_per_kg, dph.is_deal
         FROM deal_price_history dph
         JOIN deals d ON d.product_url = dph.product_url
         JOIN deal_mappings dm ON dm.deal_id = d.id
         WHERE dm.canonical_id IN (${placeholders})
           AND dph.is_deal = 0
           AND dph.crawl_date >= date('now', '-90 days')
           AND dph.price_per_kg IS NOT NULL
           AND dph.price_per_kg > 0`,
        canonicalIds,
      );

      // Group non-deal price_per_kg values by canonical
      const byCanonical = new Map();
      for (const row of histRes.rows ?? []) {
        const cid = row.canonical_id;
        if (!byCanonical.has(cid)) byCanonical.set(cid, []);
        const ppk = Number(row.price_per_kg);
        if (Number.isFinite(ppk)) byCanonical.get(cid).push(ppk);
      }

      // Assign reference to each deal via its canonical
      for (const deal of deals) {
        const cid = canonicalMap.get(deal.id);
        if (!cid) continue;
        const prices = byCanonical.get(cid);
        if (!prices || prices.length < 3) continue; // require ≥ 3 non-deal observations
        const refPpk = median(prices);
        if (refPpk != null) {
          result.set(deal.id, {
            reference_price_per_kg: Math.round(refPpk * 100) / 100,
            reference_source: "canonical_historical",
            observations: prices.length,
            canonical_id: cid,
          });
        }
      }
    } catch (_) {
      // price_per_kg or deal_mappings not available — fall through to Layer 2
    }
  }

  // ── Layer 2: fall back to stated original_price for deals without canonical data ──
  // (handled in computeRealSavings — no DB query needed here)

  return result;
}

/**
 * Compute Real Savings rating for a single deal.
 *
 * Compares price_per_kg when canonical history is available (Layer 1),
 * otherwise falls back to comparing sale_price vs original_price (Layer 2).
 *
 * @param {object}      deal         - Serialised deal (from serializeDeal)
 * @param {object|null} historyData  - Entry from batchGetRealSavings map
 * @returns {object|null}
 */
/**
 * Apply badge suppression rules based on the store's stated discount_percent.
 *
 * Rules (both require a valid store discount to compare against):
 *   1. Suppress if real savings > store discount — our data cannot be trusted
 *      to claim a bigger discount than the store itself states.
 *   2. Suppress if |real savings − store discount| < 5pp — the badge adds no
 *      meaningful information when the numbers are nearly identical.
 *
 * @param {number} realPct         - computed real discount percentage (0-100)
 * @param {number|null} statedPct  - store's discount_percent (0-100) or null
 * @returns {boolean} true if the badge should be suppressed
 */
function shouldSuppressBadge(realPct, statedPct) {
  if (statedPct == null || !Number.isFinite(statedPct) || statedPct <= 0) return false;
  if (realPct > statedPct) return true;          // condition 2: real > store
  if (statedPct - realPct < 5) return true;      // condition 1: gap < 5pp
  return false;
}

function computeRealSavings(deal, historyData) {
  const statedDiscount = Number(deal.discount_percent) || null;

  // ── Layer 1: canonical price_per_kg comparison ───────────────────────────
  if (historyData?.reference_price_per_kg) {
    const dealPpk = Number(deal.price_per_kg);
    if (!Number.isFinite(dealPpk) || dealPpk <= 0) {
      // No price_per_kg on this deal — fall through to Layer 2
    } else {
      const refPpk = historyData.reference_price_per_kg;
      if (refPpk <= dealPpk) return null; // not cheaper than reference

      const realDiscountPct = ((refPpk - dealPpk) / refPpk) * 100;
      const rounded = Math.round(realDiscountPct * 10) / 10;

      let rating;
      if (rounded >= 25) rating = "great";
      else if (rounded >= 15) rating = "good";
      else if (rounded >= 5) rating = "low";
      else return null;

      if (shouldSuppressBadge(rounded, statedDiscount)) return null;

      return {
        reference_price_per_kg: refPpk,
        reference_source: historyData.reference_source,
        real_discount_pct: rounded,
        rating,
        observations: historyData.observations ?? null,
        canonical_id: historyData.canonical_id ?? null,
      };
    }
  }

  // ── Layer 2: stated original_price fallback ──────────────────────────────
  const currentPrice = Number(deal.sale_price);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return null;

  if (deal.original_price && Number(deal.original_price) > currentPrice) {
    const referencePrice = Number(deal.original_price);
    const realDiscountPct = ((referencePrice - currentPrice) / referencePrice) * 100;
    const rounded = Math.round(realDiscountPct * 10) / 10;

    let rating;
    if (rounded >= 25) rating = "great";
    else if (rounded >= 15) rating = "good";
    else if (rounded >= 5) rating = "low";
    else return null;

    if (shouldSuppressBadge(rounded, statedDiscount)) return null;

    return {
      reference_price: referencePrice,
      reference_source: "store_original",
      real_discount_pct: rounded,
      rating,
      observations: null,
      canonical_id: null,
    };
  }

  return null;
}

/**
 * Explain why real savings badge is absent for a deal.
 * Call only when computeRealSavings(deal, historyData) returns null.
 *
 * @param {object}      deal        - Serialised deal
 * @param {object|null} historyData - Entry from batchGetRealSavings map
 * @returns {string} reason code
 */
function explainRealSavings(deal, historyData) {
  if (computeRealSavings(deal, historyData) !== null) return null;

  if (!deal.canonical_id) return "no_canonical";

  const statedDiscount = Number(deal.discount_percent) || null;

  // Trace Layer 1
  if (historyData?.reference_price_per_kg) {
    const dealPpk = Number(deal.price_per_kg);
    if (Number.isFinite(dealPpk) && dealPpk > 0) {
      const refPpk = historyData.reference_price_per_kg;
      if (refPpk <= dealPpk) return "not_cheaper";
      const realPct = Math.round(((refPpk - dealPpk) / refPpk) * 1000) / 10;
      if (realPct < 5) return "rating_too_low";
      if (shouldSuppressBadge(realPct, statedDiscount)) return "badge_suppressed";
    }
    // no price_per_kg — fall through to Layer 2
  }

  // Layer 2
  const currentPrice = Number(deal.sale_price);
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return "no_price_data";
  if (!deal.original_price || Number(deal.original_price) <= currentPrice) {
    return historyData ? "no_original_price" : "no_history";
  }
  const refPrice = Number(deal.original_price);
  const realPct = Math.round(((refPrice - currentPrice) / refPrice) * 1000) / 10;
  if (realPct < 5) return "rating_too_low";
  if (shouldSuppressBadge(realPct, statedDiscount)) return "badge_suppressed";

  return "unknown";
}

module.exports = { batchGetRealSavings, computeRealSavings, explainRealSavings };
