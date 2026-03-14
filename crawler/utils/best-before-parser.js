"use strict";

// German and English month name → zero-padded number
const MONTH_MAP = {
  januar: "01",
  jan: "01",
  februar: "02",
  feb: "02",
  märz: "03",
  maerz: "03",
  mär: "03",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  mai: "05",
  may: "05",
  juni: "06",
  june: "06",
  jun: "06",
  juli: "07",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sept: "09",
  sep: "09",
  oktober: "10",
  october: "10",
  okt: "10",
  oct: "10",
  november: "11",
  nov: "11",
  dezember: "12",
  december: "12",
  dez: "12",
  dec: "12",
};

// All recognised best-before keywords (German + English)
// bbd = "Best Before Date" used by indiansupermarkt.de e.g. "(BBD : 22 October 2025)"
const KEYWORD =
  /\b(mhd|bbe|b\.b\.e|best[\s-]?before|bbd|bb|expiry[\s-]?date|mhb|mindestens[\s-]?haltbar[\s-]?bis|mindesthaltbarkeitsdatum|haltbarkeitsdatum|mindesthaltbarkeit|ablauf)\b/i;

// Shared keyword group used inside each extraction pattern
const KW =
  "(?:mhd|bbe|b\\.b\\.e|best[\\s-]?before|bbd|bb|expiry[\\s-]?date|mhb|mindestens[\\s-]?haltbar[\\s-]?bis|mindesthaltbarkeitsdatum|haltbarkeitsdatum|mindesthaltbarkeit|ablauf)";

/**
 * Detects best-before / MHD / BBE date in a product name or description.
 * Recognised keywords: MHD, BBE, B.B.E, Best Before, BBD, BB, Expiry Date, MHB,
 *   Mindestens haltbar bis, Mindesthaltbarkeitsdatum, Haltbarkeitsdatum, Ablauf.
 * Returns "YYYY-MM" string or null.
 */
function parseBestBefore(text) {
  if (!text || !KEYWORD.test(text)) return null;

  const t = text.toLowerCase();

  // Pattern A: DD/MM/YYYY or DD/MM/YY  (e.g. "BB: 22/03/26", "Best Before 14/03/2026")
  // Three numeric parts separated by / or .
  let m = t.match(
    new RegExp(
      `\\b${KW}[^0-9]*(\\d{1,2})[\\/\\.](\\d{1,2})[\\/\\.](\\d{2,4})\\b`,
    ),
  );
  if (m) {
    const month = parseInt(m[2]);
    let year = parseInt(m[3]);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12)
      return `${year}-${String(month).padStart(2, "0")}`;
  }

  // Pattern B: MM/YYYY or MM.YYYY  (e.g. "MHD 03/2025")
  m = t.match(new RegExp(`\\b${KW}[^0-9]*(\\d{1,2})[\\/\\.](\\d{4})\\b`));
  if (m) {
    const month = parseInt(m[1]);
    if (month >= 1 && month <= 12)
      return `${m[2]}-${String(month).padStart(2, "0")}`;
  }

  // Pattern C: MM/YY or MM.YY  (e.g. "MHD 03/25")
  m = t.match(new RegExp(`\\b${KW}[^0-9]*(\\d{1,2})[\\/\\.](\\d{2})\\b`));
  if (m) {
    const month = parseInt(m[1]);
    if (month >= 1 && month <= 12)
      return `${2000 + parseInt(m[2])}-${String(month).padStart(2, "0")}`;
  }

  // Pattern D: (keyword) [optional day or "end"] MonthName Year
  // Handles: "MHD März 2025", "Best Before: 18 Aug 2025", "Best Before: End Feb 2026"
  //          "Best Before 31 May'25" (apostrophe-prefixed 2-digit year, used by globalfoodhub.com)
  // [^a-z]* skips digits/punctuation (e.g. ": 18 "); (?:end\s+)? skips the word "end"
  // [\s']+ allows a plain space, apostrophe, or "space + apostrophe" before the year digits
  for (const [name, num] of Object.entries(MONTH_MAP)) {
    const re = new RegExp(
      `\\b${KW}[^a-z]*(?:end\\s+)?${name}[\\s']+(\\d{2,4})\\b`,
    );
    m = t.match(re);
    if (m) {
      let yr = parseInt(m[1]);
      if (yr < 100) yr += 2000;
      return `${yr}-${num}`;
    }
  }

  return null;
}

module.exports = { parseBestBefore };
