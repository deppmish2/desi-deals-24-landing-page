"use strict";
const express = require("express");
const db      = require("../db");
const router  = express.Router();

const CATALOG_SQL = `
  WITH ranked AS (
    SELECT
      spm.canonical_id,
      sp.sale_price,
      sp.original_price,
      sp.discount_percent,
      sp.price_per_kg,
      sp.best_before,
      sp.store_id
    FROM store_product_mappings spm
    JOIN store_products sp ON sp.id = spm.deal_id AND sp.is_active = 1
  ),
  cheapest AS (
    SELECT canonical_id, sale_price, original_price, discount_percent,
           price_per_kg, best_before, store_id
    FROM (
      SELECT r.*,
             ROW_NUMBER() OVER (
               PARTITION BY r.canonical_id
               ORDER BY r.sale_price ASC, r.store_id ASC
             ) AS rn
      FROM ranked r
    )
    WHERE rn = 1
  ),
  counts AS (
    SELECT canonical_id, COUNT(DISTINCT store_id) AS store_count
    FROM ranked
    GROUP BY canonical_id
  )
  SELECT
    cp.id           AS canonical_id,
    cp.canonical_name,
    cp.image_url,
    cp.category,
    c.sale_price    AS cheapest_price,
    c.original_price,
    c.discount_percent AS discount_pct,
    c.price_per_kg,
    c.best_before,
    c.store_id      AS cheapest_store_id,
    s.name          AS cheapest_store_name,
    ct.store_count
  FROM canonical_products cp
  JOIN cheapest c  ON c.canonical_id = cp.id
  JOIN stores   s  ON s.id = c.store_id
  JOIN counts   ct ON ct.canonical_id = cp.id
`;

router.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  || "1",  10) || 1);
    const limit    = Math.max(1, Math.min(100, parseInt(req.query.limit || "24", 10) || 24));
    const offset   = (page - 1) * limit;
    const q        = String(req.query.q        || "").trim();
    const category = String(req.query.category || "").trim();
    const store    = String(req.query.store    || "").trim();
    const isDiscounted = req.query.is_discounted === "1";
    const minDiscount  = parseFloat(req.query.min_discount || "0") || 0;
    const hideExpired  = req.query.hide_expired === "1";

    const conditions = [];
    const params     = [];

    if (q) {
      conditions.push("cp.canonical_name LIKE '%' || ? || '%'");
      params.push(q);
    }
    if (category) {
      conditions.push("cp.category = ?");
      params.push(category);
    }
    if (store) {
      conditions.push(`EXISTS (
        SELECT 1 FROM store_product_mappings spm2
        JOIN store_products sp2 ON sp2.id = spm2.deal_id AND sp2.is_active = 1
        WHERE spm2.canonical_id = cp.id AND sp2.store_id = ?
      )`);
      params.push(store);
    }
    if (isDiscounted) {
      conditions.push("c.discount_percent > 0");
    }
    if (minDiscount > 0) {
      conditions.push("c.discount_percent >= ?");
      params.push(minDiscount);
    }
    if (hideExpired) {
      conditions.push("(c.best_before IS NULL OR c.best_before >= date('now'))");
    }

    const whereClause = conditions.length
      ? "WHERE " + conditions.join(" AND ")
      : "";

    const countRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM (${CATALOG_SQL} ${whereClause})`
    ).get(...params);
    const total = countRow?.n ?? 0;

    const rows = await db.prepare(
      `${CATALOG_SQL} ${whereClause} ORDER BY c.sale_price ASC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      data: rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/suggest", async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "q is required" });

    const like = `%${q}%`;

    const products = await db.prepare(`
      SELECT cp.id AS canonical_id, cp.canonical_name
      FROM canonical_products cp
      WHERE cp.canonical_name LIKE ?
        AND EXISTS (
          SELECT 1 FROM store_product_mappings spm
          JOIN store_products sp ON sp.id = spm.deal_id AND sp.is_active = 1
          WHERE spm.canonical_id = cp.id
        )
      LIMIT 3
    `).all(like);

    const categories = await db.prepare(`
      SELECT DISTINCT cp.category AS name
      FROM canonical_products cp
      WHERE cp.category LIKE ?
        AND cp.category IS NOT NULL
      LIMIT 3
    `).all(like);

    const stores = await db.prepare(`
      SELECT id AS store_id, name
      FROM stores
      WHERE name LIKE ?
      LIMIT 3
    `).all(like);

    res.json({ products, categories, stores });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/brands", async (req, res, next) => {
  try {
    const { id } = req.params;
    const row = await db.prepare(
      "SELECT brand_slots FROM canonical_products WHERE id = ?"
    ).get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    let brands = [];
    try { brands = JSON.parse(row.brand_slots || "[]"); } catch { brands = []; }
    if (!Array.isArray(brands)) brands = [];
    res.json({ data: brands.flat().filter(Boolean) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
