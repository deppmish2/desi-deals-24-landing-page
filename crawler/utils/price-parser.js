"use strict";

/**
 * Parse a German/EU price string into a float.
 * Handles: "€ 2,99", "2.99€", "ab 2,99 €", "EUR 3.50", "2.990,00", "3,99"
 * Returns null if no valid price found.
 */
function parsePrice(str) {
  if (!str && str !== 0) return null;
  const s = String(str)
    .replace(/\bab\b/gi, "") // remove "ab" (from)
    .replace(/EUR/gi, "")
    .replace(/€/g, "")
    .trim();

  // Handle thousands separator: "2.990,00" → "2990.00"
  // Pattern: digit(s) . digit{3} , digit{1,2}  → thousands-formatted
  const thousandsMatch = s.match(/(\d{1,3}(?:\.\d{3})+),(\d{1,2})/);
  if (thousandsMatch) {
    const clean = thousandsMatch[0].replace(/\./g, "").replace(",", ".");
    const val = parseFloat(clean);
    return isNaN(val) ? null : val;
  }

  // English decimal dot: "3.29" or "329.99" (dot followed by 1-2 digits at end)
  // Distinguish from German thousands: "2.990" has exactly 3 digits after dot
  const dotDecimalMatch = s.match(/\d+\.(\d{1,2})(?!\d)/);
  if (dotDecimalMatch) {
    const val = parseFloat(s.match(/[\d.]+/)[0]);
    return isNaN(val) ? null : val;
  }

  // German decimal comma: "2,99" → "2.99" (remove any remaining dots as thousands sep)
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const match = normalized.match(/\d+(\.\d+)?/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  return isNaN(val) ? null : val;
}

/**
 * Calculate discount percentage.
 * Returns null if either price is missing or sale >= original.
 */
function calcDiscount(salePrice, originalPrice) {
  if (!salePrice || !originalPrice || originalPrice <= salePrice) return null;
  return Math.round((1 - salePrice / originalPrice) * 1000) / 10; // 1 decimal place
}

/**
 * Calculate price per kg given a price and weight object.
 */
function calcPricePerKg(price, weightValue, weightUnit) {
  if (!price || !weightValue || !weightUnit) return null;
  const unit = weightUnit.toLowerCase();
  if (unit === "g") return Math.round((price / weightValue) * 1000 * 100) / 100;
  if (unit === "kg") return Math.round((price / weightValue) * 100) / 100;
  return null; // ml/l/units not convertible to kg
}

module.exports = { parsePrice, calcDiscount, calcPricePerKg };
