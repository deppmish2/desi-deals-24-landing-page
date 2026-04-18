"use strict";

function parseDiscountBadge(text) {
  if (!text) return null;
  const match = String(text).match(/(-?\d+(?:[.,]\d+)?)\s*%/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) ? Math.abs(value) : null;
}

module.exports = { parseDiscountBadge };
