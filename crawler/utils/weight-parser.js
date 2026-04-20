"use strict";

const PATTERNS = [
  // "6 x 500g" → multiply count × unit weight to get total
  {
    re: /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i,
    fn: (m) => ({
      raw: m[0],
      value: parseGerman(m[1]) * parseGerman(m[2]),
      unit: normalizeUnit(m[3]),
    }),
  },
  // "1.5 kg", "500 g", "500g", "0,5 kg"
  {
    re: /(\d+(?:[.,]\d+)?)\s*(kg|g|liter|litre|ml|l)\b/i,
    fn: (m) => ({
      raw: m[0],
      value: parseGerman(m[1]),
      unit: normalizeUnit(m[2]),
    }),
  },
  // "100 gm", "500gm" — Indian abbreviation for grams.
  // Use the LAST match so that multi-pack titles like
  // "(48pc x 10gm) 480gm" return the total weight (480gm) not the
  // per-unit weight (10gm).
  {
    re: /(\d+(?:[.,]\d+)?)\s*gm\b/gi,
    fn: (m) => ({ raw: m[0], value: parseGerman(m[1]), unit: "g" }),
    last: true,
  },
  // "1 Liter"
  {
    re: /(\d+(?:[.,]\d+)?)\s*liter\b/i,
    fn: (m) => ({ raw: m[0], value: parseGerman(m[1]), unit: "l" }),
  },
];

function parseGerman(s) {
  return parseFloat(String(s).replace(",", "."));
}

function normalizeUnit(u) {
  const map = {
    liter: "l",
    litre: "l",
    gram: "g",
    kilogram: "kg",
    milliliter: "ml",
  };
  const lower = u.toLowerCase();
  return map[lower] || lower;
}

/**
 * Extract weight from a string (usually product title or description).
 * Returns { value: number, unit: string, raw: string } or null.
 */
function parseWeight(str) {
  if (!str) return null;
  for (const { re, fn, last } of PATTERNS) {
    if (last) {
      // Collect all matches and use the last one (e.g. total weight after
      // per-unit spec in "(48pc x 10gm) 480gm").
      const matches = [...str.matchAll(re)];
      if (matches.length > 0) {
        const m = matches[matches.length - 1];
        const result = fn(m);
        if (!isNaN(result.value) && result.value > 0) return result;
      }
    } else {
      const m = str.match(re);
      if (m) {
        const result = fn(m);
        if (!isNaN(result.value) && result.value > 0) return result;
      }
    }
  }
  return null;
}

module.exports = { parseWeight };
