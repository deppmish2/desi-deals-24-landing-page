"use strict";
const express = require("express");
const requireUserAuth = require("../middleware/user-auth");

const VALID_ADVANCE_STATUSES = ["placed", "shipped", "delivered", "issue"];

module.exports = function createOrdersRouter(db) {
  const router = express.Router();

  // GET /orders — all completed (archived) lists for the user
  router.get("/", requireUserAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const lists = await db.prepare(`
        SELECT
          sl.id, sl.name, sl.status, sl.completed_store_id, sl.completed_at,
          sl.created_at, sl.order_status, sl.savings_eur, sl.total_eur,
          sl.rating, sl.eta_date, sl.issue_text, sl.tracking_url,
          s.name AS completed_store_name
        FROM shopping_lists sl
        LEFT JOIN stores s ON s.id = sl.completed_store_id
        WHERE sl.user_id = ? AND sl.status = 'completed'
        ORDER BY sl.completed_at DESC
      `).all(userId);

      const result = await Promise.all(lists.map(async (list) => {
        const items = await db.prepare(`
          SELECT id, raw_item_text, quantity, quantity_unit, item_count
          FROM list_items WHERE list_id = ?
          ORDER BY id ASC
        `).all(list.id);
        return { ...list, items };
      }));

      res.json({ data: result });
    } catch (err) { next(err); }
  });

  // PATCH /orders/:id/handoff — hand off to store; sets order_status='pending'
  router.patch("/:id/handoff", requireUserAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const listId = req.params.id;
      const { store_id, savings_eur, total_eur } = req.body || {};

      if (!store_id) return res.status(400).json({ error: "store_id is required" });

      const store = await db.prepare("SELECT id FROM stores WHERE id = ?").get(store_id);
      if (!store) return res.status(400).json({ error: "store_id not found" });

      const list = await db.prepare(
        "SELECT id FROM shopping_lists WHERE id = ? AND user_id = ?"
      ).get(listId, userId);
      if (!list) return res.status(404).json({ error: "List not found" });

      const completedAt = new Date().toISOString();
      await db.prepare(`
        UPDATE shopping_lists
        SET status = 'completed', order_status = 'pending',
            completed_store_id = ?, completed_at = ?,
            savings_eur = ?, total_eur = ?
        WHERE id = ? AND user_id = ?
      `).run(store_id, completedAt, savings_eur ?? null, total_eur ?? null, listId, userId);

      const updated = await db.prepare(
        `SELECT id, status, order_status, completed_store_id, completed_at,
                savings_eur, total_eur FROM shopping_lists WHERE id = ?`
      ).get(listId);

      res.json({ data: updated });
    } catch (err) { next(err); }
  });

  // PATCH /orders/:id/confirm — user confirms they placed the order
  router.patch("/:id/confirm", requireUserAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const listId = req.params.id;

      const list = await db.prepare(
        "SELECT id, order_status FROM shopping_lists WHERE id = ? AND user_id = ? AND status = 'completed'"
      ).get(listId, userId);
      if (!list) return res.status(404).json({ error: "Order not found" });
      if (list.order_status !== "pending") {
        return res.status(400).json({ error: "Order is not pending confirmation" });
      }

      await db.prepare(
        "UPDATE shopping_lists SET order_status = 'placed' WHERE id = ? AND user_id = ?"
      ).run(listId, userId);

      res.json({ data: { id: listId, order_status: "placed" } });
    } catch (err) { next(err); }
  });

  // DELETE /orders/:id — user cancels ("I didn't order")
  router.delete("/:id", requireUserAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const listId = req.params.id;

      const list = await db.prepare(
        "SELECT id FROM shopping_lists WHERE id = ? AND user_id = ?"
      ).get(listId, userId);
      if (!list) return res.status(404).json({ error: "Order not found" });

      await db.prepare(
        "DELETE FROM shopping_lists WHERE id = ? AND user_id = ?"
      ).run(listId, userId);

      res.json({ data: { id: listId, deleted: true } });
    } catch (err) { next(err); }
  });

  // PATCH /orders/:id/rating — rate the store 1-5
  router.patch("/:id/rating", requireUserAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const listId = req.params.id;
      const { rating } = req.body || {};

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "rating must be integer 1-5" });
      }

      const list = await db.prepare(
        "SELECT id FROM shopping_lists WHERE id = ? AND user_id = ? AND status = 'completed'"
      ).get(listId, userId);
      if (!list) return res.status(404).json({ error: "Order not found" });

      await db.prepare(
        "UPDATE shopping_lists SET rating = ? WHERE id = ? AND user_id = ?"
      ).run(rating, listId, userId);

      res.json({ data: { id: listId, rating } });
    } catch (err) { next(err); }
  });

  // PATCH /orders/:id/status — advance lifecycle (admin / manual)
  router.patch("/:id/status", requireUserAuth, async (req, res, next) => {
    try {
      const userId = req.user.id;
      const listId = req.params.id;
      const { order_status, eta_date, issue_text, tracking_url } = req.body || {};

      if (!VALID_ADVANCE_STATUSES.includes(order_status)) {
        return res.status(400).json({
          error: `order_status must be one of: ${VALID_ADVANCE_STATUSES.join(", ")}`,
        });
      }

      const list = await db.prepare(
        "SELECT id FROM shopping_lists WHERE id = ? AND user_id = ? AND status = 'completed'"
      ).get(listId, userId);
      if (!list) return res.status(404).json({ error: "Order not found" });

      await db.prepare(`
        UPDATE shopping_lists
        SET order_status = ?, eta_date = ?, issue_text = ?, tracking_url = ?
        WHERE id = ? AND user_id = ?
      `).run(
        order_status,
        eta_date ?? null,
        issue_text ?? null,
        tracking_url ?? null,
        listId,
        userId
      );

      res.json({ data: { id: listId, order_status } });
    } catch (err) { next(err); }
  });

  return router;
};
