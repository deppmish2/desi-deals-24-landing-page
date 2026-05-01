"use strict";

const crypto = require("crypto");
const express = require("express");

const db = require("../db");
const requireUserAuth = require("../middleware/user-auth");
const { parseShoppingList } = require("../services/list-parser");
const { resolveQueryToCanonicalId } = require("../services/canonicalizer");
const { parseItemIntent } = require("../services/item-matcher");
const { parseProductName } = require("../services/product-parser");
const { trackEvent } = require("../services/event-tracker");
const { bestSmartScore } = require("../services/smart-ranker");
const { expandQuery } = require("../services/search-expander");

const CANONICAL_LINK_THRESHOLD = 0.45;

function toBaseQuantity(value, unit, packCount = 1) {
  const qty = Number(value);
  const count = Number(packCount);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(count) || count <= 0) return null;

  const normalizedUnit = String(unit || "").trim().toLowerCase();
  if (normalizedUnit === "kg") return { qty: qty * 1000 * count, type: "mass" };
  if (normalizedUnit === "g") return { qty: qty * count, type: "mass" };
  if (normalizedUnit === "l") return { qty: qty * 1000 * count, type: "volume" };
  if (normalizedUnit === "ml") return { qty: qty * count, type: "volume" };
  return null;
}

function hasCompatibleCanonicalSize(query, quantity, quantityUnit, canonicalName) {
  const intent = parseItemIntent(query, quantity, quantityUnit);
  const requestedSize = toBaseQuantity(intent?.size?.value, intent?.size?.unit);
  if (!requestedSize) return true;

  const parsedCanonical = parseProductName(canonicalName || "");
  const canonicalSize = toBaseQuantity(
    parsedCanonical?.weight_value,
    parsedCanonical?.weight_unit,
    parsedCanonical?.pack_count || 1,
  );
  if (!canonicalSize) return false;
  if (canonicalSize.type !== requestedSize.type) return false;

  return Math.abs(canonicalSize.qty - requestedSize.qty) <= 0.001;
}

function validateCanonicalMatch(query, canonicalId, quantity = null, quantityUnit = null) {
  if (!canonicalId || !query) return false;
  const row = db
    .prepare(
      "SELECT canonical_name FROM canonical_products WHERE id = ? LIMIT 1",
    )
    .get(canonicalId);
  if (!row) return false;
  const expandedTerms = expandQuery(String(query).trim());
  const score = bestSmartScore(expandedTerms, row.canonical_name);
  if (score < CANONICAL_LINK_THRESHOLD) return false;
  return hasCompatibleCanonicalSize(
    query,
    quantity,
    quantityUnit,
    row.canonical_name,
  );
}
const {
  cacheList,
  getCachedList,
  getCachedUserLists,
} = require("../services/session-store");

const router = express.Router();

function serializeList(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    raw_input: row.raw_input,
    input_method: row.input_method,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    reorder_reminder_days: row.reorder_reminder_days,
  };
}

function serializeItem(row) {
  return {
    id: row.id,
    list_id: row.list_id,
    canonical_id: row.canonical_id,
    raw_item_text: row.raw_item_text,
    quantity: row.quantity,
    quantity_unit: row.quantity_unit,
    item_count: row.item_count != null ? Number(row.item_count) : 1,
    brand_pref: row.brand_pref,
    resolved: Boolean(row.resolved),
    unresolvable: Boolean(row.unresolvable),
  };
}

function normalizeIncomingListItem(item) {
  const rawItemText = String(item?.raw_item_text || item?.name || "").trim();
  if (!rawItemText) return null;

  let quantity = null;
  if (item?.quantity != null && item.quantity !== "") {
    const parsed = Number(item.quantity);
    quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const quantityUnit =
    item?.quantity_unit == null
      ? null
      : String(item.quantity_unit).trim().toLowerCase() || null;

  const rawItemCount =
    item?.item_count == null || item.item_count === ""
      ? 1
      : Number(item.item_count);
  const itemCount = Number.isFinite(rawItemCount) ? Math.max(1, rawItemCount) : 1;

  const brandPref =
    item?.brand_pref == null ? null : String(item.brand_pref).trim() || null;

  return {
    raw_item_text: rawItemText,
    quantity,
    quantity_unit: quantityUnit,
    item_count: itemCount,
    brand_pref: brandPref,
  };
}

function getOwnedList(listId, userId) {
  return db
    .prepare(
      `SELECT *
     FROM shopping_lists
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    )
    .get(listId, userId);
}

router.use(requireUserAuth);

// POST /api/v1/lists
router.post("/", async (req, res) => {
  const name = String(req.body?.name || "").trim() || "My List";
  const bodyItems = Array.isArray(req.body?.items)
    ? req.body.items.map(normalizeIncomingListItem).filter(Boolean)
    : [];
  const rawInput =
    String(req.body?.raw_input || "").trim() ||
    bodyItems.map((item) => item.raw_item_text).join(", ");
  const inputMethod = String(req.body?.input_method || "text")
    .trim()
    .toLowerCase();

  if (inputMethod && !["text", "voice"].includes(inputMethod)) {
    return res
      .status(400)
      .json({ error: "input_method must be text or voice" });
  }

  const listId = crypto.randomUUID();
  const now = new Date().toISOString();

  // On Vercel, SQLite is ephemeral — ensure the user row exists so the FK
  // constraint on shopping_lists.user_id doesn't fail on cold-start instances.
  const userEmail =
    typeof req.user.email === "string" && req.user.email.trim()
      ? req.user.email.trim().toLowerCase()
      : `user-${req.user.id}@local.invalid`;
  try {
    db.prepare(
      `INSERT OR IGNORE INTO users
        (id, email, password_hash, google_id, postcode, city, dietary_prefs,
         preferred_stores, blocked_stores, preferred_brands,
         delivery_speed_pref, created_at, last_login_at)
       VALUES (?, ?, NULL, NULL, '', NULL, ?, ?, ?, ?, 'cheapest', ?, ?)`,
    ).run(
      req.user.id,
      userEmail,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({}),
      now,
      now,
    );
  } catch (e) {
    console.warn("[lists] Failed to ensure user row:", e.message);
  }

  db.prepare(
    `INSERT INTO shopping_lists
      (id, user_id, name, raw_input, input_method, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    listId,
    req.user.id,
    name,
    rawInput || null,
    inputMethod || null,
    now,
    now,
  );

  const parsedItems =
    bodyItems.length > 0
      ? bodyItems
      : rawInput
        ? (await parseShoppingList(rawInput)).items
        : [];
  const resolvedItems = [];

  for (const item of parsedItems) {
    const resolved = await resolveQueryToCanonicalId(
      db,
      item.raw_item_text,
      null,
      {
        createIfMissing: false,
      },
    ).catch(() => null);
    const canonicalId =
      resolved?.canonical_id &&
      validateCanonicalMatch(
        item.raw_item_text,
        resolved.canonical_id,
        item.quantity,
        item.quantity_unit,
      )
        ? resolved.canonical_id
        : null;
    resolvedItems.push({
      ...item,
      canonical_id: canonicalId,
      resolved: canonicalId ? 1 : 0,
      unresolvable: canonicalId ? 0 : 1,
    });
  }

  const insertItem = db.prepare(
    `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, brand_pref, resolved, unresolvable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction((items) => {
    for (const item of items) {
      insertItem.run(
        listId,
        item.canonical_id || null,
        item.raw_item_text,
        item.quantity,
        item.quantity_unit,
        item.item_count != null ? Math.max(1, Number(item.item_count) || 1) : 1,
        item.brand_pref || null,
        item.resolved ? 1 : 0,
        item.unresolvable ? 1 : 0,
      );
    }
  });

  tx(resolvedItems);

  const list = getOwnedList(listId, req.user.id);
  const items = db
    .prepare("SELECT * FROM list_items WHERE list_id = ? ORDER BY id ASC")
    .all(listId);

  // Persist to Redis so the list survives Vercel cold starts
  await cacheList(req.user.id, list, items).catch(() => {});

  trackEvent(db, "lists.created", {
    userId: req.user.id,
    route: req.originalUrl,
    entityType: "shopping_list",
    entityId: listId,
    payload: {
      parsed_count: items.length,
      input_method: inputMethod || null,
    },
  });

  res.status(201).json({
    data: serializeList(list),
    items: items.map(serializeItem),
    parsed_count: items.length,
  });
});

// GET /api/v1/lists
router.get("/", async (req, res) => {
  const rows = db
    .prepare(
      `SELECT l.*, COUNT(i.id) AS items_count
     FROM shopping_lists l
     LEFT JOIN list_items i ON i.list_id = l.id
     WHERE l.user_id = ?
     GROUP BY l.id
     ORDER BY l.created_at DESC`,
    )
    .all(req.user.id);

  if (rows.length === 0) {
    // Cold start: SQLite empty — restore from Redis
    const cached = await getCachedUserLists(req.user.id).catch(() => []);
    if (cached.length > 0) {
      return res.json({
        data: cached.map(({ list, items }) => ({
          ...serializeList(list),
          items_count: (items || []).length,
        })),
      });
    }
  }

  res.json({
    data: rows.map((row) => ({
      ...serializeList(row),
      items_count: row.items_count,
    })),
  });
});

// GET /api/v1/lists/:id
router.get("/:id", async (req, res) => {
  const list = getOwnedList(req.params.id, req.user.id);
  if (!list) {
    // Cold start: try Redis
    const cached = await getCachedList(req.params.id).catch(() => null);
    if (cached?.list && cached.list.user_id === req.user.id) {
      return res.json({
        data: serializeList(cached.list),
        items: (cached.items || []).map(serializeItem),
      });
    }
    return res.status(404).json({ error: "List not found" });
  }

  const items = db
    .prepare("SELECT * FROM list_items WHERE list_id = ? ORDER BY id ASC")
    .all(list.id);
  res.json({
    data: serializeList(list),
    items: items.map(serializeItem),
  });
});

// PUT /api/v1/lists/:id
router.put("/:id", (req, res) => {
  const list = getOwnedList(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: "List not found" });

  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
    const value = String(req.body.name || "").trim();
    if (!value) return res.status(400).json({ error: "name cannot be empty" });
    updates.push("name = ?");
    params.push(value);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "raw_input")) {
    const value =
      req.body.raw_input == null ? null : String(req.body.raw_input).trim();
    updates.push("raw_input = ?");
    params.push(value || null);
  }

  if (Object.prototype.hasOwnProperty.call(req.body || {}, "input_method")) {
    const value =
      req.body.input_method == null
        ? null
        : String(req.body.input_method).trim().toLowerCase();
    if (value && !["text", "voice"].includes(value)) {
      return res
        .status(400)
        .json({ error: "input_method must be text or voice" });
    }
    updates.push("input_method = ?");
    params.push(value || null);
  }

  if (
    Object.prototype.hasOwnProperty.call(
      req.body || {},
      "reorder_reminder_days",
    )
  ) {
    const value = req.body.reorder_reminder_days;
    if (
      value != null &&
      (!Number.isInteger(value) || value < 1 || value > 365)
    ) {
      return res.status(400).json({
        error: "reorder_reminder_days must be null or integer 1..365",
      });
    }
    updates.push("reorder_reminder_days = ?");
    params.push(value == null ? null : value);
  }

  if (updates.length > 0) {
    updates.push("last_used_at = ?");
    params.push(new Date().toISOString());
    params.push(list.id, req.user.id);
    db.prepare(
      `UPDATE shopping_lists SET ${updates.join(", ")} WHERE id = ? AND user_id = ?`,
    ).run(...params);
  }

  const updated = getOwnedList(list.id, req.user.id);
  res.json({ data: serializeList(updated) });
});

// DELETE /api/v1/lists/:id
router.delete("/:id", (req, res) => {
  const list = getOwnedList(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: "List not found" });

  db.prepare("DELETE FROM shopping_lists WHERE id = ? AND user_id = ?").run(
    list.id,
    req.user.id,
  );
  res.json({ ok: true });
});

// POST /api/v1/lists/:id/items
router.post("/:id/items", async (req, res) => {
  const list = getOwnedList(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: "List not found" });

  const rawItemText = String(req.body?.raw_item_text || "").trim();
  if (!rawItemText) {
    return res.status(400).json({ error: "raw_item_text is required" });
  }

  const quantity =
    req.body?.quantity == null ? null : Number(req.body.quantity);
  if (quantity != null && !Number.isFinite(quantity)) {
    return res.status(400).json({ error: "quantity must be numeric or null" });
  }

  const resolved = await resolveQueryToCanonicalId(db, rawItemText, null, {
    createIfMissing: false,
  }).catch(() => null);
  const resolvedCanonicalId =
    resolved?.canonical_id &&
    validateCanonicalMatch(
      rawItemText,
      resolved.canonical_id,
      quantity,
      req.body?.quantity_unit || null,
    )
      ? resolved.canonical_id
      : null;

  const rawItemCount =
    req.body?.item_count != null ? Number(req.body.item_count) : 1;
  const itemCount = Number.isFinite(rawItemCount) ? Math.max(1, rawItemCount) : 1;

  const result = db
    .prepare(
      `INSERT INTO list_items
      (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, brand_pref, resolved, unresolvable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      list.id,
      req.body?.canonical_id || resolvedCanonicalId || null,
      rawItemText,
      quantity,
      req.body?.quantity_unit || null,
      itemCount,
      req.body?.brand_pref || null,
      req.body?.resolved != null
        ? req.body.resolved
          ? 1
          : 0
        : resolvedCanonicalId
          ? 1
          : 0,
      req.body?.unresolvable != null
        ? req.body.unresolvable
          ? 1
          : 0
        : resolvedCanonicalId
          ? 0
          : 1,
    );

  const item = db
    .prepare("SELECT * FROM list_items WHERE id = ?")
    .get(result.lastInsertRowid);
  trackEvent(db, "lists.item_added", {
    userId: req.user.id,
    route: req.originalUrl,
    entityType: "shopping_list",
    entityId: list.id,
    payload: {
      item_id: item.id,
      canonical_id: item.canonical_id || null,
      raw_item_text: item.raw_item_text,
    },
  });
  res.status(201).json({ data: serializeItem(item) });
});

// PUT /api/v1/lists/:id/items/:itemId
router.put("/:id/items/:itemId", async (req, res) => {
  const list = getOwnedList(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: "List not found" });

  const existing = db
    .prepare("SELECT * FROM list_items WHERE id = ? AND list_id = ?")
    .get(req.params.itemId, list.id);

  if (!existing) return res.status(404).json({ error: "List item not found" });

  const updates = [];
  const params = [];
  const body = req.body || {};
  let nextRawItemText = existing.raw_item_text;
  let nextQuantity = existing.quantity;
  let nextQuantityUnit = existing.quantity_unit;
  let recomputeCanonical = false;

  if (Object.prototype.hasOwnProperty.call(body, "raw_item_text")) {
    const value = String(body.raw_item_text || "").trim();
    if (!value)
      return res.status(400).json({ error: "raw_item_text cannot be empty" });
    updates.push("raw_item_text = ?");
    params.push(value);
    nextRawItemText = value;
    recomputeCanonical = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "quantity")) {
    const value = body.quantity == null ? null : Number(body.quantity);
    if (value != null && !Number.isFinite(value))
      return res
        .status(400)
        .json({ error: "quantity must be numeric or null" });
    updates.push("quantity = ?");
    params.push(value);
    nextQuantity = value;
    recomputeCanonical = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "quantity_unit")) {
    const value = body.quantity_unit || null;
    updates.push("quantity_unit = ?");
    params.push(value);
    nextQuantityUnit = value;
    recomputeCanonical = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, "item_count")) {
    const rawCount = body.item_count == null ? 1 : Number(body.item_count);
    const count = Number.isFinite(rawCount) ? Math.max(1, rawCount) : 1;
    updates.push("item_count = ?");
    params.push(count);
  }

  if (Object.prototype.hasOwnProperty.call(body, "brand_pref")) {
    updates.push("brand_pref = ?");
    params.push(body.brand_pref || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, "canonical_id")) {
    updates.push("canonical_id = ?");
    params.push(body.canonical_id || null);
  }

  if (Object.prototype.hasOwnProperty.call(body, "resolved")) {
    updates.push("resolved = ?");
    params.push(body.resolved ? 1 : 0);
  }

  if (Object.prototype.hasOwnProperty.call(body, "unresolvable")) {
    updates.push("unresolvable = ?");
    params.push(body.unresolvable ? 1 : 0);
  }

  if (
    recomputeCanonical &&
    !Object.prototype.hasOwnProperty.call(body, "canonical_id")
  ) {
    const resolved = await resolveQueryToCanonicalId(db, nextRawItemText, null, {
      createIfMissing: false,
    }).catch(() => null);
    const resolvedCanonicalId =
      resolved?.canonical_id &&
      validateCanonicalMatch(
        nextRawItemText,
        resolved.canonical_id,
        nextQuantity,
        nextQuantityUnit,
      )
        ? resolved.canonical_id
        : null;

    updates.push("canonical_id = ?");
    params.push(resolvedCanonicalId);

    if (!Object.prototype.hasOwnProperty.call(body, "resolved")) {
      updates.push("resolved = ?");
      params.push(resolvedCanonicalId ? 1 : 0);
    }
    if (!Object.prototype.hasOwnProperty.call(body, "unresolvable")) {
      updates.push("unresolvable = ?");
      params.push(resolvedCanonicalId ? 0 : 1);
    }
  }

  if (updates.length === 0) {
    return res.json({ data: serializeItem(existing) });
  }

  params.push(existing.id, list.id);
  db.prepare(
    `UPDATE list_items SET ${updates.join(", ")} WHERE id = ? AND list_id = ?`,
  ).run(...params);

  const updated = db
    .prepare("SELECT * FROM list_items WHERE id = ?")
    .get(existing.id);
  res.json({ data: serializeItem(updated) });
});

// DELETE /api/v1/lists/:id/items/:itemId
router.delete("/:id/items/:itemId", (req, res) => {
  const list = getOwnedList(req.params.id, req.user.id);
  if (!list) return res.status(404).json({ error: "List not found" });

  const result = db
    .prepare("DELETE FROM list_items WHERE id = ? AND list_id = ?")
    .run(req.params.itemId, list.id);
  if (result.changes === 0)
    return res.status(404).json({ error: "List item not found" });

  res.json({ ok: true });
});

module.exports = router;
