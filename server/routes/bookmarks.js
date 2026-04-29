"use strict";

const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const { verifyJwt } = require("../utils/jwt");

const router = express.Router();
const EXCLUDED_BOOKMARK_STORE_IDS = ["dookan"];
const EXCLUDED_BOOKMARK_STORE_IDS_SQL = EXCLUDED_BOOKMARK_STORE_IDS.map(
  (storeId) => `'${String(storeId).replace(/'/g, "''")}'`,
).join(", ");
const DISPLAYABLE_BOOKMARK_DISCOUNT_SQL = `
  (
    coalesce(d.discount_percent, 0) > 0
    OR (
      d.original_price IS NOT NULL
      AND d.sale_price IS NOT NULL
      AND d.original_price > d.sale_price
      AND d.original_price > 0
    )
  )
`;

function accessSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

function getUserId(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const result = verifyJwt(token, accessSecret());
  if (!result.ok) return null;
  return result.payload?.sub || null;
}

// GET /api/v1/bookmarks — list bookmarked deal IDs for the logged-in user
router.get("/", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    const rows = await db
      .prepare(
        `SELECT b.deal_id
         FROM bookmarks b
         JOIN store_products d ON d.id = b.deal_id
         WHERE b.user_id = ?
           AND d.is_active = 1
           AND lower(coalesce(d.availability, '')) = 'in_stock'
           AND trim(coalesce(d.product_name, '')) <> ''
           AND trim(coalesce(d.product_url, '')) <> ''
           AND ${DISPLAYABLE_BOOKMARK_DISCOUNT_SQL}
           AND lower(coalesce(d.store_id, '')) NOT IN (${EXCLUDED_BOOKMARK_STORE_IDS_SQL})
         ORDER BY b.created_at DESC`,
      )
      .all(userId);
    res.json({ data: rows.map((r) => r.deal_id) });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/bookmarks/:dealId — add bookmark
router.post("/:dealId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    const dealId = req.params.dealId;
    const id = crypto.randomUUID();
    await db
      .prepare(
        "INSERT OR IGNORE INTO bookmarks (id, user_id, deal_id) VALUES (?, ?, ?)",
      )
      .run(id, userId, dealId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/v1/bookmarks/:dealId — remove bookmark
router.delete("/:dealId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    const dealId = req.params.dealId;
    await db
      .prepare("DELETE FROM bookmarks WHERE user_id = ? AND deal_id = ?")
      .run(userId, dealId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
