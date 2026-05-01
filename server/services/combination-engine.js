"use strict";

/**
 * Quantity Combination Engine
 *
 * Finds the cheapest EXACT combination of package sizes that sums to a target
 * quantity. Implements the spec in agent_files/matching_spec.md.
 *
 * Algorithm: dynamic programming (unbounded coin-change variant).
 * Complexity: O(target_qty × num_pack_sizes) — practical for grocery quantities.
 */

/**
 * Convert weight/volume value+unit to base units.
 * Mass → grams, Volume → millilitres.
 * Returns { qty: number, type: "mass"|"volume" } or null if unsupported unit.
 */
function toBaseQty(value, unit) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  const u = String(unit || "").trim().toLowerCase();
  if (u === "kg") return { qty: Math.round(num * 1000), type: "mass" };
  if (u === "g") return { qty: Math.round(num), type: "mass" };
  if (u === "l") return { qty: Math.round(num * 1000), type: "volume" };
  if (u === "ml") return { qty: Math.round(num), type: "volume" };
  return null;
}

/**
 * Find the cheapest exact combination of package sizes that sums to targetQty.
 *
 * @param {Array<{ size: number, price: number, deal: object }>} packOptions
 *   Available pack sizes in base units (grams or ml) with their prices.
 * @param {number} targetQty - Target quantity in base units.
 * @returns {{ combinations: Array<{deal, count, pack_size}>, total_price: number } | null}
 *   null when no exact combination is achievable.
 */
function findCheapestExactCombination(packOptions, targetQty) {
  if (!packOptions || packOptions.length === 0) return null;
  if (!Number.isFinite(targetQty) || targetQty <= 0) return null;

  // Safety cap: avoid DP array explosion. 50 000 g = 50 kg is enough for groceries.
  if (targetQty > 50000) return null;

  // Deduplicate by size — keep the cheapest price for each pack size.
  const sizeMap = new Map(); // size (int) → { price, deal }
  for (const opt of packOptions) {
    const size = Number(opt.size);
    const price = Number(opt.price);
    if (!Number.isFinite(size) || size <= 0) continue;
    if (!Number.isFinite(price) || price < 0) continue;
    if (!sizeMap.has(size) || price < sizeMap.get(size).price) {
      sizeMap.set(size, { price, deal: opt.deal });
    }
  }

  const packs = Array.from(sizeMap.entries()).map(([size, { price, deal }]) => ({
    size,
    price,
    deal,
  }));
  if (packs.length === 0) return null;

  // dp[amount] = { cost: number, packSize: number } | null
  // cost is the minimum total price to reach exactly `amount` grams/ml.
  const dp = new Array(targetQty + 1).fill(null);
  dp[0] = { cost: 0, packSize: -1 };

  for (let amount = 1; amount <= targetQty; amount++) {
    for (const pack of packs) {
      if (pack.size > amount) continue;
      const prev = dp[amount - pack.size];
      if (prev === null) continue;
      const newCost = prev.cost + pack.price;
      if (dp[amount] === null || newCost < dp[amount].cost) {
        dp[amount] = { cost: newCost, packSize: pack.size };
      }
    }
  }

  if (dp[targetQty] === null) return null; // No exact combination exists.

  // Trace back to reconstruct which pack sizes were selected.
  const countsBySize = new Map();
  let cur = targetQty;
  while (cur > 0) {
    const { packSize } = dp[cur];
    countsBySize.set(packSize, (countsBySize.get(packSize) || 0) + 1);
    cur -= packSize;
  }

  const combinations = [];
  for (const [size, count] of countsBySize.entries()) {
    const { deal } = sizeMap.get(size);
    combinations.push({ deal, count, pack_size: size });
  }

  return {
    combinations,
    total_price: Math.round(dp[targetQty].cost * 100) / 100,
  };
}

module.exports = { toBaseQty, findCheapestExactCombination };
