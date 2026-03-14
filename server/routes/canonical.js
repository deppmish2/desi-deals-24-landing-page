"use strict";

const express = require("express");
const db = require("../db");

const router = express.Router();

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// GET /api/v1/canonical
router.get("/", (req, res) => {
  const q = String(req.query.q || "").trim();
  const category = String(req.query.category || "").trim();
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.query.limit || "24", 10)),
  );

  let sql = `
    SELECT c.*, COUNT(d.id) AS variants_count
    FROM canonical_products c
    LEFT JOIN deals d ON d.canonical_id = c.id AND d.is_active = 1
    WHERE 1=1
  `;
  const params = [];

  if (q) {
    sql += " AND c.canonical_name LIKE ?";
    params.push(`%${q}%`);
  }
  if (category) {
    sql += " AND c.category = ?";
    params.push(category);
  }

  sql +=
    " GROUP BY c.id ORDER BY variants_count DESC, c.canonical_name ASC LIMIT ?";
  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  res.json({
    data: rows.map((row) => ({
      ...row,
      common_aliases: parseJson(row.common_aliases, []),
    })),
  });
});

// GET /api/v1/canonical/:id
router.get("/:id", (req, res) => {
  const canonical = db
    .prepare(
      `SELECT *
     FROM canonical_products
     WHERE id = ?
     LIMIT 1`,
    )
    .get(req.params.id);

  if (!canonical)
    return res.status(404).json({ error: "Canonical product not found" });

  const variants = db
    .prepare(
      `SELECT d.*, s.name AS store_name, s.url AS store_url,
            m.match_method, m.match_confidence
     FROM deals d
     JOIN stores s ON s.id = d.store_id
     LEFT JOIN deal_mappings m ON m.deal_id = d.id AND m.canonical_id = ?
     WHERE d.is_active = 1 AND d.canonical_id = ?
     ORDER BY d.sale_price ASC`,
    )
    .all(canonical.id, canonical.id);

  res.json({
    data: {
      ...canonical,
      common_aliases: parseJson(canonical.common_aliases, []),
      variants: variants.map((row) => ({
        id: row.id,
        product_name: row.product_name,
        product_url: row.product_url,
        image_url: row.image_url,
        product_category: row.product_category,
        sale_price: row.sale_price,
        original_price: row.original_price,
        discount_percent: row.discount_percent,
        availability: row.availability,
        crawl_timestamp: row.crawl_timestamp,
        store: {
          id: row.store_id,
          name: row.store_name,
          url: row.store_url,
        },
        mapping: {
          method: row.match_method || "unknown",
          confidence: row.match_confidence,
        },
      })),
    },
  });
});

module.exports = router;
