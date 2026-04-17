"use strict";

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

function normalizeSearchValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’`´]s\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchValue(value) {
  return normalizeSearchValue(value).replace(/\s+/g, "");
}

function buildWordVariants(word) {
  const normalized = normalizeSearchValue(word);
  if (!normalized) return [];

  const variants = new Set([normalized]);

  if (normalized.endsWith("ies") && normalized.length > 5) {
    variants.add(`${normalized.slice(0, -3)}y`);
  }
  if (normalized.endsWith("es") && normalized.length > 5) {
    variants.add(normalized.slice(0, -2));
  }
  if (normalized.endsWith("s") && normalized.length > 4) {
    variants.add(normalized.slice(0, -1));
  }

  return [...variants].filter(Boolean);
}

function getTokenTolerance(token) {
  if (!token) return 0;
  if (token.length >= 10) return 2;
  if (token.length >= 6) return 1;
  return 0;
}

function scoreWordMatch(hayWord, queryWord) {
  if (!hayWord || !queryWord) return 0;

  const hayVariants = buildWordVariants(hayWord);
  const queryVariants = buildWordVariants(queryWord);
  let best = 0;

  for (const hayVariant of hayVariants) {
    for (const queryVariant of queryVariants) {
      if (hayVariant === queryVariant) {
        best = Math.max(best, 100);
        continue;
      }

      if (
        queryVariant.length >= 4 && hayVariant.length >= 4 &&
        (hayVariant.startsWith(queryVariant) || queryVariant.startsWith(hayVariant))
      ) {
        best = Math.max(best, 92);
        continue;
      }

      if (
        queryVariant.length >= 5 && hayVariant.length >= 4 &&
        (hayVariant.includes(queryVariant) || queryVariant.includes(hayVariant))
      ) {
        best = Math.max(best, 84);
        continue;
      }

      const tolerance = getTokenTolerance(queryVariant);
      if (tolerance <= 0) continue;

      const distance = levenshtein(hayVariant, queryVariant);
      if (distance <= tolerance) {
        best = Math.max(best, 76 - distance * 10);
      }
    }
  }

  return best;
}

function getSearchMatchScore(haystack, query) {
  const normalizedHaystack = normalizeSearchValue(haystack);
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedHaystack || !normalizedQuery) return 0;

  const haystackCompact = compactSearchValue(haystack);
  const queryCompact = compactSearchValue(query);
  const haystackWords = normalizedHaystack.split(" ").filter(Boolean);
  const queryWords = normalizedQuery.split(" ").filter(Boolean);

  let score = 0;

  if (normalizedHaystack.includes(normalizedQuery)) {
    score += 300;
  } else if (queryCompact && haystackCompact.includes(queryCompact)) {
    score += 240;
  }

  for (const queryWord of queryWords) {
    let bestTokenScore = 0;
    for (const haystackWord of haystackWords) {
      bestTokenScore = Math.max(
        bestTokenScore,
        scoreWordMatch(haystackWord, queryWord),
      );
    }

    if (bestTokenScore <= 0) {
      return 0;
    }
    score += bestTokenScore;
  }

  return score;
}

function fuzzySearch(haystack, query) {
  return getSearchMatchScore(haystack, query) > 0;
}

function filterAndRankDealsByQuery(deals, query, getHaystack) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return Array.isArray(deals) ? [...deals] : [];

  const ranked = [];
  for (const deal of Array.isArray(deals) ? deals : []) {
    const haystack = getHaystack(deal);
    const searchScore = getSearchMatchScore(haystack, normalizedQuery);
    if (searchScore <= 0) continue;
    ranked.push({ deal, searchScore });
  }

  ranked.sort((left, right) => {
    if (right.searchScore !== left.searchScore) {
      return right.searchScore - left.searchScore;
    }

    const leftDiscount = Number(left.deal?.discount_percent || 0);
    const rightDiscount = Number(right.deal?.discount_percent || 0);
    if (rightDiscount !== leftDiscount) {
      return rightDiscount - leftDiscount;
    }

    const leftName = String(left.deal?.product_name || "");
    const rightName = String(right.deal?.product_name || "");
    return leftName.localeCompare(rightName);
  });

  return ranked.map((entry) => entry.deal);
}

module.exports = {
  compactSearchValue,
  filterAndRankDealsByQuery,
  fuzzySearch,
  getSearchMatchScore,
  levenshtein,
  normalizeSearchValue,
};
