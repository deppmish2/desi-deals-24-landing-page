"use strict";

/**
 * tfidf-embedder.js  — Layer 4 of The Smartest Architecture
 *
 * Lightweight TF cosine similarity for product name matching.
 * We use term-frequency (TF) vectors instead of full TF-IDF because:
 *   - We're comparing two short strings (no corpus needed)
 *   - TF cosine is fast, pure JS, zero deps
 *   - It naturally handles bag-of-words overlap
 *
 * Key insight from search_embeddings.md:
 *   Embed the NORMALIZED STRUCTURED REPRESENTATION (brand + base product,
 *   WITHOUT weight), then match only within same weight class.
 *   This avoids matching "1kg basmati" with "5kg basmati" purely on text.
 */

/**
 * Tokenize a string into cleaned unigrams (min 2 chars, no pure-number tokens).
 */
function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

/**
 * Build a normalized term-frequency map.
 * Each term's frequency = count / total_tokens, so short and long texts
 * are comparable on the same 0–1 scale.
 */
function buildTF(tokens) {
  const tf = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  const total = tokens.length || 1;
  for (const t in tf) tf[t] /= total;
  return tf;
}

/**
 * Cosine similarity between two TF maps.
 * Returns 0..1.
 */
function cosineSimilarity(tf1, tf2) {
  let dot = 0;
  let mag1 = 0;
  let mag2 = 0;
  for (const [term, freq] of Object.entries(tf1)) {
    mag1 += freq * freq;
    if (tf2[term] !== undefined) dot += freq * tf2[term];
  }
  for (const freq of Object.values(tf2)) {
    mag2 += freq * freq;
  }
  const denom = Math.sqrt(mag1) * Math.sqrt(mag2);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * TF cosine similarity between two text strings.
 * Returns 0..1.
 */
function textSimilarity(a, b) {
  const tokA = tokenize(a);
  const tokB = tokenize(b);
  if (tokA.length === 0 || tokB.length === 0) return 0;
  return cosineSimilarity(buildTF(tokA), buildTF(tokB));
}

/**
 * Fraction of query tokens that appear in the product text.
 * Short tokens (≤4 chars) require exact match; longer tokens allow substring.
 * Returns 0..1.
 */
function tokenOverlap(queryText, productText) {
  const qTokens = tokenize(queryText);
  const pTokens = tokenize(productText);
  if (qTokens.length === 0) return 0;
  const pSet = new Set(pTokens);
  const matched = qTokens.filter((t) => {
    if (pSet.has(t)) return true;
    if (t.length > 4) {
      return pTokens.some((pt) => pt.includes(t) || t.includes(pt));
    }
    return false;
  }).length;
  return matched / qTokens.length;
}

module.exports = {
  textSimilarity,
  tokenOverlap,
  tokenize,
  buildTF,
  cosineSimilarity,
};
