"use strict";

const synonyms = require("./synonyms.json");

const UNIT_RE = /\b(kg|kilo|kilogram|g|gram|ml|ltr|litre|liter|l|oz|lb)\b/g;
const QUALIFIER_RE =
  /\b(organic|premium|extra|special|fresh|pure|whole|split|hulled)\b/g;
const PACK_RE = /\b(pack|packet|pouch|bag|box|tin|jar|bottle|sachet)\b/g;

function applySynonyms(value) {
  let result = value;
  for (const [from, to] of Object.entries(synonyms)) {
    const re = new RegExp(
      `\\b${from.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}\\b`,
      "g",
    );
    result = result.replace(re, to);
  }
  return result;
}

function normalise(rawName) {
  const source = String(rawName || "").toLowerCase();
  if (!source) return "";

  return applySynonyms(
    source
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(UNIT_RE, " ")
      .replace(QUALIFIER_RE, " ")
      .replace(PACK_RE, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  normalise,
};
