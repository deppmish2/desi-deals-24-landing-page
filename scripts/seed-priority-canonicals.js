"use strict";
/**
 * seed-priority-canonicals.js
 *
 * Seeds `canonical_products` with high-popularity Indian grocery products
 * from the curated CSV, then runs a one-time auto-map pass against all
 * existing active deals to populate `deal_mappings`.
 *
 * Usage:
 *   node scripts/seed-priority-canonicals.js             # seed + map
 *   node scripts/seed-priority-canonicals.js --dry-run   # preview only
 *   MIN_POPULARITY=70 node scripts/seed-priority-canonicals.js
 *
 * Safe to re-run — uses ON CONFLICT DO UPDATE for canonicals,
 * INSERT OR IGNORE for deal_mappings.
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");
const { loadPriorityCanonicals, autoMapDeals } = require("../crawler/utils/auto-mapper");

const CSV_PATH = path.resolve(
  __dirname,
  "../data/Most Popular Indian Groceries - indian_grocery_1000_items.csv",
);
const MIN_POPULARITY = parseInt(process.env.MIN_POPULARITY || "60", 10);
const DRY_RUN = process.argv.includes("--dry-run");

// ── Category mapping ─────────────────────────────────────────────────────────
// Rules are checked in order. CSV category is matched first; base product name
// is used as a fallback. Word-boundary matching prevents "matta" matching "atta".

const CATEGORY_RULES = [
  // Spices before Lentils so "Chana Masala" (CSV: Spices) doesn't match "chana"
  { kws: ["spice", "spices", "masala", "condiment", "pepper", "chilli", "chili", "mirch", "mustard", "turmeric", "cumin", "coriander", "cardamom", "clove", "cinnamon", "fenugreek", "asafoetida", "saffron", "tamarind"], category: "Spices & Masalas" },
  { kws: ["flour", "grain", "atta", "maida", "besan", "sooji", "cornflour"], category: "Flours & Baking" },
  { kws: ["rice", "basmati", "poha", "idli", "matta", "sona", "chawal"], category: "Rice & Grains" },
  { kws: ["pulse", "lentil", "dal", "chana", "moong", "urad", "masoor", "rajma", "chickpea"], category: "Lentils & Pulses" },
  { kws: ["oil", "ghee", "fat", "vanaspati"], category: "Oils & Ghee" },
  { kws: ["sauce", "paste", "preserve", "pickle", "chutney", "achar", "ketchup", "vinegar"], category: "Sauces & Pastes" },
  { kws: ["snack", "snacks", "confection", "sweet", "sweets", "biscuit", "namkeen", "halwa", "ladoo", "barfi", "mithai", "chocolate", "chips", "wafer", "papad"], category: "Snacks & Sweets" },
  { kws: ["beverage", "tea", "coffee", "drink", "juice", "lassi", "sharbat", "syrup"], category: "Beverages" },
  { kws: ["dairy", "paneer", "egg", "milk", "curd", "yogurt", "butter", "cream", "khoya"], category: "Dairy & Paneer" },
  { kws: ["frozen", "ready", "paratha", "naan", "samosa"], category: "Frozen Foods" },
  { kws: ["noodle", "pasta", "vermicelli", "sewai", "maggi", "instant"], category: "Noodles & Pasta" },
  { kws: ["fresh", "produce", "vegetable", "fruit", "herb"], category: "Fresh Produce" },
  { kws: ["personal care", "soap", "shampoo", "hair", "skin", "cosmetic", "lotion"], category: "Personal Care" },
  { kws: ["household", "pooja", "incense", "agarbatti", "diya", "puja"], category: "Household" },
];

function wordMatch(haystack, kw) {
  // Escape special regex chars then use word boundaries
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

function mapCategory(csvCategory, baseProduct) {
  const cat = csvCategory.toLowerCase();
  const prod = baseProduct.toLowerCase();

  // Special-case ambiguous CSV categories that group unrelated products together
  if (cat.includes("oil") || cat.includes("ghee")) {
    // "Oils, Ghee & Condiments" contains both oils and pickles/pastes
    if (/\b(pickle|achar|paste|chutney|sauce|ketchup|vinegar)\b/.test(prod)) return "Sauces & Pastes";
    return "Oils & Ghee";
  }
  if (cat.includes("frozen") || cat.includes("ready")) {
    // "Ready to Eat & Frozen" contains both frozen foods and dairy like paneer
    if (/\bpaneer\b/.test(prod)) return "Dairy & Paneer";
    return "Frozen Foods";
  }

  // Standard: match on CSV category string first (more reliable), then base product
  for (const rule of CATEGORY_RULES) {
    if (rule.kws.some((kw) => wordMatch(cat, kw))) return rule.category;
  }
  for (const rule of CATEGORY_RULES) {
    if (rule.kws.some((kw) => wordMatch(prod, kw))) return rule.category;
  }
  return "Other";
}

// ── CSV parsing ──────────────────────────────────────────────────────────────

function parseAliasColumn(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function parseCsvLine(line) {
  // Handle quoted fields with commas inside
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv() {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim());
  // Skip header (line 0). Deduplicate by base product name (CSV has repeated rows).
  const seen = new Map(); // baseProduct.toLowerCase() → row
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 7) continue;
    const [, baseProduct, category, brands, searchVars, misspellings, popularityRaw] = fields;
    const popularity = parseInt(popularityRaw, 10);
    if (!baseProduct || !Number.isFinite(popularity)) continue;
    const key = baseProduct.trim().toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { baseProduct: baseProduct.trim(), category: category.trim(), brands, searchVars, misspellings, popularity });
    }
  }
  return [...seen.values()];
}

// ── Slug helpers (mirrors canonicalizer.js) ──────────────────────────────────

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "item";
}

async function ensureUniqueId(db, baseId, existingIds) {
  let id = baseId;
  let suffix = 2;
  while (
    existingIds.has(id) ||
    (await db.execute("SELECT 1 FROM canonical_products WHERE id = ? LIMIT 1", [id])).rows.length > 0
  ) {
    id = `${baseId}-${suffix}`;
    suffix++;
  }
  existingIds.add(id);
  return id;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = require("../server/db");
  await db.ready;

  if (DRY_RUN) console.log("[dry-run] No writes will be made.\n");

  // Parse CSV
  const allRows = parseCsv();
  const qualifying = allRows.filter((r) => r.popularity >= MIN_POPULARITY);
  console.log(`CSV: ${allRows.length} products total, ${qualifying.length} qualify (MIN_POPULARITY=${MIN_POPULARITY})`);

  let created = 0;
  let updated = 0;
  const seenIds = new Set();

  for (const row of qualifying) {
    const aliases = [
      ...parseAliasColumn(row.brands),
      ...parseAliasColumn(row.searchVars),
      ...parseAliasColumn(row.misspellings),
    ].filter((a, i, arr) => a.length >= 2 && arr.indexOf(a) === i); // dedupe + min length

    const category = mapCategory(row.category, row.baseProduct);
    const baseId = slugify(row.baseProduct);
    const canonicalId = await ensureUniqueId(db, baseId, seenIds);

    if (DRY_RUN) {
      console.log(`  [dry] ${canonicalId} | "${row.baseProduct}" | ${category} | ${aliases.length} aliases`);
      created++;
      continue;
    }

    // Check if already exists
    const existing = (await db.execute(
      "SELECT id FROM canonical_products WHERE id = ? LIMIT 1",
      [canonicalId],
    )).rows[0];

    await db.execute(
      `INSERT INTO canonical_products
         (id, canonical_name, category, common_aliases, is_priority, verified)
       VALUES (?, ?, ?, ?, 1, 1)
       ON CONFLICT(id) DO UPDATE SET
         common_aliases = excluded.common_aliases,
         is_priority = 1`,
      [canonicalId, row.baseProduct, category, JSON.stringify(aliases)],
    );

    if (existing) updated++;
    else created++;
  }

  console.log(`\nCanonicals: ${created} created, ${updated} updated`);

  if (DRY_RUN) {
    console.log("\n[dry-run] Skipping deal mapping pass.");
    return;
  }

  // One-time auto-map all existing active deals → deal_mappings
  console.log("\nRunning auto-map pass against all active deals...");
  const priorityCanonicals = await loadPriorityCanonicals(db);
  console.log(`  Loaded ${priorityCanonicals.length} priority canonicals`);

  const dealsRes = await db.execute(
    `SELECT id, product_name, product_url, store_id
     FROM deals
     WHERE is_active = 1
       AND product_url IS NOT NULL
       AND product_name IS NOT NULL`,
  );
  const deals = dealsRes.rows ?? [];
  console.log(`  Active deals to scan: ${deals.length}`);

  const mapped = await autoMapDeals(db, deals, priorityCanonicals);
  console.log(`  deal_mappings upserted: ${mapped}`);

  // Summary: top canonicals by store coverage
  const topRows = (await db.execute(
    `SELECT cp.canonical_name,
            COUNT(DISTINCT d.store_id) AS stores,
            COUNT(*) AS deal_count
     FROM deal_mappings dm
     JOIN deals d ON d.id = dm.deal_id
     JOIN canonical_products cp ON cp.id = dm.canonical_id
     WHERE cp.is_priority = 1 AND d.is_active = 1
     GROUP BY cp.canonical_name
     ORDER BY stores DESC, deal_count DESC
     LIMIT 15`,
  )).rows ?? [];

  if (topRows.length > 0) {
    console.log("\nTop canonicals by store coverage:");
    for (const r of topRows) {
      const name = String(r.canonical_name).padEnd(30);
      console.log(`  ${name} → ${r.stores} stores, ${r.deal_count} deals`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
