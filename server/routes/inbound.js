"use strict";

const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const { sendAlertNotification } = require("../services/alert-notifier");
const { resolveQueryToCanonicalId } = require("../services/canonicalizer");
const { trackEvent } = require("../services/event-tracker");

const router = express.Router();

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ""));
  const bBuf = Buffer.from(String(b || ""));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function signatureForPayload(secret, payload) {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload || {}))
    .digest("hex");
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

async function findFreshAlertsForItem(productName) {
  const term = normalize(productName);
  if (!term) return [];
  const resolved = await resolveQueryToCanonicalId(db, productName, null, {
    createIfMissing: false,
  }).catch(() => null);

  const alerts = db
    .prepare(
      `SELECT a.*, u.email
     FROM price_alerts a
     JOIN users u ON u.id = a.user_id
     WHERE a.is_active = 1
       AND a.alert_type = 'fresh_arrived'`,
    )
    .all();

  return alerts.filter((alert) => {
    if (
      resolved?.canonical_id &&
      alert.canonical_id &&
      alert.canonical_id === resolved.canonical_id
    ) {
      return true;
    }
    const q = normalize(alert.product_query || alert.canonical_id);
    if (!q) return false;
    return term.includes(q) || q.includes(term);
  });
}

async function processPayload(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const now = new Date().toISOString();

  for (const item of items) {
    const productName = String(item?.product_name || "").trim();
    if (!productName) continue;

    const alerts = await findFreshAlertsForItem(productName);
    for (const alert of alerts) {
      await sendAlertNotification(db, {
        alert,
        user: { id: alert.user_id, email: alert.email },
        matches: [{ query: productName, store_id: payload.store_id }],
        context: "inbound:fresh-stock",
      });

      db.prepare(
        `UPDATE price_alerts
         SET triggered = 1, last_triggered_at = ?
         WHERE id = ?`,
      ).run(now, alert.id);
    }
  }
}

// POST /api/v1/inbound/fresh-stock
router.post("/fresh-stock", async (req, res) => {
  const payload = req.body || {};
  const storeId = String(payload.store_id || "").trim();
  if (!storeId) return res.status(400).json({ error: "store_id is required" });

  const store = db
    .prepare("SELECT id, webhook_secret FROM stores WHERE id = ? LIMIT 1")
    .get(storeId);
  if (!store || !store.webhook_secret) {
    return res.status(401).json({ error: "Store webhook is not configured" });
  }

  const signature = req.headers["x-webhook-signature"];
  if (!signature)
    return res
      .status(401)
      .json({ error: "Missing X-Webhook-Signature header" });

  const expected = signatureForPayload(store.webhook_secret, payload);
  if (!safeEqual(signature, expected)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  trackEvent(db, "inbound.fresh_stock.accepted", {
    route: req.originalUrl,
    entityType: "store",
    entityId: storeId,
    source: "webhook",
    payload: {
      items_count: Array.isArray(payload.items) ? payload.items.length : 0,
    },
  });

  setImmediate(() => {
    processPayload(payload).catch((error) => {
      console.error(
        "[inbound:fresh-stock] async processing failed:",
        error.message,
      );
    });
  });

  res.json({ ok: true, accepted: true });
});

module.exports = router;
