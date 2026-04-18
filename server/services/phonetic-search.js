"use strict";

const { normalizeSearchValue, levenshtein } = require("./deal-search");

// Strip vowels to get consonant skeleton — catches vowel swaps and missing vowels.
// "turmeric" → "trmrc", "tumeric" → "tmrc" (distance 1)
// "coriander" → "crndr", "corriander" → "crrndr" (distance 1)
// "mustard" → "mstrd", "musterd" → "mstrd" (exact)
function consonantSkeleton(word) {
  return word.replace(/[aeiou]/g, "");
}

function phoneticTokenScore(hayToken, queryToken) {
  if (!hayToken || !queryToken) return 0;
  if (hayToken === queryToken) return 100;

  const haySkel = consonantSkeleton(hayToken);
  const querySkel = consonantSkeleton(queryToken);
  if (!haySkel || !querySkel) return 0;

  if (haySkel === querySkel && haySkel.length >= 3) return 80;

  if (haySkel.length >= 4 && querySkel.length >= 4) {
    // Gate: full words must be plausibly related before skeleton comparison.
    // Prevents "finger"→"fngrk" matching "fenugrik"→"fngrk" (distance 1 skeleton but unrelated words).
    const fullDist = levenshtein(hayToken, queryToken);
    const maxLen = Math.max(hayToken.length, queryToken.length);
    if (fullDist > Math.floor(maxLen * 0.45)) return 0;

    const dist = levenshtein(haySkel, querySkel);
    if (dist === 1) return 65;
  }

  return 0;
}

function phoneticMatchScore(canonicalName, query) {
  const normHay = normalizeSearchValue(canonicalName);
  const normQuery = normalizeSearchValue(query);
  if (!normHay || !normQuery) return 0;

  const hayWords = normHay.split(" ").filter(Boolean);
  const queryWords = normQuery.split(" ").filter(Boolean);

  let total = 0;
  for (const queryWord of queryWords) {
    let best = 0;
    for (const hayWord of hayWords) {
      best = Math.max(best, phoneticTokenScore(hayWord, queryWord));
    }
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Zero-results fallback: match query phonetically against canonical product names.
 * Only call when the primary search returns no results.
 *
 * @param {object} db    - better-sqlite3 db instance
 * @param {Array}  deals - full in-memory deal list
 * @param {string} query - normalised search query
 * @returns {Array} matching deals (unranked — phonetic match quality is uniform)
 */
async function phoneticFallback(db, deals, query) {
  // Short queries are prefix-search intent, not misspelled full words.
  // Phonetic skeleton matching is too ambiguous below 5 chars.
  if (!query || query.length < 5) return [];
  const canonicals = await db
    .prepare("SELECT id, canonical_name FROM canonical_products")
    .all();

  const matchedIds = new Set();
  for (const c of canonicals) {
    if (phoneticMatchScore(c.canonical_name, query) > 0) {
      matchedIds.add(c.id);
    }
  }

  if (matchedIds.size === 0) return [];
  return deals.filter((d) => d.canonical_id && matchedIds.has(d.canonical_id));
}

module.exports = { phoneticFallback, phoneticMatchScore };
