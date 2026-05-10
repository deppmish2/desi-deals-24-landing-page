# Admin Canonical Category Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a category selector to the admin product editor overlay so admins can change a canonical's category with full cascade: invalid store product mappings are cleared, re-matched to correct canonicals, and failures queued for review.

**Architecture:** Cascade logic lives in `server/services/category-cascade.js` (isolated, testable). The route in `admin-dashboard.js` calls it. Frontend adds a `<select>` to `AdminProductEditor`, calls a new `changeCanonicalCategory` API function when category changes on save.

**Tech Stack:** Node.js CommonJS, Express, libsql async DB interface, `crawler/utils/auto-mapper.js` (`matchesCanonical`, `loadPriorityCanonicals`, `norm`), React, node:test

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `server/services/category-cascade.js` | `cascadeCategoryChange(db, canonicalId, newCategory)` — cascade logic |
| Modify | `server/routes/admin-dashboard.js` | New `POST /canonical/:id/change-category` route |
| Modify | `client/src/utils/api.js` | New `changeCanonicalCategory(id, category)` function |
| Modify | `client/src/components/AdminProductEditor.jsx` | Category `<select>` + updated save handler |
| Modify | `client/src/components/ProductCard.jsx` | Pass `initialCategory` prop |
| Modify | `client/src/pages/DealsPage.jsx` | Pass `initialCategory` prop |
| Create | `tests/integration/change-category.test.js` | Integration tests for cascade logic |

---

## Task 1: Cascade Service + Tests

**Files:**
- Create: `server/services/category-cascade.js`
- Create: `tests/integration/change-category.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/change-category.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb } = require("./helpers");
const { cascadeCategoryChange } = require("../../server/services/category-cascade");

// Wrap sync SQLite (node:sqlite) in the async interface cascadeCategoryChange expects
function makeDb(sqlite) {
  return {
    prepare(sql) {
      return {
        get: (...args) => Promise.resolve(sqlite.prepare(sql).get(...args)),
        all: (...args) => Promise.resolve(sqlite.prepare(sql).all(...args)),
        run: (...args) => Promise.resolve(sqlite.prepare(sql).run(...args)),
      };
    },
  };
}

function seed(sqlite) {
  sqlite.exec(`
    INSERT INTO stores (id, name, url) VALUES ('s1', 'Test Store', 'https://test.com');
    INSERT INTO canonical_products (id, canonical_name, category, is_match_priority)
      VALUES ('canon-rice', 'Priya Poha Thick 500g', 'Rice & Grains', 1);
    INSERT INTO store_products
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, canonical_id, is_active)
      VALUES
        ('sp-cross', 'run1', '2026-01-01', 's1', 'Priya Poha Thin 500g',
         'Rice & Grains', 'https://test.com/1', 'canon-rice', 1),
        ('sp-other', 'run1', '2026-01-01', 's1', 'Priya Poha Thick 500g',
         'Other', 'https://test.com/2', 'canon-rice', 1);
    INSERT INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence)
      VALUES ('sp-cross', 'canon-rice', 'slot_match', 0.9),
             ('sp-other', 'canon-rice', 'slot_match', 0.9);
  `);
}

test("cross-category product queued after category change", async () => {
  const sqlite = createTestDb();
  seed(sqlite);
  const db = makeDb(sqlite);

  const result = await cascadeCategoryChange(db, "canon-rice", "Ready Meals & Mixes");

  // canonical updated
  const canon = sqlite.prepare("SELECT category FROM canonical_products WHERE id = 'canon-rice'").get();
  assert.equal(canon.category, "Ready Meals & Mixes");

  // sp-cross mapping cleared (product_category='Rice & Grains' ≠ 'Ready Meals & Mixes')
  const mapping = sqlite.prepare("SELECT * FROM store_product_mappings WHERE deal_id = 'sp-cross'").get();
  assert.equal(mapping, undefined);

  const sp = sqlite.prepare("SELECT canonical_id FROM store_products WHERE id = 'sp-cross'").get();
  assert.equal(sp.canonical_id, null);

  // sp-cross queued (no priority canonical in 'Rice & Grains' matches it)
  const queued = sqlite.prepare("SELECT * FROM entity_resolution_queue WHERE deal_id = 'sp-cross'").get();
  assert.ok(queued);
  assert.equal(queued.status, "pending");

  assert.deepEqual(result, { products_unchanged: 1, products_remapped: 0, products_queued: 1 });
});

test("product with product_category=Other stays unchanged", async () => {
  const sqlite = createTestDb();
  seed(sqlite);
  const db = makeDb(sqlite);

  await cascadeCategoryChange(db, "canon-rice", "Ready Meals & Mixes");

  // sp-other mapping preserved (product_category='Other' bypasses category mismatch check)
  const mapping = sqlite.prepare("SELECT * FROM store_product_mappings WHERE deal_id = 'sp-other'").get();
  assert.ok(mapping, "mapping should still exist");
  assert.equal(mapping.canonical_id, "canon-rice");
});

test("no-op when category unchanged", async () => {
  const sqlite = createTestDb();
  seed(sqlite);
  const db = makeDb(sqlite);

  const result = await cascadeCategoryChange(db, "canon-rice", "Rice & Grains");
  assert.deepEqual(result, { products_unchanged: 0, products_remapped: 0, products_queued: 0 });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
node --test tests/integration/change-category.test.js --reporter=spec 2>&1 | tail -20
```

Expected: `Error: Cannot find module '../../server/services/category-cascade'`

- [ ] **Step 3: Create `server/services/category-cascade.js`**

```js
"use strict";

const { loadPriorityCanonicals, matchesCanonical, norm } = require("../../crawler/utils/auto-mapper");

async function cascadeCategoryChange(db, canonicalId, newCategory) {
  const canonical = await db.prepare(
    "SELECT id, category FROM canonical_products WHERE id = ? LIMIT 1"
  ).get(canonicalId);
  if (!canonical) throw new Error(`Canonical not found: ${canonicalId}`);

  // No-op if category unchanged
  if (canonical.category === newCategory) {
    return { products_unchanged: 0, products_remapped: 0, products_queued: 0 };
  }

  // 1. Update canonical category
  await db.prepare("UPDATE canonical_products SET category = ? WHERE id = ?").run(newCategory, canonicalId);

  // 2. Find all active store products mapped to this canonical
  const mapped = await db.prepare(
    `SELECT id, product_name, product_category, weight_value, weight_unit, store_id
     FROM store_products WHERE canonical_id = ? AND is_active = 1`
  ).all(canonicalId);

  if (!mapped.length) return { products_unchanged: 0, products_remapped: 0, products_queued: 0 };

  // 3. Load all priority canonicals for re-matching (includes the updated canonical)
  const priorityCanonicals = await loadPriorityCanonicals(db);

  let products_unchanged = 0, products_remapped = 0, products_queued = 0;

  for (const sp of mapped) {
    // Mirrors matchesCanonical category guard: mismatch only when both sides are non-Other and differ
    const categoryMismatch =
      sp.product_category && sp.product_category !== "Other" &&
      newCategory !== "Other" &&
      sp.product_category !== newCategory;

    if (!categoryMismatch) {
      products_unchanged++;
      continue;
    }

    // Clear invalid mapping
    await db.prepare("DELETE FROM store_product_mappings WHERE deal_id = ?").run(sp.id);
    await db.prepare("UPDATE store_products SET canonical_id = NULL WHERE id = ?").run(sp.id);

    // Try to find a new canonical in product's own category
    const normedName = norm(sp.product_name);
    const matched = priorityCanonicals.find(
      (c) => matchesCanonical(normedName, sp.weight_value, sp.weight_unit, c, sp.product_category) === true
    );

    if (matched) {
      await db.prepare(
        "INSERT OR REPLACE INTO store_product_mappings (deal_id, canonical_id, match_method, match_confidence) VALUES (?, ?, 'slot_match', 0.85)"
      ).run(sp.id, matched.id);
      await db.prepare("UPDATE store_products SET canonical_id = ? WHERE id = ?").run(matched.id, sp.id);
      products_remapped++;
    } else {
      await db.prepare(
        `INSERT OR IGNORE INTO entity_resolution_queue
         (deal_id, raw_name, normalised_name, status, store_id, category)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      ).run(sp.id, sp.product_name, normedName, sp.store_id, sp.product_category);
      products_queued++;
    }
  }

  return { products_unchanged, products_remapped, products_queued };
}

module.exports = { cascadeCategoryChange };
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
node --test tests/integration/change-category.test.js --reporter=spec 2>&1 | tail -20
```

Expected: 3 passing, 0 failing

- [ ] **Step 5: Run full regression suite**

```bash
npm test 2>&1 | tail -30
```

Expected: same pass count as before (163 passing, 2 pre-existing failures)

- [ ] **Step 6: Commit**

```bash
git add server/services/category-cascade.js tests/integration/change-category.test.js
git commit -m "feat(admin): add cascadeCategoryChange service with integration tests"
```

---

## Task 2: Backend Route

**Files:**
- Modify: `server/routes/admin-dashboard.js` (add before `module.exports` at line 319)

- [ ] **Step 1: Add `cascadeCategoryChange` import at top of `admin-dashboard.js`**

After line 9 (the existing requires block), add:

```js
const { cascadeCategoryChange } = require("../services/category-cascade");
```

- [ ] **Step 2: Add `VALID_CATEGORIES` constant**

After the import lines and before the `router` definition (after line 12), add:

```js
const VALID_CATEGORIES = [
  "Rice & Grains", "Flours & Baking", "Lentils & Pulses", "Spices & Masalas",
  "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets", "Beverages",
  "Dairy & Paneer", "Frozen Foods", "Fresh Produce", "Noodles & Pasta",
  "Canned & Packaged", "Personal Care", "Household", "Ready Meals & Mixes", "Other",
];
```

- [ ] **Step 3: Add the route before `module.exports` at line 319**

```js
// POST /canonical/:id/change-category — update category + cascade remap store products
router.post("/canonical/:id/change-category", async (req, res) => {
  try {
    const { id } = req.params;
    const { category } = req.body || {};

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`,
      });
    }

    const canonical = await db
      .prepare("SELECT id FROM canonical_products WHERE id = ? LIMIT 1")
      .get(id);
    if (!canonical) return res.status(404).json({ error: "Canonical not found" });

    const result = await cascadeCategoryChange(db, id, category);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[admin] change-category error:", err);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Verify server starts without errors**

```bash
DB_FILE=data/prod_local.db npm run dev 2>&1 | head -20
```

Expected: server starts, no require errors

- [ ] **Step 5: Smoke test the endpoint**

```bash
ADMIN_TOKEN=$(grep ADMIN_SECRET .env.local | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/admin-dashboard/canonical/nonexistent-id/change-category \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"Ready Meals & Mixes"}' | jq .
```

Expected: `{"error":"Canonical not found"}`

```bash
curl -s -X POST http://localhost:3000/api/admin-dashboard/canonical/nonexistent-id/change-category \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category":"NotACategory"}' | jq .
```

Expected: `{"error":"Invalid category. Must be one of: ..."}`

- [ ] **Step 6: Commit**

```bash
git add server/routes/admin-dashboard.js
git commit -m "feat(admin): POST /canonical/:id/change-category endpoint with cascade"
```

---

## Task 3: Frontend API + AdminProductEditor

**Files:**
- Modify: `client/src/utils/api.js` (after line 369)
- Modify: `client/src/components/AdminProductEditor.jsx`

- [ ] **Step 1: Add `changeCanonicalCategory` to `api.js`**

After the `updateCanonical` function (line 369), add:

```js
export function changeCanonicalCategory(id, category) {
  return authRequest(`/admin-dashboard/canonical/${encodeURIComponent(id)}/change-category`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });
}
```

- [ ] **Step 2: Replace `AdminProductEditor.jsx` with updated version**

Full file (replaces existing 114-line file):

```jsx
import React, { useState } from "react";
import { updateCanonical, changeCanonicalCategory } from "../utils/api";

const CATEGORIES = [
  "Rice & Grains", "Flours & Baking", "Lentils & Pulses", "Spices & Masalas",
  "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets", "Beverages",
  "Dairy & Paneer", "Frozen Foods", "Fresh Produce", "Noodles & Pasta",
  "Canned & Packaged", "Personal Care", "Household", "Ready Meals & Mixes", "Other",
];

export default function AdminProductEditor({
  canonicalId, initialName, initialBrand, initialType, initialCategory,
  onClose, onSaved,
}) {
  const [name, setName] = useState(initialName || "");
  const [brand, setBrand] = useState(initialBrand || "");
  const [type, setType] = useState(initialType || "");
  const [category, setCategory] = useState(initialCategory || "Other");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let remapSummary = null;
      if (category !== initialCategory) {
        remapSummary = await changeCanonicalCategory(canonicalId, category);
      }
      const result = await updateCanonical(canonicalId, {
        canonical_name: name.trim() || undefined,
        brand: brand.trim() || undefined,
        product_type: type.trim() || undefined,
        category,
      });
      const newId = result?.new_id || canonicalId;
      window.dispatchEvent(new CustomEvent("dd24-canonical-updated", {
        detail: { oldId: canonicalId, newId },
      }));
      setSaved(true);
      setSaveMessage(
        remapSummary
          ? `Saved ✓ · ${remapSummary.products_remapped} remapped, ${remapSummary.products_queued} queued`
          : "Saved ✓"
      );
      onSaved?.({ newId });
      setTimeout(onClose, 2000);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const textFields = [
    { label: "Canonical", value: name, set: setName, placeholder: "Full product name" },
    { label: "Brand", value: brand, set: setBrand, placeholder: "Brand name" },
    { label: "Type / Variant", value: type, set: setType, placeholder: "e.g. Extra Long, Whole" },
  ];

  const inputStyle = {
    width: "100%", background: "#0f172a",
    border: "1px solid #334155", borderRadius: 7,
    color: "#e2e8f0", fontSize: 12, padding: "5px 8px",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "absolute", inset: 0,
        background: "rgba(15, 23, 42, 0.97)",
        borderRadius: 20, padding: "14px 14px 12px",
        zIndex: 20, display: "flex", flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ color: "#60a5fa", fontSize: 10, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", margin: 0 }}>
          Admin · Edit Metadata
        </p>
        <span style={{ color: "#475569", fontSize: 10 }}>{canonicalId}</span>
      </div>

      {textFields.map(({ label, value, set, placeholder }) => (
        <div key={label} style={{ marginBottom: 8 }}>
          <label style={{ color: "#64748b", fontSize: 10, fontWeight: 600, display: "block", marginBottom: 3 }}>{label}</label>
          <input
            value={value}
            onChange={e => set(e.target.value)}
            placeholder={placeholder}
            style={inputStyle}
          />
        </div>
      ))}

      <div style={{ marginBottom: 8 }}>
        <label style={{ color: "#64748b", fontSize: 10, fontWeight: 600, display: "block", marginBottom: 3 }}>
          Category {category !== initialCategory && <span style={{ color: "#f59e0b" }}>· will remap products</span>}
        </label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{ ...inputStyle, cursor: "pointer" }}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {error && <p style={{ color: "#f87171", fontSize: 11, margin: "4px 0" }}>{error}</p>}

      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, height: 32, borderRadius: 8,
            background: saved ? "#16a34a" : saving ? "#1e40af" : "#3b82f6",
            color: "#fff", fontSize: 11, fontWeight: 600,
            border: "none", cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saveMessage || (saved ? "Saved ✓" : saving ? "Saving…" : "Save")}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            flex: 1, height: 32, borderRadius: 8,
            background: "#1e293b", color: "#94a3b8",
            fontSize: 12, fontWeight: 500,
            border: "1px solid #334155", cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify frontend builds without errors**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: build completes, no TypeScript/ESLint errors

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/api.js client/src/components/AdminProductEditor.jsx
git commit -m "feat(admin): category select in admin product editor with cascade remap"
```

---

## Task 4: Call Site Updates

**Files:**
- Modify: `client/src/components/ProductCard.jsx` (line ~94)
- Modify: `client/src/pages/DealsPage.jsx` (line ~327)

- [ ] **Step 1: Update ProductCard.jsx**

Find the `<AdminProductEditor` block at line ~94. Add `initialCategory` prop:

```jsx
<AdminProductEditor
  canonicalId={product.canonical_id}
  initialName={displayName}
  initialBrand={displayBrand || ""}
  initialType={serverData?.primary_type || product.primary_type || ""}
  initialCategory={product.category || product.product_category || "Other"}
  onClose={() => setEditOpen(false)}
  onSaved={() => setEditOpen(false)}
/>
```

`product.category` is the field at line 55 of ProductCard (`product_category: product.category`). The product object passed to the component has both `category` and `product_category` available.

- [ ] **Step 2: Update DealsPage.jsx**

Find the `<AdminProductEditor` block at line ~327. Add `initialCategory` prop:

```jsx
<AdminProductEditor
  canonicalId={deal.canonical_id}
  initialName={editData.canonical_name}
  initialBrand={editData.primary_brand || ""}
  initialType={editData.product_type || ""}
  initialCategory={editData.category || "Other"}
  onClose={() => setEditOpen(false)}
  onSaved={() => setEditOpen(false)}
/>
```

`editData.category` is already returned by `fetchCatalogProduct` (catalog.js line 294: `category: row.category`).

- [ ] **Step 3: Build frontend**

```bash
cd client && npm run build 2>&1 | tail -10
```

Expected: clean build

- [ ] **Step 4: Manual smoke test**

Start dev server with prod_local.db:
```bash
DB_FILE=data/prod_local.db npm run dev
```
Open `http://localhost:5173/deals` in browser.

1. Log in as admin
2. Click EDIT on any product card
3. Verify category `<select>` appears pre-populated with the canonical's current category
4. Verify the label shows `· will remap products` in amber when category is changed
5. Change category on a product known to be mis-categorised (e.g. a "Ready to Eat" product still showing as "Rice & Grains")
6. Click Save
7. Verify saved message shows `Saved ✓ · N remapped, Y queued`
8. Verify in DB: `SELECT category FROM canonical_products WHERE id = ?` returns new category

```bash
DB_FILE=data/prod_local.db node -e "
const db = require('./server/db');
db.prepare('SELECT id, canonical_name, category FROM canonical_products WHERE category = \"Ready Meals & Mixes\" LIMIT 5').all().then(r => console.log(r));
"
```

- [ ] **Step 5: Run full regression suite**

```bash
npm test 2>&1 | tail -30
```

Expected: 166 passing (3 new from Task 1), 2 pre-existing failures unchanged

- [ ] **Step 6: Commit**

```bash
git add client/src/components/ProductCard.jsx client/src/pages/DealsPage.jsx
git commit -m "feat(admin): pass initialCategory to AdminProductEditor in ProductCard and DealsPage"
```
