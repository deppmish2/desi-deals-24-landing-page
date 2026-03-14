"use strict";

const { resolveName } = require("../../crawler/entity-resolution");

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

function loadCanonicalRows(db) {
  return db
    .prepare(
      `SELECT id, canonical_name, category, common_aliases, image_url
     FROM canonical_products`,
    )
    .all();
}

function addAliasToCanonical(db, canonicalId, rawName) {
  const row = db
    .prepare(
      `SELECT common_aliases
     FROM canonical_products
     WHERE id = ?
     LIMIT 1`,
    )
    .get(canonicalId);

  const aliases = parseJson(row?.common_aliases, []);
  if (!aliases.includes(rawName)) aliases.push(rawName);

  db.prepare(
    `UPDATE canonical_products
     SET common_aliases = ?
     WHERE id = ?`,
  ).run(JSON.stringify(aliases), canonicalId);
}

function ensureUniqueCanonicalId(db, baseId) {
  let id = baseId;
  let suffix = 2;
  while (
    db.prepare("SELECT 1 FROM canonical_products WHERE id = ? LIMIT 1").get(id)
  ) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

function createCanonical(db, { canonicalName, category, imageUrl, rawName }) {
  const baseId = slugify(canonicalName || rawName);
  const canonicalId = ensureUniqueCanonicalId(db, baseId);

  db.prepare(
    `INSERT INTO canonical_products
      (id, canonical_name, category, common_aliases, image_url, verified)
     VALUES (?, ?, ?, ?, ?, 0)`,
  ).run(
    canonicalId,
    canonicalName,
    category || "Other",
    JSON.stringify(rawName ? [rawName] : []),
    imageUrl || null,
  );

  return db
    .prepare("SELECT * FROM canonical_products WHERE id = ? LIMIT 1")
    .get(canonicalId);
}

function upsertDealMapping(db, { dealId, canonicalId, method, confidence }) {
  db.prepare(
    `INSERT INTO deal_mappings
      (deal_id, canonical_id, match_method, match_confidence, verified_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(deal_id, canonical_id)
     DO UPDATE SET
       match_method = excluded.match_method,
       match_confidence = excluded.match_confidence,
       verified_at = excluded.verified_at`,
  ).run(dealId, canonicalId, method, confidence, new Date().toISOString());

  db.prepare("UPDATE deals SET canonical_id = ? WHERE id = ?").run(
    canonicalId,
    dealId,
  );
}

function enqueueManualReview(
  db,
  deal,
  suggestedCanonicalId,
  confidence,
  normalisedName,
) {
  const pending = db
    .prepare(
      `SELECT id
     FROM entity_resolution_queue
     WHERE deal_id = ? AND status = 'pending'
     LIMIT 1`,
    )
    .get(deal.id);

  if (pending) return;

  db.prepare(
    `INSERT INTO entity_resolution_queue
      (deal_id, suggested_canonical_id, confidence, raw_name, normalised_name, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
  ).run(
    deal.id,
    suggestedCanonicalId || null,
    confidence == null ? null : Number(confidence),
    deal.product_name,
    normalisedName || null,
  );
}

async function resolveQueryToCanonicalId(
  db,
  query,
  categoryHint,
  options = {},
) {
  const createIfMissing = options.createIfMissing !== false;
  const canonicalRows = loadCanonicalRows(db);
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

  const created = createCanonical(db, {
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

async function canonicalizeDeals(db, { runId } = {}) {
  const params = [];
  let where = "d.is_active = 1";
  if (runId) {
    where += " AND d.crawl_run_id = ?";
    params.push(runId);
  }

  const deals = db
    .prepare(
      `SELECT d.id, d.product_name, d.product_category, d.image_url
     FROM deals d
     WHERE ${where}`,
    )
    .all(...params);

  const canonicalRows = loadCanonicalRows(db);
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

    let canonicalRow = null;
    if (resolved.match) {
      canonicalRow = canonicalByName.get(resolved.match) || null;
    }

    if (!canonicalRow) {
      canonicalRow = createCanonical(db, {
        canonicalName: deal.product_name,
        category: deal.product_category,
        imageUrl: deal.image_url,
        rawName: deal.product_name,
      });
      canonicalByName.set(canonicalRow.canonical_name, canonicalRow);
      stats.created += 1;
    }

    addAliasToCanonical(db, canonicalRow.id, deal.product_name);
    upsertDealMapping(db, {
      dealId: deal.id,
      canonicalId: canonicalRow.id,
      method: resolved.method || "new",
      confidence:
        resolved.confidence == null ? null : Number(resolved.confidence),
    });

    if (resolved.method === "manual_review") {
      enqueueManualReview(
        db,
        deal,
        canonicalRow.id,
        resolved.confidence,
        resolved.normalised,
      );
      stats.manual_review += 1;
    }

    stats.mapped += 1;
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
