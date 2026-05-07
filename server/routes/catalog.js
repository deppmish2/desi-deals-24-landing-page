"use strict";
const express = require("express");
const db      = require("../db");
const { expandQuery } = require("../services/search-expander");
const router  = express.Router();

// Tokens like "250gm", "1kg", "500ml" don't appear in canonical names — strip them
// so "Ayurveda Indian Paneer 250gm" matches "Ayurveda Indian Paneer".
const WEIGHT_TOKEN_RE = /^\d+(\.\d+)?(g|gm|kg|ml|l|oz|lb|lbs|mg|pack|pcs?|piece|ct|unit|units)$/i;
const BARE_NUMBER_RE = /^\d+$/;
const SEARCH_STOP_WORDS = new Set(["a", "an", "the", "of", "x", "and", "&", "bundle", "pack", "set", "combo"]);

function buildSearchCondition(q, column) {
  const allWords = q.trim().split(/\s+/)
    .map(w => w.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ""))
    .filter(Boolean);
  const words = allWords.filter(w =>
    !WEIGHT_TOKEN_RE.test(w) &&
    !BARE_NUMBER_RE.test(w) &&
    /[a-zA-Z0-9]/.test(w) &&
    !SEARCH_STOP_WORDS.has(w.toLowerCase())
  );
  const effective = words.length ? words : allWords; // fallback if query is only weight tokens

  // Word-boundary LIKE: pad column with spaces so short terms like "aval" don't
  // match mid-word (e.g. "Athavale" contains "aval" but " athavale " does not contain " aval ").
  const paddedCol = `' ' || lower(${column}) || ' '`;
  const makeLike = (t) => ({ clause: `${paddedCol} LIKE '%' || ? || '%'`, param: ` ${t.toLowerCase()} ` });

  if (effective.length <= 1) {
    // Single word: OR across all synonym/phonetic variants
    const terms = expandQuery(effective[0] || q).slice(0, 8);
    const pairs = terms.map(makeLike);
    return { clause: `(${pairs.map(p => p.clause).join(" OR ")})`, params: pairs.map(p => p.param) };
  }

  // Multi-word: AND each word so order doesn't matter.
  // Within each word, OR across its synonyms/phonetic variants.
  const andClauses = [];
  const params = [];
  for (const word of effective) {
    const wordTerms = expandQuery(word).slice(0, 6);
    const pairs = wordTerms.map(makeLike);
    andClauses.push(`(${pairs.map(p => p.clause).join(" OR ")})`);
    params.push(...pairs.map(p => p.param));
  }
  return { clause: `(${andClauses.join(" AND ")})`, params };
}

function parseSlots(raw) {
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

function joinSlots(slots) {
  return slots.map(g => (Array.isArray(g) ? g[0] : g)).filter(Boolean).join(" ") || null;
}

function serializeCatalogRow(row) {
  const brandSlots = parseSlots(row.brand_slots_raw);
  const typeSlots  = parseSlots(row.type_slots_raw);
  return {
    ...row,
    primary_brand: joinSlots(brandSlots),
    primary_type:  joinSlots(typeSlots),
    brand_slots_raw: undefined,
    type_slots_raw:  undefined,
  };
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
  ),
  last_seen AS (
    SELECT canonical_id, store_id FROM (
      SELECT spm.canonical_id, sp.store_id,
             ROW_NUMBER() OVER (
               PARTITION BY spm.canonical_id
               ORDER BY sp.crawl_timestamp DESC, sp.store_id ASC
             ) AS rn
      FROM store_product_mappings spm
      JOIN store_products sp ON sp.id = spm.deal_id
    ) WHERE rn = 1
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
    COALESCE(s.name, sf.name) AS cheapest_store_name,
    ct.store_count,
    COALESCE(cp.weight_value, c.weight_value) AS weight_value,
    COALESCE(cp.weight_unit,  c.weight_unit)  AS weight_unit,
    c.weight_raw,
    json_extract(cp.brand_slots, '$[0][0]')   AS primary_brand,
    cp.brand_slots                             AS brand_slots_raw,
    cp.type_slots                              AS type_slots_raw
  FROM canonical_products cp
  LEFT JOIN cheapest c  ON c.canonical_id = cp.id
  LEFT JOIN stores   s  ON s.id = c.store_id
  LEFT JOIN counts   ct ON ct.canonical_id = cp.id
  LEFT JOIN last_seen ls ON ls.canonical_id = cp.id AND c.canonical_id IS NULL
  LEFT JOIN stores   sf ON sf.id = ls.store_id
`;

router.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  || "1",  10) || 1);
    const limit    = Math.max(1, Math.min(100, parseInt(req.query.limit || "24", 10) || 24));
    const offset   = (page - 1) * limit;
    const q        = String(req.query.q        || "").trim();
    const category = String(req.query.category || "").trim();
    const store    = String(req.query.store    || "").trim();
    const sort     = String(req.query.sort     || "").trim();
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
        JOIN stores s2 ON s2.id = sp2.store_id
        WHERE spm2.canonical_id = cp.id AND lower(s2.name) = lower(?)
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

    const ORDER_BY_MAP = {
      price:        "c.sale_price ASC, cp.id ASC",
      price_per_kg: "c.price_per_kg ASC NULLS LAST, cp.id ASC",
      discount:     "c.discount_percent DESC NULLS LAST, cp.id ASC",
      real_savings: "(c.original_price - c.sale_price) DESC NULLS LAST, cp.id ASC",
    };
    const orderBy = Object.hasOwn(ORDER_BY_MAP, sort)
      ? ORDER_BY_MAP[sort]
      : "c.sale_price ASC NULLS LAST, cp.id ASC";

    const rows = await db.prepare(
      `${CATALOG_SQL} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    res.json({
      data: rows.map(serializeCatalogRow),
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

router.get("/known-brands", async (req, res, next) => {
  try {
    const rows = await db.prepare("SELECT name, aliases FROM known_brands ORDER BY name").all();
    res.json({
      data: rows.map((r) => {
        let aliases = [];
        try { aliases = JSON.parse(r.aliases || "[]"); } catch { aliases = []; }
        return { name: r.name, aliases };
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const row = await db.prepare(
      "SELECT id, canonical_name, category, brand_slots, type_slots FROM canonical_products WHERE id = ?"
    ).get(id);
    if (!row) return res.status(404).json({ error: "Not found" });

    let brandSlots = [], typeSlots = [];
    try { brandSlots = JSON.parse(row.brand_slots || "[]"); } catch { brandSlots = []; }
    try { typeSlots = JSON.parse(row.type_slots || "[]"); } catch { typeSlots = []; }

    res.json({
      id: row.id,
      canonical_name: row.canonical_name,
      category: row.category,
      primary_brand: joinSlots(brandSlots),
      product_type: joinSlots(typeSlots),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:id/brands", async (req, res, next) => {
  try {
    const { id } = req.params;
    const [row, knownRows] = await Promise.all([
      db.prepare("SELECT brand_slots FROM canonical_products WHERE id = ?").get(id),
      db.prepare("SELECT name, aliases FROM known_brands").all(),
    ]);
    if (!row) return res.status(404).json({ error: "Not found" });

    let slots = [];
    try { slots = JSON.parse(row.brand_slots || "[]"); } catch { slots = []; }
    if (!Array.isArray(slots)) slots = [];
    const flat = slots.flat().filter(Boolean);

    // Build known-brand lookup (name + aliases → canonical name)
    const knownMap = new Map();
    for (const { name, aliases } of knownRows) {
      knownMap.set(name.toLowerCase(), name);
      let al = [];
      try { al = JSON.parse(aliases || "[]"); } catch { al = []; }
      for (const a of al) { if (a) knownMap.set(a.toLowerCase(), name); }
    }

    // Greedily merge consecutive tokens into known multi-word brands
    const merged = [];
    let i = 0;
    while (i < flat.length) {
      let matched = false;
      for (let len = Math.min(3, flat.length - i); len >= 2; len--) {
        const candidate = flat.slice(i, i + len).join(" ");
        const canonical = knownMap.get(candidate.toLowerCase());
        if (canonical) { merged.push(canonical); i += len; matched = true; break; }
      }
      if (!matched) { merged.push(flat[i]); i++; }
    }

    res.json({ data: merged });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
