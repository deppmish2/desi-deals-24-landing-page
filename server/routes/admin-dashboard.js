"use strict";

const { Router } = require("express");
const db = require("../db");
const requireAdminAuth = require("../middleware/user-admin-auth");
const { decomposeCanonical, buildBrandAliasMap } = require("../../crawler/utils/canonical-decomposer");
const { loadPriorityCanonicals, autoMapDeals, matchesCanonical, norm } = require("../../crawler/utils/auto-mapper");
const { canonicalizeDeals } = require("../services/canonicalizer");

const router = Router();
router.use(requireAdminAuth);

function isMissingSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("no such table") ||
    message.includes("no such column") ||
    message.includes("has no column named")
  );
}

async function safeGet(sql, params = [], fallback = {}) {
  try {
    return (await db.prepare(sql).get(params)) || fallback;
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

async function safeAll(sql, params = [], fallback = []) {
  try {
    return (await db.prepare(sql).all(params)) || fallback;
  } catch (error) {
    if (isMissingSchemaError(error)) return fallback;
    throw error;
  }
}

// ── Known brands ──────────────────────────────────────────────────────────────

router.get("/brands", async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT id, name, aliases FROM known_brands ORDER BY name`,
    ).all();
    res.json(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        aliases: JSON.parse(String(r.aliases || "[]")),
      })),
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Canonical stats ───────────────────────────────────────────────────────────

router.get("/canonical-stats", async (req, res) => {
  try {
    const [totalCanonicalsRow, mappedDealsRow, totalActiveRow, unmappedRows] = await Promise.all([
      safeGet(`SELECT COUNT(*) as count FROM canonical_products`, [], { count: 0 }),
      safeGet(`SELECT COUNT(DISTINCT deal_id) as count FROM deal_mappings`, [], { count: 0 }),
      safeGet(`SELECT COUNT(*) as count FROM deals WHERE is_active = 1`, [], { count: 0 }),
      safeAll(
        `SELECT d.id, d.product_name, d.product_url, d.product_category,
                d.sale_price, d.currency, s.name as store_name, d.store_id
         FROM deals d
         LEFT JOIN deal_mappings dm ON dm.deal_id = d.id
         JOIN stores s ON s.id = d.store_id
         WHERE d.is_active = 1 AND dm.deal_id IS NULL
         ORDER BY d.store_id, d.product_name`,
        [],
      ),
    ]);
    res.json({
      total_canonicals: totalCanonicalsRow.count,
      mapped_deals: mappedDealsRow.count,
      total_active_deals: totalActiveRow.count,
      unmapped_products: unmappedRows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Brand remap ───────────────────────────────────────────────────────────────

router.post("/brands/remap", async (req, res) => {
  const { brands } = req.body || {};
  if (!Array.isArray(brands)) {
    return res.status(400).json({ error: "brands must be an array" });
  }

  try {
    // 1. Replace known_brands table — dedupe by lowercase name, merge aliases
    const deduped = new Map();
    for (const brand of brands) {
      const name = String(brand.name || "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (deduped.has(key)) {
        const existing = deduped.get(key);
        const merged = [...new Set([...existing.aliases, ...(brand.aliases || [])])];
        deduped.set(key, { name: existing.name, aliases: merged });
      } else {
        deduped.set(key, { name, aliases: brand.aliases || [] });
      }
    }
    await db.execute(`DELETE FROM known_brands`);
    for (const { name, aliases } of deduped.values()) {
      await db.execute(
        `INSERT INTO known_brands (name, aliases) VALUES (?, ?)`,
        [name, JSON.stringify(aliases)],
      );
    }

    // 2. Create job row
    const jobResult = await db.prepare(
      `INSERT INTO brand_remap_jobs (status) VALUES ('running')`,
    ).run();
    const jobId = Number(jobResult.lastInsertRowid);

    // 3. All work synchronous — background async killed by Vercel after response
    const startedAt = Date.now();
    try {
      const freshBrands = [...deduped.values()].map((b) => ({
        name: b.name,
        aliases: b.aliases.map((a) => String(a).toLowerCase().trim()).filter(Boolean),
      }));

      const canonicals = await db.prepare(
        `SELECT id, canonical_name, common_aliases FROM canonical_products`,
      ).all();

      const aliasMap = buildBrandAliasMap(freshBrands);

      let canonicalsRedecomposed = 0;
      let canonicalsDeleted = 0;
      const redecomposeStmts = [];

      for (const canonical of canonicals) {
        const aliases = canonical.common_aliases
          ? String(canonical.common_aliases).split(",").map((a) => a.trim()).filter(Boolean)
          : [];
        const decomposed = decomposeCanonical(canonical.canonical_name, aliases, freshBrands, aliasMap);

        if (decomposed.brandSlots === null) {
          redecomposeStmts.push(
            { sql: `UPDATE deals SET canonical_id = NULL WHERE canonical_id = ?`, args: [canonical.id] },
            { sql: `DELETE FROM canonical_products WHERE id = ?`, args: [canonical.id] },
          );
          canonicalsDeleted++;
        } else {
          redecomposeStmts.push({
            sql: `UPDATE canonical_products
                  SET brand_slots = ?, base_product_slots = ?, product_group_id = ?
                  WHERE id = ?`,
            args: [
              JSON.stringify(decomposed.brandSlots),
              JSON.stringify(decomposed.baseProductSlots),
              decomposed.productGroupId,
              canonical.id,
            ],
          });
          canonicalsRedecomposed++;
        }
      }

      if (redecomposeStmts.length > 0) await db.batch(redecomposeStmts, "write");

      // 2b. Re-validate existing mappings against new slots — purge stale ones
      const priorityCanonicals = await loadPriorityCanonicals(db);
      const canonMap = new Map(priorityCanonicals.map((c) => [c.id, c]));

      const existingMappings = await db.prepare(
        `SELECT dm.deal_id, dm.canonical_id, d.product_name, d.weight_value, d.weight_unit
         FROM deal_mappings dm
         JOIN deals d ON d.id = dm.deal_id
         WHERE d.is_active = 1`,
      ).all();

      const purgeStmts = [];
      for (const m of existingMappings) {
        const canon = canonMap.get(m.canonical_id);
        if (!canon || matchesCanonical(norm(m.product_name), m.weight_value ?? null, m.weight_unit ?? null, canon) !== true) {
          purgeStmts.push({
            sql: `DELETE FROM deal_mappings WHERE deal_id = ? AND canonical_id = ?`,
            args: [m.deal_id, m.canonical_id],
          });
        }
      }
      if (purgeStmts.length > 0) await db.batch(purgeStmts, "write");
      const stalePurged = purgeStmts.length;

      // 2c. Map previously-unmapped active deals
      const unmappedDeals = await db.prepare(
        `SELECT d.id, d.product_url, d.product_name, d.weight_value, d.weight_unit
         FROM deals d
         LEFT JOIN deal_mappings dm ON dm.deal_id = d.id
         WHERE d.is_active = 1 AND dm.deal_id IS NULL`,
      ).all();

      const newlyMapped = await autoMapDeals(db, unmappedDeals, priorityCanonicals);

      // Phase 4: create new canonical products for deals still without a mapping
      const canonStats = await canonicalizeDeals(db, { unmappedOnly: true });

      const stillUnmapped = unmappedDeals.length - newlyMapped - canonStats.created;
      const stats = { canonicalsRedecomposed, canonicalsDeleted, stalePurged, newlyMapped, canonicalsCreated: canonStats.created, stillUnmapped, duration_ms: Date.now() - startedAt };
      await db.execute(
        `UPDATE brand_remap_jobs SET status = 'completed', finished_at = CURRENT_TIMESTAMP, stats = ? WHERE id = ?`,
        [JSON.stringify(stats), jobId],
      );
      res.status(200).json({ jobId, status: "completed", stats });
    } catch (workErr) {
      await db.execute(
        `UPDATE brand_remap_jobs SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error = ? WHERE id = ?`,
        [String(workErr.message), jobId],
      ).catch(() => {});
      res.status(500).json({ error: workErr.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/brands/remap-status/:jobId", async (req, res) => {
  try {
    const row = await db.prepare(
      `SELECT id, status, started_at, finished_at, stats, error FROM brand_remap_jobs WHERE id = ?`,
    ).get([Number(req.params.jobId)]);
    if (!row) return res.status(404).json({ error: "Job not found" });
    res.json({
      jobId: row.id,
      status: row.status,
      started_at: row.started_at,
      finished_at: row.finished_at,
      stats: row.stats ? JSON.parse(row.stats) : null,
      error: row.error || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
