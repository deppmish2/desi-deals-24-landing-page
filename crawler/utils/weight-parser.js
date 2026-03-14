"use strict";

const PATTERNS = [
  // "6 x 500g" → take total or first match; we take the first unit
  {
    re: /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i,
    fn: (m) => ({
      raw: m[0],
      value: parseGerman(m[2]),
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
  // "100 gm", "500gm" — Indian abbreviation for grams
  {
    re: /(\d+(?:[.,]\d+)?)\s*gm\b/i,
    fn: (m) => ({ raw: m[0], value: parseGerman(m[1]), unit: "g" }),
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
  for (const { re, fn } of PATTERNS) {
    const m = str.match(re);
    if (m) {
      const result = fn(m);
      if (!isNaN(result.value) && result.value > 0) return result;
    }
  }
  return null;
}

module.exports = { parseWeight };
