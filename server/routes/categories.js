"use strict";
const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /api/v1/categories
router.get("/", async (req, res) => {
  const rows = await db
    .prepare(
      `
    SELECT product_category AS category, COUNT(*) AS count
    FROM deals
    WHERE is_active = 1
    GROUP BY product_category
    ORDER BY count DESC
  `,
    )
    .all();
  res.json({ data: rows });
});

module.exports = router;
