"use strict";

const express = require("express");
const db = require("../db");
const { trackEvent } = require("../services/event-tracker");
const {
  expandQuery,
  phoneticNormalise,
} = require("../services/search-expander");
const { bestSmartScore } = require("../services/smart-ranker");

const router = express.Router();
const MAX_LOOKUP_TERMS = 10;

function normaliseAutocompleteText(value) {
  return phoneticNormalise(String(value || "").toLowerCase())
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLookupTerms(query, expandedTerms) {
  const terms = new Set();

  function addTerm(value) {
    const text = String(value || "")
      .toLowerCase()
      .trim();
    if (!text || text.length < 2) return;

    terms.add(text);
    for (const token of text.split(/\s+/)) {
      if (token.length >= 2) terms.add(token);
    }

    const normalised = normaliseAutocompleteText(text);
    if (!normalised) return;
    terms.add(normalised);
    for (const token of normalised.split(/\s+/)) {
      if (token.length >= 2) terms.add(token);
    }
  }

  addTerm(query);
  for (const term of expandedTerms || []) {
    addTerm(term);
    if (terms.size >= MAX_LOOKUP_TERMS * 3) break;
  }

  return Array.from(terms).slice(0, MAX_LOOKUP_TERMS);
}

function lexicalMatchBoost(query, lookupTerms, label) {
  const queryNorm = normaliseAutocompleteText(query);
  const labelNorm = normaliseAutocompleteText(label);
  if (!labelNorm) return 0;

  const queryTokens = queryNorm.split(/\s+/).filter(Boolean);
  const labelTokens = labelNorm.split(/\s+/).filter(Boolean);
  const labelSet = new Set(labelTokens);
  let boost = 0;

  if (queryNorm && labelNorm.includes(queryNorm)) {
    boost += 0.22;
  }

  if (queryTokens.length > 0) {
    const matched = queryTokens.filter((token) => labelSet.has(token)).length;
    if (matched === queryTokens.length) {
      boost += 0.18;
    } else {
      boost += Math.min(0.16, matched * 0.06);
    }
  }

  for (const term of lookupTerms) {
    const termNorm = normaliseAutocompleteText(term);
    if (!termNorm || termNorm.length < 2) continue;
    if (labelNorm.includes(termNorm)) {
      boost += termNorm.includes(" ") ? 0.06 : 0.025;
      break;
    }
  }

  // Avoid promoting masala mixes for plain dal/flour/rice lookups.
  if (!queryTokens.includes("masala") && labelSet.has("masala")) {
    boost -= 0.06;
  }

  return Math.max(-0.1, Math.min(0.4, boost));
}

function rankSuggestions(expandedTerms, rows, mapRow, minScore = 0.48) {
  const seen = new Set();
  return rows
    .map((row) => {
      const mapped = mapRow(row);
      return { ...mapped, score: bestSmartScore(expandedTerms, mapped.label) };
    })
    .filter((row) => {
      const key = String(row.label || "")
        .trim()
        .toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return row.score >= minScore;
    })
    .sort(
      (a, b) =>
        b.score - a.score || String(a.label).localeCompare(String(b.label)),
    );
}

// GET /api/v1/search/autocomplete?q=...
router.get("/autocomplete", (req, res) => {
  const startedAt = Date.now();
  const q = String(req.query.q || "").trim();
  if (q.length < 2) {
    res.json({ suggestions: [] });
    trackEvent(db, "search.autocomplete", {
      route: req.originalUrl,
      payload: {
        duration_ms: Date.now() - startedAt,
        query_length: q.length,
        result_count: 0,
        source: "none",
      },
    });
    return;
  }

  // Expand the query to cover synonyms and phonetic variants.
  // e.g. "jirra" → ["jirra", "jira", "jeera", "cumin"]
  //      "haldee" → ["haldee", "haldi", "turmeric"]
  const expandedTerms = expandQuery(q);
  const lookupTerms = buildLookupTerms(q, expandedTerms);
  const sqlLookupTerms = lookupTerms.slice(0, 5);

  // ── Canonical products first ──────────────────────────────────────────────
  // Fetch candidates by LIKE on expanded terms + first char fallback.
  const firstChar = String(q[0] || "").toLowerCase();

  const canonicalLikeClauses = sqlLookupTerms
    .map(() => "lower(canonical_name) LIKE ?")
    .join(" OR ");
  const canonicalParams = [...sqlLookupTerms.map((t) => `%${t}%`), firstChar];

  const canonical = db
    .prepare(
      `SELECT id, canonical_name, verified
       FROM canonical_products
       WHERE ((${canonicalLikeClauses})
          OR substr(lower(canonical_name), 1, 1) = ?)
         AND EXISTS (
           SELECT 1
           FROM deals d
           WHERE d.canonical_id = canonical_products.id
             AND d.is_active = 1
             AND lower(coalesce(d.availability, '')) = 'in_stock'
         )
       ORDER BY verified DESC, canonical_name ASC
       LIMIT 300`,
    )
    .all(...canonicalParams);

  const canonicalRanked = rankSuggestions(expandedTerms, canonical, (row) => ({
    id: row.id,
    label: row.canonical_name,
    type: "canonical",
    verified: Number(row.verified || 0),
  })).map((row) => ({
    ...row,
    has_deal: false,
    max_discount: 0,
    final_score:
      row.score +
      lexicalMatchBoost(q, lookupTerms, row.label) +
      (row.verified ? 0.02 : 0),
  }));

  // ── Raw product names ─────────────────────────────────────────────────────
  const rawLikeClauses = sqlLookupTerms
    .map(() => "lower(product_name) LIKE ?")
    .join(" OR ");
  const rawParams = [...sqlLookupTerms.map((term) => `%${term}%`), firstChar];

  const raw = db
    .prepare(
      `SELECT product_name,
              product_category,
              MAX(crawl_timestamp) AS latest_seen,
              MAX(COALESCE(discount_percent, 0)) AS max_discount,
              SUM(CASE WHEN COALESCE(discount_percent, 0) > 0 THEN 1 ELSE 0 END) AS deal_hits
       FROM deals
       WHERE product_name IS NOT NULL
         AND trim(product_name) <> ''
         AND is_active = 1
         AND lower(coalesce(availability, '')) = 'in_stock'
         AND (${rawLikeClauses}
              OR substr(lower(product_name), 1, 1) = ?)
       GROUP BY lower(trim(product_name)), product_category
       ORDER BY latest_seen DESC
       LIMIT 700`,
    )
    .all(...rawParams);

  const ranked = rankSuggestions(expandedTerms, raw, (row) => ({
    id: null,
    label: row.product_name,
    type: "raw",
    category: row.product_category,
    has_deal:
      Number(row.deal_hits || 0) > 0 || Number(row.max_discount || 0) > 0,
    max_discount: Number(row.max_discount || 0),
  })).map((row) => ({
    ...row,
    final_score:
      row.score +
      lexicalMatchBoost(q, lookupTerms, row.label) +
      (row.has_deal ? 0.18 : 0) +
      Math.min(90, Math.max(0, Number(row.max_discount || 0))) / 600,
  }));

  // Merge canonical + raw, deduplicate by label, and prefer deal-backed rows.
  const mergedMap = new Map();
  for (const row of [...ranked, ...canonicalRanked]) {
    const key = String(row.label || "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    const prev = mergedMap.get(key);
    if (!prev || row.final_score > prev.final_score) {
      mergedMap.set(key, row);
    }
  }
  let merged = Array.from(mergedMap.values())
    .sort(
      (a, b) =>
        b.final_score - a.final_score ||
        Number(Boolean(b.has_deal)) - Number(Boolean(a.has_deal)) ||
        Number(b.max_discount || 0) - Number(a.max_discount || 0) ||
        b.score - a.score,
    )
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      label: row.label,
      type: row.type,
      has_deal: Boolean(row.has_deal),
      max_discount: Number(row.max_discount || 0),
    }));

  // Last-resort fallback keeps autocomplete populated for hard queries.
  if (merged.length === 0) {
    const fallback = db
      .prepare(
        `SELECT product_name,
                MAX(crawl_timestamp) AS latest_seen,
                MAX(COALESCE(discount_percent, 0)) AS max_discount
         FROM deals
         WHERE product_name LIKE ?
           AND is_active = 1
           AND lower(coalesce(availability, '')) = 'in_stock'
         GROUP BY lower(trim(product_name))
         ORDER BY max_discount DESC, latest_seen DESC
         LIMIT 8`,
      )
      .all(`%${q}%`);
    merged = fallback.map((row) => ({
      id: null,
      label: row.product_name,
      type: "raw",
      has_deal: Number(row.max_discount || 0) > 0,
      max_discount: Number(row.max_discount || 0),
    }));
  }

  res.json({ suggestions: merged });
  trackEvent(db, "search.autocomplete", {
    route: req.originalUrl,
    payload: {
      duration_ms: Date.now() - startedAt,
      query_length: q.length,
      result_count: merged.length,
      source:
        merged.length === 0
          ? "none"
          : merged.some((row) => row.has_deal)
            ? "deal_preferred"
            : "catalog",
    },
  });
});

module.exports = router;
