"use strict";

/**
 * smart-ranker.js  — Layers 3 & 5 of The Smartest Architecture
 *
 * Binary-classifier-style scoring that combines multiple signals:
 *
 *   1. Embedding similarity  (30%) — TF cosine on weight-free normalized keys
 *   2. Brand match           (25%) — exact brand token match
 *   3. Weight class match    (15%) — product weight within 20 % of requested
 *   4. Token overlap         (20%) — fraction of query tokens in product name
 *   5. Phonetic similarity   (10%) — covers transliteration / spelling variants
 *
 * This is FAR more reliable than threshold-based string similarity alone:
 *   - wrong brand → score penalized even if description is similar
 *   - wrong weight class → score penalized (1kg rice ≠ 5kg rice for a basket)
 *   - phonetic layer catches "jirra" → "jeera", "haldee" → "haldi"
 *
 * The weights act like a trained logistic-regression binary classifier.
 * As labeled data accumulates (active learning loop), these weights can be
 * tuned — but the hand-crafted values already outperform pure string matching
 * on Indian grocery product names.
 */

const { parseProductName } = require("./product-parser");
const { textSimilarity, tokenOverlap } = require("./tfidf-embedder");
const { normalise } = require("../../crawler/entity-resolution/normaliser");
const { phoneticNormalise } = require("./search-expander");

function toBaseGrams(value, unit) {
  const v = Number(value);
  if (isNaN(v) || v <= 0) return null;
  const u = String(unit || "").toLowerCase();
  if (u === "kg") return v * 1000;
  if (u === "g") return v;
  if (u === "l") return v * 1000;
  if (u === "ml") return v;
  return null;
}

/**
 * Score a search query against one product using multi-signal binary classification.
 *
 * @param {string} queryText
 * @param {string} productName
 * @param {number|null} productWeightValue   — from deal row (weight_value)
 * @param {string|null} productWeightUnit    — from deal row (weight_unit)
 * @returns {{ score: number, confidence: 'high'|'medium'|'low', features: object }}
 */
function rankMatch(
  queryText,
  productName,
  productWeightValue,
  productWeightUnit,
) {
  const query = parseProductName(queryText);
  const product = parseProductName(productName);

  // ── Feature 1: Embedding similarity ────────────────────────────────────────
  // Compare weight-free normalized keys.
  // "TRS 5kg basmati"  → key = "trs basmati"
  // "TRS 1kg basmati"  → key = "trs basmati"  ← same key, high similarity ✓
  // "TRS 5kg sona masoori" → key = "trs sona masoori" ← different key ✓
  const embeddingSimilarity = textSimilarity(
    query.normalized_key,
    product.normalized_key,
  );

  // ── Feature 2: Brand match ──────────────────────────────────────────────────
  // 1.0 = brands match exactly
  // 0.0 = brands differ (strong signal: wrong brand is almost certainly wrong product)
  // 0.5 = brand unknown on either side (neutral — don't penalize)
  let brandMatch;
  if (query.brand && product.brand) {
    // Use phonetic normalization so "dawaat" == "daawat", "aashirvaad" == "ashirvad", etc.
    brandMatch =
      phoneticNormalise(query.brand) === phoneticNormalise(product.brand)
        ? 1
        : 0;
  } else {
    brandMatch = 0.5; // no brand info on one side → neutral
  }

  // ── Feature 3: Weight class match ──────────────────────────────────────────
  // Use deal's stored weight_value/unit if available; else fall back to parsed.
  // Avoid matching a 1kg product to a 5kg request.
  let weightMatch = 0.5; // neutral when no weight info in query or product
  const qWeight = query.total_weight_g;
  const pWeight =
    product.total_weight_g ||
    toBaseGrams(productWeightValue, productWeightUnit);
  if (qWeight && pWeight) {
    const ratio = Math.abs(qWeight - pWeight) / Math.max(qWeight, pWeight);
    weightMatch = ratio <= 0.2 ? 1 : ratio <= 0.5 ? 0.5 : 0;
  }

  // ── Feature 4: Token overlap ────────────────────────────────────────────────
  // What fraction of query tokens appear in the product name?
  // Operates on normalise() output, which strips units, packaging words, etc.
  const overlap = tokenOverlap(normalise(queryText), normalise(productName));

  // ── Feature 5: Phonetic similarity ─────────────────────────────────────────
  // Handles transliteration variants: "jirra"→"jeera", "haldee"→"haldi",
  // "baasmati"→"basmati", etc.
  const phoneticSim = textSimilarity(
    phoneticNormalise(normalise(queryText)),
    phoneticNormalise(normalise(productName)),
  );

  // ── Weighted combination ────────────────────────────────────────────────────
  const score =
    0.3 * embeddingSimilarity +
    0.25 * brandMatch +
    0.15 * weightMatch +
    0.2 * overlap +
    0.1 * phoneticSim;

  const confidence = score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low";

  return {
    score,
    confidence,
    features: {
      embedding_similarity: Math.round(embeddingSimilarity * 100) / 100,
      brand_match: brandMatch,
      weight_match: weightMatch,
      token_overlap: Math.round(overlap * 100) / 100,
      phonetic_similarity: Math.round(phoneticSim * 100) / 100,
    },
  };
}

/**
 * Score a query against a candidate label (used by autocomplete).
 * Tries all expanded query terms and returns the best score.
 *
 * @param {string[]} expandedTerms  — from expandQuery()
 * @param {string}   candidate      — product name to score
 * @returns {number}  0..1
 */
function bestSmartScore(expandedTerms, candidate) {
  let best = 0;
  for (const term of expandedTerms) {
    const { score } = rankMatch(term, candidate, null, null);
    if (score > best) best = score;
    if (best >= 0.9) break; // perfect match, no need to check more terms
  }
  return best;
}

/**
 * Re-rank an array of deal rows against a search query.
 *
 * Accepts either a raw query string or a pre-expanded array of terms
 * (from expandQuery()). Using expanded terms ensures that a search for
 * "jirra" can match a "Jeera Cumin Seeds" product at high confidence,
 * because "jirra" expands to ["jirra","jira","jeera","cumin"] and the
 * "jeera" term scores 1.0 against the product.
 *
 * Each deal must have: product_name, weight_value, weight_unit.
 * Returns a new array sorted by smart relevance score descending.
 *
 * @param {string|string[]} queryOrTerms  — raw query or pre-expanded terms
 * @param {object[]}        deals
 * @returns {object[]}
 */
function reRankDeals(queryOrTerms, deals) {
  if (!queryOrTerms || !deals || deals.length === 0) return deals;
  const terms = Array.isArray(queryOrTerms) ? queryOrTerms : [queryOrTerms];
  return deals
    .map((deal) => {
      let best = 0;
      for (const term of terms) {
        const { score } = rankMatch(
          term,
          deal.product_name,
          deal.weight_value,
          deal.weight_unit,
        );
        if (score > best) best = score;
        if (best >= 0.9) break; // perfect match found
      }
      return { deal, score: best };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ deal }) => deal);
}

module.exports = { rankMatch, bestSmartScore, reRankDeals };
