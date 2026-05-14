"use strict";

const { resolveName } = require("../../crawler/entity-resolution");
const { decomposeCanonical } = require("../../crawler/utils/canonical-decomposer");
const { resolveBaseProduct } = require("./base-product-catalog");

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "item";
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function loadCanonicalRows(db) {
  return await db
    .prepare(
      `SELECT id, canonical_name, category, common_aliases, image_url
     FROM canonical_products`,
    )
    .all();
}

async function addAliasToCanonical(db, canonicalId, rawName) {
  const row = await db
    .prepare(
      `SELECT common_aliases
     FROM canonical_products
     WHERE id = ?
     LIMIT 1`,
    )
    .get(canonicalId);

  const aliases = parseJson(row?.common_aliases, []);
  if (!aliases.includes(rawName)) aliases.push(rawName);

  await db
    .prepare(
      `UPDATE canonical_products
     SET common_aliases = ?
     WHERE id = ?`,
    )
    .run(JSON.stringify(aliases), canonicalId);
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

async function createCanonical(
  db,
  { canonicalName, category, imageUrl, rawName },
  brands = [],
) {
  const baseId = slugify(canonicalName || rawName);
  const canonicalId = await ensureUniqueCanonicalId(db, baseId);

  // Decompose into token slots so the new canonical immediately participates
  // in slot-based matching on the next crawl run.
  const {
    brandSlots,
    baseProductSlots,
    typeSlots,
    productGroupId,
    weightValue,
    weightUnit,
  } = decomposeCanonical(canonicalName || rawName || "", [], brands);

  const baseKey = resolveBaseProduct(canonicalName)?.base_key ?? null;

  await db
    .prepare(
      `INSERT INTO canonical_products
        (id, canonical_name, category, common_aliases, image_url, verified,
         brand_slots, base_product_slots, type_slots, product_group_id, base_key,
         weight_value, weight_unit, is_match_priority)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      canonicalId,
      canonicalName,
      category || "Other",
      JSON.stringify(rawName ? [rawName] : []),
      imageUrl || null,
      JSON.stringify(brandSlots),
      JSON.stringify(baseProductSlots),
      JSON.stringify(typeSlots),
      productGroupId,
      baseKey,
      weightValue,
      weightUnit,
    );

  // Upsert the product group record
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO product_groups (id, group_name, category)
         VALUES (?, ?, ?)`,
      )
      .run(productGroupId, productGroupId.replace(/-/g, " "), category || null);
  } catch (_) {
    // product_groups table may not exist on older DBs — non-fatal
  }

  return await db
    .prepare("SELECT * FROM canonical_products WHERE id = ? LIMIT 1")
    .get(canonicalId);
}

async function upsertDealMapping(
  db,
  { dealId, canonicalId, method, confidence },
) {
  await db
    .prepare(
      `INSERT INTO store_product_mappings
      (deal_id, canonical_id, match_method, match_confidence, verified_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(deal_id, canonical_id)
     DO UPDATE SET
       match_method = excluded.match_method,
       match_confidence = excluded.match_confidence,
       verified_at = excluded.verified_at`,
    )
    .run(dealId, canonicalId, method, confidence, new Date().toISOString());

  await db
    .prepare("UPDATE store_products SET canonical_id = ? WHERE id = ?")
    .run(canonicalId, dealId);
}

async function enqueueManualReview(
  db,
  deal,
  suggestedCanonicalId,
  confidence,
  normalisedName,
) {
  const pending = await db
    .prepare(
      `SELECT id
     FROM entity_resolution_queue
     WHERE deal_id = ? AND status = 'pending'
     LIMIT 1`,
    )
    .get(deal.id);

  if (pending) return;

  await db
    .prepare(
      `INSERT INTO entity_resolution_queue
      (deal_id, suggested_canonical_id, confidence, raw_name, normalised_name, status, store_id, category)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      deal.id,
      suggestedCanonicalId || null,
      confidence == null ? null : Number(confidence),
      deal.product_name,
      normalisedName || null,
      deal.store_id || null,
      deal.product_category || null,
    );
}

async function resolveQueryToCanonicalId(
  db,
  query,
  categoryHint,
  options = {},
) {
  const createIfMissing = options.createIfMissing !== false;
  const canonicalRows = await loadCanonicalRows(db);
  const canonicalNames = canonicalRows.map((row) => row.canonical_name);
  const resolved = await resolveName(query, canonicalNames);

  if (resolved.match) {
    const matched = canonicalRows.find(
      (row) => row.canonical_name === resolved.match,
    );
    if (matched) {
      return {
        canonical_id: matched.id,
        resolved: resolved.method !== "manual_review",
        method: resolved.method,
        confidence: resolved.confidence,
      };
    }
  }

  if (resolved.method === "manual_review") {
    return {
      canonical_id: null,
      resolved: false,
      method: "manual_review",
      confidence: resolved.confidence,
      normalised_name: resolved.normalised,
    };
  }

  if (!createIfMissing) {
    return {
      canonical_id: null,
      resolved: false,
      method: "unmapped",
      confidence: resolved.confidence || 0,
      normalised_name: resolved.normalised,
    };
  }

  const created = await createCanonical(db, {
    canonicalName: query,
    category: categoryHint || "Other",
    imageUrl: null,
    rawName: query,
  });

  return {
    canonical_id: created.id,
    resolved: true,
    method: "new",
    confidence: resolved.confidence || 0,
    normalised_name: resolved.normalised,
  };
}

async function canonicalizeDeals(db, { runId, unmappedOnly } = {}) {
  const params = [];
  let where = "d.is_active = 1";
  if (runId) {
    where += " AND d.crawl_run_id = ?";
    params.push(runId);
  }
  const join = unmappedOnly
    ? "LEFT JOIN store_product_mappings dm ON dm.deal_id = d.id"
    : "";
  if (unmappedOnly) where += " AND dm.deal_id IS NULL";

  const deals = await db
    .prepare(
      `SELECT d.id, d.product_name, d.product_category, d.image_url, d.store_id
     FROM store_products d
     ${join}
     WHERE ${where}`,
    )
    .all(...params);

  // Load brands once for the entire run — passed into createCanonical for decomposition
  let brandRows = [];
  try { brandRows = await db.prepare(`SELECT name, aliases FROM known_brands`).all(); } catch (_) {}
  const brands = brandRows.map((r) => ({
    name: r.name,
    aliases: JSON.parse(String(r.aliases || "[]")),
  }));

  const canonicalRows = await loadCanonicalRows(db);
  const canonicalByName = new Map(
    canonicalRows.map((row) => [row.canonical_name, row]),
  );

  const stats = {
    scanned: deals.length,
    mapped: 0,
    created: 0,
    manual_review: 0,
  };

  for (const deal of deals) {
    const canonicalNames = Array.from(canonicalByName.keys());
    const resolved = await resolveName(deal.product_name, canonicalNames);

    // Only auto-map exact or high-confidence fuzzy matches (≥0.90)
    if (resolved.match && (resolved.method === "exact" || resolved.method === "fuzzy")) {
      const canonicalRow = canonicalByName.get(resolved.match);
      if (canonicalRow) {
        await addAliasToCanonical(db, canonicalRow.id, deal.product_name);
        await upsertDealMapping(db, {
          dealId: deal.id,
          canonicalId: canonicalRow.id,
          method: resolved.method,
          confidence: resolved.confidence == null ? null : Number(resolved.confidence),
        });
        if (!canonicalRow.image_url && deal.image_url) {
          await db.prepare("UPDATE canonical_products SET image_url = ? WHERE id = ?")
            .run(deal.image_url, canonicalRow.id);
          canonicalRow.image_url = deal.image_url;
        }
        stats.mapped += 1;
        continue;
      }
    }

    // Everything else (no match or below threshold) → queue for admin review
    await enqueueManualReview(
      db,
      deal,
      null,
      resolved.confidence,
      resolved.normalised,
    );
    stats.manual_review += 1;
  }

  if (stats.scanned > 0) {
    console.log(
      `[canonicalize] run=${runId || "all"} scanned=${stats.scanned} mapped=${stats.mapped} created=${stats.created} manual=${stats.manual_review}`,
    );
  }

  return stats;
}

module.exports = {
  canonicalizeDeals,
  resolveQueryToCanonicalId,
};
