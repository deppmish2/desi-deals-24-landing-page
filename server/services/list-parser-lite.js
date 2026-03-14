"use strict";

// Lightweight parser for POC: splits list text and extracts optional qty/unit tokens.
const UNITS = new Set([
  "kg",
  "g",
  "gm",
  "ml",
  "l",
  "ltr",
  "litre",
  "liter",
  "pack",
  "packs",
  "pcs",
  "units",
]);

// Normalize unit aliases to canonical forms
const UNIT_ALIASES = { gm: "g", ltr: "l", litre: "l", liter: "l" };

function normalizeChunk(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLine(rawLine) {
  const line = normalizeChunk(rawLine);
  if (!line) return null;

  const qtyMatch = line.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s+(.+)$/);
  if (qtyMatch) {
    const quantity = parseFloat(qtyMatch[1]);
    const maybeUnit = (qtyMatch[2] || "").toLowerCase();
    const itemText = normalizeChunk(qtyMatch[3]);

    if (itemText) {
      const canonicalUnit = UNITS.has(maybeUnit)
        ? UNIT_ALIASES[maybeUnit] || maybeUnit
        : null;
      return {
        raw_item_text: itemText,
        quantity,
        quantity_unit: canonicalUnit,
        resolved: 0,
        unresolvable: 0,
      };
    }
  }

  return {
    raw_item_text: line,
    quantity: null,
    quantity_unit: null,
    resolved: 0,
    unresolvable: 0,
  };
}

function splitIntoLines(rawInput) {
  return String(rawInput || "")
    .split(/[\n,;]+/)
    .map(normalizeChunk)
    .filter(Boolean);
}

function parseShoppingInput(rawInput) {
  const lines = splitIntoLines(rawInput);
  const items = [];

  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed) items.push(parsed);
  }

  return items;
}

module.exports = {
  parseShoppingInput,
};
