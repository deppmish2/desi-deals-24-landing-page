"use strict";
const express         = require("express");
const requireUserAuth = require("../middleware/user-auth");
const { compareCart } = require("../services/cart-comparator");
const db              = require("../db");

const router = express.Router();

router.post("/cart", requireUserAuth, async (req, res, next) => {
  try {
    const { items } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required and must not be empty" });
    }

    if (items.length > 100) {
      return res.status(400).json({ error: "items array must not exceed 100 items" });
    }

    for (const item of items) {
      if (!item.canonical_id) {
        return res.status(400).json({ error: "each item must have canonical_id" });
      }
      const qty = Number(item.quantity ?? 1);
      if (!Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ error: "each item quantity must be a positive number" });
      }
    }

    const result = await compareCart(db, items);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
