"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const requireAdminAuth = require("../middleware/user-admin-auth");
const { normalise } = require("../../crawler/entity-resolution/normaliser");
const { fuzzyMatch } = require("../../crawler/entity-resolution/fuzzy-matcher");
const { decomposeCanonical } = require("../../crawler/utils/canonical-decomposer");

router.use(requireAdminAuth);

// --- Helpers ---

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "item";
}

async function ensureUniqueCanonicalId(db, baseId) {
  let id = baseId;
  let suffix = 2;
  while (
    await db
      .prepare("SELECT 1 FROM canonical_products WHERE id = ? LIMIT 1")
      .get(id)
  ) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

// --- Routes ---

// GET /review-queue?status=pending&category=&page=1
router.get("/review-queue", async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const category = req.query.category || "";
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const offset = (page - 1) * pageSize;

    const conditions = ["eq.status = ?"];
    const params = [status];

    if (category) {
      conditions.push("eq.category = ?");
      params.push(category);
    }

    const where = conditions.join(" AND ");

    const items = await db
      .prepare(
        `SELECT eq.id, eq.deal_id, eq.raw_name, eq.normalised_name, eq.confidence,
                eq.status, eq.store_id, eq.category, eq.created_at,
                eq.suggested_canonical_id,
                cp.canonical_name as suggested_canonical_name,
                cp.brand_slots, cp.base_product_slots, cp.type_slots,
                cp.category as canonical_category,
                s.name as store_name
         FROM entity_resolution_queue eq
         LEFT JOIN canonical_products cp ON cp.id = eq.suggested_canonical_id
         LEFT JOIN stores s ON s.id = eq.store_id
         WHERE ${where}
         ORDER BY eq.created_at DESC
         LIMIT ${pageSize} OFFSET ?`,
      )
      .all(...params, offset);

    const countRow = await db
      .prepare(
        `SELECT COUNT(*) as c FROM entity_resolution_queue eq WHERE ${where}`,
      )
      .get(...params);

    items.forEach((item) => {
      item.normalised_name = normalise(item.raw_name || "");
      if (item.suggested_canonical_name) {
        item.suggested_canonical_name_normalised = normalise(item.suggested_canonical_name);
        // keep suggested_canonical_name as original for edit form display
      }
    });

    res.json({ items, total: countRow.c, page, pageSize });
  } catch (err) {
    console.error("[review-queue] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /review-queue/:id — confirm, assign to existing canonical
router.patch("/review-queue/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { canonical_id } = req.body || {};

    if (!canonical_id) {
      return res.status(400).json({ error: "canonical_id is required" });
    }

    const item = await db
      .prepare("SELECT * FROM entity_resolution_queue WHERE id = ? LIMIT 1")
      .get(id);

    if (!item) {
      return res.status(404).json({ error: "Queue item not found" });
    }

    await db
      .prepare(
        "UPDATE entity_resolution_queue SET status = 'confirmed', suggested_canonical_id = ? WHERE id = ?",
      )
      .run(canonical_id, id);

    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
         VALUES (?, ?, 'manual', ?, ?)
         ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
           match_method = 'manual',
           match_confidence = excluded.match_confidence,
           verified_at = excluded.verified_at`,
      )
      .run(item.deal_id, canonical_id, item.confidence, now);

    await db
      .prepare("UPDATE deals SET canonical_id = ? WHERE id = ?")
      .run(canonical_id, item.deal_id);

    res.json({ ok: true });
  } catch (err) {
    console.error("[review-queue] PATCH error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /review-queue/canonical — create new canonical + re-scan pending in same category
router.post("/review-queue/canonical", async (req, res) => {
  try {
    const { queue_item_id, canonical_name, category, image_url, brand, base_product, product_type } = req.body || {};

    if (!canonical_name || !queue_item_id) {
      return res
        .status(400)
        .json({ error: "canonical_name and queue_item_id are required" });
    }

    const originItem = await db
      .prepare("SELECT * FROM entity_resolution_queue WHERE id = ? LIMIT 1")
      .get(queue_item_id);

    if (!originItem) {
      return res.status(404).json({ error: "Queue item not found" });
    }

    // Create canonical record
    const baseId = slugify(canonical_name);
    const newId = await ensureUniqueCanonicalId(db, baseId);

    let { brandSlots, baseProductSlots, typeSlots, productGroupId, weightValue, weightUnit } =
      decomposeCanonical(canonical_name, [], []);

    // Override slots with explicit admin input if provided
    if (brand !== undefined || base_product !== undefined || product_type !== undefined) {
      const tok = (s) => normalise(String(s || "")).split(/\s+/).filter(Boolean).map((w) => [w]);
      const first = (slots) => slots.map((g) => (Array.isArray(g) ? g[0] : g)).filter(Boolean);
      if (brand !== undefined) brandSlots = tok(brand);
      if (base_product !== undefined) baseProductSlots = tok(base_product);
      if (product_type !== undefined) typeSlots = tok(product_type);
      productGroupId = [...first(brandSlots || []), ...first(baseProductSlots), ...first(typeSlots)].join("-") || productGroupId;
    }

    await db
      .prepare(
        `INSERT INTO canonical_products
          (id, canonical_name, category, common_aliases, image_url, verified,
           brand_slots, base_product_slots, type_slots, product_group_id,
           weight_value, weight_unit, is_match_priority)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        newId,
        canonical_name,
        category || originItem.category || "Other",
        JSON.stringify([]),
        image_url || null,
        JSON.stringify(brandSlots),
        JSON.stringify(baseProductSlots),
        JSON.stringify(typeSlots),
        productGroupId,
        weightValue,
        weightUnit,
      );

    // Confirm originating queue item
    await db
      .prepare(
        "UPDATE entity_resolution_queue SET status = 'confirmed', suggested_canonical_id = ? WHERE id = ?",
      )
      .run(newId, queue_item_id);

    const now = new Date().toISOString();

    // Insert deal_mapping for originating deal
    await db
      .prepare(
        `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
         VALUES (?, ?, 'manual', 1.0, ?)
         ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
           match_method = 'manual',
           match_confidence = excluded.match_confidence,
           verified_at = excluded.verified_at`,
      )
      .run(originItem.deal_id, newId, now);

    await db
      .prepare("UPDATE deals SET canonical_id = ? WHERE id = ?")
      .run(newId, originItem.deal_id);

    // Re-scan pending items in same category
    const pendingItems = await db
      .prepare(
        "SELECT * FROM entity_resolution_queue WHERE status = 'pending' AND category = ? AND id != ?",
      )
      .all(category || originItem.category || "Other", queue_item_id);

    let autoConfirmed = 0;
    const normalisedCanonical = normalise(canonical_name);

    for (const pending of pendingItems) {
      const normalisedPending = pending.normalised_name || normalise(pending.raw_name);
      const matchResult = fuzzyMatch(normalisedPending, [normalisedCanonical]);

      if (matchResult && matchResult.confidence >= 0.90) {
        await db
          .prepare(
            "UPDATE entity_resolution_queue SET status = 'confirmed', suggested_canonical_id = ? WHERE id = ?",
          )
          .run(newId, pending.id);

        await db
          .prepare(
            `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
             VALUES (?, ?, 'fuzzy', ?, ?)
             ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
               match_method = 'fuzzy',
               match_confidence = excluded.match_confidence,
               verified_at = excluded.verified_at`,
          )
          .run(pending.deal_id, newId, matchResult.confidence, now);

        await db
          .prepare("UPDATE deals SET canonical_id = ? WHERE id = ?")
          .run(newId, pending.deal_id);

        autoConfirmed += 1;
      }
    }

    res.json({ ok: true, canonical_id: newId, auto_confirmed: autoConfirmed });
  } catch (err) {
    console.error("[review-queue] POST canonical error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /review-queue/canonical/:id — update brand/base_product/type/category on existing canonical
router.patch("/review-queue/canonical/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { brand, base_product, product_type, category, canonical_name } = req.body || {};

    const existing = await db
      .prepare("SELECT * FROM canonical_products WHERE id = ? LIMIT 1")
      .get(id);
    if (!existing) return res.status(404).json({ error: "Canonical not found" });

    const tok = (s) => normalise(String(s || "")).split(/\s+/).filter(Boolean).map((w) => [w]);
    const first = (slots) => slots.map((g) => (Array.isArray(g) ? g[0] : g)).filter(Boolean);
    const brandSlots = brand !== undefined ? tok(brand) : JSON.parse(existing.brand_slots || "[]");
    const baseProductSlots = base_product !== undefined ? tok(base_product) : JSON.parse(existing.base_product_slots || "[]");
    const typeSlots = product_type !== undefined ? tok(product_type) : JSON.parse(existing.type_slots || "[]");
    const productGroupId = [...first(brandSlots), ...first(baseProductSlots), ...first(typeSlots)].join("-") || existing.product_group_id;
    const resolvedCategory = category || existing.category;
    const resolvedName = (canonical_name || "").trim() || existing.canonical_name;
    const newId = await ensureUniqueCanonicalId(db, slugify(resolvedName));
    const idChanged = newId !== id;

    if (idChanged) {
      // Explicit INSERT to avoid INSERT...SELECT param issues with libsql
      await db.prepare(
        `INSERT INTO canonical_products
          (id, canonical_name, category, common_aliases, base_unit, image_url, verified,
           is_priority, is_match_priority, brand_slots, base_product_slots, type_slots,
           product_group_id, weight_value, weight_unit, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId, resolvedName, resolvedCategory,
        existing.common_aliases ?? null,
        existing.base_unit ?? null,
        existing.image_url ?? null,
        existing.verified ?? 0,
        existing.is_priority ?? 0,
        existing.is_match_priority ?? 1,
        JSON.stringify(brandSlots),
        JSON.stringify(baseProductSlots),
        JSON.stringify(typeSlots),
        productGroupId,
        existing.weight_value ?? null,
        existing.weight_unit ?? null,
        existing.created_at ?? new Date().toISOString(),
      );
      // Cascade references before deleting old record
      await db.prepare(`UPDATE deal_mappings SET canonical_id = ? WHERE canonical_id = ?`).run(newId, id);
      await db.prepare(`UPDATE entity_resolution_queue SET suggested_canonical_id = ? WHERE suggested_canonical_id = ?`).run(newId, id);
      await db.prepare(`UPDATE deals SET canonical_id = ? WHERE canonical_id = ?`).run(newId, id);
      await db.prepare(`DELETE FROM canonical_products WHERE id = ?`).run(id);
    } else {
      await db.prepare(
        `UPDATE canonical_products SET canonical_name=?, brand_slots=?, base_product_slots=?, type_slots=?, product_group_id=?, category=? WHERE id=?`,
      ).run(resolvedName, JSON.stringify(brandSlots), JSON.stringify(baseProductSlots), JSON.stringify(typeSlots), productGroupId, resolvedCategory, id);
    }

    res.json({ ok: true, new_id: newId });
  } catch (err) {
    console.error("[review-queue] PATCH canonical error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /review-queue/:id/dismiss
router.post("/review-queue/:id/dismiss", async (req, res) => {
  try {
    const { id } = req.params;

    const item = await db
      .prepare("SELECT * FROM entity_resolution_queue WHERE id = ? LIMIT 1")
      .get(id);

    if (!item) {
      return res.status(404).json({ error: "Queue item not found" });
    }

    await db
      .prepare("UPDATE entity_resolution_queue SET status = 'dismissed' WHERE id = ?")
      .run(id);

    res.json({ ok: true });
  } catch (err) {
    console.error("[review-queue] POST dismiss error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
