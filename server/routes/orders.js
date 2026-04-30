"use strict";
const express         = require("express");
const requireUserAuth = require("../middleware/user-auth");
const db              = require("../db");

const router = express.Router();

router.get("/", requireUserAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;

    const lists = await db.prepare(`
      SELECT
        sl.id,
        sl.name,
        sl.status,
        sl.completed_store_id,
        sl.completed_at,
        sl.created_at,
        s.name AS completed_store_name
      FROM shopping_lists sl
      LEFT JOIN stores s ON s.id = sl.completed_store_id
      WHERE sl.user_id = ?
      ORDER BY sl.created_at DESC
    `).all(userId);

    const result = await Promise.all(lists.map(async (list) => {
      const items = await db.prepare(`
        SELECT id, raw_item_text, quantity, quantity_unit, item_count
        FROM list_items
        WHERE list_id = ?
        ORDER BY id ASC
      `).all(list.id);
      return { ...list, items };
    }));

    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id/complete", requireUserAuth, async (req, res, next) => {
  try {
    const userId    = req.user.id;
    const listId    = req.params.id;
    const { store_id } = req.body || {};

    if (!store_id) {
      return res.status(400).json({ error: "store_id is required" });
    }

    const list = await db.prepare(
      "SELECT id, user_id, status FROM shopping_lists WHERE id = ? AND user_id = ?"
    ).get(listId, userId);

    if (!list) return res.status(404).json({ error: "Order not found" });

    const store = await db.prepare("SELECT id FROM stores WHERE id = ?").get(store_id);
    if (!store) return res.status(400).json({ error: "store_id not found" });

    // Re-completing an already-completed list overwrites the store — intentional for now
    const completedAt = new Date().toISOString();
    await db.prepare(`
      UPDATE shopping_lists
      SET status = 'completed', completed_store_id = ?, completed_at = ?
      WHERE id = ? AND user_id = ?
    `).run(store_id, completedAt, listId, userId);

    const updated = await db.prepare(
      "SELECT id, status, completed_store_id, completed_at FROM shopping_lists WHERE id = ?"
    ).get(listId);

    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
