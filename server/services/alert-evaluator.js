"use strict";

const { sendAlertNotification } = require("./alert-notifier");

const ALERT_TYPES = new Set(["price", "deal", "restock_any", "restock_store"]);

function buildPattern(alert) {
  const base = String(alert.product_query || alert.canonical_id || "").trim();
  if (!base) return null;
  return `%${base.replace(/[-_]+/g, " ")}%`;
}

function cooldownMs() {
  const minutes = Math.max(
    1,
    parseInt(process.env.ALERT_COOLDOWN_MINUTES || "720", 10),
  );
  return minutes * 60 * 1000;
}

function shouldSkipDueCooldown(alert) {
  if (!alert.last_triggered_at) return false;
  const last = Date.parse(alert.last_triggered_at);
  if (Number.isNaN(last)) return false;
  return Date.now() - last < cooldownMs();
}

async function queryMatchesForAlert(db, alert) {
  let sql = `
    SELECT d.*, s.name AS store_name
    FROM deals d
    JOIN stores s ON s.id = d.store_id
    WHERE d.is_active = 1
      AND d.availability = 'in_stock'
  `;
  const params = [];

  if (alert.canonical_id) {
    sql += " AND d.canonical_id = ?";
    params.push(alert.canonical_id);
  } else {
    const pattern = buildPattern(alert);
    if (!pattern) return [];
    sql += " AND d.product_name LIKE ?";
    params.push(pattern);
  }

  if (alert.target_store_id) {
    sql += " AND d.store_id = ?";
    params.push(alert.target_store_id);
  }

  if (alert.alert_type === "price") {
    sql += " AND d.sale_price <= ?";
    params.push(Number(alert.target_price || 0));
  }

  if (alert.alert_type === "deal") {
    sql += " AND COALESCE(d.discount_percent, 0) >= ?";
    params.push(
      Number(alert.min_discount_pct != null ? alert.min_discount_pct : 1),
    );
  }

  sql += " ORDER BY d.sale_price ASC LIMIT 15";
  return await db.prepare(sql).all(...params);
}

async function evaluateAlertsAfterCrawl(db, { runId }) {
  const alerts = await db
    .prepare(
      `SELECT a.*, u.id AS user_id, u.email
     FROM price_alerts a
     JOIN users u ON u.id = a.user_id
     WHERE a.is_active = 1`,
    )
    .all();

  let triggeredCount = 0;

  for (const alert of alerts) {
    if (!ALERT_TYPES.has(alert.alert_type)) continue;
    if (shouldSkipDueCooldown(alert)) continue;

    if (alert.alert_type === "price" && alert.target_price == null) continue;
    if (!alert.product_query && !alert.canonical_id) continue;
    if (alert.alert_type === "restock_store" && !alert.target_store_id)
      continue;

    const matches = await queryMatchesForAlert(db, alert);
    if (matches.length === 0) continue;

    await sendAlertNotification(db, {
      alert,
      user: { id: alert.user_id, email: alert.email },
      matches,
      context: `crawl_run:${runId}`,
    });

    await db.prepare(
      `UPDATE price_alerts
       SET triggered = 1, last_triggered_at = ?
       WHERE id = ?`,
    ).run(new Date().toISOString(), alert.id);

    triggeredCount += 1;
  }

  if (triggeredCount > 0) {
    console.log(
      `[alerts] Triggered ${triggeredCount} alerts after crawl ${runId}`,
    );
  }

  return { triggered: triggeredCount };
}

module.exports = {
  evaluateAlertsAfterCrawl,
};
