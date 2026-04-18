"use strict";

const { normalise } = require("./normaliser");
const { fuzzyMatch } = require("./fuzzy-matcher");

async function resolveName(rawName, canonicalNames) {
  const normalised = normalise(rawName);
  const rows = (Array.isArray(canonicalNames) ? canonicalNames : [])
    .map((name) => {
      const canonicalName = String(name || "").trim();
      if (!canonicalName) return null;
      return {
        canonicalName,
        normalisedCanonical: normalise(canonicalName),
      };
    })
    .filter(Boolean);

  const exact = rows.find((row) => row.normalisedCanonical === normalised);
  if (exact?.canonicalName) {
    return {
      normalised,
      match: exact.canonicalName,
      confidence: 1,
      method: "exact",
    };
  }

  const uniqueNormalisedCanonical = Array.from(
    new Set(rows.map((row) => row.normalisedCanonical).filter(Boolean)),
  );
  const fuzzy = fuzzyMatch(normalised, uniqueNormalisedCanonical);
  if (!fuzzy) {
    return { normalised, match: null, confidence: 0, method: "new" };
  }

  const matchedRow = rows.find(
    (row) => row.normalisedCanonical === String(fuzzy.match || ""),
  );
  const matchedCanonicalName = matchedRow?.canonicalName || null;
  if (!matchedCanonicalName) {
    return { normalised, match: null, confidence: 0, method: "new" };
  }

  return {
    normalised,
    match: matchedCanonicalName,
    confidence: fuzzy.confidence,
    method: "fuzzy",
  };
}

module.exports = {
  resolveName,
};
