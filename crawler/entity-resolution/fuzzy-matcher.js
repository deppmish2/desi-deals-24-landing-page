"use strict";

// Lightweight normalized Levenshtein similarity (0..1)
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

function soften(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/([aeiou])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function consonantSignature(value) {
  return soften(value).replace(/[aeiou]/g, "");
}

function tokenize(value) {
  return soften(value).split(/\s+/).filter(Boolean);
}

function tokenCoverageScore(source, target) {
  const sourceTokens = tokenize(source);
  const targetTokens = tokenize(target);
  if (sourceTokens.length === 0 || targetTokens.length === 0) return 0;

  const matched = sourceTokens.filter((sourceToken) =>
    targetTokens.some(
      (targetToken) =>
        targetToken.includes(sourceToken) || sourceToken.includes(targetToken),
    ),
  ).length;
  return matched / sourceTokens.length;
}

function combinedSimilarity(a, b) {
  const plainScore = similarity(String(a || ""), String(b || ""));
  const softScore = similarity(soften(a), soften(b));
  const consonantScore = similarity(
    consonantSignature(a),
    consonantSignature(b),
  );
  const tokenScore = tokenCoverageScore(a, b);
  return Math.max(
    plainScore,
    softScore * 0.98,
    consonantScore * 0.9,
    tokenScore * 0.92,
  );
}

function fuzzyMatch(normalisedName, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!normalisedName || list.length === 0) return null;

  let best = null;
  for (const candidate of list) {
    const score = combinedSimilarity(normalisedName, candidate);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (!best) return null;
  if (best.score >= 0.78) {
    return { match: best.candidate, confidence: best.score, method: "fuzzy" };
  }
  if (best.score >= 0.58) {
    return {
      match: best.candidate,
      confidence: best.score,
      method: "ambiguous",
    };
  }
  return null;
}

module.exports = {
  similarity,
  fuzzyMatch,
};
