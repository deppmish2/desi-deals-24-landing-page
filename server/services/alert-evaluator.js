"use strict";

const db = require("../db");

async function evaluatePriceAlerts() {
  const rows = await db.prepare(`
    SELECT
      pa.id          AS alert_id,
      pa.user_id,
      pa.canonical_id,
      pa.price_threshold,
      pa.store_id    AS alert_store_id,
      cp.canonical_name,
      sp.sale_price,
      sp.store_id,
      sp.product_url,
      s.name         AS store_name,
      s.url          AS store_url
    FROM product_alerts pa
    JOIN canonical_products cp ON cp.id = pa.canonical_id
    JOIN store_products sp ON sp.canonical_id = pa.canonical_id AND sp.is_active = 1
    JOIN stores s ON s.id = sp.store_id
    WHERE pa.alert_type = 'price_below'
      AND sp.sale_price < pa.price_threshold
      AND (pa.store_id IS NULL OR pa.store_id = sp.store_id)
  `).all();

  // Keep cheapest match per alert when store_id is unconstrained
  const seen = new Map();
  for (const row of rows) {
    const key = row.alert_id;
    if (!seen.has(key) || row.sale_price < seen.get(key).sale_price) {
      seen.set(key, { ...row, alert_type: "price_below" });
    }
  }
  return Array.from(seen.values());
}

async function evaluateBackInStockAlerts(newlyActiveDealIds) {
  if (!newlyActiveDealIds || newlyActiveDealIds.length === 0) return [];

  const placeholders = newlyActiveDealIds.map(() => "?").join(",");
  const rows = await db.prepare(`
    SELECT
      pa.id          AS alert_id,
      pa.user_id,
      pa.canonical_id,
      pa.store_id    AS alert_store_id,
      cp.canonical_name,
      sp.sale_price,
      sp.store_id,
      sp.product_url,
      s.name         AS store_name,
      s.url          AS store_url
    FROM product_alerts pa
    JOIN canonical_products cp ON cp.id = pa.canonical_id
    JOIN store_products sp ON sp.canonical_id = pa.canonical_id AND sp.id IN (${placeholders})
    JOIN stores s ON s.id = sp.store_id
    WHERE pa.alert_type = 'back_in_stock'
      AND (pa.store_id IS NULL OR pa.store_id = sp.store_id)
  `).all(...newlyActiveDealIds);
  return rows.map(r => ({ ...r, alert_type: "back_in_stock" }));
}

async function consumeAlert(alertId) {
  await db.prepare("DELETE FROM product_alerts WHERE id = ?").run(alertId);
}

module.exports = { evaluatePriceAlerts, evaluateBackInStockAlerts, consumeAlert };
