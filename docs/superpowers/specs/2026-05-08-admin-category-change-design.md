# Admin Canonical Category Change

**Date:** 2026-05-08  
**Status:** Approved for implementation

## Problem

`canonical_products.category` can be wrong (mis-mapped at crawl time). The existing `PATCH /admin-dashboard/review-queue/canonical/:id` can update the category field but applies no cascade: store product mappings remain pointing at the canonical with the old (wrong) category, causing category-guard violations in the recommender and incorrect product grouping.

Admin needs a way to change a canonical's category that also cleans up all downstream mappings.

## Goal

Add a category selector to the admin product editor overlay. When the category changes, the backend:
1. Updates the canonical
2. Finds every store product mapped to it
3. Re-evaluates each mapping under the new (category-aware) automapper
4. Clears invalidated mappings, re-maps to correct canonicals, queues failures for review

## Architecture

Three changes:

1. **Backend** — new `POST /admin-dashboard/canonical/:id/change-category` endpoint with cascade logic
2. **Frontend API** — new `changeCanonicalCategory()` call in `api.js`
3. **Frontend UI** — `<select>` field in `AdminProductEditor`, wired to the new endpoint on save

---

## Section 1: Backend Endpoint

**File:** `server/routes/admin-dashboard.js`

### Route

```
POST /canonical/:id/change-category
Body: { category: string }
Auth: Bearer admin token (existing middleware)
```

### Validation

`category` must be one of the 16 known values. Reject with 400 otherwise.

```js
const VALID_CATEGORIES = [
  "Rice & Grains", "Flours & Baking", "Lentils & Pulses", "Spices & Masalas",
  "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets", "Beverages",
  "Dairy & Paneer", "Frozen Foods", "Fresh Produce", "Noodles & Pasta",
  "Canned & Packaged", "Personal Care", "Household", "Ready Meals & Mixes", "Other"
];
```

### Cascade Logic

```
1. Load canonical by id — 404 if not found
2. If canonical.category === newCategory → return early, no-op
3. UPDATE canonical_products SET category = newCategory WHERE id = ?
4. Load all active store products where canonical_id = id
   (SELECT id, product_name, product_category, weight_value, weight_unit FROM store_products
    WHERE canonical_id = ? AND is_active = 1)
5. Load priority canonicals via loadPriorityCanonicals(db) from crawler/utils/auto-mapper.js
6. For each store product:
   a. Re-test against updated canonical using matchesCanonical(normedName, wv, wu, updatedCanon, product_category)
   b. If still passes (returns true) → products_unchanged++, skip
   c. If rejected (returns null):
      - DELETE FROM store_product_mappings WHERE deal_id = sp.id
      - UPDATE store_products SET canonical_id = NULL WHERE id = sp.id
      - Try matchesCanonical against each priority canonical where canon.category = sp.product_category
      - First match found → INSERT INTO store_product_mappings + UPDATE sp.canonical_id → products_remapped++
      - No match → INSERT/REPLACE INTO entity_resolution_queue → products_queued++
7. Return { products_unchanged, products_remapped, products_queued }
```

### entity_resolution_queue insert

```sql
INSERT OR REPLACE INTO entity_resolution_queue
  (deal_id, product_name, product_category, product_url, store_id, status, created_at)
VALUES (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP)
```

(Matches existing schema — see 4440 in session memory.)

### store_product_mappings insert (on rematch)

```sql
INSERT OR REPLACE INTO store_product_mappings
  (deal_id, canonical_id, match_method, match_confidence)
VALUES (?, ?, 'slot_match', 0.85)
```

---

## Section 2: Frontend API

**File:** `client/src/utils/api.js`

Add after `updateCanonical`:

```js
export function changeCanonicalCategory(id, category) {
  return authRequest(`/admin-dashboard/canonical/${encodeURIComponent(id)}/change-category`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category }),
  });
}
```

---

## Section 3: AdminProductEditor UI

**File:** `client/src/components/AdminProductEditor.jsx`

### New prop

`initialCategory` — string (e.g. `"Rice & Grains"`)

### Category select

Add between the Type/Variant field and the Save button:

```jsx
<div style={{ marginBottom: 8 }}>
  <label style={{ color: "#64748b", fontSize: 10, fontWeight: 600, display: "block", marginBottom: 3 }}>
    Category
  </label>
  <select
    value={category}
    onChange={e => setCategory(e.target.value)}
    style={{
      width: "100%", background: "#0f172a",
      border: "1px solid #334155", borderRadius: 7,
      color: "#e2e8f0", fontSize: 12, padding: "5px 8px",
      outline: "none", boxSizing: "border-box",
    }}
  >
    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
  </select>
</div>
```

### Hardcoded category list (top of file)

```js
const CATEGORIES = [
  "Rice & Grains", "Flours & Baking", "Lentils & Pulses", "Spices & Masalas",
  "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets", "Beverages",
  "Dairy & Paneer", "Frozen Foods", "Fresh Produce", "Noodles & Pasta",
  "Canned & Packaged", "Personal Care", "Household", "Ready Meals & Mixes", "Other",
];
```

### Save handler — category-first

```js
const handleSave = async () => {
  setSaving(true);
  setError(null);
  try {
    let remapSummary = null;
    if (category !== initialCategory) {
      const remapResult = await changeCanonicalCategory(canonicalId, category);
      remapSummary = remapResult; // { products_unchanged, products_remapped, products_queued }
    }
    const result = await updateCanonical(canonicalId, {
      canonical_name: name.trim() || undefined,
      brand: brand.trim() || undefined,
      product_type: type.trim() || undefined,
      category,  // also update category via existing PATCH for slot recalculation
    });
    const newId = result?.new_id || canonicalId;
    window.dispatchEvent(new CustomEvent("dd24-canonical-updated", { detail: { oldId: canonicalId, newId } }));
    setSaved(true);
    setSaveMessage(remapSummary
      ? `Saved ✓ · ${remapSummary.products_remapped} remapped, ${remapSummary.products_queued} queued`
      : "Saved ✓");
    onSaved?.({ newId });
    setTimeout(onClose, 2000);
  } catch (e) {
    setError(e.message);
    setSaving(false);
  }
};
```

### Updated save button label

```jsx
{saveMessage || (saved ? "Saved ✓" : saving ? "Saving…" : "Save")}
```

---

## Section 4: Call Site Updates

### ProductCard.jsx

Pass `initialCategory`:

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

### DealsPage.jsx

`editData.category` is already returned by `fetchCatalogProduct` (line 294 in catalog.js):

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

---

## Files Changed

| Action | File |
|---|---|
| Modify | `server/routes/admin-dashboard.js` |
| Modify | `client/src/utils/api.js` |
| Modify | `client/src/components/AdminProductEditor.jsx` |
| Modify | `client/src/components/ProductCard.jsx` |
| Modify | `client/src/pages/DealsPage.jsx` |

## What Does NOT Change

- Existing `PATCH /review-queue/canonical/:id` — unchanged; still used for name/brand/type/category (without cascade)
- `matchesCanonical` logic — no change; cascade calls it as-is
- `entity_resolution_queue` schema — no change
- `store_product_mappings` schema — no change
- Products where category unchanged or `product_category === newCategory` — left untouched

## Edge Cases

- **No mapped products:** Endpoint returns `{ products_unchanged: 0, products_remapped: 0, products_queued: 0 }` — valid, no-op cascade
- **"Other" category on either side:** `matchesCanonical` category guard passes for "Other" — mapping kept, not cleared
- **canonical_id conflict after name change:** Category change runs before `updateCanonical` PATCH; if PATCH changes the id, cascade already ran on old id — acceptable (both point to same product group)
- **No priority canonicals in target category:** All products go to queue — warning logged server-side
