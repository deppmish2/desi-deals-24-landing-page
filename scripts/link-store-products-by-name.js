#!/usr/bin/env node
/**
 * Increase deal-to-canonical coverage using two strategies:
 *
 *   A) Normalised exact match  — normalise both sides, exact-match
 *   B) Token overlap (Jaccard) — match if shared-token ratio >= JACCARD_THRESHOLD
 *
 * Runs against unlinked deals only (canonical_id IS NULL).
 *
 * Usage:
 *   node scripts/link-deals-by-name.js --db-file data/prod_local.db
 *   node scripts/link-deals-by-name.js --db-file data/prod_local.db --execute
 *   node scripts/link-deals-by-name.js --execute          # Turso via .env.local
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { normalise } = require("../crawler/entity-resolution/normaliser");

const JACCARD_THRESHOLD = 0.65;
// Minimum tokens a deal name must have to attempt token-overlap matching
// (avoids matching single-word names like "salt" to everything)
const MIN_TOKENS = 2;
// Minimum canonical tokens required for containment matching
// (avoids "salt" canonical matching everything)
const MIN_CANONICAL_TOKENS_FOR_CONTAINMENT = 2;

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = require("path").resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error("ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set.");
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

function tokenSet(normalisedName) {
  return new Set(normalisedName.split(/\s+/).filter(Boolean));
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) { if (setB.has(t)) intersection++; }
  return intersection / (setA.size + setB.size - intersection);
}

const isDryRun = !process.argv.includes("--execute");
const client = getClient();

console.log(`Mode: ${isDryRun ? "DRY RUN" : "EXECUTE"} (add --execute to apply)`);
console.log(`Jaccard threshold: ${JACCARD_THRESHOLD}`);
console.log("");

async function main() {
  // Load all canonicals with their normalised name and token set
  const canonicalRows = await client.execute(
    `SELECT id, canonical_name FROM canonical_products`
  );

  const canonicals = canonicalRows.rows.map((r) => {
    const norm = normalise(r.canonical_name);
    return { id: r.id, norm, tokens: tokenSet(norm) };
  });

  // Build exact-match lookup: normalised_name → canonical_id
  const exactMap = new Map();
  for (const c of canonicals) {
    if (c.norm && !exactMap.has(c.norm)) exactMap.set(c.norm, c.id);
  }

  console.log(`Canonicals loaded: ${canonicals.length}`);

  // Fetch all unlinked deals
  const dealRows = await client.execute(
    `SELECT id, product_name FROM store_products WHERE canonical_id IS NULL`
  );

  console.log(`Unlinked deals: ${dealRows.rows.length}`);
  console.log("");

  const now = new Date().toISOString();
  let exactMatched = 0;
  let tokenMatched = 0;
  let unmatched = 0;

  // Collect matches before writing (dry-run safe)
  const matches = []; // { dealId, canonicalId, method, confidence }

  for (const deal of dealRows.rows) {
    const norm = normalise(deal.product_name);
    if (!norm) { unmatched++; continue; }

    // A) Normalised exact match
    const exactId = exactMap.get(norm);
    if (exactId) {
      matches.push({ dealId: deal.id, canonicalId: exactId, method: "normalised-match", confidence: 0.95 });
      exactMatched++;
      continue;
    }

    const dealTokens = tokenSet(norm);
    if (dealTokens.size < MIN_TOKENS) { unmatched++; continue; }

    // B) Containment — all canonical tokens present in deal tokens
    let containmentId = null;
    let containmentBest = 0;
    for (const c of canonicals) {
      if (c.tokens.size < MIN_CANONICAL_TOKENS_FOR_CONTAINMENT) continue;
      // Every canonical token must appear in deal tokens
      let allPresent = true;
      for (const t of c.tokens) { if (!dealTokens.has(t)) { allPresent = false; break; } }
      if (allPresent) {
        // Among multiple containment matches, prefer the one with more tokens (more specific)
        if (c.tokens.size > containmentBest) { containmentBest = c.tokens.size; containmentId = c.id; }
      }
    }
    if (containmentId) {
      matches.push({ dealId: deal.id, canonicalId: containmentId, method: "containment", confidence: 0.88 });
      tokenMatched++;
      continue;
    }

    // C) Token overlap (Jaccard)

    let bestScore = 0;
    let bestId = null;
    for (const c of canonicals) {
      if (c.tokens.size === 0) continue;
      const score = jaccard(dealTokens, c.tokens);
      if (score > bestScore) { bestScore = score; bestId = c.id; }
    }

    if (bestScore >= JACCARD_THRESHOLD) {
      matches.push({ dealId: deal.id, canonicalId: bestId, method: "token-overlap", confidence: bestScore });
      tokenMatched++;
    } else {
      unmatched++;
    }
  }

  const containmentMatched = matches.filter(m => m.method === "containment").length;
  const overlapMatched = matches.filter(m => m.method === "token-overlap").length;
  console.log(`Results:`);
  console.log(`  A) Normalised exact match: ${exactMatched}`);
  console.log(`  B) Containment match:      ${containmentMatched}`);
  console.log(`  C) Token overlap match:    ${overlapMatched}`);
  console.log(`  No match:                  ${unmatched}`);
  console.log(`  Total would link:          ${matches.length}`);
  console.log("");

  if (isDryRun) {
    // Show a sample of token-overlap matches for sanity check
    const sample = matches.filter((m) => m.method === "token-overlap").slice(0, 10);
    if (sample.length > 0) {
      console.log("Sample token-overlap matches (spot-check quality):");
      const canonMap = new Map(canonicalRows.rows.map((r) => [r.id, r.canonical_name]));
      for (const m of sample) {
        const deal = dealRows.rows.find((d) => d.id === m.dealId);
        console.log(`  [${m.confidence.toFixed(2)}] "${deal?.product_name}" → "${canonMap.get(m.canonicalId)}"`);
      }
    }

    // Show projected coverage
    const totalResult = await client.execute(`SELECT COUNT(*) as n FROM store_products`);
    const currentLinked = await client.execute(`SELECT COUNT(*) as n FROM store_products WHERE canonical_id IS NOT NULL`);
    const currentN = Number(currentLinked.rows[0].n);
    const totalN = Number(totalResult.rows[0].n);
    const projectedN = currentN + matches.length;
    console.log(`\nProjected coverage: ${projectedN}/${totalN} (${Math.round(projectedN / totalN * 100)}%) up from ${Math.round(currentN / totalN * 100)}%`);
    return;
  }

  // EXECUTE: write in batches of 500
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < matches.length; i += CHUNK) {
    const chunk = matches.slice(i, i + CHUNK);
    const tx = await client.transaction("write");
    try {
      for (const m of chunk) {
        await tx.execute({
          sql: `INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(deal_id, canonical_id) DO NOTHING`,
          args: [m.dealId, m.canonicalId, m.method, m.confidence, now],
        });
        await tx.execute({
          sql: `UPDATE store_products SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
          args: [m.canonicalId, m.dealId],
        });
        written++;
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    if ((i + CHUNK) % 5000 === 0) console.log(`  Progress: ${i + CHUNK}/${matches.length}...`);
  }

  const covResult   = await client.execute(`SELECT COUNT(*) as n FROM store_products WHERE canonical_id IS NOT NULL`);
  const totalResult = await client.execute(`SELECT COUNT(*) as n FROM store_products`);
  const linked = Number(covResult.rows[0].n);
  const total  = Number(totalResult.rows[0].n);
  console.log(`DONE: ${written} deals linked`);
  console.log(`Final coverage: ${linked}/${total} (${Math.round(linked / total * 100)}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
