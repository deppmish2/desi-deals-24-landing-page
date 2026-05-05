# Frontend Redesign: Cart, Catalog & Compare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three redesigned screens (Cart Direction 2, All Products catalog, Compare Direction 6), extract shared components, update navigation, and add brand picker to cart items.

**Architecture:** `CartPage.jsx` replaces `ListPage.jsx` at `/cart`; `ComparePage.jsx` restyled at `/compare/:id`; new `CatalogPage.jsx` at `/products`; shared `NavTabs`, `ProductCard`, `ReplacementsModal` components extracted into `client/src/components/`; `useCart` + `CartContext` extended with brand preference state.

**Tech Stack:** React 18, React Router v6, Tailwind CSS v3, Vite, DM Sans (Google Fonts). Backend: Express + libsql async (CommonJS). No frontend test framework — verify via browser dev server.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `client/index.html` | Add DM Sans font |
| Modify | `server/routes/catalog.js` | Add GET `/:id/brands` endpoint |
| Modify | `client/src/utils/api.js` | Add `fetchProductBrands`, `fetchCatalog` |
| Modify | `client/src/hooks/useCart.js` | Add `setBrand` action |
| Modify | `client/src/hooks/CartContext.js` | Expose `setBrand` in context |
| Create | `client/src/components/ReplacementsModal.jsx` | Extracted from DealsPage |
| Modify | `client/src/pages/DealsPage.jsx` | Remove "See alternatives", import ReplacementsModal |
| Create | `client/src/components/NavTabs.jsx` | All Products / Deals / Cart nav |
| Create | `client/src/pages/CartPage.jsx` | Direction 2 cart screen |
| Create | `client/src/components/ProductCard.jsx` | Context-aware product card (catalog) |
| Create | `client/src/pages/CatalogPage.jsx` | All Products browse |
| Create | `client/src/components/comparison/CoverageBar.jsx` | Coverage progress bar |
| Create | `client/src/components/comparison/MissingItemsBanner.jsx` | Amber missing-items strip |
| Create | `client/src/components/comparison/StoreComparisonCard.jsx` | Full comparison card |
| Modify | `client/src/pages/ComparePage.jsx` | Direction 6 restyle |
| Modify | `client/src/App.jsx` | Route changes + redirects |

---

## Task 1: DM Sans font + backend brands endpoint

**Files:**
- Modify: `client/index.html`
- Modify: `server/routes/catalog.js`

- [ ] **Step 1: Add DM Sans to index.html**

In `client/index.html`, add after the Space Grotesk `<noscript>` block (before `</noscript>`):

```html
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&display=swap"
      rel="stylesheet"
    />
    <link
      href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap"
      rel="stylesheet"
    />
  </noscript>
```

Also add the preload link (after the Space Grotesk preload, before the `<noscript>` tag):

```html
    <link
      rel="preload"
      as="style"
      href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap"
      onload="this.onload=null;this.rel='stylesheet';"
    />
```

- [ ] **Step 2: Add brands endpoint to catalog.js**

In `server/routes/catalog.js`, insert before the `module.exports = router;` line:

```js
router.get("/:id/brands", async (req, res, next) => {
  try {
    const { id } = req.params;
    const row = await db.prepare(
      "SELECT brand_slots FROM canonical_products WHERE id = ?"
    ).get(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    let brands = [];
    try { brands = JSON.parse(row.brand_slots || "[]"); } catch { brands = []; }
    if (!Array.isArray(brands)) brands = [];
    res.json({ data: brands.flat().filter(Boolean) });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 3: Smoke-test the endpoint**

Start dev server: `DB_FILE=data/prod_local.db npm run dev`

Pick any canonical_id from the DB:
```bash
node -e "const db=require('./server/db'); db.prepare('SELECT id FROM canonical_products LIMIT 1').get().then(r=>console.log(r))"
```

Then hit the endpoint (replace `<id>` with the result):
```bash
curl -s "http://localhost:3000/api/v1/catalog/<id>/brands" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: `{ data: [...] }` — array may be empty if brand_slots is null/empty for that product. No 500.

- [ ] **Step 4: Commit**

```bash
git add client/index.html server/routes/catalog.js
git commit -m "feat: add DM Sans font and GET /api/v1/catalog/:id/brands endpoint"
```

---

## Task 2: api.js — fetchProductBrands + fetchCatalog

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Add fetchProductBrands**

In `client/src/utils/api.js`, find the existing `export function fetchBrands()` (the admin endpoint). Add the new public function directly below it:

```js
export function fetchProductBrands(canonicalId) {
  return request(`/catalog/${canonicalId}/brands`);
}
```

- [ ] **Step 2: Add fetchCatalog**

In the same file, find the `// ── Shopping lists` comment. Insert before it:

```js
// ── Catalog ───────────────────────────────────────────────────────────────────

export function fetchCatalog(params = {}) {
  return request("/catalog", params);
}

export function fetchCatalogProduct(canonicalId) {
  return request(`/catalog/${canonicalId}`);
}

```

- [ ] **Step 3: Verify no syntax errors**

```bash
cd client && node -e "import('./src/utils/api.js').catch(e => { console.error(e.message); process.exit(1) })" 2>&1 || echo "Syntax OK (ESM import attempt expected to fail in CJS node — check Vite build instead"
npm run build 2>&1 | tail -5
```

Expected: build completes without errors.

- [ ] **Step 4: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(api): add fetchProductBrands and fetchCatalog utilities"
```

---

## Task 3: useCart + CartContext — brand preference state

**Files:**
- Modify: `client/src/hooks/useCart.js`
- Modify: `client/src/hooks/CartContext.js`

- [ ] **Step 1: Add setBrand to useCart.js**

In `client/src/hooks/useCart.js`, add `setBrand` after the `clearCart` callback (before the `return` statement):

```js
  const setBrand = useCallback((canonicalId, brand, anyBrand) => {
    setItems(prev => {
      const next = prev.map(item =>
        item.canonical_id === canonicalId
          ? { ...item, brand: brand ?? null, anyBrand: anyBrand ?? false }
          : item
      );
      writeCart(next);
      return next;
    });
  }, []);
```

Update the return statement to include `setBrand`:

```js
  return { items, addItem, removeItem, updateItem, clearCart, setBrand, count: items.length };
```

- [ ] **Step 2: Expose setBrand in CartContext**

Replace the entire content of `client/src/hooks/CartContext.js` with:

```js
import { createContext } from "react";
export const CartContext = createContext({
  items: [],
  addItem: () => {},
  removeItem: () => {},
  updateItem: () => {},
  clearCart: () => {},
  setBrand: () => {},
  count: 0,
});
```

- [ ] **Step 3: Verify CartContext provider passes setBrand**

Search for where `CartContext.Provider` is rendered (likely `App.jsx` or a wrapper):

```bash
grep -n "CartContext.Provider\|CartContext\.Provider\|useCart" client/src/App.jsx client/src/main.jsx 2>/dev/null
```

Open whichever file renders `<CartContext.Provider value={...}>`. Confirm `setBrand` is included in the `value` object. If it reads from `useCart()`, `setBrand` is already included since `useCart` now returns it. No change needed if the spread is `{...useCart()}` or all fields are passed.

If the provider uses destructuring like `const { items, addItem, ... } = useCart()`, add `setBrand` to the destructure and the `value` prop.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/useCart.js client/src/hooks/CartContext.js
git commit -m "feat(cart): add brand/anyBrand preference state and setBrand action to useCart"
```

---

## Task 4: Extract ReplacementsModal

**Files:**
- Create: `client/src/components/ReplacementsModal.jsx`
- Modify: `client/src/pages/DealsPage.jsx`

- [ ] **Step 1: Identify the code to extract**

In `client/src/pages/DealsPage.jsx`:
- `ReplacementDealRow` function starts at line 440
- `ReplacementsModal` function starts at line 500
- Both end around line 660 (before `DealCard` at line 668)

Read lines 440–660 to confirm exact boundaries:
```bash
sed -n '440,665p' client/src/pages/DealsPage.jsx
```

- [ ] **Step 2: Create ReplacementsModal.jsx**

Create `client/src/components/ReplacementsModal.jsx`. The file needs:
1. React imports including `createPortal`
2. The `TIER_LABELS` object (search DealsPage for it: `grep -n "TIER_LABELS" client/src/pages/DealsPage.jsx`)
3. The `ReplacementDealRow` function (copy verbatim from DealsPage lines 440–499)
4. The `ReplacementsModal` function (copy verbatim from DealsPage lines 500–660)
5. Export both

```js
import React, { createPortal } from "react";

const TIER_LABELS = {
  // copy from DealsPage — search: grep -n -A 10 "TIER_LABELS" client/src/pages/DealsPage.jsx
};

function ReplacementDealRow({ /* props as in DealsPage */ }) {
  // copy verbatim from DealsPage lines 440–499
}

export function ReplacementsModal({ sourceDeal, tiers, loading, otherStores, isAdmin, onClose }) {
  // copy verbatim from DealsPage lines 500–660
}

export default ReplacementsModal;
```

The file must import anything `ReplacementsModal` and `ReplacementDealRow` reference from DealsPage's imports. Check DealsPage imports:
```bash
sed -n '1,45p' client/src/pages/DealsPage.jsx
```

Common needs: `buildDealPageUrl`, `resolveUrl`, price formatting utilities. Add those imports at the top of `ReplacementsModal.jsx`.

- [ ] **Step 3: Update DealsPage imports**

In `client/src/pages/DealsPage.jsx`:

1. Remove `ReplacementDealRow` and `ReplacementsModal` function definitions (lines 440–660).
2. Add import at the top (after existing imports):

```js
import ReplacementsModal from "../components/ReplacementsModal";
```

All usages of `ReplacementsModal` in `DealCard` remain unchanged — they reference the same component name.

- [ ] **Step 4: Verify**

```bash
cd client && npm run build 2>&1 | tail -10
```

Expected: build succeeds. Then start dev server and open `/deals` — modal should still work when clicking "See alternatives" on any deal with a `canonical_id`.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/ReplacementsModal.jsx client/src/pages/DealsPage.jsx
git commit -m "refactor: extract ReplacementsModal into shared component"
```

---

## Task 5: DealsPage — remove "See alternatives" from DealCard

**Files:**
- Modify: `client/src/pages/DealsPage.jsx`

- [ ] **Step 1: Locate and remove the "See alternatives" button**

Find it:
```bash
grep -n "See alternatives\|handleOpenReplacements\|showReplacements" client/src/pages/DealsPage.jsx
```

Remove the button element (the `<button>` with "See alternatives" text, around line 1148–1158). Keep `showReplacements` state and `<ReplacementsModal>` render — the modal still opens programmatically in the compare step.

The block to remove looks like:
```jsx
{deal.canonical_id && (
  <button
    type="button"
    onClick={handleOpenReplacements}
    className="w-full text-center text-[11px] ..."
  >
    ...
    See alternatives
  </button>
)}
```

Remove only that `{deal.canonical_id && (<button...>)}` block.

- [ ] **Step 2: Remove now-unused state**

Since "See alternatives" no longer has a trigger button, `showReplacements`, `replacementTiers`, `replacementsLoading`, `otherStores` state and `handleOpenReplacements` in `DealCard` are dead code.

Remove:
- `const [showReplacements, setShowReplacements] = useState(false);`
- `const [replacementTiers, setReplacementTiers] = useState(null);`
- `const [replacementsLoading, setReplacementsLoading] = useState(false);`
- `const [otherStores, setOtherStores] = useState(null);`
- `async function handleOpenReplacements() { ... }` (the entire function)
- `{showReplacements && (<ReplacementsModal ... />)}` render

Verify `loadingCanonical`, `canonicalData` are NOT removed if still used elsewhere in DealCard.

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

Open dev server, check `/deals` — cards render, no "See alternatives" button visible.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/DealsPage.jsx
git commit -m "feat(deals): remove 'See alternatives' from product cards"
```

---

## Task 6: NavTabs component

**Files:**
- Create: `client/src/components/NavTabs.jsx`

- [ ] **Step 1: Create NavTabs.jsx**

```jsx
import React, { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { CartContext } from "../hooks/CartContext";

export default function NavTabs() {
  const { pathname } = useLocation();
  const { count } = useContext(CartContext);

  const isProducts = pathname.startsWith("/products");
  const isDeals = pathname === "/" || pathname === "/deals" || pathname.startsWith("/deal/");

  return (
    <div
      style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", fontFamily: "'DM Sans', system-ui, sans-serif" }}
      className="flex items-center px-4"
    >
      <Link
        to="/products"
        style={{
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: isProducts ? 700 : 500,
          color: isProducts ? "#16a34a" : "#64748b",
          borderBottom: isProducts ? "2px solid #16a34a" : "2px solid transparent",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        All Products
      </Link>
      <Link
        to="/deals"
        style={{
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: isDeals ? 700 : 500,
          color: isDeals ? "#16a34a" : "#64748b",
          borderBottom: isDeals ? "2px solid #16a34a" : "2px solid transparent",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Deals
      </Link>
      <div style={{ flex: 1 }} />
      <Link
        to="/cart"
        style={{ textDecoration: "none", position: "relative", padding: "8px", color: "#64748b", display: "flex" }}
        aria-label={`Cart, ${count} items`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        {count > 0 && (
          <span
            style={{
              position: "absolute", top: 4, right: 4,
              background: "#16a34a", color: "#fff",
              borderRadius: 99, minWidth: 15, height: 15,
              fontSize: 9, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd client && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/NavTabs.jsx
git commit -m "feat: add NavTabs component with All Products / Deals / Cart navigation"
```

---

## Task 7: CartPage

**Files:**
- Create: `client/src/pages/CartPage.jsx`

- [ ] **Step 1: Create CartPage.jsx**

```jsx
import React, { useContext, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CartContext } from "../hooks/CartContext";
import {
  getAuthSession,
  createList,
  fetchLists,
  mergeCartIntoList,
  fetchProductBrands,
} from "../utils/api";

const CATEGORY_COLORS = {
  "Rice & Grains":    { bg: "#fef3c7", text: "#92400e", label: "RICE" },
  "Lentils & Pulses": { bg: "#fce7f3", text: "#9d174d", label: "DAL" },
  "Spices & Masalas": { bg: "#fff7ed", text: "#9a3412", label: "SPICE" },
  "Dairy & Paneer":   { bg: "#eff6ff", text: "#1e40af", label: "DAIRY" },
  "Flours & Baking":  { bg: "#f0fdf4", text: "#166534", label: "FLOUR" },
};

function CategoryThumb({ category, imageUrl }) {
  const [imgError, setImgError] = useState(false);
  const colors = CATEGORY_COLORS[category] || { bg: "#f1f5f9", text: "#64748b", label: "?" };
  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt=""
        onError={() => setImgError(true)}
        style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: 56, height: 56, borderRadius: 12,
        background: colors.bg, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, color: colors.text, letterSpacing: "0.08em" }}>
        {colors.label}
      </span>
    </div>
  );
}

function BrandPickerSheet({ canonicalId, canonicalName, currentBrand, anyBrand, onSelect, onClose }) {
  const [brands, setBrands] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchProductBrands(canonicalId)
      .then(data => setBrands(data.data || []))
      .catch(() => { setLoadError(true); setBrands([]); });
  }, [canonicalId]);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }} />
      <div
        style={{
          position: "relative", width: "100%", maxWidth: 448,
          background: "#fff", borderRadius: "24px 24px 0 0",
          padding: "20px 20px 32px", maxHeight: "70vh", overflowY: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        <p style={{ margin: "0 0 2px", fontSize: 13, color: "#94a3b8" }}>Choose brand for</p>
        <p style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{canonicalName}</p>

        {loadError && (
          <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            Unable to load brands — tap "Any brand" to continue.
          </p>
        )}

        {brands === null && !loadError && (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #16a34a", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
          </div>
        )}

        {brands !== null && (
          <div>
            <BrandOption
              label="Any brand"
              description="Match any available brand at comparison"
              selected={anyBrand}
              onSelect={() => onSelect(null, true)}
            />
            {brands.map(brand => (
              <BrandOption
                key={brand}
                label={brand}
                selected={!anyBrand && currentBrand === brand}
                onSelect={() => onSelect(brand, false)}
              />
            ))}
            {brands.length === 0 && !loadError && (
              <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "8px 0 0" }}>
                No specific brands found — "Any brand" will match.
              </p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function BrandOption({ label, description, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%", background: "none", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderRadius: 14, textAlign: "left",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
      onMouseLeave={e => e.currentTarget.style.background = "none"}
    >
      <div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1e293b" }}>{label}</p>
        {description && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>{description}</p>}
      </div>
      {selected && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </button>
  );
}

function CartItemCard({ item, index, onRemove, onDecrement, onIncrement, onBrandSelect }) {
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const brand = item.brand ?? null;
  const anyBrand = item.anyBrand !== false;
  const qty = item.item_count || 1;

  return (
    <>
      <div style={{
        background: "#fff", border: "1px solid #f1f5f9",
        borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", overflow: "hidden",
      }}>
        {/* Top section */}
        <div style={{ padding: "14px 14px 10px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <CategoryThumb category={item.product_category} imageUrl={item.image_url} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, lineHeight: 1.4, wordBreak: "break-word", color: "#1e293b" }}>
              {item.canonical_id && (
                <>
                  <button
                    onClick={() => setShowBrandPicker(true)}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontSize: 14, fontWeight: 700,
                      color: anyBrand ? "#94a3b8" : "#16a34a",
                      borderBottom: anyBrand ? "1.5px dashed #cbd5e1" : "1.5px solid #86efac",
                      lineHeight: "inherit",
                    }}
                  >
                    {anyBrand ? "Any brand" : (brand || "Any brand")}
                  </button>
                  {" "}
                </>
              )}
              {item.raw_item_text}
            </p>
            {(item.weight_raw || item.quantity) && (
              <p style={{ margin: "3px 0 0", fontSize: 11, color: "#94a3b8" }}>
                {item.weight_raw || `${item.quantity}${item.quantity_unit || ""}`}
              </p>
            )}
            {anyBrand && item.canonical_id && (
              <p style={{ margin: "3px 0 0", fontSize: 10, color: "#94a3b8" }}>Matches any available brand</p>
            )}
          </div>
        </div>

        {/* Bottom section */}
        <div style={{
          padding: "8px 14px 14px", borderTop: "1px solid #f8fafc",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <button
            onClick={() => onRemove(index)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "4px 6px", borderRadius: 8,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#cbd5e1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M6 7v5M10 7v5M3 4l.8 9.5A.5.5 0 004.3 14h7.4a.5.5 0 00.5-.5L13 4"/>
            </svg>
            <span style={{ fontSize: 11, color: "#cbd5e1" }}>Remove</span>
          </button>

          <div style={{
            border: "1.5px solid rgba(22,163,74,0.2)", borderRadius: 10,
            height: 32, display: "flex", overflow: "hidden",
          }}>
            <button
              onClick={() => onDecrement(index)}
              disabled={qty <= 1}
              style={{
                width: 32, background: "none", border: "none",
                cursor: qty <= 1 ? "default" : "pointer",
                fontSize: 15, fontWeight: 700,
                color: qty <= 1 ? "#cbd5e1" : "#16a34a",
              }}
            >−</button>
            <div style={{
              width: 32, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#1e293b",
            }}>
              {qty}
            </div>
            <button
              onClick={() => onIncrement(index)}
              style={{ width: 32, background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#16a34a" }}
            >+</button>
          </div>
        </div>
      </div>

      {showBrandPicker && (
        <BrandPickerSheet
          canonicalId={item.canonical_id}
          canonicalName={item.raw_item_text}
          currentBrand={brand}
          anyBrand={anyBrand}
          onSelect={(b, ab) => { onBrandSelect(item.canonical_id, b, ab); setShowBrandPicker(false); }}
          onClose={() => setShowBrandPicker(false)}
        />
      )}
    </>
  );
}

export default function CartPage() {
  const { items, removeItem, updateItem, clearCart, setBrand } = useContext(CartContext);
  const [finding, setFinding] = useState(false);
  const navigate = useNavigate();
  const session = getAuthSession();

  const handleDecrement = (index) => {
    const qty = items[index].item_count || 1;
    if (qty <= 1) return;
    updateItem(index, { item_count: qty - 1 });
  };

  const handleIncrement = (index) => {
    updateItem(index, { item_count: (items[index].item_count || 1) + 1 });
  };

  const handleFindBestPrice = async () => {
    if (!items.length || finding) return;
    if (!session) {
      navigate("/?login=1");
      return;
    }
    setFinding(true);
    try {
      const listsRes = await fetchLists();
      const listsData = listsRes.ok ? await listsRes.json() : null;
      let list = listsData?.data?.[0];
      if (!list) {
        const createRes = await createList("My Shopping List");
        const createData = await createRes.json();
        list = createData.data || createData;
      }
      await mergeCartIntoList(list.id, items);
      clearCart();
      navigate(`/compare/${list.id}`);
    } catch (err) {
      console.error("Find best price error:", err);
    } finally {
      setFinding(false);
    }
  };

  return (
    <div style={{
      background: "radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)",
      minHeight: "100vh",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #f1f5f9",
        position: "sticky", top: 0, zIndex: 50,
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8", padding: 0, lineHeight: 1 }}
        >←</button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>Cart</p>
          <p style={{ margin: "1px 0 0", fontSize: 11, color: "#94a3b8" }}>
            {items.length} item{items.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-4 pb-[120px]">
        {items.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 80, textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
              </svg>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#1e293b" }}>Your cart is empty</p>
            <p style={{ margin: "0 0 28px", fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxWidth: 280 }}>
              Add products from the catalog to start comparing prices across stores.
            </p>
            <button
              onClick={() => navigate("/products")}
              style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 14, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Browse products
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((item, index) => (
              <CartItemCard
                key={item.canonical_id || String(index)}
                item={item}
                index={index}
                onRemove={removeItem}
                onDecrement={handleDecrement}
                onIncrement={handleIncrement}
                onBrandSelect={setBrand}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#fff", borderTop: "1px solid #f1f5f9",
        padding: "12px 16px 20px", zIndex: 40,
      }}>
        <div className="max-w-2xl mx-auto">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {items.length} item{items.length !== 1 ? "s" : ""} in list
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Prices shown at comparison →</span>
          </div>
          <button
            onClick={handleFindBestPrice}
            disabled={!items.length || finding}
            style={{
              width: "100%", height: 52, borderRadius: 16, border: "none",
              cursor: items.length && !finding ? "pointer" : "not-allowed",
              background: items.length ? "#16a34a" : "#f1f5f9",
              color: items.length ? "#fff" : "#94a3b8",
              fontSize: 15, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}
          >
            <span>{finding ? "Saving list…" : "Find best price"}</span>
            {!finding && <span>→</span>}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

- [ ] **Step 3: Verify in browser**

Start: `DB_FILE=data/prod_local.db npm run dev` + `cd client && npm run dev`

Navigate to `http://localhost:5173/cart`. Verify:
- Empty state shows shopping bag icon + "Your cart is empty" + orange "Browse products" button
- Add a deal to cart from `/deals` (CartButton), then revisit `/cart`
- CartItemCard renders with thumbnail, product name, remove button, stepper
- Stepper increments/decrements; minus disabled at qty=1
- If item has `canonical_id`, brand span is tappable → BrandPickerSheet opens
- "Find best price" button is green when items present, grey when empty

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CartPage.jsx
git commit -m "feat: add CartPage with Direction 2 design (brand picker, qty stepper, find best price)"
```

---

## Task 8: ProductCard + CatalogPage

**Files:**
- Create: `client/src/components/ProductCard.jsx`
- Create: `client/src/pages/CatalogPage.jsx`

- [ ] **Step 1: Create ProductCard.jsx**

```jsx
import React, { useContext, useState } from "react";
import { CartContext } from "../hooks/CartContext";

export default function ProductCard({ product, context }) {
  const { addItem } = useContext(CartContext);
  const [imgError, setImgError] = useState(false);
  const [inCart, setInCart] = useState(false);

  const handleAddToCart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    addItem({
      raw_item_text: product.canonical_name,
      canonical_id: product.canonical_id,
      product_category: product.category,
      image_url: product.image_url,
      weight_raw: product.weight_raw,
      quantity: product.weight_value,
      quantity_unit: product.weight_unit,
      item_count: 1,
    });
    setInCart(true);
    setTimeout(() => setInCart(false), 1500);
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Check out ${product.canonical_name} on DesiDeals24!`)}`;

  return (
    <div style={{
      background: "#fff", border: "1px solid #f1f5f9",
      borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      overflow: "hidden", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Image */}
      <div style={{ aspectRatio: "4/3", background: "#f8fafc", overflow: "hidden" }}>
        {product.image_url && !imgError ? (
          <img
            src={product.image_url}
            alt={product.canonical_name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{product.category || "?"}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "12px 14px 14px" }}>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "#94a3b8" }}>{product.category}</p>
        <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#1e293b", lineHeight: 1.3 }}>
          {product.canonical_name}
        </p>
        {product.cheapest_store_name && (
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#94a3b8" }}>
            From {product.cheapest_store_name}
            {product.store_count > 1 ? ` + ${product.store_count - 1} more` : ""}
          </p>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          {context === "deals" && product.product_url && (
            <a
              href={product.product_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: "#16a34a", color: "#fff",
                borderRadius: 14, padding: "10px 0",
                fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
                textDecoration: "none",
              }}
            >
              Snatch Deal
            </a>
          )}

          <button
            onClick={handleAddToCart}
            style={{
              flex: context === "deals" ? 0 : 1,
              width: context === "deals" ? 44 : undefined,
              height: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: inCart ? "#16a34a" : "#fff",
              border: `1px solid ${inCart ? "#16a34a" : "#e2e8f0"}`,
              borderRadius: 14, cursor: "pointer",
              color: inCart ? "#fff" : "#1e293b",
              fontSize: context === "deals" ? undefined : 13,
              fontWeight: context === "deals" ? undefined : 600,
              gap: 6,
            }}
            title="Add to cart"
          >
            {context === "deals" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
              </svg>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
                {inCart ? "Added!" : "Add to cart"}
              </>
            )}
          </button>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid #e2e8f0", borderRadius: 14, flexShrink: 0,
            }}
            title="Share on WhatsApp"
          >
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.67 4.61 1.832 6.5L4 29l7.697-1.803A12.94 12.94 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
              <path d="M21.786 18.618c-.306-.153-1.81-.894-2.09-.994-.28-.1-.484-.153-.688.153-.204.306-.79.994-.968 1.198-.178.204-.356.23-.662.077-.306-.153-1.29-.476-2.458-1.516-.908-.81-1.522-1.81-1.7-2.116-.178-.306-.019-.47.134-.622.137-.136.306-.356.459-.535.153-.178.204-.306.306-.51.102-.204.051-.382-.025-.535-.077-.153-.688-1.658-.942-2.27-.248-.595-.5-.514-.688-.524l-.586-.01c-.204 0-.535.077-.816.382-.28.306-1.07 1.045-1.07 2.55s1.095 2.96 1.248 3.164c.153.204 2.154 3.29 5.22 4.614.73.315 1.3.503 1.744.644.733.233 1.4.2 1.927.121.588-.087 1.81-.74 2.065-1.455.255-.714.255-1.326.178-1.455-.076-.13-.28-.204-.586-.357z" fill="white"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create CatalogPage.jsx**

```jsx
import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchCatalog } from "../utils/api";
import ProductCard from "../components/ProductCard";
import NavTabs from "../components/NavTabs";

const CATEGORIES = [
  "All", "Rice & Grains", "Flours & Baking", "Lentils & Pulses",
  "Spices & Masalas", "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets",
  "Beverages", "Dairy & Paneer", "Frozen Foods", "Fresh Produce",
  "Noodles & Pasta", "Canned & Packaged", "Personal Care", "Household",
];

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);

  const q = searchParams.get("q") || "";
  const category = searchParams.get("category") || "";

  const load = useCallback(async (params, reset) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCatalog({ q: params.q, category: params.category, page: params.page, limit: 24 });
      const rows = data.data || [];
      setProducts(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(rows.length === 24);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    load({ q, category, page: 1 }, true);
  }, [q, category, load]);

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearchParams(p => { if (val) p.set("q", val); else p.delete("q"); return p; });
  };

  const handleCategory = (cat) => {
    setSearchParams(p => { if (cat && cat !== "All") p.set("category", cat); else p.delete("category"); return p; });
  };

  const handleLoadMore = () => {
    const next = page + 1;
    setPage(next);
    load({ q, category, page: next }, false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <NavTabs />

      {/* Search + filters */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "12px 16px" }}>
        <div className="max-w-2xl mx-auto">
          <input
            type="search"
            placeholder="Search products…"
            value={q}
            onChange={handleSearch}
            style={{
              width: "100%", boxSizing: "border-box",
              padding: "10px 14px", borderRadius: 14,
              border: "1px solid #e2e8f0", fontSize: 14, color: "#1e293b",
              outline: "none", marginBottom: 10,
            }}
          />
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {CATEGORIES.map(cat => {
              const active = cat === "All" ? !category : category === cat;
              return (
                <button
                  key={cat}
                  onClick={() => handleCategory(cat === "All" ? "" : cat)}
                  style={{
                    flexShrink: 0, padding: "6px 12px", borderRadius: 99, border: "none", cursor: "pointer",
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    background: active ? "#16a34a" : "#f1f5f9",
                    color: active ? "#fff" : "#64748b",
                  }}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Product grid */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {error && <p style={{ color: "#ef4444", fontSize: 14, textAlign: "center", padding: 24 }}>{error}</p>}
        {!error && products.length === 0 && !loading && (
          <p style={{ fontSize: 14, color: "#94a3b8", textAlign: "center", padding: 40 }}>No products found.</p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {products.map(p => (
            <ProductCard key={p.canonical_id} product={p} context="catalog" />
          ))}
        </div>
        {loading && (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2.5px solid #16a34a", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
          </div>
        )}
        {hasMore && !loading && (
          <button
            onClick={handleLoadMore}
            style={{
              display: "block", margin: "16px auto 0", padding: "10px 28px",
              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14,
              fontSize: 14, fontWeight: 600, color: "#16a34a", cursor: "pointer",
            }}
          >
            Load more
          </button>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

Navigate to `http://localhost:5173/products` (after adding route in Task 11). Products grid should load from `/api/v1/catalog`. Category filter chips should work. "Add to cart" button shows cart icon in catalog context.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ProductCard.jsx client/src/pages/CatalogPage.jsx
git commit -m "feat: add ProductCard component and CatalogPage (All Products browse)"
```

---

## Task 9: Comparison sub-components

**Files:**
- Create: `client/src/components/comparison/CoverageBar.jsx`
- Create: `client/src/components/comparison/MissingItemsBanner.jsx`
- Create: `client/src/components/comparison/StoreComparisonCard.jsx`

- [ ] **Step 1: Create comparison/ directory and CoverageBar**

```bash
mkdir -p client/src/components/comparison
```

`client/src/components/comparison/CoverageBar.jsx`:

```jsx
import React from "react";

export default function CoverageBar({ available, total }) {
  const pct = total > 0 ? Math.round((available / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: "#f1f5f9", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`, height: "100%",
            background: "#16a34a", borderRadius: 99,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", fontWeight: 600 }}>
        {available}/{total} items
      </span>
    </div>
  );
}
```

- [ ] **Step 2: Create MissingItemsBanner**

`client/src/components/comparison/MissingItemsBanner.jsx`:

```jsx
import React from "react";

export default function MissingItemsBanner({ count, estimatedCost }) {
  if (!count) return null;
  return (
    <div style={{
      background: "#fffbeb", border: "1px solid #fde68a",
      borderRadius: 12, padding: "10px 14px",
    }}>
      <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
        ⚠ {count} item{count !== 1 ? "s" : ""} not available
        {estimatedCost ? ` · Est. missing: ~€${Number(estimatedCost).toFixed(2)}` : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Create StoreComparisonCard**

`client/src/components/comparison/StoreComparisonCard.jsx`:

```jsx
import React, { useState, useEffect } from "react";
import CoverageBar from "./CoverageBar";
import MissingItemsBanner from "./MissingItemsBanner";
import ReplacementsModal from "../ReplacementsModal";
import { fetchReplacements, fetchSameProductOtherStores } from "../../utils/api";

export default function StoreComparisonCard({ store, onShop }) {
  const [expanded, setExpanded] = useState(false);
  const [replacingItem, setReplacingItem] = useState(null);
  const [repTiers, setRepTiers] = useState(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repOtherStores, setRepOtherStores] = useState(null);

  const {
    store_name, store_id,
    confirmed_total, estimated_total,
    coverage, items = [],
  } = store;

  const available = (coverage?.available ?? 0) + (coverage?.replaced ?? 0);
  const missing = coverage?.missing ?? 0;
  const total = coverage?.total ?? (items.length || 1);

  useEffect(() => {
    if (!replacingItem) { setRepTiers(null); setRepOtherStores(null); return; }
    setRepLoading(true);
    Promise.all([
      fetchReplacements(replacingItem.canonical_id, store_id, null),
      fetchSameProductOtherStores(replacingItem.canonical_id, store_id),
    ]).then(([repData, otherData]) => {
      setRepTiers(repData.tiers || []);
      setRepOtherStores(otherData.stores || []);
      setRepLoading(false);
    }).catch(() => {
      setRepTiers([]);
      setRepOtherStores([]);
      setRepLoading(false);
    });
  }, [replacingItem, store_id]);

  return (
    <div style={{
      background: "#fff", border: "1px solid #f1f5f9",
      borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      overflow: "hidden", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{ padding: "16px 16px 0" }}>
        {/* Store name */}
        <p style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
          {store_name}
        </p>

        {/* Totals */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 11, color: "#94a3b8" }}>Cart total</p>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1e293b" }}>
              €{Number(confirmed_total || 0).toFixed(2)}
            </p>
          </div>
          {estimated_total && Math.abs(estimated_total - confirmed_total) > 0.01 && (
            <div>
              <p style={{ margin: "0 0 2px", fontSize: 11, color: "#94a3b8" }}>Fair total</p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#64748b" }}>
                €{Number(estimated_total).toFixed(2)}
              </p>
            </div>
          )}
        </div>

        {/* Coverage */}
        <div style={{ marginBottom: 12 }}>
          <CoverageBar available={available} total={total} />
        </div>

        {/* Missing banner */}
        {missing > 0 && (
          <div style={{ marginBottom: 12 }}>
            <MissingItemsBanner count={missing} estimatedCost={store.missing_cost_est} />
          </div>
        )}

        {/* Expand toggle */}
        {items.length > 0 && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "#64748b", padding: "0 0 12px",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span>{expanded ? "▲" : "▾"}</span>
            <span>{expanded ? "Hide breakdown" : "Show full breakdown"}</span>
          </button>
        )}

        {/* Item breakdown */}
        {expanded && (
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 12, marginBottom: 12 }}>
            {items.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, padding: "6px 0",
                  borderBottom: i < items.length - 1 ? "1px solid #f8fafc" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  {item.state === "ok"       && <span style={{ color: "#16a34a", fontSize: 13 }}>✓</span>}
                  {item.state === "replaced" && <span style={{ color: "#f59e0b", fontSize: 13 }}>↔</span>}
                  {item.state === "missing"  && <span style={{ color: "#94a3b8", fontSize: 13 }}>✗</span>}
                  <p style={{
                    margin: 0, fontSize: 13, color: "#1e293b",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {item.product_name || item.canonical_name}
                  </p>
                  {item.state === "replaced" && (
                    <span style={{ fontSize: 10, color: "#f59e0b", background: "#fffbeb", padding: "1px 6px", borderRadius: 99, flexShrink: 0 }}>
                      replaced
                    </span>
                  )}
                  {item.state === "missing" && (
                    <span style={{ fontSize: 10, color: "#94a3b8", background: "#f8fafc", padding: "1px 6px", borderRadius: 99, flexShrink: 0 }}>
                      not found
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {item.price != null && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
                      €{Number(item.price).toFixed(2)}
                    </span>
                  )}
                  {(item.state === "replaced" || item.state === "missing") && item.canonical_id && (
                    <button
                      onClick={() => setReplacingItem({ canonical_id: item.canonical_id, product_name: item.product_name || item.canonical_name })}
                      style={{
                        fontSize: 11, color: "#16a34a",
                        background: "#f0fdf4", border: "1px solid #86efac",
                        borderRadius: 8, padding: "3px 8px", cursor: "pointer",
                      }}
                    >
                      Replace
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: "0 16px 16px" }}>
        <button
          onClick={() => onShop && onShop(store)}
          style={{
            width: "100%", height: 46,
            background: "#16a34a", color: "#fff", border: "none",
            borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >
          Shop at {store_name} →
        </button>
      </div>

      {/* Replacements modal */}
      {replacingItem && (
        <ReplacementsModal
          sourceDeal={{ id: null, canonical_id: replacingItem.canonical_id, product_name: replacingItem.product_name, store: { id: store_id, name: store_name } }}
          tiers={repTiers}
          loading={repLoading}
          otherStores={repOtherStores}
          isAdmin={false}
          onClose={() => setReplacingItem(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add client/src/components/comparison/
git commit -m "feat: add CoverageBar, MissingItemsBanner, StoreComparisonCard comparison components"
```

---

## Task 10: ComparePage restyle — Direction 6

**Files:**
- Modify: `client/src/pages/ComparePage.jsx`

- [ ] **Step 1: Read current ComparePage**

```bash
cat -n client/src/pages/ComparePage.jsx
```

Note the current structure — it uses `useParams` to get `id`, calls `runComparison(id)`, and renders `StoreCard` components.

- [ ] **Step 2: Replace ComparePage.jsx**

Replace the entire file with:

```jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { runComparison, cartTransfer } from "../utils/api";
import StoreComparisonCard from "../components/comparison/StoreComparisonCard";

const SORT_OPTIONS = [
  { key: "confirmed_total", label: "Best value" },
  { key: "estimated_total", label: "Confirmed" },
  { key: "coverage_pct",    label: "Coverage" },
];

function sortStores(stores, key) {
  return [...stores].sort((a, b) => {
    if (key === "coverage_pct") return (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0);
    return (a[key] ?? Infinity) - (b[key] ?? Infinity);
  });
}

export default function ComparePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("confirmed_total");
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    runComparison(id)
      .then(data => {
        const raw = data.stores || data.data || data || [];
        setStores(raw);
        if (raw[0]?.coverage?.total) setItemCount(raw[0].coverage.total);
        else if (raw[0]?.items?.length) setItemCount(raw[0].items.length);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const sorted = sortStores(stores, sort);

  const handleShop = async (store) => {
    try {
      await cartTransfer(id, store.store_id, store.items || []);
    } catch {
      // best-effort; navigate regardless
    }
    if (store.store_url) window.open(store.store_url, "_blank", "noopener");
  };

  return (
    <div style={{
      background: "radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)",
      minHeight: "100vh",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #f1f5f9",
        position: "sticky", top: 0, zIndex: 50,
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          onClick={() => navigate("/cart")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8", padding: 0 }}
        >←</button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>Compare prices</p>
          {itemCount > 0 && (
            <p style={{ margin: "1px 0 0", fontSize: 11, color: "#94a3b8" }}>
              {itemCount} item{itemCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Sort pills */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "10px 16px" }}>
        <div className="max-w-2xl mx-auto flex gap-2">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSort(opt.key)}
              style={{
                padding: "6px 14px", borderRadius: 99, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: sort === opt.key ? 700 : 500,
                background: sort === opt.key ? "#16a34a" : "#f1f5f9",
                color: sort === opt.key ? "#fff" : "#64748b",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 48, gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid #16a34a", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
            <p style={{ margin: 0, fontSize: 14, color: "#94a3b8" }}>Comparing prices…</p>
          </div>
        )}

        {error && (
          <div style={{ textAlign: "center", padding: 48 }}>
            <p style={{ fontSize: 14, color: "#ef4444", marginBottom: 16 }}>{error}</p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "10px 24px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", fontSize: 14, fontWeight: 600 }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <p style={{ fontSize: 14, color: "#94a3b8", textAlign: "center", padding: 48 }}>
            No stores found for this cart.
          </p>
        )}

        {!loading && !error && sorted.map(store => (
          <StoreComparisonCard
            key={store.store_id}
            store={store}
            onShop={handleShop}
          />
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Verify in browser**

Navigate to `http://localhost:5173/compare/<list_id>` using a real list ID from the DB:

```bash
node -e "const db=require('./server/db'); db.prepare('SELECT id FROM shopping_lists LIMIT 1').get().then(r=>console.log(r?.id))"
```

Expected: comparison cards render with store name, confirmed total, coverage bar. Sort pills reorder cards. "Show full breakdown" expands item list.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ComparePage.jsx
git commit -m "feat: restyle ComparePage with Direction 6 design (coverage bar, sort pills, expandable breakdown)"
```

---

## Task 11: App.jsx routes + DealsPage NavTabs

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/pages/DealsPage.jsx`

- [ ] **Step 1: Add new routes and redirects to App.jsx**

In `client/src/App.jsx`:

1. Add imports at the top:
```jsx
import { Navigate } from "react-router-dom";
import CartPage from "./pages/CartPage";
import CatalogPage from "./pages/CatalogPage";
```

2. Inside `<Routes>`, add after existing routes (before the catch-all `*`):
```jsx
<Route path="/cart" element={<CartPage />} />
<Route path="/compare/:id" element={<ComparePage />} />
<Route path="/products" element={<CatalogPage />} />
<Route path="/list" element={<Navigate to="/cart" replace />} />
<Route path="/list/:id/compare" element={<RedirectToCompare />} />
```

3. Add `RedirectToCompare` helper component before the main export:
```jsx
function RedirectToCompare() {
  const { id } = useParams();
  return <Navigate to={`/compare/${id}`} replace />;
}
```

4. Verify `useParams` is imported from `"react-router-dom"` (it should already be, but check).

- [ ] **Step 2: Add NavTabs to DealsPage**

In `client/src/pages/DealsPage.jsx`:

1. Import NavTabs:
```jsx
import NavTabs from "../components/NavTabs";
```

2. Find the top of the DealsPage return JSX (the outermost `<div>` or fragment). Add `<NavTabs />` as the first child inside the page container, before the existing header/search bar.

Search for the exact location:
```bash
grep -n "return (" client/src/pages/DealsPage.jsx | tail -5
```

Then read ~10 lines after that return to find the opening tag, and insert `<NavTabs />` immediately inside.

- [ ] **Step 3: Verify build and all routes**

```bash
cd client && npm run build 2>&1 | tail -10
```

Start dev server and test:
- `http://localhost:5173/` — DealsPage with NavTabs, "All Products" and "Deals" tabs visible
- `http://localhost:5173/products` — CatalogPage loads, NavTabs active on "All Products"
- `http://localhost:5173/cart` — CartPage loads
- `http://localhost:5173/list` — redirects to `/cart`
- `http://localhost:5173/list/some-id/compare` — redirects to `/compare/some-id`

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx client/src/pages/DealsPage.jsx
git commit -m "feat: add /cart, /compare/:id, /products routes; add NavTabs to DealsPage; redirect old /list routes"
```

---

## Self-Review Checklist (run before declaring done)

- [ ] `GET /api/v1/catalog/:id/brands` returns `{ data: [] }` for a valid canonical_id
- [ ] CartPage renders at `/cart` with correct Direction 2 layout (no prices)
- [ ] Qty stepper: minus greyed at qty=1, remove only via bin
- [ ] Brand picker opens when tapping brand span; closes on selection; localStorage reflects change
- [ ] "Find best price" navigates guest to `/?login=1`; logged-in user to `/compare/:id`
- [ ] `/products` shows catalog grid; search and category filter work
- [ ] `/compare/:id` shows StoreComparisonCard per store; sort pills reorder
- [ ] "Show full breakdown" expands items with ok/replaced/missing states
- [ ] "Replace" button on missing/replaced items opens ReplacementsModal bottom sheet
- [ ] "See alternatives" is absent from all deal cards on `/` and `/deals`
- [ ] `/list` and `/list/:id/compare` redirect correctly
- [ ] NavTabs highlights correct tab on each page; cart badge shows count
- [ ] `npm run build:client` passes with no errors
