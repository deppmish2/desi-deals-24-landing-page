"use strict";
/**
 * auto-mapper.js
 *
 * After each store's deals are scraped, attempts to match them against
 * is_priority = 1 canonical products using substring name matching.
 * Upserts confirmed matches into deal_mappings so Pass 1 can fetch
 * non-deal prices for those products on future crawls.
 */

const { v4: uuidv4 } = require("uuid");

/** Normalise a product name for comparison */
function norm(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Load all is_priority = 1 canonical products once per crawl run.
 * Returns array of { id, canonical_name, normed, aliases[] }
 */
async function loadPriorityCanonicals(db) {
  let rows;
  try {
    const res = await db.execute(
      `SELECT id, canonical_name, common_aliases
       FROM canonical_products
       WHERE is_priority = 1`,
    );
    rows = res.rows ?? [];
  } catch (e) {
    // is_priority column may not exist yet — skip silently
    if (/no such column/i.test(e.message)) return [];
    throw e;
  }

  return rows.map((r) => {
    const aliases = r.common_aliases
      ? String(r.common_aliases).split(",").map((a) => norm(a.trim())).filter(Boolean)
      : [];
    return {
      id: r.id,
      canonical_name: r.canonical_name,
      normed: norm(r.canonical_name),
      aliases,
    };
  });
}

/**
 * For each scraped deal, check if its product_name contains a priority
 * canonical name (or alias) as a substring. If so, upsert into deal_mappings.
 *
 * @param {object} db
 * @param {Array}  deals           - Normalised deal objects from buildNormalizedScrapedDeals
 * @param {Array}  priorityCanonicals - From loadPriorityCanonicals()
 * @returns {Promise<number>}      - Number of mappings upserted
 */
async function autoMapDeals(db, deals, priorityCanonicals) {
  if (!priorityCanonicals.length || !deals.length) return 0;

  let mapped = 0;
  for (const deal of deals) {
    if (!deal.product_url || !deal.product_name) continue;
    const normedName = norm(deal.product_name);

    for (const canon of priorityCanonicals) {
      const terms = [canon.normed, ...canon.aliases].filter(Boolean);
      const matched = terms.some(
        (term) => term.length >= 4 && normedName.includes(term),
      );
      if (!matched) continue;

      try {
        // Upsert: if mapping already exists, update match_confidence
        await db.execute(
          `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence)
           VALUES (?, ?, 'name_substring', 0.7)
           ON CONFLICT(deal_id, canonical_id) DO UPDATE SET match_confidence = 0.7`,
          [deal.id, canon.id],
        );
        mapped++;
      } catch (_) {
        // deal_id or canonical_id FK violation — skip
      }
      break; // one canonical per deal
    }
  }

  return mapped;
}

module.exports = { loadPriorityCanonicals, autoMapDeals };
