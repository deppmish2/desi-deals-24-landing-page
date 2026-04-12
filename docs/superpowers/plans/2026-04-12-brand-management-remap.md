# Brand Management + Admin-Triggered Remap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brands stored in DB, editable from admin panel; "Save & Re-map" re-decomposes all canonicals and maps previously unmapped deals against the updated brand list.

**Architecture:** `known_brands` table replaces static JS file. Decomposer accepts brands as parameter. Admin remap route commits brands, re-decomposes canonicals (deleting unbranded ones), then runs auto-mapper only on unmapped deals. Frontend polls a job status endpoint.

**Tech Stack:** Node.js/Express, libsql (async), React + Tailwind, node:test regression tests (.mjs)

---

## File Map

| File | Action |
|---|---|
| `server/db/schema.sql` | Add `known_brands`, `brand_remap_jobs` tables |
| `server/db/index.js` | Seed `known_brands` on startup |
| `crawler/utils/canonical-decomposer.js` | BBD strip, all-token brand scan, brands injected as param |
| `tests/regression/canonical-decomposer.test.mjs` | Update tests for new signature and null-brand behavior |
| `crawler/utils/auto-mapper.js` | Remove legacy fallback; `loadPriorityCanonicals` filters `brand_slots IS NOT NULL` |
| `tests/regression/auto-mapper.test.mjs` | Rewrite tests to use slotted canonicals |
| `scripts/migrate-canonical-slots.js` | Load brands from DB, pass to decomposer, delete unbranded canonicals |
| `server/services/canonicalizer.js` | Load brands from DB, pass to decomposer |
| `server/routes/admin-dashboard.js` | Add `GET /brands`, `POST /brands/remap`, `GET /brands/remap-status/:jobId`, `GET /canonical-stats` |
| `client/src/utils/api.js` | Add `fetchBrands`, `triggerBrandRemap`, `fetchRemapStatus`, `fetchCanonicalStats` |
| `client/src/landing/AdminPage.jsx` | 3-tab layout; Canonical Stats tab with brand manager + unmapped products |

---

## Task 1: Schema — known_brands and brand_remap_jobs tables

**Files:**
- Modify: `server/db/schema.sql`

- [ ] **Step 1: Add tables to schema.sql**

Open `server/db/schema.sql` and append at the end (before any final comments):

```sql
-- Known brands whitelist — source of truth for canonical brand-slot matching
CREATE TABLE IF NOT EXISTS known_brands (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]'  -- JSON array of lowercase strings
);

-- Tracks async brand remap jobs triggered from admin panel
CREATE TABLE IF NOT EXISTS brand_remap_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
  started_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  stats       TEXT,   -- JSON: {canonicalsRedecomposed, canonicalsDeleted, newlyMapped, stillUnmapped, duration_ms}
  error       TEXT
);
```

- [ ] **Step 2: Commit**

```bash
git add server/db/schema.sql
git commit -m "feat(schema): add known_brands and brand_remap_jobs tables"
```

---

## Task 2: Seed known_brands on startup

**Files:**
- Modify: `server/db/index.js`

- [ ] **Step 1: Add seed data and seeding logic**

In `server/db/index.js`, find the block starting with `const ready = (async () => {` (around line 162). After the `alwaysMigrations` loop (which ends around line 175), add a brands seed block before the `if (!shouldBootstrapRuntimeDb())` check:

```js
  // Seed known_brands with initial brand list (INSERT OR IGNORE — safe to re-run)
  const SEED_BRANDS = [
    { name: "Aachi",        aliases: ["aachi"] },
    { name: "Aashirvaad",   aliases: ["aashirvaad", "aashirwad", "ashirwad"] },
    { name: "Bambino",      aliases: ["bambino"] },
    { name: "Daawat",       aliases: ["daawat", "dawat"] },
    { name: "Gits",         aliases: ["gits"] },
    { name: "Haldiram's",   aliases: ["haldiram", "haldirams"] },
    { name: "Heer",         aliases: ["heer"] },
    { name: "ITC",          aliases: ["itc"] },
    { name: "Knorr",        aliases: ["knorr"] },
    { name: "LKK",          aliases: ["lkk"] },
    { name: "Maggi",        aliases: ["maggi"] },
    { name: "MTR",          aliases: ["mtr"] },
    { name: "Nanak",        aliases: ["nanak"] },
    { name: "Priya",        aliases: ["priya"] },
    { name: "Shan",         aliases: ["shan"] },
    { name: "Swad",         aliases: ["swad"] },
  ];
  for (const brand of SEED_BRANDS) {
    try {
      await db.execute(
        `INSERT OR IGNORE INTO known_brands (name, aliases) VALUES (?, ?)`,
        [brand.name, JSON.stringify(brand.aliases)],
      );
    } catch (_) {
      // table may not exist yet on very first boot before schema runs — ignore
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add server/db/index.js
git commit -m "feat(db): seed known_brands on startup"
```

---

## Task 3: Update canonical-decomposer — brands injected, BBD strip, all-token scan

**Files:**
- Modify: `crawler/utils/canonical-decomposer.js`
- Modify: `tests/regression/canonical-decomposer.test.mjs`

- [ ] **Step 1: Write failing tests**

Replace the brand-slot tests in `tests/regression/canonical-decomposer.test.mjs`. The full updated file:

```js
import test from "node:test";
import assert from "node:assert/strict";

import decomposerModule from "../../crawler/utils/canonical-decomposer.js";
const { decomposeCanonical } = decomposerModule;

// Shared brand list used across tests
const BRANDS = [
  { name: "Daawat",     aliases: ["daawat", "dawat"] },
  { name: "Heer",       aliases: ["heer"] },
  { name: "Knorr",      aliases: ["knorr"] },
  { name: "Aashirvaad", aliases: ["aashirvaad", "aashirwad", "ashirwad"] },
  { name: "Parachute",  aliases: ["parachute"] },
];

// ── Weight extraction ────────────────────────────────────────────────────────

test("extracts kg weight and normalises to grams", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.equal(r.weightValue, 5000);
  assert.equal(r.weightUnit, "g");
});

test("extracts g weight", () => {
  const r = decomposeCanonical("Heer Basmati Rice Extra Long 500g", [], BRANDS);
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "g");
});

test("extracts gm weight (Indian abbreviation)", () => {
  const r = decomposeCanonical("Knorr Bouillon Cubes Chicken 400gm", [], BRANDS);
  assert.equal(r.weightValue, 400);
  assert.equal(r.weightUnit, "g");
});

test("extracts ml weight", () => {
  const r = decomposeCanonical("Parachute Coconut Oil 500ml", [], BRANDS);
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "ml");
});

test("extracts l weight and normalises to ml", () => {
  const r = decomposeCanonical("Parachute Coconut Oil 1l", [], BRANDS);
  assert.equal(r.weightValue, 1000);
  assert.equal(r.weightUnit, "ml");
});

test("returns null weight when no weight in name", () => {
  const r = decomposeCanonical("Aashirvaad Chakki Atta", [], BRANDS);
  assert.equal(r.weightValue, null);
  assert.equal(r.weightUnit, null);
});

// ── Weight in middle of name ─────────────────────────────────────────────────

test("extracts weight correctly when weight sits between brand and product", () => {
  const r = decomposeCanonical("Heer 500g Basmati Rice Extra Long", [], BRANDS);
  assert.equal(r.weightValue, 500);
  assert.equal(r.weightUnit, "g");
  const allTokens = [
    ...( r.brandSlots || []).flat(),
    ...r.baseProductSlots.flat(),
    ...r.typeSlots.flat(),
  ];
  assert.ok(!allTokens.some((t) => /\d/.test(t)), "no numeric token in slots");
});

// ── Brand slot — known brand found ───────────────────────────────────────────

test("recognised brand gets brand slot with name and aliases (deduplicated)", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.deepEqual(r.brandSlots, [["daawat", "dawat"]]);
});

test("brand matching is case-insensitive (canonical lowercased before token compare)", () => {
  const r = decomposeCanonical("AASHIRVAAD Chakki Atta 5kg", [], BRANDS);
  assert.ok(r.brandSlots !== null, "should find brand");
  assert.ok(r.brandSlots[0].includes("aashirvaad"), "brand slot includes canonical alias");
});

test("brand is found even when not the first token", () => {
  const r = decomposeCanonical("Organic Daawat Basmati Rice 5kg", [], BRANDS);
  assert.ok(r.brandSlots !== null, "brand found in non-first position");
  assert.ok(r.brandSlots[0].includes("daawat"));
  // "organic" should be in baseProductSlots, not brandSlots
  assert.ok(r.baseProductSlots.flat().includes("organic"));
});

// ── Brand slot — unknown brand → null ────────────────────────────────────────

test("unrecognised brand returns brandSlots = null", () => {
  const r = decomposeCanonical("Generic Basmati Rice 5kg", [], BRANDS);
  assert.equal(r.brandSlots, null);
});

test("empty name returns brandSlots = null", () => {
  const r = decomposeCanonical("", [], BRANDS);
  assert.equal(r.brandSlots, null);
  assert.deepEqual(r.baseProductSlots, []);
});

test("no brands list → brandSlots always null", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg", [], []);
  assert.equal(r.brandSlots, null);
});

// ── BBD stripping ─────────────────────────────────────────────────────────────

test("strips 'Best before DATE' before tokenising", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg Best before 12/2025", [], BRANDS);
  const all = [...(r.brandSlots || []).flat(), ...r.baseProductSlots.flat()];
  assert.ok(!all.includes("best"), "best stripped");
  assert.ok(!all.includes("before"), "before stripped");
});

test("strips 'BBD DATE' before tokenising", () => {
  const r = decomposeCanonical("Knorr Bouillon Cubes 400gm BBD 2025", [], BRANDS);
  const all = [...(r.brandSlots || []).flat(), ...r.baseProductSlots.flat()];
  assert.ok(!all.includes("bbd"), "bbd stripped");
});

test("strips 'MHD DATE' before tokenising", () => {
  const r = decomposeCanonical("Heer Basmati Rice 500g MHD 12.2025", [], BRANDS);
  const all = [...(r.brandSlots || []).flat(), ...r.baseProductSlots.flat()];
  assert.ok(!all.includes("mhd"), "mhd stripped");
});

test("strips parenthetical notes from canonical name", () => {
  const r = decomposeCanonical("Daawat Basmati Rice 5kg (BBD 2025)", [], BRANDS);
  const allTokens = r.baseProductSlots.flat();
  assert.ok(!allTokens.includes("bbd"), "BBD note should be stripped");
});

// ── Base product slots ────────────────────────────────────────────────────────

test("each remaining non-brand word becomes its own slot group", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.deepEqual(r.baseProductSlots, [
    ["basmati"],
    ["rice"],
    ["extra"],
    ["long"],
  ]);
});

test("strips dashes from canonical name", () => {
  const r = decomposeCanonical("Daawat - Basmati Rice 5kg", [], BRANDS);
  assert.ok(r.brandSlots !== null);
  assert.deepEqual(r.baseProductSlots, [["basmati"], ["rice"]]);
});

// ── typeSlots ────────────────────────────────────────────────────────────────

test("typeSlots is always empty from decomposer", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.deepEqual(r.typeSlots, []);
});

// ── productGroupId ────────────────────────────────────────────────────────────

test("productGroupId is slug of non-brand, non-weight words", () => {
  const r = decomposeCanonical("Daawat Basmati Rice Extra Long 5kg", [], BRANDS);
  assert.equal(r.productGroupId, "basmati-rice-extra-long");
});

test("productGroupId is weight-agnostic", () => {
  const r5kg  = decomposeCanonical("Heer Basmati Rice Extra Long 5kg", [], BRANDS);
  const r500g = decomposeCanonical("Heer Basmati Rice Extra Long 500g", [], BRANDS);
  assert.equal(r5kg.productGroupId, r500g.productGroupId);
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm run test:regression 2>&1 | grep -E "fail|not ok"
```

Expected: multiple failures (brandSlots tests fail because signature not yet updated).

- [ ] **Step 3: Implement the updated decomposer**

Replace `crawler/utils/canonical-decomposer.js` entirely:

```js
"use strict";
/**
 * canonical-decomposer.js
 *
 * Decomposes a canonical product name into token-slot arrays for matching.
 *
 * Used by:
 *  - scripts/migrate-canonical-slots.js
 *  - server/services/canonicalizer.js
 *  - server/routes/admin-dashboard.js (remap job)
 *
 * @param {string}   canonicalName
 * @param {string[]} commonAliases  - reserved for future use
 * @param {Array}    brands         - from known_brands table: [{name, aliases: string[]}]
 */

const { parseWeight } = require("./weight-parser");

// Patterns to strip before processing: "Best before 12/2025", "BBD 2025", "MHD 12.25", etc.
const BBD_RE = /\b(?:best\s+before|best\s+by|bb[d]?|exp\.?|expires?|mhd)\b[\s:]*[\d\/\.\-a-zA-Z]*/gi;

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeWeight(value, unit) {
  switch (unit) {
    case "g":  return { weightValue: value,        weightUnit: "g" };
    case "kg": return { weightValue: value * 1000, weightUnit: "g" };
    case "ml": return { weightValue: value,        weightUnit: "ml" };
    case "l":  return { weightValue: value * 1000, weightUnit: "ml" };
    default:   return { weightValue: null,         weightUnit: null };
  }
}

function decomposeCanonical(canonicalName, commonAliases = [], brands = []) {
  let name = String(canonicalName || "");

  if (!name.trim()) {
    return {
      brandSlots: null,
      baseProductSlots: [],
      typeSlots: [],
      productGroupId: "unknown",
      weightValue: null,
      weightUnit: null,
    };
  }

  // 1. Strip BBD/expiry patterns before any tokenisation
  name = name.replace(BBD_RE, " ");

  // 2. Extract weight
  const wt = parseWeight(name);
  const { weightValue, weightUnit } = wt
    ? normalizeWeight(wt.value, wt.unit)
    : { weightValue: null, weightUnit: null };

  // 3. Strip weight, parentheticals, dashes — then normalise
  let stripped = name;
  if (wt && wt.raw) stripped = stripped.replace(wt.raw, " ");
  stripped = stripped
    .replace(/\([^)]*\)/g, " ")
    .replace(/-+/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = stripped.split(" ").filter(Boolean);

  if (tokens.length === 0) {
    return {
      brandSlots: null,
      baseProductSlots: [],
      typeSlots: [],
      productGroupId: "unknown",
      weightValue,
      weightUnit,
    };
  }

  // 4. Scan ALL tokens for a known brand alias match
  let brandEntry = null;
  let brandTokenIndex = -1;
  outer: for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    for (const b of brands) {
      if (b.aliases.some((alias) => t === alias)) {
        brandEntry = b;
        brandTokenIndex = i;
        break outer;
      }
    }
  }

  // 5. Build slot arrays
  const productTokens = tokens.filter((_, i) => i !== brandTokenIndex);

  // Deduplicate in case name.toLowerCase() already appears in aliases
  const brandSlots = brandEntry
    ? [[...new Set([brandEntry.name.toLowerCase(), ...brandEntry.aliases])]]
    : null;

  const baseProductSlots = productTokens.map((t) => [t]);

  const productGroupId =
    productTokens.length > 0 ? productTokens.join("-") : "unknown";

  return {
    brandSlots,
    baseProductSlots,
    typeSlots: [],
    productGroupId,
    weightValue,
    weightUnit,
  };
}

module.exports = { decomposeCanonical };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm run test:regression 2>&1 | tail -8
```

Expected: `# pass 85` or more, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add crawler/utils/canonical-decomposer.js tests/regression/canonical-decomposer.test.mjs
git commit -m "feat(decomposer): brands injected, BBD strip, all-token brand scan; brandSlots=null when no match"
```

---

## Task 4: Update auto-mapper — remove legacy fallback, filter brand_slots IS NOT NULL

**Files:**
- Modify: `crawler/utils/auto-mapper.js`
- Modify: `tests/regression/auto-mapper.test.mjs`

- [ ] **Step 1: Write failing tests**

Replace `tests/regression/auto-mapper.test.mjs` entirely:

```js
import test from "node:test";
import assert from "node:assert/strict";

import autoMapperModule from "../../crawler/utils/auto-mapper.js";
const { autoMapDeals, matchesCanonical } = autoMapperModule;

function makeDb() {
  const inserts = [];
  return {
    inserts,
    execute: async (sql, params) => {
      if (/INSERT INTO deal_mappings/i.test(sql)) inserts.push(params);
      return { rows: [] };
    },
  };
}

// A properly slotted Knorr canonical
const KNORR = {
  id: "canon-knorr",
  canonical_name: "Knorr Bouillon Cubes Chicken 400gm",
  normed: "knorr bouillon cubes chicken 400gm",
  aliases: [],
  brandSlots:       [["knorr"]],
  baseProductSlots: [["bouillon"], ["cubes"], ["chicken"]],
  typeSlots:        [],
  weightValue: 400,
  weightUnit: "g",
};

// ── matchesCanonical ─────────────────────────────────────────────────────────

test("matchesCanonical returns true when all slots present and weight matches", () => {
  const result = matchesCanonical(
    "knorr bouillon cubes chicken 400gm",
    400, "g",
    KNORR,
  );
  assert.equal(result, true);
});

test("matchesCanonical returns false when brand slot missing", () => {
  const result = matchesCanonical(
    "jumbo bouillon cubes chicken 400gm",
    400, "g",
    KNORR,
  );
  assert.equal(result, false);
});

test("matchesCanonical returns false when weight differs by > 10%", () => {
  // 480 / 400 = 1.2 — outside ±10% tolerance
  const result = matchesCanonical(
    "knorr bouillon cubes chicken 480gm",
    480, "g",
    KNORR,
  );
  assert.equal(result, false);
});

test("matchesCanonical returns null when canonical has no slots", () => {
  const noSlots = { ...KNORR, brandSlots: null, baseProductSlots: null };
  const result = matchesCanonical("knorr bouillon cubes chicken", null, null, noSlots);
  assert.equal(result, null);
});

// ── autoMapDeals — no legacy fallback ────────────────────────────────────────

test("autoMapDeals skips canonical with no slots (no legacy fallback)", async () => {
  const db = makeDb();
  const noSlots = { ...KNORR, brandSlots: null, baseProductSlots: null };
  const deals = [{
    id: "deal-knorr",
    product_url: "https://example.com/knorr",
    product_name: "Knorr Bouillon Cubes Chicken 400gm",
    weight_value: 400,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [noSlots]);
  assert.equal(db.inserts.length, 0, "no-slot canonical must be skipped entirely");
});

test("autoMapDeals matches Knorr deal to slotted Knorr canonical", async () => {
  const db = makeDb();
  const deals = [{
    id: "deal-knorr",
    product_url: "https://example.com/knorr",
    product_name: "Knorr Bouillon Cubes Chicken 400gm",
    weight_value: 400,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [KNORR]);
  assert.equal(db.inserts.length, 1, "Knorr deal should match slotted canonical");
  assert.equal(db.inserts[0][1], "canon-knorr");
});

test("autoMapDeals does NOT match Jumbo deal to Knorr canonical", async () => {
  const db = makeDb();
  const deals = [{
    id: "deal-jumbo",
    product_url: "https://example.com/jumbo",
    product_name: "Jumbo Bouillon Cubes Chicken 400g",
    weight_value: 400,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [KNORR]);
  assert.equal(db.inserts.length, 0, "Jumbo deal should not match Knorr canonical");
});

test("autoMapDeals does NOT match Knorr deal when weight differs by > 10%", async () => {
  const db = makeDb();
  const deals = [{
    id: "deal-knorr-480",
    product_url: "https://example.com/knorr-480",
    product_name: "Knorr Bouillon Cubes Chicken 480g",
    weight_value: 480,
    weight_unit: "g",
  }];
  await autoMapDeals(db, deals, [KNORR]);
  assert.equal(db.inserts.length, 0, "480g deal should not match 400g canonical");
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm run test:regression 2>&1 | grep -E "not ok.*auto-mapper|# fail"
```

Expected: some auto-mapper tests fail (because legacy fallback still exists and `matchesCanonical null` still triggers it).

- [ ] **Step 3: Update auto-mapper**

In `crawler/utils/auto-mapper.js`:

**Change 1** — in `loadPriorityCanonicals`, add `AND brand_slots IS NOT NULL` to both query branches:

```js
// Primary query (is_match_priority)
`SELECT id, canonical_name, common_aliases,
        brand_slots, base_product_slots, type_slots,
        weight_value, weight_unit
 FROM canonical_products
 WHERE is_match_priority = 1
   AND brand_slots IS NOT NULL`

// Fallback query (is_priority)
`SELECT id, canonical_name, common_aliases,
        brand_slots, base_product_slots, type_slots,
        weight_value, weight_unit
 FROM canonical_products
 WHERE is_priority = 1
   AND brand_slots IS NOT NULL`
```

**Change 2** — in `autoMapDeals`, remove Path 2 (legacy brand-anchored alias substring matching). Replace the inner loop body:

```js
    for (const canon of priorityCanonicals) {
      const slotResult = matchesCanonical(normedName, dealWeightValue, dealWeightUnit, canon);

      // null = no slots → skip (no legacy fallback)
      if (slotResult !== true) continue;

      try {
        await db.execute(
          `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence)
           VALUES (?, ?, 'slot_match', 0.85)
           ON CONFLICT(deal_id, canonical_id) DO UPDATE SET match_confidence = 0.85`,
          [deal.id, canon.id],
        );
        mapped++;
      } catch (_) {
        // FK violation — skip
      }
      break; // one canonical per deal
    }
```

Also remove the `aliases` field from the mapped object in `loadPriorityCanonicals` and the `normed` field (they were only used by the legacy path):

```js
  return rows.map((r) => {
    const brandSlots       = parseSlots(r.brand_slots);
    const baseProductSlots = parseSlots(r.base_product_slots);
    const typeSlots        = parseSlots(r.type_slots) || [];

    return {
      id: r.id,
      canonical_name: r.canonical_name,
      brandSlots,
      baseProductSlots,
      typeSlots,
      weightValue: r.weight_value ?? null,
      weightUnit:  r.weight_unit  ?? null,
    };
  });
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm run test:regression 2>&1 | tail -8
```

Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add crawler/utils/auto-mapper.js tests/regression/auto-mapper.test.mjs
git commit -m "feat(auto-mapper): remove legacy fallback; slot-only matching; filter brand_slots IS NOT NULL"
```

---

## Task 5: Update decomposeCanonical callers

**Files:**
- Modify: `scripts/migrate-canonical-slots.js`
- Modify: `server/services/canonicalizer.js`

- [ ] **Step 1: Update migrate-canonical-slots.js**

This script re-decomposes canonicals. It now loads brands from DB, passes them to `decomposeCanonical`, and deletes canonicals where `brandSlots = null`.

Replace the `main()` function body in `scripts/migrate-canonical-slots.js`:

```js
async function main() {
  await db.ready;

  // Load brands from DB
  const brandRows = await db.prepare(`SELECT name, aliases FROM known_brands`).all();
  const brands = brandRows.map((r) => ({
    name: r.name,
    aliases: JSON.parse(String(r.aliases || "[]")),
  }));
  console.log(`[migrate-canonical-slots] Loaded ${brands.length} known brands`);

  const rows = await db.prepare(
    `SELECT id, canonical_name, common_aliases, category FROM canonical_products`,
  ).all();

  console.log(`[migrate-canonical-slots] Processing ${rows.length} canonical rows…`);
  if (DRY_RUN) console.log("[migrate-canonical-slots] DRY RUN — no writes");

  let updated = 0;
  let deleted = 0;
  let weightExtracted = 0;
  let weightMissed = 0;
  const productGroupsSeen = new Set();

  for (const row of rows) {
    const aliases = row.common_aliases
      ? String(row.common_aliases).split(",").map((a) => a.trim()).filter(Boolean)
      : [];

    let decomposed;
    try {
      decomposed = decomposeCanonical(row.canonical_name, aliases, brands);
    } catch (err) {
      console.warn(`[migrate] SKIP id=${row.id} error=${err.message}`);
      continue;
    }

    const { brandSlots, baseProductSlots, typeSlots, productGroupId, weightValue, weightUnit } = decomposed;

    if (DRY_RUN) {
      if (brandSlots === null) {
        console.log(`[dry-run] DELETE (no brand): "${row.canonical_name}"`);
      } else {
        console.log(`[dry-run] UPDATE id=${row.id} brand=${JSON.stringify(brandSlots)} group=${productGroupId}`);
      }
      updated++;
      continue;
    }

    if (brandSlots === null) {
      // Clear canonical_id on deals first (no ON DELETE CASCADE on this FK)
      await db.execute(`UPDATE deals SET canonical_id = NULL WHERE canonical_id = ?`, [row.id]);
      await db.execute(`DELETE FROM canonical_products WHERE id = ?`, [row.id]);
      console.log(`[migrate] DELETED (no brand): "${row.canonical_name}"`);
      deleted++;
      continue;
    }

    if (weightValue != null) weightExtracted++; else weightMissed++;

    if (!productGroupsSeen.has(productGroupId)) {
      productGroupsSeen.add(productGroupId);
      try {
        await db.execute(
          `INSERT OR IGNORE INTO product_groups (id, group_name, category) VALUES (?, ?, ?)`,
          [productGroupId, productGroupId.replace(/-/g, " "), row.category || null],
        );
      } catch (e) {
        console.warn(`[migrate] product_group upsert failed: ${e.message}`);
      }
    }

    try {
      await db.execute(
        `UPDATE canonical_products
         SET brand_slots = ?, base_product_slots = ?, type_slots = ?,
             product_group_id = ?, weight_value = ?, weight_unit = ?,
             is_match_priority = 1
         WHERE id = ?`,
        [
          JSON.stringify(brandSlots),
          JSON.stringify(baseProductSlots),
          JSON.stringify(typeSlots),
          productGroupId,
          weightValue,
          weightUnit,
          row.id,
        ],
      );
      updated++;
    } catch (e) {
      console.warn(`[migrate] UPDATE failed id=${row.id}: ${e.message}`);
    }
  }

  console.log(`[migrate-canonical-slots] Done.`);
  console.log(`  updated: ${updated} / ${rows.length}`);
  console.log(`  deleted (no brand): ${deleted}`);
  console.log(`  weight extracted: ${weightExtracted}`);
  console.log(`  weight missed: ${weightMissed}`);
  console.log(`  product groups: ${productGroupsSeen.size}`);
}
```

- [ ] **Step 2: Update server/services/canonicalizer.js**

Find the call to `decomposeCanonical` in `server/services/canonicalizer.js` (around line 86). The function that calls it needs to load brands from DB first.

Find the function containing `decomposeCanonical(canonicalName || rawName || "")` and update it:

```js
  // Load brands for decomposition
  const brandRows = await db.prepare(`SELECT name, aliases FROM known_brands`).all().catch(() => []);
  const brands = brandRows.map((r) => ({
    name: r.name,
    aliases: JSON.parse(String(r.aliases || "[]")),
  }));

  const {
    brandSlots,
    baseProductSlots,
    typeSlots,
    productGroupId,
    weightValue,
    weightUnit,
  } = decomposeCanonical(canonicalName || rawName || "", [], brands);
```

- [ ] **Step 3: Run tests — verify still passing**

```bash
npm run test:regression 2>&1 | tail -5
```

Expected: `# fail 0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-canonical-slots.js server/services/canonicalizer.js
git commit -m "feat(callers): pass brands to decomposeCanonical; delete unbranded canonicals in migrate script"
```

---

## Task 6: Backend — brand and remap routes

**Files:**
- Modify: `server/routes/admin-dashboard.js`

- [ ] **Step 1: Add required imports at the top of admin-dashboard.js**

After the existing `require` lines at the top, add:

```js
const { decomposeCanonical } = require("../../crawler/utils/canonical-decomposer");
const { loadPriorityCanonicals, autoMapDeals } = require("../../crawler/utils/auto-mapper");
```

- [ ] **Step 2: Add GET /brands**

Append to `server/routes/admin-dashboard.js` (before `module.exports = router`):

```js
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
```

- [ ] **Step 3: Add GET /canonical-stats**

```js
router.get("/canonical-stats", async (req, res) => {
  try {
    const [
      totalCanonicalsRow,
      mappedDealsRow,
      totalActiveRow,
      unmappedRows,
    ] = await Promise.all([
      safeGet(`SELECT COUNT(*) as count FROM canonical_products`, [], { count: 0 }),
      safeGet(
        `SELECT COUNT(DISTINCT deal_id) as count FROM deal_mappings`,
        [], { count: 0 },
      ),
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
```

- [ ] **Step 4: Add POST /brands/remap**

```js
router.post("/brands/remap", async (req, res) => {
  const { brands } = req.body || {};
  if (!Array.isArray(brands)) {
    return res.status(400).json({ error: "brands must be an array" });
  }

  try {
    // 1. Replace known_brands table
    await db.execute(`DELETE FROM known_brands`);
    for (const brand of brands) {
      if (!brand.name) continue;
      await db.execute(
        `INSERT INTO known_brands (name, aliases) VALUES (?, ?)`,
        [String(brand.name).trim(), JSON.stringify(brand.aliases || [])],
      );
    }

    // 2. Create job row
    const jobResult = await db.prepare(
      `INSERT INTO brand_remap_jobs (status) VALUES ('running')`,
    ).run();
    const jobId = Number(jobResult.lastInsertRowid);

    // 3. Return 202 immediately
    res.status(202).json({ jobId });

    // 4. Continue working — re-decompose, delete unbranded, map unmapped deals
    (async () => {
      const startedAt = Date.now();
      try {
        const freshBrands = brands.map((b) => ({
          name: String(b.name || "").trim(),
          aliases: (b.aliases || []).map((a) => String(a).toLowerCase().trim()).filter(Boolean),
        }));

        // Re-decompose all canonicals
        const canonicals = await db.prepare(
          `SELECT id, canonical_name, common_aliases FROM canonical_products`,
        ).all();

        let canonicalsRedecomposed = 0;
        let canonicalsDeleted = 0;

        for (const canonical of canonicals) {
          const aliases = canonical.common_aliases
            ? String(canonical.common_aliases).split(",").map((a) => a.trim()).filter(Boolean)
            : [];

          const decomposed = decomposeCanonical(
            canonical.canonical_name, aliases, freshBrands,
          );

          if (decomposed.brandSlots === null) {
            // Clear FK on deals before deleting canonical
            await db.execute(
              `UPDATE deals SET canonical_id = NULL WHERE canonical_id = ?`,
              [canonical.id],
            );
            await db.execute(
              `DELETE FROM canonical_products WHERE id = ?`,
              [canonical.id],
            );
            canonicalsDeleted++;
          } else {
            await db.execute(
              `UPDATE canonical_products
               SET brand_slots = ?, base_product_slots = ?, product_group_id = ?
               WHERE id = ?`,
              [
                JSON.stringify(decomposed.brandSlots),
                JSON.stringify(decomposed.baseProductSlots),
                decomposed.productGroupId,
                canonical.id,
              ],
            );
            canonicalsRedecomposed++;
          }
        }

        // Load unmapped active deals only
        const unmappedDeals = await db.prepare(
          `SELECT d.id, d.product_url, d.product_name,
                  d.weight_value, d.weight_unit
           FROM deals d
           LEFT JOIN deal_mappings dm ON dm.deal_id = d.id
           WHERE d.is_active = 1 AND dm.deal_id IS NULL`,
        ).all();

        // Load updated priority canonicals (brand_slots IS NOT NULL enforced inside)
        const priorityCanonicals = await loadPriorityCanonicals(db);

        const newlyMapped = await autoMapDeals(db, unmappedDeals, priorityCanonicals);
        const stillUnmapped = unmappedDeals.length - newlyMapped;

        await db.execute(
          `UPDATE brand_remap_jobs
           SET status = 'completed', finished_at = CURRENT_TIMESTAMP, stats = ?
           WHERE id = ?`,
          [
            JSON.stringify({
              canonicalsRedecomposed,
              canonicalsDeleted,
              newlyMapped,
              stillUnmapped,
              duration_ms: Date.now() - startedAt,
            }),
            jobId,
          ],
        );
      } catch (err) {
        await db.execute(
          `UPDATE brand_remap_jobs
           SET status = 'failed', finished_at = CURRENT_TIMESTAMP, error = ?
           WHERE id = ?`,
          [String(err.message), jobId],
        ).catch(() => {});
      }
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: Add GET /brands/remap-status/:jobId**

```js
router.get("/brands/remap-status/:jobId", async (req, res) => {
  try {
    const row = await db.prepare(
      `SELECT id, status, started_at, finished_at, stats, error
       FROM brand_remap_jobs WHERE id = ?`,
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
```

- [ ] **Step 6: Run regression tests — verify still passing**

```bash
npm run test:regression 2>&1 | tail -5
```

Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add server/routes/admin-dashboard.js
git commit -m "feat(api): GET /brands, GET /canonical-stats, POST /brands/remap, GET /brands/remap-status/:jobId"
```

---

## Task 7: Frontend API helpers

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Add four helpers at the end of api.js**

```js
export function fetchBrands() {
  return authRequest("/admin-dashboard/brands");
}

export function triggerBrandRemap(brands) {
  return authRequest("/admin-dashboard/brands/remap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brands }),
  });
}

export function fetchRemapStatus(jobId) {
  return authRequest(`/admin-dashboard/brands/remap-status/${jobId}`);
}

export function fetchCanonicalStats() {
  return authRequest("/admin-dashboard/canonical-stats");
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(api-client): add fetchBrands, triggerBrandRemap, fetchRemapStatus, fetchCanonicalStats"
```

---

## Task 8: Admin dashboard — 3 tabs + Canonical Stats tab

**Files:**
- Modify: `client/src/landing/AdminPage.jsx`

- [ ] **Step 1: Update imports**

Change the import line at the top of `AdminPage.jsx` from:

```js
import { fetchAdminStats, getAuthSession, logoutUser } from "../utils/api";
```

to:

```js
import {
  fetchAdminStats,
  fetchBrands,
  fetchCanonicalStats,
  fetchRemapStatus,
  triggerBrandRemap,
  getAuthSession,
  logoutUser,
} from "../utils/api";
```

- [ ] **Step 2: Add tab state and canonical stats state to AdminPage component**

Inside `AdminPage()`, after the existing state declarations (`stats`, `error`, `loading`), add:

```js
  const [tab, setTab] = useState("crawl");

  // Canonical Stats tab state
  const [canonicalStats, setCanonicalStats] = useState(null);
  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [canonicalError, setCanonicalError] = useState(null);

  // Brand manager draft state
  const [brandDraft, setBrandDraft] = useState(null);   // null = not yet loaded
  const [brandsDirty, setBrandsDirty] = useState(false);
  const [deletedBrandIds, setDeletedBrandIds] = useState(new Set());
  const [remapJobId, setRemapJobId] = useState(null);
  const [remapStatus, setRemapStatus] = useState(null); // null | "running" | "completed" | "failed"
  const [remapStats, setRemapStats] = useState(null);
  const [remapError, setRemapError] = useState(null);
  const [remapToast, setRemapToast] = useState(null);   // success message string
```

- [ ] **Step 3: Add canonical tab load handler**

After `handleLogout`, add:

```js
  async function handleCanonicalTabOpen() {
    if (canonicalStats) return; // already loaded
    setCanonicalLoading(true);
    setCanonicalError(null);
    try {
      const [stats, brands] = await Promise.all([
        fetchCanonicalStats(),
        fetchBrands(),
      ]);
      setCanonicalStats(stats);
      setBrandDraft(brands);
    } catch (err) {
      setCanonicalError(String(err?.message || "Failed to load"));
    } finally {
      setCanonicalLoading(false);
    }
  }

  function handleTabChange(newTab) {
    setTab(newTab);
    if (newTab === "canonical") handleCanonicalTabOpen();
  }
```

- [ ] **Step 4: Add brand draft mutation helpers**

After `handleTabChange`:

```js
  function handleBrandFieldChange(index, field, value) {
    setBrandDraft((prev) => {
      const next = prev.map((b, i) =>
        i === index ? { ...b, [field]: value } : b,
      );
      return next;
    });
    setBrandsDirty(true);
  }

  function handleAddBrand() {
    setBrandDraft((prev) => [...(prev || []), { id: null, name: "", aliases: [] }]);
    setBrandsDirty(true);
  }

  function handleDeleteBrand(index) {
    setBrandDraft((prev) => {
      const brand = prev[index];
      if (brand.id) {
        setDeletedBrandIds((ids) => new Set([...ids, brand.id]));
      }
      return prev.filter((_, i) => i !== index);
    });
    setBrandsDirty(true);
  }

  function handleUndoDelete(brandId) {
    setDeletedBrandIds((ids) => {
      const next = new Set(ids);
      next.delete(brandId);
      return next;
    });
    setBrandsDirty(true);
  }

  async function handleSaveAndRemap() {
    setRemapStatus("running");
    setRemapError(null);
    setRemapToast(null);

    // Build final brand list: non-deleted rows with non-empty names
    const finalBrands = (brandDraft || [])
      .filter((b) => !deletedBrandIds.has(b.id) && String(b.name).trim())
      .map((b) => ({
        name: String(b.name).trim(),
        aliases: Array.isArray(b.aliases)
          ? b.aliases
          : String(b.aliases || "")
              .split(",")
              .map((a) => a.trim().toLowerCase())
              .filter(Boolean),
      }));

    try {
      const { jobId } = await triggerBrandRemap(finalBrands);
      setRemapJobId(jobId);
      setBrandsDirty(false);

      // Poll every 3 seconds
      const poll = setInterval(async () => {
        try {
          const result = await fetchRemapStatus(jobId);
          if (result.status === "completed") {
            clearInterval(poll);
            setRemapStatus("completed");
            setRemapStats(result.stats);
            setRemapToast(
              `${result.stats?.newlyMapped ?? 0} newly mapped · ` +
              `${result.stats?.stillUnmapped ?? 0} still unmapped · ` +
              `${result.stats?.canonicalsDeleted ?? 0} canonicals deleted`,
            );
            // Reload canonical stats
            const [freshStats, freshBrands] = await Promise.all([
              fetchCanonicalStats(),
              fetchBrands(),
            ]);
            setCanonicalStats(freshStats);
            setBrandDraft(freshBrands);
          } else if (result.status === "failed") {
            clearInterval(poll);
            setRemapStatus("failed");
            setRemapError(result.error || "Remap failed");
          }
        } catch (_) {}
      }, 3000);
    } catch (err) {
      setRemapStatus(null);
      setRemapError(String(err?.message || "Failed to start remap"));
    }
  }
```

- [ ] **Step 5: Add tab bar below the sticky header**

Find the closing `</div>` of the sticky header block (after the Sign out button, around line 262). Just after that closing `</div>`, add the tab bar:

```jsx
      {/* Tab bar */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 flex gap-0">
          {[
            { id: "crawl", label: "Crawl Stats" },
            { id: "user",  label: "User Stats"  },
            { id: "canonical", label: "Canonical Stats" },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`px-5 py-3 text-[13px] font-bold border-b-2 transition-colors ${
                tab === id
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
```

- [ ] **Step 6: Wrap existing content in Crawl Stats and User Stats tabs**

Currently everything is rendered inside `<div className="max-w-6xl mx-auto px-6 py-8 space-y-8">`. Replace that single outer div with three conditional sections.

Find the line:
```jsx
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
```

Replace it with:
```jsx
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* ── User Stats tab ── */}
        {tab === "user" && <>
```

Then find where the user content ends and crawl content begins. The user KPI cards are first (the `<div className="grid grid-cols-2 sm:grid-cols-4 gap-4">` block at line ~265). The crawl card starts immediately after (the `<div className="bg-white rounded-2xl..." >` block containing "Latest crawl").

Move the KPI cards + charts + search tables + all users table into the `tab === "user"` block.
Move the Latest crawl card + store report + recent crawl runs into the `tab === "crawl"` block.

Concrete structure after refactor:

```jsx
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* ── User Stats tab ── */}
        {tab === "user" && (
          <>
            {/* 4 KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Total users" value={kpis.total_users} />
              <KpiCard label="New users (30d)" value={kpis.new_users_30d} />
              <KpiCard label="Searches today" value={kpis.searches_today} />
              <KpiCard label="Unique searchers (30d)" value={kpis.unique_searchers_30d} />
            </div>

            {/* ...all remaining existing user content blocks (charts, tables)... */}
          </>
        )}

        {/* ── Crawl Stats tab ── */}
        {tab === "crawl" && (
          <>
            {/* ...latest crawl card and all existing crawl content blocks... */}
          </>
        )}

        {/* ── Canonical Stats tab ── */}
        {tab === "canonical" && (
          <CanonicalStatsTab
            loading={canonicalLoading}
            error={canonicalError}
            stats={canonicalStats}
            brandDraft={brandDraft}
            brandsDirty={brandsDirty}
            deletedBrandIds={deletedBrandIds}
            remapStatus={remapStatus}
            remapError={remapError}
            remapToast={remapToast}
            onBrandFieldChange={handleBrandFieldChange}
            onAddBrand={handleAddBrand}
            onDeleteBrand={handleDeleteBrand}
            onUndoDelete={handleUndoDelete}
            onSaveAndRemap={handleSaveAndRemap}
          />
        )}

      </div>
```

- [ ] **Step 7: Add CanonicalStatsTab component**

Add this new component above `export default function AdminPage()` in the same file:

```jsx
function CanonicalStatsTab({
  loading, error, stats, brandDraft, brandsDirty, deletedBrandIds,
  remapStatus, remapError, remapToast,
  onBrandFieldChange, onAddBrand, onDeleteBrand, onUndoDelete, onSaveAndRemap,
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-500 text-sm">
        {error}
      </div>
    );
  }
  if (!stats) return null;

  const mappedPct = stats.total_active_deals > 0
    ? Math.round((stats.mapped_deals / stats.total_active_deals) * 100)
    : 0;
  const unmappedCount = stats.total_active_deals - stats.mapped_deals;
  const unmappedPct = 100 - mappedPct;

  return (
    <div className="space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total canonicals" value={stats.total_canonicals} />
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-2">
            Deals mapped
          </div>
          <div className="text-[34px] font-extrabold text-green-700 leading-none">
            {stats.mapped_deals}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {mappedPct}% of {stats.total_active_deals} active
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm px-5 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-red-400 mb-2">
            Unmapped products
          </div>
          <div className="text-[34px] font-extrabold text-red-600 leading-none">
            {unmappedCount}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {unmappedPct}% of active deals
          </div>
        </div>
      </div>

      {/* Mapping health bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
          Mapping health
        </div>
        <div className="flex h-4 rounded-full overflow-hidden">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${mappedPct}%` }}
          />
          <div
            className="bg-red-300 transition-all"
            style={{ width: `${unmappedPct}%` }}
          />
        </div>
        <div className="flex gap-6 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
            Slot matched ({mappedPct}%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-300" />
            Unmapped ({unmappedPct}%)
          </span>
        </div>
      </div>

      {/* Brand Manager */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400">
              Known Brands
            </span>
            {brandDraft && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                {brandDraft.filter((b) => !deletedBrandIds.has(b.id)).length} brands
              </span>
            )}
          </div>
          <button
            onClick={onAddBrand}
            className="text-xs font-bold text-green-700 hover:text-green-900 transition-colors"
          >
            + Add brand
          </button>
        </div>

        {brandDraft && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-[10px] font-bold uppercase tracking-[1px] text-slate-400 pb-1 border-b border-slate-100">
              <span>Brand name</span>
              <span>Aliases (comma-separated)</span>
              <span />
            </div>
            {brandDraft.map((brand, i) => {
              const isDeleted = deletedBrandIds.has(brand.id);
              return (
                <div
                  key={brand.id ?? `new-${i}`}
                  className={`grid grid-cols-[1fr_2fr_auto] gap-2 items-center py-1 ${
                    isDeleted ? "opacity-40 line-through" : ""
                  }`}
                >
                  <input
                    className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-green-500"
                    value={brand.name}
                    disabled={isDeleted}
                    onChange={(e) => onBrandFieldChange(i, "name", e.target.value)}
                  />
                  <input
                    className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-green-500 font-mono text-xs"
                    value={Array.isArray(brand.aliases) ? brand.aliases.join(", ") : brand.aliases}
                    disabled={isDeleted}
                    onChange={(e) =>
                      onBrandFieldChange(
                        i,
                        "aliases",
                        e.target.value.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean),
                      )
                    }
                  />
                  {isDeleted ? (
                    <button
                      onClick={() => onUndoDelete(brand.id)}
                      className="text-xs text-slate-400 hover:text-slate-700"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      onClick={() => onDeleteBrand(i)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Toast / status */}
        {remapToast && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-green-50 text-green-800 text-sm font-medium">
            {remapToast}
          </div>
        )}
        {remapError && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">
            {remapError}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onSaveAndRemap}
            disabled={!brandsDirty || remapStatus === "running"}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-colors ${
              !brandsDirty || remapStatus === "running"
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
          >
            {remapStatus === "running" ? "Remapping…" : "Save & Re-map"}
          </button>
        </div>
      </div>

      {/* Unmapped products table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
          Unmapped products
        </div>
        {stats.unmapped_products.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 text-sm font-medium py-4">
            <span className="text-lg">✓</span> All active products are mapped
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
                  <th className="pb-2 pr-4">Product</th>
                  <th className="pb-2 pr-4">Store</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 pr-4">Price</th>
                  <th className="pb-2">Link</th>
                </tr>
              </thead>
              <tbody>
                {stats.unmapped_products.map((p) => (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-700 max-w-[260px] truncate">
                      {p.product_name}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs">{p.store_name}</td>
                    <td className="py-2.5 pr-4 text-slate-400 text-xs">{p.product_category}</td>
                    <td className="py-2.5 pr-4 text-slate-700 text-xs">
                      {p.sale_price != null
                        ? `${(p.currency || "€")} ${Number(p.sale_price).toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="py-2.5">
                      <a
                        href={p.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-green-700 font-bold hover:underline"
                      >
                        View ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run regression tests**

```bash
npm run test:regression 2>&1 | tail -5
```

Expected: `# fail 0`.

- [ ] **Step 9: Commit**

```bash
git add client/src/landing/AdminPage.jsx
git commit -m "feat(admin): 3-tab layout + Canonical Stats tab with brand manager and unmapped products"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run full regression suite**

```bash
npm run test:regression 2>&1 | tail -8
```

Expected: `# fail 0`, all tests pass.

- [ ] **Step 2: Build the frontend**

```bash
cd client && npm run build 2>&1 | tail -10
cd ..
```

Expected: build completes without errors.

- [ ] **Step 3: Push and update PR**

```bash
git push origin real-savings-feature
```

The open PR (deppmish2/desi-deals-24-landing-page#20, or a new PR if main was already merged) will update automatically.

- [ ] **Step 4: Post-deploy migration (run after deploying to production)**

After the code is live, re-decompose all existing canonicals using the updated decomposer + brand list:

```bash
node scripts/migrate-canonical-slots.js
```

This will update `brand_slots` on all canonicals and delete any that don't match a known brand. Then open the admin panel → Canonical Stats tab → "Save & Re-map" to map previously unmapped deals.
