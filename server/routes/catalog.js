"use strict";
const express = require("express");
const db      = require("../db");
const { expandQuery } = require("../services/search-expander");
const router  = express.Router();

function buildSearchCondition(q, column) {
  const terms = expandQuery(q).slice(0, 8);
  const clauses = terms.map(() => `lower(${column}) LIKE '%' || ? || '%'`);
  const params  = terms.map(t => t.toLowerCase());
  return { clause: `(${clauses.join(" OR ")})`, params };
}

const CATALOG_SQL = `
  WITH ranked AS (
    SELECT
      spm.canonical_id,
      sp.sale_price,
      sp.original_price,
      sp.discount_percent,
      sp.price_per_kg,
      sp.best_before,
      sp.store_id,
      sp.image_url    AS deal_image_url,
      sp.weight_value,
      sp.weight_unit,
      sp.weight_raw
    FROM store_product_mappings spm
    JOIN store_products sp ON sp.id = spm.deal_id AND sp.is_active = 1
  ),
  cheapest AS (
    SELECT canonical_id, sale_price, original_price, discount_percent,
           price_per_kg, best_before, store_id, deal_image_url,
           weight_value, weight_unit, weight_raw
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
    COALESCE(cp.image_url, c.deal_image_url) AS image_url,
    cp.category,
    c.sale_price    AS cheapest_price,
    c.original_price,
    c.discount_percent AS discount_pct,
    c.price_per_kg,
    c.best_before,
    c.store_id      AS cheapest_store_id,
    s.name          AS cheapest_store_name,
    ct.store_count,
    COALESCE(cp.weight_value, c.weight_value) AS weight_value,
    COALESCE(cp.weight_unit,  c.weight_unit)  AS weight_unit,
    c.weight_raw,
    json_extract(cp.brand_slots, '$[0][0]')   AS primary_brand
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
      const { clause, params: qParams } = buildSearchCondition(q, "cp.canonical_name");
      conditions.push(clause);
      params.push(...qParams);
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

    const { clause: nameClause, params: nameParams } = buildSearchCondition(q, "cp.canonical_name");

    const products = await db.prepare(`
      SELECT cp.id AS canonical_id, cp.canonical_name
      FROM canonical_products cp
      WHERE ${nameClause}
        AND EXISTS (
          SELECT 1 FROM store_product_mappings spm
          JOIN store_products sp ON sp.id = spm.deal_id AND sp.is_active = 1
          WHERE spm.canonical_id = cp.id
        )
      LIMIT 5
    `).all(...nameParams);

    const simpleLike = `%${q}%`;

    const categories = await db.prepare(`
      SELECT DISTINCT cp.category AS name
      FROM canonical_products cp
      WHERE lower(cp.category) LIKE ?
        AND cp.category IS NOT NULL
      LIMIT 3
    `).all(simpleLike);

    const stores = await db.prepare(`
      SELECT id AS store_id, name
      FROM stores
      WHERE lower(name) LIKE ?
      LIMIT 3
    `).all(simpleLike);

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
