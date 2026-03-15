"use strict";
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/v1/stores
router.get("/", async (req, res) => {
  const rows = await db
    .prepare(
      `
    SELECT s.*, COUNT(d.id) AS active_deals_count
    FROM stores s
    LEFT JOIN deals d ON d.store_id = s.id AND d.is_active = 1
    GROUP BY s.id
    ORDER BY s.name
  `,
    )
    .all();
  res.json({ data: rows });
});

// GET /api/v1/stores/:id
router.get("/:id", async (req, res) => {
  const store = await db
    .prepare(`SELECT * FROM stores WHERE id = ?`)
    .get(req.params.id);
  if (!store) return res.status(404).json({ error: "Store not found" });
  res.json(store);
});

module.exports = router;
