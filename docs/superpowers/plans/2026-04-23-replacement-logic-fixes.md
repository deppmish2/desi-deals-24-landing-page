# Product Replacement Logic Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 confirmed bugs in the product replacement system: wrong sort key, T4 over-restricts sizes, T2 leaks same-brand results, fake deals surface as alternatives, and fresh-produce names get false base_key assignments.

**Architecture:** All replacement logic is in one file (`product-replacements.js`). Fresh-produce guard goes in `base-product-catalog.js`. One new integration test file covers Tasks 1–4. A one-off cleanup script handles the DB side of Task 5. No new services, no new routes.

**Tech Stack:** Node.js CJS, better-sqlite3 (sync), node:test + assert/strict, SQLite.

---

## Files

| Action | Path |
|---|---|
| Modify | `server/services/product-replacements.js` |
| Modify | `server/services/base-product-catalog.js` |
| Create | `tests/integration/product-replacements.test.js` |
| Create | `scripts/fix-fresh-produce-base-keys.js` |

---

## Task 1 — Sort T2/T3/T4 by `price_per_kg` ascending (not `discount_percent` descending)

**Why this is wrong:** `discount_percent` is store-set and can be inflated. A 30%-off 500g bag may cost more per kg than a 7%-off 1kg bag. The field `price_per_kg` is already fetched in the SQL — just not used for ranking.

**Files:**
- Create: `tests/integration/product-replacements.test.js`
- Modify: `server/services/product-replacements.js:27-29` (sort helper) and `:189-191` (three sort calls)

- [ ] **Step 1: Create test file with sort test**

Create `tests/integration/product-replacements.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { getReplacements } = require("../../server/services/product-replacements");

const STORE = "s1";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE canonical_products (
      id TEXT PRIMARY KEY, canonical_name TEXT NOT NULL,
      category TEXT, brand_slots TEXT, base_product_slots TEXT,
      base_key TEXT, weight_value REAL, weight_unit TEXT
    );
    CREATE TABLE stores (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL);
    CREATE TABLE deals (
      id TEXT PRIMARY KEY, canonical_id TEXT, store_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      product_name TEXT, product_category TEXT, product_url TEXT,
      image_url TEXT, weight_raw TEXT, weight_value REAL, weight_unit TEXT,
      sale_price REAL, original_price REAL, discount_percent REAL,
      price_per_kg REAL, currency TEXT, availability TEXT,
      bulk_pricing TEXT, best_before TEXT, crawl_timestamp TEXT
    );
    INSERT INTO stores VALUES ('${STORE}', 'Test Store', 'https://example.com');
  `);
  return db;
}

/** Insert a canonical_products row. brandSlots / baseSlots are JS arrays, serialised to JSON. */
function cp(db, { id, name, category = "Lentils & Pulses", brandSlots = null, baseSlots = null, weight = null }) {
  db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, brand_slots, base_product_slots, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, 'g')`
  ).run(
    id, name, category,
    brandSlots ? JSON.stringify(brandSlots) : null,
    baseSlots  ? JSON.stringify(baseSlots)  : null,
    weight
  );
}

/** Insert a deals row. All deals go to STORE and are active. */
function deal(db, { id, canonicalId, name, weight = null, price = 5.00, origPrice = null, discount = null, ppkg = null }) {
  db.prepare(
    `INSERT INTO deals (id, canonical_id, store_id, is_active, product_name, weight_value, weight_unit,
                        sale_price, original_price, discount_percent, price_per_kg, currency)
     VALUES (?, ?, ?, 1, ?, ?, 'g', ?, ?, ?, ?, 'EUR')`
  ).run(id, canonicalId, STORE, name, weight, price, origPrice, discount, ppkg);
}

// ─── Task 1: sort ────────────────────────────────────────────────────────────

test("T2 ranks by price_per_kg ascending, not discount_percent descending", async () => {
  const db = makeDb();

  // Source canonical + deal
  cp(db, { id: "src", name: "Xyzbrand Toor Dal 1kg",
           brandSlots: [["Xyzbrand"]], baseSlots: [["toor"],["dal"]], weight: 1000 });
  deal(db, { id: "d-src", canonicalId: "src", name: "Xyzbrand Toor Dal 1kg",
             weight: 1000, price: 4.00, ppkg: 4.00 });

  // Candidate A — high discount (30%) but more expensive per kg (3.50)
  cp(db, { id: "ca", name: "Abcbrand Toor Dal 1kg",
           brandSlots: [["Abcbrand"]], baseSlots: [["toor"],["dal"]], weight: 1000 });
  deal(db, { id: "d-a", canonicalId: "ca", name: "Abcbrand Toor Dal 1kg",
             weight: 1000, price: 3.50, origPrice: 5.00, discount: 30, ppkg: 3.50 });

  // Candidate B — low discount (7%) but cheaper per kg (2.80) — better value
  cp(db, { id: "cb", name: "Schani Toor Dal 1kg",
           brandSlots: [["Schani"]], baseSlots: [["toor"],["dal"]], weight: 1000 });
  deal(db, { id: "d-b", canonicalId: "cb", name: "Schani Toor Dal 1kg",
             weight: 1000, price: 2.80, origPrice: 3.00, discount: 7, ppkg: 2.80 });

  const result = await getReplacements(db, { canonicalId: "src", storeId: STORE, dealId: "d-src" });
  const t2 = result.tiers.find(t => t.type === "same_spec");
  assert.ok(t2, "T2 same_spec tier must exist");
  assert.equal(t2.deals[0].id, "d-b", "cheaper per-kg deal must rank first");
  assert.equal(t2.deals[1].id, "d-a");
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

Expected: FAIL — `d-a` (30% discount) ranks first instead of `d-b`.

- [ ] **Step 3: Replace sort helper and calls**

In `server/services/product-replacements.js`, replace lines 27–29:

```js
// BEFORE:
const byDiscountDesc = (a, b) =>
  (b.discount_percent || 0) - (a.discount_percent || 0) ||
  (a.sale_price || 0) - (b.sale_price || 0);

// AFTER:
const byValueAsc = (a, b) => {
  const aUnit = a.price_per_kg ?? Infinity;
  const bUnit = b.price_per_kg ?? Infinity;
  if (aUnit !== bUnit) return aUnit - bUnit;
  return (a.sale_price || 0) - (b.sale_price || 0);
};
```

Then replace the three sort calls (previously lines 189–191):

```js
// BEFORE:
  t2.sort(byDiscountDesc);
  t3.sort(byDiscountDesc);
  t4.sort(byDiscountDesc);

// AFTER:
  t2.sort(byValueAsc);
  t3.sort(byValueAsc);
  t4.sort(byValueAsc);
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

- [ ] **Step 5: Run full integration suite — expect no regressions**

```bash
node --test --reporter=spec tests/integration/*.test.js
```

- [ ] **Step 6: Commit**

```bash
git add server/services/product-replacements.js tests/integration/product-replacements.test.js
git commit -m "fix(replacements): rank T2/T3/T4 by price_per_kg ascending, not discount_percent"
```

---

## Task 2 — T4 must not block larger packs

**Why this is wrong:** `sizeCompatible` hard-returns `false` when `candWeight > srcWeight`. T4 is a category-level fallback — showing a 1kg bag when you're looking at a 500g bag is a valid "best deal in category" result. The size guard is appropriate for T1 (size variants of same product) but wrong for T4.

**Files:**
- Modify: `server/services/product-replacements.js:182`
- Modify: `tests/integration/product-replacements.test.js` (append test)

- [ ] **Step 1: Append failing test**

Append to `tests/integration/product-replacements.test.js`:

```js
// ─── Task 2: T4 larger packs ─────────────────────────────────────────────────

test("T4 includes larger-pack candidates from same category", async () => {
  const db = makeDb();

  // Source: 500g, no brand/slots → only category matching possible
  cp(db, { id: "src-t4", name: "Generic Dal 500g", category: "Lentils & Pulses", weight: 500 });
  deal(db, { id: "d-src-t4", canonicalId: "src-t4", name: "Generic Dal 500g",
             weight: 500, price: 2.50, ppkg: 5.00 });

  // Candidate: 1000g same category — blocked by current sizeCompatible (1000 > 500)
  cp(db, { id: "cand-t4", name: "Other Dal 1kg", category: "Lentils & Pulses", weight: 1000 });
  deal(db, { id: "d-cand-t4", canonicalId: "cand-t4", name: "Other Dal 1kg",
             weight: 1000, price: 4.00, ppkg: 4.00 });

  const result = await getReplacements(db, { canonicalId: "src-t4", storeId: STORE, dealId: "d-src-t4" });
  const t4 = result.tiers.find(t => t.type === "same_category");
  assert.ok(t4, "T4 same_category tier must exist");
  assert.ok(t4.deals.some(d => d.id === "d-cand-t4"), "1kg candidate must appear in T4");
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

Expected: FAIL — `d-cand-t4` (1kg) excluded from T4.

- [ ] **Step 3: Remove sizeCompatible from T4 condition**

In `server/services/product-replacements.js`, find the T4 block (comment `// T4: same category`). Change:

```js
// BEFORE:
    if (sameCategory && sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) && !seen.has(`t4:${cKey}`)) {

// AFTER:
    if (sameCategory && !seen.has(`t4:${cKey}`)) {
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server/services/product-replacements.js tests/integration/product-replacements.test.js
git commit -m "fix(replacements): T4 same_category no longer excludes larger packs"
```

---

## Task 3 — T2 must not include same-brand candidates

**Why this is wrong:** T2 is labelled `"same_spec"` and is meant as a cross-brand alternative. When T1 fails for a same-brand item (e.g., same weight so size check fails), it falls through to T2 if `base_product_slots` match. `isSameBrandT2` guard prevents this.

**Files:**
- Modify: `server/services/product-replacements.js` (~lines 148–158, T2 block)
- Modify: `tests/integration/product-replacements.test.js` (append test)

- [ ] **Step 1: Append failing test**

Append to `tests/integration/product-replacements.test.js`:

```js
// ─── Task 3: T2 brand guard ───────────────────────────────────────────────────

test("T2 excludes same-brand candidates; includes different-brand candidates", async () => {
  const db = makeDb();

  // Source: Xyzbrand, 1000g
  cp(db, { id: "src-t2b", name: "Xyzbrand Urid Dal 1kg",
           brandSlots: [["Xyzbrand"]], baseSlots: [["urid"],["dal"]], weight: 1000 });
  deal(db, { id: "d-src-t2b", canonicalId: "src-t2b", name: "Xyzbrand Urid Dal 1kg",
             weight: 1000, price: 3.00, ppkg: 3.00 });

  // Same brand, same weight, same spec — different canonical (data-quality duplicate scenario).
  // T1 fails because parseWeight(1000) === srcWeightValue(1000) (same size → not a size variant).
  // Without brand guard, this falls into T2. It must NOT appear there.
  cp(db, { id: "dup-t2b", name: "Xyzbrand Urid Dal Premium 1kg",
           brandSlots: [["Xyzbrand"]], baseSlots: [["urid"],["dal"]], weight: 1000 });
  deal(db, { id: "d-dup-t2b", canonicalId: "dup-t2b", name: "Xyzbrand Urid Dal 1kg",
             weight: 1000, price: 3.10, ppkg: 3.10 });

  // Different brand, same spec — MUST appear in T2
  cp(db, { id: "other-t2b", name: "Abcbrand Urid Dal 1kg",
           brandSlots: [["Abcbrand"]], baseSlots: [["urid"],["dal"]], weight: 1000 });
  deal(db, { id: "d-other-t2b", canonicalId: "other-t2b", name: "Abcbrand Urid Dal 1kg",
             weight: 1000, price: 2.80, ppkg: 2.80 });

  const result = await getReplacements(db, { canonicalId: "src-t2b", storeId: STORE, dealId: "d-src-t2b" });
  const t2 = result.tiers.find(t => t.type === "same_spec");
  assert.ok(t2, "T2 tier must exist");
  const ids = t2.deals.map(d => d.id);
  assert.ok(!ids.includes("d-dup-t2b"), "same-brand duplicate must NOT be in T2");
  assert.ok(ids.includes("d-other-t2b"), "different-brand candidate must be in T2");
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

Expected: FAIL — `d-dup-t2b` appears in T2.

- [ ] **Step 3: Add brand guard to T2 block**

In `server/services/product-replacements.js`, find the T2 block. Replace:

```js
// BEFORE (the T2 sameBaseProduct block):
    const sameBaseProduct =
      (srcBaseSlots && baseProductSlotsMatch(srcBaseSlots, row.cp_base_product_slots)) ||
      (srcBaseKey && candBase?.base_key === srcBaseKey && sameCategory);
    if (
      sameBaseProduct &&
      sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) &&
      !seen.has(`t2:${cKey}`)
    ) {
      t2.push(row);
      seen.add(`t2:${cKey}`);
      continue;
    }

// AFTER:
    const sameBaseProduct =
      (srcBaseSlots && baseProductSlotsMatch(srcBaseSlots, row.cp_base_product_slots)) ||
      (srcBaseKey && candBase?.base_key === srcBaseKey && sameCategory);
    const isSameBrandT2 = !!srcBrand && (
      nameHasBrand(row.product_name, srcBrand) ||
      (candBase?.base_key ? detectBrandForBase(row.cp_canonical_name, candBase.base_key) === srcBrand : false)
    );
    if (
      sameBaseProduct &&
      !isSameBrandT2 &&
      sizeCompatible(srcWeightValue, parseWeight(row.weight_value, row.weight_raw)) &&
      !seen.has(`t2:${cKey}`)
    ) {
      t2.push(row);
      seen.add(`t2:${cKey}`);
      continue;
    }
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server/services/product-replacements.js tests/integration/product-replacements.test.js
git commit -m "fix(replacements): T2 same_spec excludes same-brand candidates"
```

---

## Task 4 — Exclude fake deals from replacement candidates

**Why this is wrong:** The `/deals` listing applies `FAKE_DEAL_THRESHOLD_PP=10` to hide deals where stated `discount_percent` diverges from the computed real discount by >10pp. No such filter exists on replacement candidates. A product with a fabricated 60% discount can surface as a "better alternative."

`computeRealSavings` (used in `/deals`) requires historical median price data and can't be replicated in SQL. We use the price-arithmetic proxy instead: if the stated discount diverges from `(1 − sale/original) × 100` by more than 10pp, the deal is fake.

**Files:**
- Modify: `server/services/product-replacements.js:11-25` (`ACTIVE_DEALS_WITH_CANONICAL_SQL`)
- Modify: `tests/integration/product-replacements.test.js` (append test)

- [ ] **Step 1: Append failing test**

Append to `tests/integration/product-replacements.test.js`:

```js
// ─── Task 4: fake-deal filter ─────────────────────────────────────────────────

test("fake deals (stated discount far above arithmetic discount) excluded from all tiers", async () => {
  const db = makeDb();

  // Source: no brand/slots → only T4 category match
  cp(db, { id: "src-fk", name: "Generic Flour 1kg", category: "Flours & Baking", weight: 1000 });
  deal(db, { id: "d-src-fk", canonicalId: "src-fk", name: "Generic Flour 1kg",
             weight: 1000, price: 3.00, ppkg: 3.00 });

  // Fake: claimed 60% off, real arithmetic discount = (10-9.5)/10*100 = 5% → gap = 55pp > 10pp
  cp(db, { id: "cand-fk", name: "Fake Flour 1kg", category: "Flours & Baking", weight: 1000 });
  deal(db, { id: "d-fake", canonicalId: "cand-fk", name: "Fake Flour 1kg",
             weight: 1000, price: 9.50, origPrice: 10.00, discount: 60, ppkg: 9.50 });

  // Legit: claimed 25% off, arithmetic discount = (5-3.75)/5*100 = 25% → gap = 0pp
  cp(db, { id: "cand-ok", name: "Good Flour 1kg", category: "Flours & Baking", weight: 1000 });
  deal(db, { id: "d-legit", canonicalId: "cand-ok", name: "Good Flour 1kg",
             weight: 1000, price: 3.75, origPrice: 5.00, discount: 25, ppkg: 3.75 });

  const result = await getReplacements(db, { canonicalId: "src-fk", storeId: STORE, dealId: "d-src-fk" });
  const allDeals = result.tiers.flatMap(t => t.deals).map(d => d.id);
  assert.ok(!allDeals.includes("d-fake"),  "fake deal must not appear in any tier");
  assert.ok(allDeals.includes("d-legit"), "legit deal must appear");
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

Expected: FAIL — `d-fake` appears in T4.

- [ ] **Step 3: Add fake-deal WHERE clause to SQL**

In `server/services/product-replacements.js`, find `ACTIVE_DEALS_WITH_CANONICAL_SQL`. Change the WHERE clause:

```js
// BEFORE:
  WHERE d.store_id = ? AND d.is_active = 1 AND d.canonical_id IS NOT NULL

// AFTER:
  WHERE d.store_id = ? AND d.is_active = 1 AND d.canonical_id IS NOT NULL
    AND (
      d.original_price IS NULL OR d.sale_price IS NULL OR d.discount_percent IS NULL OR
      ABS(d.discount_percent - ROUND((1.0 - d.sale_price / d.original_price) * 100.0)) <= 10
    )
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test --reporter=spec tests/integration/product-replacements.test.js
```

- [ ] **Step 5: Run full integration suite**

```bash
node --test --reporter=spec tests/integration/*.test.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/product-replacements.js tests/integration/product-replacements.test.js
git commit -m "fix(replacements): exclude fake deals from replacement candidates via arithmetic discount guard"
```

---

## Task 5 — Block fresh-produce false positives in `resolveBaseProduct`

**Why this is wrong:** `resolveBaseProduct("Fresh Green Chilli")` scores a token match against `"red chili powder"` (shared token: chilli/chili) and assigns `base_key = "red chili powder"`. This causes fresh produce canonicals to participate in dry-goods cross-store matching. Two confirmed bad rows in prod_local.db:
- `fresh-green-chilli` → `base_key = "red chili powder"`
- `fresh-red-sambhar-onions` → `base_key = "sambar masala"`

Fix: return `null` early for any input starting with `"Fresh "`. Then clean existing bad rows.

**Files:**
- Modify: `server/services/base-product-catalog.js:244-246` (start of `resolveBaseProduct`)
- Modify: `tests/integration/base-product-catalog.test.js` (append tests)
- Create: `scripts/fix-fresh-produce-base-keys.js`

- [ ] **Step 1: Append failing tests to existing test file**

Append to `tests/integration/base-product-catalog.test.js`:

```js
test("resolveBaseProduct returns null for fresh produce names (Fresh prefix guard)", () => {
  assert.equal(resolveBaseProduct("Fresh Green Chilli"), null,
    "should not match 'red chili powder'");
  assert.equal(resolveBaseProduct("Fresh Red Sambhar Onions"), null,
    "should not match 'sambar masala'");
  assert.equal(resolveBaseProduct("fresh coriander"), null);
  assert.equal(resolveBaseProduct("Fresh Haldi"), null);
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
node --test --reporter=spec tests/integration/base-product-catalog.test.js
```

Expected: FAIL — `resolveBaseProduct("Fresh Green Chilli")` returns a non-null match.

- [ ] **Step 3: Add guard to resolveBaseProduct**

In `server/services/base-product-catalog.js` at line 244, `resolveBaseProduct` currently starts:

```js
function resolveBaseProduct(text) {
  const textNorm = normalizeText(text);
  if (!textNorm) return null;
```

Change to:

```js
function resolveBaseProduct(text) {
  if (!text || /^fresh\s/i.test(text.trim())) return null;
  const textNorm = normalizeText(text);
  if (!textNorm) return null;
```

- [ ] **Step 4: Run test — expect PASS**

```bash
node --test --reporter=spec tests/integration/base-product-catalog.test.js
```

- [ ] **Step 5: Run all integration tests**

```bash
node --test --reporter=spec tests/integration/*.test.js
```

Expected: all pass.

- [ ] **Step 6: Write DB cleanup script**

Create `scripts/fix-fresh-produce-base-keys.js`:

```js
"use strict";
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/prod_local.db");
const db = new Database(DB_PATH);

const { changes } = db
  .prepare(`UPDATE canonical_products SET base_key = NULL WHERE category = 'Fresh Produce' AND base_key IS NOT NULL`)
  .run();

console.log(`Cleared base_key on ${changes} Fresh Produce canonicals`);
db.close();
```

- [ ] **Step 7: Run cleanup against prod_local.db**

```bash
node scripts/fix-fresh-produce-base-keys.js
```

Expected output: `Cleared base_key on N Fresh Produce canonicals` (N > 0)

Verify with:

```bash
sqlite3 data/prod_local.db "SELECT COUNT(*) FROM canonical_products WHERE category='Fresh Produce' AND base_key IS NOT NULL;"
```

Expected: `0`

- [ ] **Step 8: Commit**

```bash
git add server/services/base-product-catalog.js tests/integration/base-product-catalog.test.js scripts/fix-fresh-produce-base-keys.js
git commit -m "fix(base-product-catalog): block Fresh Produce false positives in resolveBaseProduct; clean DB"
```

---

## Self-Review

**Spec coverage:**
- Sort by price_per_kg → Task 1 ✓
- T4 allows larger packs → Task 2 ✓
- T2 brand exclusion guard → Task 3 ✓
- Fake-deal filter on candidates → Task 4 ✓
- Fresh-produce base_key false positives → Task 5 ✓

**Placeholder scan:** None. All steps contain exact code.

**Type consistency:**
- `byValueAsc` defined Task 1, used at three sort sites — consistent.
- `isSameBrandT2` scoped to T2 block, uses already-imported `detectBrandForBase` — consistent.
- Test helper functions `cp()`/`deal()`/`makeDb()` defined once in the file header, reused across all four in-file test groups — consistent.

**Not addressed (out of scope):**
- `base_key` overall coverage 20.6% — limited by CSV catalog size, not code bugs.
- 3,207 active deals linked to `is_priority=0` canonicals — `is_priority` does not affect replacement routing; admin display only.
