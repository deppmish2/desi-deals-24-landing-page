"use strict";

const STOP_WORDS = new Set([
  "and",
  "or",
  "with",
  "of",
  "the",
  "a",
  "an",
  "pack",
  "packs",
  "packet",
  "packets",
  "kg",
  "g",
  "gm",
  "ml",
  "l",
  "ltr",
  "litre",
  "liter",
  "pcs",
  "pc",
  "piece",
  "pieces",
  "units",
  "unit",
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => !/^\d+(?:\.\d+)?$/.test(token));
}

function inferType(text) {
  const v = normalizeText(text);
  if (!v) return null;
  if (/\b(murukku|snack|chips|namkeen|sev|bhujia|mixture)\b/.test(v))
    return "snack";
  if (/\b(rice|basmati|sona masoori|idli rice|ponni|parboiled)\b/.test(v))
    return "rice";
  if (/\b(dal|dhal|lentil|toor|moong|urad|masoor|rajma|chana)\b/.test(v))
    return "dal";
  if (/\b(masala|spice|powder|seasoning|garam)\b/.test(v)) return "masala";
  if (/\b(atta|maida|besan|flour)\b/.test(v)) return "flour";
  if (/\b(oil|ghee)\b/.test(v)) return "oil";
  return null;
}

function normalizeAnswer(value) {
  const upper = String(value || "")
    .trim()
    .toUpperCase();
  if (upper.includes("YES")) return "YES";
  if (upper.includes("NO")) return "NO";
  return "UNSURE";
}

async function resolveAmbiguous(productA, productB) {
  const rawA =
    `${String(productA?.raw_name || "")} ${String(productA?.weight_raw || "")}`.trim();
  const rawB = String(productB?.canonical_name || "").trim();
  const normA = normalizeText(rawA);
  const normB = normalizeText(rawB);

  if (!normA || !normB) return "UNSURE";
  if (normA === normB) return "YES";
  if (normA.includes(normB) || normB.includes(normA)) return "YES";

  const typeA = inferType(rawA);
  const typeB = inferType(rawB);
  if (typeA && typeB && typeA !== typeB) return "NO";

  const tokensA = new Set(tokenize(rawA));
  const tokensB = new Set(tokenize(rawB));
  if (tokensA.size === 0 || tokensB.size === 0) return "UNSURE";

  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }

  const coverageA = overlap / tokensA.size;
  const coverageB = overlap / tokensB.size;

  if (coverageA >= 0.75 && coverageB >= 0.6) return normalizeAnswer("YES");
  if (coverageA <= 0.25 && coverageB <= 0.25) return normalizeAnswer("NO");
  return normalizeAnswer("UNSURE");
}

module.exports = {
  resolveAmbiguous,
};
