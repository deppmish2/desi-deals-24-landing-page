"use strict";

const express = require("express");
const db = require("../db");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const rows = await db.prepare(`SELECT * FROM stores ORDER BY name ASC`).all();
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const row = await db.prepare(`SELECT * FROM stores WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: "Store not found" });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
