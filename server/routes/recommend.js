"use strict";

const express = require("express");
const db = require("../db");
const requireUserAuth = require("../middleware/user-auth");
const {
  recommendForList,
  searchStrictReplacementOptions,
} = require("../services/recommender");
const { buildCartTransfer } = require("../services/cart-transfer");
const { trackEvent } = require("../services/event-tracker");
const { getCachedList, getCachedUser } = require("../services/session-store");
const { restoreFromSnapshot } = require("../../crawler/utils/snapshot");
const { restoreDealsFromSeed } = require("../services/deals-seed-loader");

const router = express.Router();
const PREFS = new Set(["cheapest", "fastest", "same_day_if_available"]);
const MASS_VOLUME_UNITS = new Set(["kg", "g", "l", "ml"]);
const RECOMMEND_COLD_START_TIMEOUT_MS = Math.max(
  300,
  parseInt(process.env.RECOMMEND_COLD_START_TIMEOUT_MS || "10000", 10),
);
const RECOMMEND_COLD_START_POLL_MS = Math.max(
  100,
  parseInt(process.env.RECOMMEND_COLD_START_POLL_MS || "300", 10),
);

function normalizeIncomingItem(item) {
  const rawItemText = String(item?.raw_item_text || item?.name || "").trim();
  if (!rawItemText) return null;

  let quantity = null;
  if (item?.quantity != null && item.quantity !== "") {
    const n = Number(item.quantity);
    quantity = Number.isFinite(n) && n > 0 ? n : null;
  }

  const quantityUnit =
    item?.quantity_unit == null
      ? null
      : String(item.quantity_unit).trim().toLowerCase() || null;

  const rawItemCount =
    item?.item_count == null || item.item_count === ""
      ? 1
      : Number(item.item_count);
  const itemCount = Number.isFinite(rawItemCount)
    ? Math.max(1, Math.round(rawItemCount))
    : 1;

  return {
    raw_item_text: rawItemText,
    quantity,
    quantity_unit: quantityUnit,
    item_count: itemCount,
  };
}

function hasStructuredSize(item) {
  const quantity = Number(item?.quantity);
  const unit = String(item?.quantity_unit || "").trim().toLowerCase();
  return (
    Number.isFinite(quantity) &&
    quantity > 0 &&
    MASS_VOLUME_UNITS.has(unit)
  );
}

function normalizedItemCount(value, fallback = 1) {
  const count = Number(value);
  if (Number.isFinite(count) && count >= 1) return Math.max(1, Math.round(count));
  return Math.max(1, Number(fallback) || 1);
}

function mergeRequestedItem(dbItem, requestedItem) {
  const requestedHasStructuredSize = hasStructuredSize(requestedItem);
  const dbHasStructuredSize = hasStructuredSize(dbItem);

  const quantity = requestedHasStructuredSize
    ? Number(requestedItem.quantity)
    : dbHasStructuredSize
      ? Number(dbItem.quantity)
      : requestedItem?.quantity == null
        ? dbItem?.quantity ?? null
        : Number(requestedItem.quantity);

  const quantityUnit = requestedHasStructuredSize
    ? String(requestedItem.quantity_unit || "").trim().toLowerCase() || null
    : dbHasStructuredSize
      ? String(dbItem.quantity_unit || "").trim().toLowerCase() || null
      : requestedItem?.quantity_unit == null
        ? dbItem?.quantity_unit || null
        : String(requestedItem.quantity_unit || "").trim().toLowerCase() || null;

  return {
    raw_item_text:
      String(requestedItem?.raw_item_text || dbItem?.raw_item_text || "").trim(),
    quantity:
      quantity == null || !Number.isFinite(Number(quantity))
        ? null
        : Number(quantity),
    quantity_unit: quantityUnit,
    item_count: normalizedItemCount(
      requestedItem?.item_count,
      dbItem?.item_count,
    ),
    clearCanonical:
      requestedHasStructuredSize &&
      (!dbHasStructuredSize ||
        Number(dbItem?.quantity) !== Number(requestedItem?.quantity) ||
        String(dbItem?.quantity_unit || "").trim().toLowerCase() !==
          String(requestedItem?.quantity_unit || "").trim().toLowerCase()),
  };
}

function restoreListFromRequestPayload(listId, userId, body) {
  const incomingItems = Array.isArray(body?.items) ? body.items : [];
  const items = incomingItems.map(normalizeIncomingItem).filter(Boolean);
  if (items.length === 0) return false;

  const now = new Date().toISOString();
  const listName = String(body?.name || "Smart List").trim() || "Smart List";
  const inputMethod = String(body?.input_method || "text")
    .trim()
    .toLowerCase();
  const rawInput =
    String(body?.raw_input || "").trim() ||
    items.map((item) => item.raw_item_text).join(", ");

  db.prepare(
    `INSERT OR IGNORE INTO shopping_lists
      (id, user_id, name, raw_input, input_method, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(listId, userId, listName, rawInput, inputMethod || null, now, now);

  const hasItems =
    db
      .prepare("SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?")
      .get(listId)?.n > 0;
  if (!hasItems) {
    const insertItem = db.prepare(
      `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, quantity, quantity_unit, brand_pref, resolved, unresolvable)
       VALUES (?, NULL, ?, ?, ?, NULL, 0, 0)`,
    );
    for (const item of items) {
      insertItem.run(
        listId,
        item.raw_item_text,
        item.quantity,
        item.quantity_unit,
      );
    }
  }
  return true;
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

function getOwnedListItem(listId, itemId) {
  return db
    .prepare(
      `SELECT li.id,
              li.list_id,
              li.canonical_id,
              li.raw_item_text,
              li.quantity,
              li.quantity_unit,
              li.item_count,
              li.brand_pref,
              cp.canonical_name
       FROM list_items li
       LEFT JOIN canonical_products cp ON cp.id = li.canonical_id
       WHERE li.list_id = ?
         AND li.id = ?
       LIMIT 1`,
    )
    .get(listId, itemId);
}

function activeDealsCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM deals WHERE is_active = 1").get()
    ?.n;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hostFromUrl(value) {
  try {
    return new URL(String(value || "")).host
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function ensureDealsReadyForRecommend() {
  if (activeDealsCount() > 0) {
    return { ok: true, source: "sqlite" };
  }

  const restored = await restoreFromSnapshot(db).catch(() => false);
  if (restored && activeDealsCount() > 0) {
    return { ok: true, source: "redis_snapshot" };
  }

  const seeded = restoreDealsFromSeed(db);
  if (seeded.ok && activeDealsCount() > 0) {
    return { ok: true, source: "seed_file" };
  }

  const deadline = Date.now() + RECOMMEND_COLD_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(RECOMMEND_COLD_START_POLL_MS);
    if (activeDealsCount() > 0) {
      return { ok: true, source: "sqlite_wait" };
    }
    const retried = await restoreFromSnapshot(db).catch(() => false);
    if (retried && activeDealsCount() > 0) {
      return { ok: true, source: "redis_snapshot_wait" };
    }
  }

  return { ok: false, source: "unavailable" };
}

function ensureLocalUserRowFromAuth(reqUser, body) {
  if (!reqUser?.id) return null;
  const now = new Date().toISOString();
  const email =
    typeof reqUser.email === "string" && reqUser.email.trim()
      ? reqUser.email.trim().toLowerCase()
      : `user-${reqUser.id}@local.invalid`;
  const postcode = String(body?.postcode || "").trim();

  try {
    db.prepare(
      `INSERT OR IGNORE INTO users
        (id, email, password_hash, google_id, postcode, city, dietary_prefs,
         preferred_stores, blocked_stores, preferred_brands,
         delivery_speed_pref, created_at, last_login_at)
       VALUES (?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, 'cheapest', ?, ?)`,
    ).run(
      reqUser.id,
      email,
      postcode,
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify([]),
      JSON.stringify({}),
      now,
      now,
    );
  } catch (error) {
    console.warn("[recommend] Failed to ensure local user row:", error.message);
  }

  return db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(reqUser.id);
}

router.post("/:id/cart-transfer", requireUserAuth, async (req, res) => {
  try {
    const list = getOwnedList(req.params.id, req.user.id);
    if (!list) return res.status(404).json({ error: "List not found" });

    const storeId = String(req.body?.store_id || "").trim();
    if (!storeId) {
      return res.status(400).json({ error: "store_id is required" });
    }

    const store = db
      .prepare(
        "SELECT id, name, url, platform, logo_url FROM stores WHERE id = ? LIMIT 1",
      )
      .get(storeId);
    if (!store) return res.status(404).json({ error: "Store not found" });

    const incomingItems = Array.isArray(req.body?.matched_items)
      ? req.body.matched_items
      : [];
    if (incomingItems.length === 0) {
      return res
        .status(400)
        .json({ error: "matched_items must contain at least one item" });
    }
    if (incomingItems.length > 120) {
      return res
        .status(400)
        .json({ error: "matched_items exceeds maximum allowed size (120)" });
    }

    const storeHost = hostFromUrl(store.url);
    if (!storeHost) {
      return res.status(400).json({ error: "Store URL is invalid" });
    }

    const matchedItems = incomingItems
      .map((row) => {
        const productUrl = String(row?.product_url || "").trim();
        const qty = Number(row?.packs_needed);
        const normalizedCombination = Array.isArray(row?.combination)
          ? row.combination
              .map((comboRow) => {
                const comboUrl = String(comboRow?.product_url || "").trim();
                if (!comboUrl) return null;
                const comboHost = hostFromUrl(comboUrl);
                if (!comboHost || comboHost !== storeHost) return null;
                const comboQty = Number(comboRow?.count);
                return {
                  product_url: comboUrl,
                  count:
                    Number.isFinite(comboQty) && comboQty > 0
                      ? Math.round(comboQty)
                      : 1,
                };
              })
              .filter(Boolean)
          : [];

        if (normalizedCombination.length > 0) {
          return {
            product_url: productUrl || normalizedCombination[0].product_url,
            packs_needed: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
            combination: normalizedCombination,
          };
        }

        if (!productUrl) return null;
        const productHost = hostFromUrl(productUrl);
        if (!productHost || productHost !== storeHost) return null;
        return {
          product_url: productUrl,
          packs_needed: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
        };
      })
      .filter(Boolean);

    if (matchedItems.length === 0) {
      return res.status(400).json({
        error:
          "No valid matched_items for this store (product URLs must match store domain)",
      });
    }

    const transfer = await buildCartTransfer(store, matchedItems);
    return res.json({ data: transfer });
  } catch (err) {
    console.error("[cart-transfer] error:", err.message);
    return res.status(500).json({ error: "Failed to build cart transfer URL" });
  }
});

router.post("/:id/replacement-search", requireUserAuth, async (req, res) => {
  try {
    const list = getOwnedList(req.params.id, req.user.id);
    if (!list) return res.status(404).json({ error: "List not found" });

    const storeId = String(req.body?.store_id || "").trim();
    if (!storeId) {
      return res.status(400).json({ error: "store_id is required" });
    }

    const rawListItemId = req.body?.list_item_id;
    const listItemId = Number(rawListItemId);
    if (!Number.isFinite(listItemId) || listItemId <= 0) {
      return res.status(400).json({ error: "list_item_id is required" });
    }

    const store = db
      .prepare(
        "SELECT id, name FROM stores WHERE id = ? AND crawl_status != 'maintenance' LIMIT 1",
      )
      .get(storeId);
    if (!store) return res.status(404).json({ error: "Store not found" });

    const listItem = getOwnedListItem(list.id, listItemId);
    if (!listItem) return res.status(404).json({ error: "List item not found" });

    const queryOverride = String(req.body?.query || "").trim() || null;
    const maxResults = Math.min(
      30,
      Math.max(1, parseInt(req.body?.limit || "12", 10) || 12),
    );
    const strict = searchStrictReplacementOptions(db, {
      storeId: store.id,
      listItem,
      queryOverride,
      maxResults,
    });

    return res.json({
      data: {
        ...strict,
        list_item_id: listItem.id,
        store_id: store.id,
        store_name: store.name,
      },
    });
  } catch (err) {
    console.error("[replacement-search] error:", err.message);
    return res.status(500).json({ error: "Failed to search replacements" });
  }
});

router.post("/:id/recommend", requireUserAuth, async (req, res) => {
  try {
    const dealsReady = await ensureDealsReadyForRecommend();
    if (!dealsReady.ok) {
      return res.status(503).json({
        error: "Pricing data is warming up. Please try again in a few seconds.",
        code: "DEALS_UNAVAILABLE",
      });
    }

    // Ensure a local user row exists early so any fallback list restoration
    // (which writes shopping_lists.user_id FK) succeeds on cold instances.
    ensureLocalUserRowFromAuth(req.user, req.body || {});

    let list = getOwnedList(req.params.id, req.user.id);
    if (!list) {
      // Cold start: restore list + items from Redis into SQLite so recommender can read them
      const cached = await getCachedList(req.params.id).catch(() => null);
      if (cached?.list && cached.list.user_id === req.user.id) {
        try {
          db.prepare(
            `INSERT OR IGNORE INTO shopping_lists
              (id, user_id, name, raw_input, input_method, created_at, last_used_at, reorder_reminder_days)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            cached.list.id,
            cached.list.user_id,
            cached.list.name,
            cached.list.raw_input || null,
            cached.list.input_method || null,
            cached.list.created_at,
            cached.list.last_used_at || null,
            cached.list.reorder_reminder_days || null,
          );
          const insertItem = db.prepare(
            `INSERT OR IGNORE INTO list_items
              (list_id, canonical_id, raw_item_text, quantity, quantity_unit, brand_pref, resolved, unresolvable)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          for (const item of cached.items || []) {
            insertItem.run(
              item.list_id,
              item.canonical_id || null,
              item.raw_item_text,
              item.quantity || null,
              item.quantity_unit || null,
              item.brand_pref || null,
              item.resolved ? 1 : 0,
              item.unresolvable ? 1 : 0,
            );
          }
          list = getOwnedList(req.params.id, req.user.id);
        } catch (e) {
          console.warn(
            "[recommend] Failed to restore list from Redis:",
            e.message,
          );
          list = cached.list;
        }
      }
    }
    if (!list) {
      const restored = restoreListFromRequestPayload(
        req.params.id,
        req.user.id,
        req.body || {},
      );
      if (restored) {
        list = getOwnedList(req.params.id, req.user.id);
      }
    }
    if (!list) return res.status(404).json({ error: "List not found" });

    let user = db
      .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
      .get(req.user.id);
    if (!user) {
      user = await getCachedUser(req.user.id).catch(() => null);
    }
    if (!user) {
      user = ensureLocalUserRowFromAuth(req.user, req.body || {});
    }
    if (!user) {
      user = {
        id: req.user.id,
        email: req.user.email || null,
        postcode: String(req.body?.postcode || "").trim() || null,
        delivery_speed_pref: "cheapest",
      };
    }

    const postcode = String(req.body?.postcode || user.postcode || "").trim();
    if (!postcode) {
      return res
        .status(400)
        .json({ error: "postcode is required (body or user profile)" });
    }

    const deliveryPreference = String(
      req.body?.delivery_preference || user.delivery_speed_pref || "cheapest",
    ).trim();
    if (!PREFS.has(deliveryPreference)) {
      return res.status(400).json({
        error:
          "delivery_preference must be cheapest, fastest, or same_day_if_available",
      });
    }

    db.prepare("UPDATE shopping_lists SET last_used_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      list.id,
    );

    // If the client sends items with derived quantities (e.g. hint_pack × item_count),
    // apply them to the DB items now so the recommender always uses the correct target.
    const bodyItems = Array.isArray(req.body?.items)
      ? req.body.items.map(normalizeIncomingItem).filter(Boolean)
      : [];
    console.log("[recommend] body.items:", JSON.stringify(bodyItems));
    if (bodyItems.length > 0) {
      const dbItems = db
        .prepare(
          "SELECT id, canonical_id, raw_item_text, quantity, quantity_unit, item_count FROM list_items WHERE list_id = ? ORDER BY id ASC",
        )
        .all(list.id);
      const updateItemQty = db.prepare(
        "UPDATE list_items SET quantity = ?, quantity_unit = ?, item_count = ?, canonical_id = ?, resolved = ?, unresolvable = ? WHERE id = ?",
      );
      const requestedByText = new Map();
      for (const item of bodyItems) {
        const key = String(item.raw_item_text || "").trim().toLowerCase();
        if (!key || requestedByText.has(key)) continue;
        requestedByText.set(key, item);
      }
      for (let i = 0; i < dbItems.length; i++) {
        const dbItem = dbItems[i];
        const fallbackItem = bodyItems[i];
        const matchedItem =
          requestedByText.get(
            String(dbItem.raw_item_text || "").trim().toLowerCase(),
          ) || fallbackItem;
        if (!matchedItem) continue;

        const merged = mergeRequestedItem(dbItem, matchedItem);
        const qtyChanged =
          (dbItem.quantity == null ? null : Number(dbItem.quantity)) !==
          (merged.quantity == null ? null : Number(merged.quantity));
        const unitChanged =
          (dbItem.quantity_unit == null
            ? null
            : String(dbItem.quantity_unit).trim().toLowerCase()) !==
          merged.quantity_unit;
        const countChanged =
          normalizedItemCount(dbItem.item_count, 1) !== merged.item_count;

        if (!qtyChanged && !unitChanged && !countChanged && !merged.clearCanonical) {
          continue;
        }

        const nextCanonicalId = merged.clearCanonical ? null : dbItem.canonical_id || null;
        updateItemQty.run(
          merged.quantity,
          merged.quantity_unit,
          merged.item_count,
          nextCanonicalId,
          nextCanonicalId ? 1 : 0,
          nextCanonicalId ? 0 : 1,
          dbItem.id,
        );
      }
    }

    const startedAt = Date.now();
    const result = await recommendForList(db, {
      user,
      listId: list.id,
      postcode,
      deliveryPreference,
    });
    const durationMs = Date.now() - startedAt;
    trackEvent(db, "recommendation.generated", {
      userId: req.user.id,
      route: req.originalUrl,
      entityType: "shopping_list",
      entityId: list.id,
      payload: {
        duration_ms: durationMs,
        items_count: result?.summary?.items_count || 0,
        stores_considered: result?.summary?.stores_considered || 0,
        winner_store_id: result?.winner?.store?.id || null,
        delivery_preference: deliveryPreference,
      },
    });

    res.json(result);
  } catch (err) {
    console.error("[recommend] error:", err.message);
    res.status(500).json({ error: "Failed to generate recommendation" });
  }
});

module.exports = router;
