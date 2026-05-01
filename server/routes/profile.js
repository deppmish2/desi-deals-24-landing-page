"use strict";

const express = require("express");
const db = require("../db");
const requireUserAuth = require("../middleware/user-auth");
const { resolveQueryToCanonicalId } = require("../services/canonicalizer");
const { trackEvent } = require("../services/event-tracker");
const {
  findUserByIdOrCache,
  syncCachedUserById,
} = require("../services/user-store");

const router = express.Router();

const SPEED_PREFS = new Set(["cheapest", "fastest", "same_day_if_available"]);
const ALERT_TYPES = new Set([
  "price",
  "deal",
  "restock_any",
  "restock_store",
  "fresh_arrived",
]);

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeUserType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "basic" || normalized === "premium"
    ? normalized
    : null;
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || null,
    first_name: row.first_name || null,
    postcode: row.postcode,
    city: row.city,
    dietary_prefs: parseJson(row.dietary_prefs, []),
    preferred_stores: parseJson(row.preferred_stores, []),
    blocked_stores: parseJson(row.blocked_stores, []),
    preferred_brands: parseJson(row.preferred_brands, {}),
    delivery_speed_pref: row.delivery_speed_pref || "cheapest",
    user_type: normalizeUserType(row.user_type),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

function getCurrentUser(userId) {
  return findUserByIdOrCache(db, userId);
}

function serializeAlert(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    canonical_id: row.canonical_id,
    product_query: row.product_query,
    alert_type: row.alert_type,
    target_price: row.target_price,
    min_discount_pct: row.min_discount_pct,
    target_store_id: row.target_store_id,
    triggered: Boolean(row.triggered),
    last_triggered_at: row.last_triggered_at,
    is_active: Boolean(row.is_active),
    created_at: row.created_at,
  };
}

router.get("/", requireUserAuth, async (req, res) => {
  const user = await getCurrentUser(req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  res.json({ data: serializeUser(user) });
});

router.put("/", requireUserAuth, async (req, res) => {
  const updates = [];
  const params = [];
  const body = req.body || {};

  if (Object.prototype.hasOwnProperty.call(body, "postcode")) {
    const postcode = String(body.postcode || "").trim();
    if (!postcode)
      return res.status(400).json({ error: "postcode cannot be empty" });
    updates.push("postcode = ?");
    params.push(postcode);
  }

  if (Object.prototype.hasOwnProperty.call(body, "city")) {
    updates.push("city = ?");
    params.push(body.city == null ? null : String(body.city).trim());
  }

  if (Object.prototype.hasOwnProperty.call(body, "dietary_prefs")) {
    if (!Array.isArray(body.dietary_prefs)) {
      return res.status(400).json({ error: "dietary_prefs must be an array" });
    }
    updates.push("dietary_prefs = ?");
    params.push(JSON.stringify(body.dietary_prefs));
  }

  if (Object.prototype.hasOwnProperty.call(body, "preferred_stores")) {
    if (!Array.isArray(body.preferred_stores)) {
      return res
        .status(400)
        .json({ error: "preferred_stores must be an array" });
    }
    updates.push("preferred_stores = ?");
    params.push(JSON.stringify(body.preferred_stores));
  }

  if (Object.prototype.hasOwnProperty.call(body, "blocked_stores")) {
    if (!Array.isArray(body.blocked_stores)) {
      return res.status(400).json({ error: "blocked_stores must be an array" });
    }
    updates.push("blocked_stores = ?");
    params.push(JSON.stringify(body.blocked_stores));
  }

  if (Object.prototype.hasOwnProperty.call(body, "preferred_brands")) {
    if (
      body.preferred_brands == null ||
      typeof body.preferred_brands !== "object" ||
      Array.isArray(body.preferred_brands)
    ) {
      return res
        .status(400)
        .json({ error: "preferred_brands must be an object" });
    }
    updates.push("preferred_brands = ?");
    params.push(JSON.stringify(body.preferred_brands));
  }

  if (Object.prototype.hasOwnProperty.call(body, "delivery_speed_pref")) {
    const pref = String(body.delivery_speed_pref || "").trim();
    if (!SPEED_PREFS.has(pref)) {
      return res.status(400).json({
        error:
          "delivery_speed_pref must be cheapest, fastest, or same_day_if_available",
      });
    }
    updates.push("delivery_speed_pref = ?");
    params.push(pref);
  }

  if (updates.length === 0) {
    const current = await getCurrentUser(req.user.id);
    return res.json({ data: serializeUser(current) });
  }

  params.push(req.user.id);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(
    ...params,
  );

  const user = await syncCachedUserById(db, req.user.id, { strict: true });
  trackEvent(db, "profile.updated", {
    userId: req.user.id,
    route: req.originalUrl,
    entityType: "user",
    entityId: req.user.id,
    payload: {
      fields: updates.map((field) => field.split("=")[0].trim()),
    },
  });
  res.json({ data: serializeUser(user) });
});

// GET /api/v1/me/alerts
router.get("/alerts", requireUserAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT *
     FROM price_alerts
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    )
    .all(req.user.id);

  const data = rows.map(serializeAlert);
  const grouped = {};
  for (const item of data) {
    if (!grouped[item.alert_type]) grouped[item.alert_type] = [];
    grouped[item.alert_type].push(item);
  }

  res.json({ data, grouped });
});

// POST /api/v1/me/alerts
router.post("/alerts", requireUserAuth, async (req, res) => {
  const body = req.body || {};
  const alertType = String(body.alert_type || "").trim();
  let canonicalId = body.canonical_id ? String(body.canonical_id).trim() : null;
  const productQuery = body.product_query
    ? String(body.product_query).trim()
    : null;
  const targetStoreId = body.target_store_id
    ? String(body.target_store_id).trim()
    : null;
  const targetPrice =
    body.target_price == null ? null : Number(body.target_price);
  const minDiscount =
    body.min_discount_pct == null ? null : Number(body.min_discount_pct);

  if (!ALERT_TYPES.has(alertType)) {
    return res.status(400).json({
      error:
        "alert_type must be one of: price, deal, restock_any, restock_store, fresh_arrived",
    });
  }

  if (!canonicalId && !productQuery) {
    return res
      .status(400)
      .json({ error: "Provide either canonical_id or product_query" });
  }

  if (
    alertType === "price" &&
    (targetPrice == null || !Number.isFinite(targetPrice) || targetPrice <= 0)
  ) {
    return res
      .status(400)
      .json({ error: "price alerts require positive target_price" });
  }

  if (
    alertType === "deal" &&
    minDiscount != null &&
    (!Number.isFinite(minDiscount) || minDiscount < 0)
  ) {
    return res
      .status(400)
      .json({ error: "min_discount_pct must be a positive number" });
  }

  if (alertType === "restock_store" && !targetStoreId) {
    return res
      .status(400)
      .json({ error: "restock_store alerts require target_store_id" });
  }

  if (!canonicalId && productQuery) {
    const resolved = await resolveQueryToCanonicalId(db, productQuery, null, {
      createIfMissing: false,
    }).catch(() => null);
    if (resolved?.canonical_id) canonicalId = resolved.canonical_id;
  }

  const result = db
    .prepare(
      `INSERT INTO price_alerts
      (user_id, canonical_id, product_query, alert_type, target_price, min_discount_pct, target_store_id, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      req.user.id,
      canonicalId,
      productQuery,
      alertType,
      alertType === "price" ? targetPrice : null,
      alertType === "deal" ? (minDiscount == null ? null : minDiscount) : null,
      alertType === "restock_store" ? targetStoreId : null,
    );

  const created = db
    .prepare("SELECT * FROM price_alerts WHERE id = ?")
    .get(result.lastInsertRowid);
  trackEvent(db, "alerts.created", {
    userId: req.user.id,
    route: req.originalUrl,
    entityType: "price_alert",
    entityId: String(created.id),
    payload: {
      alert_type: created.alert_type,
      canonical_id: created.canonical_id,
      target_store_id: created.target_store_id,
    },
  });
  res.status(201).json({ data: serializeAlert(created) });
});

// PUT /api/v1/me/alerts/:id
router.put("/alerts/:id", requireUserAuth, (req, res) => {
  const existing = db
    .prepare("SELECT * FROM price_alerts WHERE id = ? AND user_id = ? LIMIT 1")
    .get(req.params.id, req.user.id);

  if (!existing) return res.status(404).json({ error: "Alert not found" });

  const body = req.body || {};
  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body, "target_price")) {
    const v = body.target_price == null ? null : Number(body.target_price);
    if (v != null && (!Number.isFinite(v) || v <= 0)) {
      return res
        .status(400)
        .json({ error: "target_price must be positive or null" });
    }
    updates.push("target_price = ?");
    params.push(v);
  }

  if (Object.prototype.hasOwnProperty.call(body, "min_discount_pct")) {
    const v =
      body.min_discount_pct == null ? null : Number(body.min_discount_pct);
    if (v != null && (!Number.isFinite(v) || v < 0)) {
      return res
        .status(400)
        .json({ error: "min_discount_pct must be positive or null" });
    }
    updates.push("min_discount_pct = ?");
    params.push(v);
  }

  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    updates.push("is_active = ?");
    params.push(body.is_active ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(body, "product_query")) {
    const v =
      body.product_query == null ? null : String(body.product_query).trim();
    updates.push("product_query = ?");
    params.push(v);
  }

  if (Object.prototype.hasOwnProperty.call(body, "canonical_id")) {
    const v =
      body.canonical_id == null ? null : String(body.canonical_id).trim();
    updates.push("canonical_id = ?");
    params.push(v);
  }

  if (updates.length === 0) {
    return res.json({ data: serializeAlert(existing) });
  }

  params.push(existing.id, req.user.id);
  db.prepare(
    `UPDATE price_alerts SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
  ).run(...params);

  const updated = db
    .prepare("SELECT * FROM price_alerts WHERE id = ?")
    .get(existing.id);
  trackEvent(db, "alerts.updated", {
    userId: req.user.id,
    route: req.originalUrl,
    entityType: "price_alert",
    entityId: String(updated.id),
    payload: {
      fields: updates.map((field) => field.split("=")[0].trim()),
      alert_type: updated.alert_type,
    },
  });
  res.json({ data: serializeAlert(updated) });
});

// DELETE /api/v1/me/alerts/:id
router.delete("/alerts/:id", requireUserAuth, (req, res) => {
  const result = db
    .prepare("DELETE FROM price_alerts WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.user.id);

  if (result.changes === 0)
    return res.status(404).json({ error: "Alert not found" });
  trackEvent(db, "alerts.deleted", {
    userId: req.user.id,
    route: req.originalUrl,
    entityType: "price_alert",
    entityId: String(req.params.id),
  });
  res.json({ ok: true });
});

module.exports = router;
