# Manual Review Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multi-tier fuzzy matching system with a strict ≥0.90 threshold and route all sub-threshold deals to an admin review queue with CRUD API and UI tab.

**Architecture:** fuzzy-matcher raises threshold to 0.90 (single tier); entity-resolution/index.js drops ai-resolver; canonicalizer stops creating canonicals for no-match deals and enqueues them instead; new admin-review-queue route handles queue CRUD + re-scan; new AdminPage tab surfaces the queue.

**Tech Stack:** Node.js/CommonJS, Express, @libsql/client (async), React + Tailwind, node:test + node:assert for tests

---

## File Map

| File | Change |
|------|--------|
| `crawler/entity-resolution/fuzzy-matcher.js` | Raise threshold 0.78 → 0.90, remove ambiguous + possible_match tiers |
| `crawler/entity-resolution/index.js` | Remove ai-resolver require + possible_match branch + resolveAmbiguous call |
| `server/db/schema.sql` | Add store_id, category columns to entity_resolution_queue CREATE TABLE |
| `server/db/index.js` | Add ALTER TABLE migrations to alwaysMigrations for existing DBs |
| `server/services/canonicalizer.js` | Remove possible_match + manual_review guards; no-match → enqueue; enqueueManualReview writes store_id + category; SELECT adds store_id |
| `server/routes/admin-review-queue.js` | New — GET list, PATCH confirm, POST dismiss, POST create-canonical + re-scan |
| `server/index.js` | Mount admin-review-queue router at /api/v1/admin-dashboard |
| `client/src/utils/api.js` | Add fetchReviewQueue, confirmQueueItem, dismissQueueItem, createCanonicalFromQueue |
| `client/src/landing/AdminPage.jsx` | Add "Review Queue" tab with table, pagination, actions |
| `tests/integration/fuzzy-matcher.test.js` | New — threshold tests + chana/toor regression |
| `tests/integration/review-queue.test.js` | New — canonicalizeDeals no-match → queue pipeline tests |

---

### Task 1: fuzzy-matcher.js — raise threshold to 0.90, remove sub-threshold tiers

**Files:**
- Modify: `crawler/entity-resolution/fuzzy-matcher.js:94-112`
- Test: `tests/integration/fuzzy-matcher.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/integration/fuzzy-matcher.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fuzzyMatch } = require("../../crawler/entity-resolution/fuzzy-matcher");

test("fuzzyMatch returns fuzzy for score >= 0.90", () => {
  // Same string → score 1.0
  const result = fuzzyMatch("toor dal", ["toor dal"]);
  assert.ok(result);
  assert.equal(result.method, "fuzzy");
  assert.ok(result.confidence >= 0.90);
});

test("fuzzyMatch returns null for score < 0.90 (chana dal vs toor dal)", () => {
  // Regression: "Lovely Chana Dal" must NOT match "Lovely Toor Dal" canonical
  const result = fuzzyMatch("lovely chana dal", ["lovely toor dal"]);
  assert.equal(result, null);
});

test("fuzzyMatch returns null for moderately similar strings", () => {
  const result = fuzzyMatch("aashirvaad atta 5kg", ["aashirvaad maida 5kg"]);
  assert.equal(result, null);
});

test("fuzzyMatch returns null when no candidates", () => {
  assert.equal(fuzzyMatch("anything", []), null);
  assert.equal(fuzzyMatch("", ["something"]), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/rasha/Documents/Rahul/desi-deals-24-landing-page && node --test tests/integration/fuzzy-matcher.test.js --reporter=spec
```

Expected: `fuzzyMatch returns null for score < 0.90` FAILS (currently returns ambiguous, not null)

- [ ] **Step 3: Edit fuzzy-matcher.js lines 94–112**

Replace:
```js
  if (best.score >= 0.78) {
    return { match: best.candidate, confidence: best.score, method: "fuzzy" };
  }
  if (best.score >= 0.58) {
    return {
      match: best.candidate,
      confidence: best.score,
      method: "ambiguous",
    };
  }
  if (best.score >= 0.40) {
    return {
      match: best.candidate,
      confidence: best.score,
      method: "possible_match",
    };
  }
  return null;
```

With:
```js
  if (best.score >= 0.90) {
    return { match: best.candidate, confidence: best.score, method: "fuzzy" };
  }
  return null;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/integration/fuzzy-matcher.test.js --reporter=spec
```

Expected: all 4 pass

- [ ] **Step 5: Commit**

```bash
git add crawler/entity-resolution/fuzzy-matcher.js tests/integration/fuzzy-matcher.test.js
git commit -m "feat(fuzzy): raise threshold to 0.90, remove ambiguous/possible_match tiers"
```

---

### Task 2: entity-resolution/index.js — remove ai-resolver, simplify to exact + fuzzy

**Files:**
- Modify: `crawler/entity-resolution/index.js`

The current file (88 lines) has: exact short-circuit, possible_match short-circuit (added last session), then resolveAmbiguous() call for ambiguous. After Task 1, fuzzyMatch only returns "fuzzy" or null — the ambiguous branch is dead code. Remove ai-resolver and simplify.

- [ ] **Step 1: Write the new index.js**

Replace entire file content with:

```js
"use strict";

const { normalise } = require("./normaliser");
const { fuzzyMatch } = require("./fuzzy-matcher");

async function resolveName(rawName, canonicalNames) {
  const normalised = normalise(rawName);
  const rows = (Array.isArray(canonicalNames) ? canonicalNames : [])
    .map((name) => {
      const canonicalName = String(name || "").trim();
      if (!canonicalName) return null;
      return {
        canonicalName,
        normalisedCanonical: normalise(canonicalName),
      };
    })
    .filter(Boolean);

  const exact = rows.find((row) => row.normalisedCanonical === normalised);
  if (exact?.canonicalName) {
    return {
      normalised,
      match: exact.canonicalName,
      confidence: 1,
      method: "exact",
    };
  }

  const uniqueNormalisedCanonical = Array.from(
    new Set(rows.map((row) => row.normalisedCanonical).filter(Boolean)),
  );
  const fuzzy = fuzzyMatch(normalised, uniqueNormalisedCanonical);
  if (!fuzzy) {
    return { normalised, match: null, confidence: 0, method: "new" };
  }

  const matchedRow = rows.find(
    (row) => row.normalisedCanonical === String(fuzzy.match || ""),
  );
  const matchedCanonicalName = matchedRow?.canonicalName || null;
  if (!matchedCanonicalName) {
    return { normalised, match: null, confidence: 0, method: "new" };
  }

  return {
    normalised,
    match: matchedCanonicalName,
    confidence: fuzzy.confidence,
    method: "fuzzy",
  };
}

module.exports = {
  resolveName,
};
```

- [ ] **Step 2: Verify existing canonicalizer tests still pass**

```bash
node --test tests/integration/canonicalizer.test.js --reporter=spec
```

Expected: all pass (exact match path unchanged)

- [ ] **Step 3: Commit**

```bash
git add crawler/entity-resolution/index.js
git commit -m "refactor(entity-resolution): remove ai-resolver, simplify to exact+fuzzy only"
```

---

### Task 3: Schema migration — add store_id and category to entity_resolution_queue

**Files:**
- Modify: `server/db/schema.sql:299-308`
- Modify: `server/db/index.js:165-193` (alwaysMigrations)

- [ ] **Step 1: Update CREATE TABLE in schema.sql**

In `server/db/schema.sql`, find the `entity_resolution_queue` CREATE TABLE (currently lines 299–308) and replace with:

```sql
CREATE TABLE IF NOT EXISTS entity_resolution_queue (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id               TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  suggested_canonical_id TEXT REFERENCES canonical_products(id) ON DELETE SET NULL,
  confidence            REAL,
  raw_name              TEXT NOT NULL,
  normalised_name       TEXT,
  status                TEXT DEFAULT 'pending',
  store_id              TEXT REFERENCES stores(id) ON DELETE SET NULL,
  category              TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 2: Add migrations to alwaysMigrations in db/index.js**

In `server/db/index.js`, after the existing entries in `alwaysMigrations` (before the closing `]`), add:

```js
    "ALTER TABLE entity_resolution_queue ADD COLUMN store_id TEXT REFERENCES stores(id) ON DELETE SET NULL",
    "ALTER TABLE entity_resolution_queue ADD COLUMN category TEXT",
    "CREATE INDEX IF NOT EXISTS idx_queue_deal_id ON entity_resolution_queue(deal_id)",
    "CREATE INDEX IF NOT EXISTS idx_queue_category ON entity_resolution_queue(category, status)",
```

- [ ] **Step 3: Verify server starts without errors**

```bash
cd /Users/rasha/Documents/Rahul/desi-deals-24-landing-page && node -e "const db = require('./server/db'); db.ready.then(() => { console.log('DB ready'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
```

Expected: `DB ready`

- [ ] **Step 4: Commit**

```bash
git add server/db/schema.sql server/db/index.js
git commit -m "feat(schema): add store_id + category to entity_resolution_queue"
```

---

### Task 4: canonicalizer.js — route no-match deals to queue, remove old guards

**Files:**
- Modify: `server/services/canonicalizer.js`

Changes:
1. `enqueueManualReview()`: add `store_id` and `category` to INSERT
2. `canonicalizeDeals()`: add `d.store_id` to SELECT; remove `possible_match` and `manual_review` guards; route all no-match deals to queue (no createCanonical for no-match)

- [ ] **Step 1: Write failing test**

```js
// tests/integration/review-queue.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb, nowIso } = require("./helpers");
const { canonicalizeDeals } = require("../../server/services/canonicalizer");

function seedStore(db) {
  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)").run(
    "jamoona", "Jamoona", "https://jamoona.com",
  );
}

function seedDeal(db, id, name, category = "Lentils & Pulses") {
  db.prepare(
    `INSERT INTO deals (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(id, "run-1", nowIso(), "jamoona", name, category, `https://jamoona.com/p/${id}`, 2.49);
}

test("no-match deal is enqueued, not canonicalized", async () => {
  const db = createTestDb();
  seedStore(db);
  seedDeal(db, "d1", "Completely Unique Product XYZ 500g");

  const stats = await canonicalizeDeals(db, { runId: "run-1" });

  assert.equal(stats.scanned, 1);
  assert.equal(stats.mapped, 0);
  assert.equal(stats.created, 0);
  assert.equal(stats.manual_review, 1);

  const queued = db.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
  assert.ok(queued, "deal should be in review queue");
  assert.equal(queued.status, "pending");
  assert.equal(queued.store_id, "jamoona");
  assert.equal(queued.category, "Lentils & Pulses");

  const canonical = db.prepare("SELECT * FROM canonical_products LIMIT 1").get();
  assert.equal(canonical, undefined, "no canonical should be created for no-match deals");
});

test("high-confidence match deal is mapped, not queued", async () => {
  const db = createTestDb();
  seedStore(db);

  // Seed an existing canonical
  db.prepare(
    `INSERT INTO canonical_products (id, canonical_name, category, common_aliases)
     VALUES (?, ?, ?, ?)`,
  ).run("toor-dal", "Toor Dal", "Lentils & Pulses", "[]");

  // Deal whose name normalises to an exact match
  seedDeal(db, "d1", "Toor Dal");

  const stats = await canonicalizeDeals(db, { runId: "run-1" });

  assert.equal(stats.mapped, 1);
  assert.equal(stats.manual_review, 0);

  const queued = db.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
  assert.equal(queued, undefined, "mapped deal should not be queued");
});

test("no-match deal is not queued again if already pending", async () => {
  const db = createTestDb();
  seedStore(db);
  seedDeal(db, "d1", "Completely Unique Product XYZ 500g");

  await canonicalizeDeals(db, { runId: "run-1" });
  await canonicalizeDeals(db, {});

  const count = db.prepare("SELECT COUNT(*) as c FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
  assert.equal(count.c, 1, "should not enqueue duplicate pending rows");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test tests/integration/review-queue.test.js --reporter=spec
```

Expected: FAIL — `no canonical should be created` assertion fails (currently creates canonical for no-match)

- [ ] **Step 3: Update enqueueManualReview in canonicalizer.js**

Find and replace `enqueueManualReview` function (lines 150–181):

```js
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
```

- [ ] **Step 4: Update canonicalizeDeals SELECT and loop in canonicalizer.js**

Find the SELECT in `canonicalizeDeals` (currently selects `d.id, d.product_name, d.product_category, d.image_url`) and add `d.store_id`:

```js
  const deals = await db
    .prepare(
      `SELECT d.id, d.product_name, d.product_category, d.image_url, d.store_id
     FROM deals d
     ${join}
     WHERE ${where}`,
    )
    .all(...params);
```

- [ ] **Step 5: Replace the for-loop body in canonicalizeDeals**

Find the loop starting `for (const deal of deals) {` and replace through the closing `}` before `if (stats.scanned > 0)`:

```js
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
        stats.mapped += 1;
        continue;
      }
    }

    // Everything else (no match, or match lost due to canonicalByName miss) → queue
    await enqueueManualReview(
      db,
      deal,
      null,
      resolved.confidence,
      resolved.normalised,
    );
    stats.manual_review += 1;
  }
```

- [ ] **Step 6: Run review-queue tests**

```bash
node --test tests/integration/review-queue.test.js --reporter=spec
```

Expected: all 3 pass

- [ ] **Step 7: Run canonicalizer tests**

```bash
node --test tests/integration/canonicalizer.test.js --reporter=spec
```

Expected: all pass (the "maps active deals" test will now FAIL because the first deal has no existing canonical — it should be queued, not mapped. Check: if the test creates a deal with an exact name match to an existing canonical it will still pass; otherwise update the test to reflect new behavior)

> **Note:** The existing `canonicalizeDeals maps active deals into canonical products` test seeds a deal with no existing canonicals. Under the new design, that deal should be *queued* not mapped. Update the test assertion if it fails:
>
> Replace `assert.equal(stats.mapped, 1)` with `assert.equal(stats.manual_review, 1)` and remove the canonical/mapping assertions, adding instead:
> ```js
> const queued = db.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'd1'").get();
> assert.ok(queued, "unmatched deal should be queued");
> ```

- [ ] **Step 8: Commit**

```bash
git add server/services/canonicalizer.js tests/integration/review-queue.test.js tests/integration/canonicalizer.test.js
git commit -m "feat(canonicalizer): no-match deals enqueued for review, auto-create removed"
```

---

### Task 5: server/routes/admin-review-queue.js — new route file

**Files:**
- Create: `server/routes/admin-review-queue.js`

Routes:
- `GET /review-queue` — paginated list, `?status=pending&category=&page=1`
- `PATCH /review-queue/:id` — confirm (assign canonical_id)
- `POST /review-queue/:id/dismiss` — dismiss
- `POST /review-queue/canonical` — create canonical + re-scan category queue

- [ ] **Step 1: Create the file**

```js
// server/routes/admin-review-queue.js
"use strict";

const express = require("express");
const router = express.Router();
const db = require("../db");
const requireAdminAuth = require("../middleware/auth");
const { normalise } = require("../../crawler/entity-resolution/normaliser");
const { fuzzyMatch } = require("../../crawler/entity-resolution/fuzzy-matcher");
const { decomposeCanonical } = require("../../crawler/utils/canonical-decomposer");

router.use(requireAdminAuth);

const PAGE_SIZE = 50;

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
  while (await db.prepare("SELECT 1 FROM canonical_products WHERE id = ? LIMIT 1").get(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  return id;
}

// GET /review-queue — list queue items (paginated)
router.get("/review-queue", async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const category = req.query.category || null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * PAGE_SIZE;

    let where = "eq.status = ?";
    const args = [status];
    if (category) {
      where += " AND eq.category = ?";
      args.push(category);
    }

    const total = await db.prepare(
      `SELECT COUNT(*) as c FROM entity_resolution_queue eq WHERE ${where}`,
    ).get(...args);

    const items = await db.prepare(
      `SELECT eq.id, eq.deal_id, eq.raw_name, eq.normalised_name, eq.confidence,
              eq.status, eq.store_id, eq.category, eq.created_at,
              eq.suggested_canonical_id,
              cp.canonical_name as suggested_canonical_name,
              s.name as store_name
       FROM entity_resolution_queue eq
       LEFT JOIN canonical_products cp ON cp.id = eq.suggested_canonical_id
       LEFT JOIN stores s ON s.id = eq.store_id
       WHERE ${where}
       ORDER BY eq.created_at DESC
       LIMIT ? OFFSET ?`,
    ).all(...args, PAGE_SIZE, offset);

    res.json({ items, total: total?.c ?? 0, page, pageSize: PAGE_SIZE });
  } catch (err) {
    console.error("[review-queue] GET error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /review-queue/:id — confirm (assign to existing canonical)
router.patch("/review-queue/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { canonical_id } = req.body;
    if (!canonical_id) return res.status(400).json({ error: "canonical_id required" });

    const item = await db.prepare(
      "SELECT * FROM entity_resolution_queue WHERE id = ? LIMIT 1",
    ).get(id);
    if (!item) return res.status(404).json({ error: "not found" });

    await db.prepare(
      `UPDATE entity_resolution_queue SET status = 'confirmed', suggested_canonical_id = ? WHERE id = ?`,
    ).run(canonical_id, id);

    await db.prepare(
      `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
       VALUES (?, ?, 'manual', ?, ?)
       ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
         match_method = 'manual',
         match_confidence = excluded.match_confidence,
         verified_at = excluded.verified_at`,
    ).run(item.deal_id, canonical_id, item.confidence, new Date().toISOString());

    await db.prepare("UPDATE deals SET canonical_id = ? WHERE id = ?").run(canonical_id, item.deal_id);

    res.json({ ok: true });
  } catch (err) {
    console.error("[review-queue] PATCH error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /review-queue/:id/dismiss — dismiss item
router.post("/review-queue/:id/dismiss", async (req, res) => {
  try {
    const { id } = req.params;
    const item = await db.prepare(
      "SELECT id FROM entity_resolution_queue WHERE id = ? LIMIT 1",
    ).get(id);
    if (!item) return res.status(404).json({ error: "not found" });

    await db.prepare(
      "UPDATE entity_resolution_queue SET status = 'dismissed' WHERE id = ?",
    ).run(id);

    res.json({ ok: true });
  } catch (err) {
    console.error("[review-queue] dismiss error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /review-queue/canonical — create new canonical from queue item, re-scan category
router.post("/review-queue/canonical", async (req, res) => {
  try {
    const { queue_item_id, canonical_name, category, image_url } = req.body;
    if (!canonical_name) return res.status(400).json({ error: "canonical_name required" });
    if (!queue_item_id) return res.status(400).json({ error: "queue_item_id required" });

    const item = await db.prepare(
      "SELECT * FROM entity_resolution_queue WHERE id = ? LIMIT 1",
    ).get(queue_item_id);
    if (!item) return res.status(404).json({ error: "queue item not found" });

    // Create canonical
    const baseId = slugify(canonical_name);
    const canonicalId = await ensureUniqueCanonicalId(db, baseId);
    const { brandSlots, baseProductSlots, typeSlots, productGroupId, weightValue, weightUnit } =
      decomposeCanonical(canonical_name, [], []);

    await db.prepare(
      `INSERT INTO canonical_products
        (id, canonical_name, category, common_aliases, image_url, verified,
         brand_slots, base_product_slots, type_slots, product_group_id,
         weight_value, weight_unit, is_match_priority)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      canonicalId, canonical_name, category || item.category || "Other",
      JSON.stringify(item.raw_name ? [item.raw_name] : []),
      image_url || null,
      JSON.stringify(brandSlots), JSON.stringify(baseProductSlots),
      JSON.stringify(typeSlots), productGroupId, weightValue, weightUnit,
    );

    // Confirm the originating queue item
    await db.prepare(
      `UPDATE entity_resolution_queue SET status = 'confirmed', suggested_canonical_id = ? WHERE id = ?`,
    ).run(canonicalId, queue_item_id);

    await db.prepare(
      `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
       VALUES (?, ?, 'manual', 1.0, ?)
       ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
         match_method = 'manual', match_confidence = 1.0, verified_at = excluded.verified_at`,
    ).run(item.deal_id, canonicalId, new Date().toISOString());

    await db.prepare("UPDATE deals SET canonical_id = ? WHERE id = ?").run(canonicalId, item.deal_id);

    // Re-scan pending items in same category at ≥0.90
    const canonicalNorm = normalise(canonical_name);
    const pending = await db.prepare(
      `SELECT * FROM entity_resolution_queue WHERE status = 'pending' AND category = ? AND id != ?`,
    ).all(category || item.category || "Other", queue_item_id);

    let autoConfirmed = 0;
    for (const p of pending) {
      const match = fuzzyMatch(p.normalised_name || normalise(p.raw_name), [canonicalNorm]);
      if (match && match.confidence >= 0.90) {
        await db.prepare(
          "UPDATE entity_resolution_queue SET status = 'confirmed', suggested_canonical_id = ? WHERE id = ?",
        ).run(canonicalId, p.id);
        await db.prepare(
          `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
           VALUES (?, ?, 'fuzzy', ?, ?)
           ON CONFLICT(deal_id, canonical_id) DO UPDATE SET
             match_method = 'fuzzy', match_confidence = excluded.match_confidence, verified_at = excluded.verified_at`,
        ).run(p.deal_id, canonicalId, match.confidence, new Date().toISOString());
        await db.prepare("UPDATE deals SET canonical_id = ? WHERE id = ?").run(canonicalId, p.deal_id);
        autoConfirmed += 1;
      }
    }

    res.json({ ok: true, canonical_id: canonicalId, auto_confirmed: autoConfirmed });
  } catch (err) {
    console.error("[review-queue] create-canonical error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/admin-review-queue.js
git commit -m "feat(routes): add admin-review-queue CRUD + re-scan endpoint"
```

---

### Task 6: server/index.js — mount new router

**Files:**
- Modify: `server/index.js:13-56`

- [ ] **Step 1: Add require and mount**

In `server/index.js`, after line 15 (`const adminStatsRouter = require("./routes/admin-stats");`), add:

```js
const adminReviewQueueRouter = require("./routes/admin-review-queue");
```

After line 56 (`app.use("/api/v1/admin-dashboard", adminStatsRouter);`), add:

```js
app.use("/api/v1/admin-dashboard", adminReviewQueueRouter);
```

- [ ] **Step 2: Verify server starts**

```bash
node -e "require('./server/index')" 2>&1 | head -5
```

Expected: no `Cannot find module` errors

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat(server): mount admin-review-queue router"
```

---

### Task 7: api.js — add queue API helper functions

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Add functions at end of file (before last line if any)**

Append after the last existing export:

```js
export function fetchReviewQueue({ status = "pending", category = "", page = 1 } = {}) {
  const params = new URLSearchParams({ status, page });
  if (category) params.set("category", category);
  return authRequest(`/admin-dashboard/review-queue?${params}`);
}

export function confirmQueueItem(id, canonicalId) {
  return authRequest(`/admin-dashboard/review-queue/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canonical_id: canonicalId }),
  });
}

export function dismissQueueItem(id) {
  return authRequest(`/admin-dashboard/review-queue/${id}/dismiss`, {
    method: "POST",
  });
}

export function createCanonicalFromQueue({ queue_item_id, canonical_name, category, image_url }) {
  return authRequest("/admin-dashboard/review-queue/canonical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ queue_item_id, canonical_name, category, image_url }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(api): add review queue CRUD helper functions"
```

---

### Task 8: AdminPage.jsx — add Review Queue tab

**Files:**
- Modify: `client/src/landing/AdminPage.jsx`

- [ ] **Step 1: Add imports at top of file (after existing imports)**

After the existing import block (line 27), add:

```js
import {
  fetchReviewQueue,
  confirmQueueItem,
  dismissQueueItem,
  createCanonicalFromQueue,
} from "../utils/api";
```

> Note: these are already exported from api.js after Task 7. Add them to the existing destructured import from `../utils/api` instead of a second import.

Actually, edit the existing import block to add the 4 new functions:

```js
import {
  fetchAdminStats,
  fetchBrands,
  fetchCanonicalStats,
  fetchMappedProducts,
  reprocessUnmapped,
  fetchRemapStatus,
  triggerBrandRemap,
  getAuthSession,
  logoutUser,
  fetchReviewQueue,
  confirmQueueItem,
  dismissQueueItem,
  createCanonicalFromQueue,
} from "../utils/api";
```

- [ ] **Step 2: Add ReviewQueueTab component before the main AdminPage function**

Add after the `CanonicalStatsTab` function (around line 765, before `export default function AdminPage`) and before `function AdminPage()`:

```jsx
function ReviewQueueTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [createForm, setCreateForm] = useState(null); // { queueItemId, rawName, category }
  const [newCanonicalName, setNewCanonicalName] = useState("");
  const PAGE_SIZE = 50;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReviewQueue({ status, page });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status, page]);

  async function handleConfirm(id, canonicalId) {
    setActionError(null);
    try {
      await confirmQueueItem(id, canonicalId);
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleDismiss(id) {
    setActionError(null);
    try {
      await dismissQueueItem(id);
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleCreateCanonical(e) {
    e.preventDefault();
    if (!newCanonicalName.trim() || !createForm) return;
    setActionError(null);
    try {
      await createCanonicalFromQueue({
        queue_item_id: createForm.queueItemId,
        canonical_name: newCanonicalName.trim(),
        category: createForm.category,
      });
      setCreateForm(null);
      setNewCanonicalName("");
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-4">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-semibold text-slate-700">Review Queue</h2>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="text-sm border border-slate-200 rounded px-2 py-1"
        >
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <span className="text-sm text-slate-500">{total} items</span>
      </div>

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      {actionError && <div className="text-red-600 text-sm mb-2">{actionError}</div>}

      {createForm && (
        <form onSubmit={handleCreateCanonical} className="mb-4 p-3 bg-green-50 border border-green-200 rounded flex gap-2 items-center">
          <span className="text-sm text-slate-600">New canonical for: <strong>{createForm.rawName}</strong></span>
          <input
            type="text"
            value={newCanonicalName}
            onChange={(e) => setNewCanonicalName(e.target.value)}
            placeholder="Canonical name"
            className="border border-slate-300 rounded px-2 py-1 text-sm flex-1"
            autoFocus
          />
          <button type="submit" className="bg-green-600 text-white px-3 py-1 rounded text-sm">Create</button>
          <button type="button" onClick={() => setCreateForm(null)} className="text-slate-500 text-sm px-2">Cancel</button>
        </form>
      )}

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-400 text-sm">No items</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                <th className="text-left p-2 border-b">Raw Name</th>
                <th className="text-left p-2 border-b">Normalised</th>
                <th className="text-left p-2 border-b">Store</th>
                <th className="text-left p-2 border-b">Category</th>
                <th className="text-right p-2 border-b">Confidence</th>
                <th className="text-left p-2 border-b">Suggested</th>
                <th className="text-left p-2 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b hover:bg-slate-50">
                  <td className="p-2 max-w-[200px] truncate" title={item.raw_name}>{item.raw_name}</td>
                  <td className="p-2 max-w-[180px] truncate text-slate-500" title={item.normalised_name}>{item.normalised_name || "—"}</td>
                  <td className="p-2 text-slate-500">{item.store_name || item.store_id || "—"}</td>
                  <td className="p-2 text-slate-500">{item.category || "—"}</td>
                  <td className="p-2 text-right tabular-nums">
                    {item.confidence != null ? (item.confidence * 100).toFixed(0) + "%" : "—"}
                  </td>
                  <td className="p-2 text-slate-600 max-w-[160px] truncate" title={item.suggested_canonical_name}>
                    {item.suggested_canonical_name || "—"}
                  </td>
                  <td className="p-2">
                    {status === "pending" && (
                      <div className="flex gap-1">
                        {item.suggested_canonical_id && (
                          <button
                            onClick={() => handleConfirm(item.id, item.suggested_canonical_id)}
                            className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200"
                          >
                            Confirm
                          </button>
                        )}
                        <button
                          onClick={() => { setCreateForm({ queueItemId: item.id, rawName: item.raw_name, category: item.category }); setNewCanonicalName(item.raw_name || ""); }}
                          className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded hover:bg-green-200"
                        >
                          Create
                        </button>
                        <button
                          onClick={() => handleDismiss(item.id)}
                          className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded hover:bg-slate-200"
                        >
                          Dismiss
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 mt-3 items-center text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded border disabled:opacity-40"
          >
            Prev
          </button>
          <span>{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded border disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add tab to the tab bar**

Find lines 1057–1059 (the tabs array) and add the new tab:

```jsx
            { id: "user",      label: "User Stats"      },
            { id: "crawl",     label: "Crawl Stats"     },
            { id: "canonical", label: "Canonical Stats" },
            { id: "queue",     label: "Review Queue"    },
```

- [ ] **Step 4: Add tab content panel**

Find the last `{tab === "canonical" && (` block and after its closing `)}`, add:

```jsx
        {tab === "queue" && (
          <ReviewQueueTab />
        )}
```

- [ ] **Step 5: Verify frontend builds without errors**

```bash
cd /Users/rasha/Documents/Rahul/desi-deals-24-landing-page/client && npm run build 2>&1 | tail -10
```

Expected: build succeeds, no type errors

- [ ] **Step 6: Commit**

```bash
cd /Users/rasha/Documents/Rahul/desi-deals-24-landing-page && git add client/src/landing/AdminPage.jsx client/src/utils/api.js
git commit -m "feat(admin-ui): add Review Queue tab with confirm/dismiss/create-canonical actions"
```

---

### Task 9: Run full test suite, verify no regressions

- [ ] **Step 1: Run all integration tests**

```bash
cd /Users/rasha/Documents/Rahul/desi-deals-24-landing-page && node --test tests/integration/*.test.js --reporter=spec 2>&1 | tail -30
```

Expected: all pass. Note: `normaliser.test.js` is untracked — it should also pass (BBD stripping was done in prior session).

- [ ] **Step 2: Fix any failures**

If `canonicalizer.test.js` `resolveQueryToCanonicalId reuses existing canonical records` fails — this test seeds an existing canonical and queries it. It should still pass because it uses exact matching. Check if any test creates a deal with no canonical and expects `stats.mapped = 1` — if so update to expect `stats.manual_review = 1`.

- [ ] **Step 3: Final commit if test fixes were needed**

```bash
git add tests/
git commit -m "test: update canonicalizer tests for new no-match → queue behavior"
```

---

## Self-Review

### Spec coverage
- ✅ Fuzzy threshold raised to 0.90 (Task 1)
- ✅ Below 0.90 → enqueue, no auto-create canonical (Tasks 1, 4)
- ✅ ai-resolver removed (Task 2)
- ✅ Queue status: pending/confirmed/dismissed (Task 5)
- ✅ Schema: store_id + category added (Task 3)
- ✅ New route file at /api/v1/admin-dashboard/review-queue (Tasks 5, 6)
- ✅ After creating canonical: async re-scan pending items in same category ≥0.90 (Task 5)
- ✅ UI: new "Review Queue" tab, 50/page, confirm/dismiss/create (Tasks 7, 8)

### Gaps / caveats
- Bulk dismiss not implemented (spec mentioned it; left for follow-up to keep scope manageable)
- `resolveQueryToCanonicalId` (shopping list path) may return `method: "new"` instead of `"manual_review"` — this is acceptable as that path still creates canonicals on-demand (not subject to the queue)
- The `"confirmed"` filter in the queue UI shows resolved items for audit trail per spec

### Type consistency
- `enqueueManualReview` signature unchanged (store_id/category read from `deal.store_id` / `deal.product_category`)
- `ReviewQueueTab` uses `fetchReviewQueue`, `confirmQueueItem`, `dismissQueueItem`, `createCanonicalFromQueue` — all match Task 7 exports
