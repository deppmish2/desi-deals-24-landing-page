# Remove Bookmarks / Saved Deals Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all bookmark/saved-deals code from frontend and backend; replace "Snatch Deal" button on deal cards with a full-width "Add to cart" button matching the All Products style.

**Architecture:** Pure removal + one button style change. No new routes, no new state. `CartButton` gains a `fullWidth` prop so DealsPage can use it without duplicating cart logic. `bookmarks` DB table is left intact.

**Tech Stack:** React 18, React Router v6, Express (CommonJS), Tailwind CSS, localStorage-persisted cart

---

## File Map

| File | Change |
|------|--------|
| `server/routes/bookmarks.js` | **Delete** |
| `client/src/pages/SavedDealsPage.jsx` | **Delete** |
| `server/index.js` | Remove `require` + `app.use` for bookmarks router |
| `client/src/utils/api.js` | Remove `fetchBookmarks`, `addBookmark`, `removeBookmark` |
| `client/src/App.jsx` | Remove `SavedDealsPage` lazy import + `/saved` Route |
| `client/src/components/CartButton.jsx` | Add `fullWidth` prop with text-button variant |
| `client/src/pages/DealsPage.jsx` | Remove all bookmark state/handlers/imports/UI; swap buttons |
| `client/src/pages/ProductCard.jsx` | Remove `context === "deals"` Snatch Deal conditional |

---

## Task 1: Remove backend bookmarks route

**Files:**
- Delete: `server/routes/bookmarks.js`
- Modify: `server/index.js`

- [ ] **Step 1: Delete the bookmarks route file**

```bash
rm server/routes/bookmarks.js
```

- [ ] **Step 2: Remove require + mount from server/index.js**

Find and remove these two lines in `server/index.js`:

```js
// Remove this line (around line 28):
const bookmarksRouter = require("./routes/bookmarks");

// Remove this line (around line 81):
app.use("/api/v1/bookmarks", bookmarksRouter);
```

- [ ] **Step 3: Verify server still starts**

```bash
DB_FILE=data/prod_local.db node server/index.js &
sleep 3 && curl -s http://localhost:2400/api/v1/catalog/known-brands | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok, brands:', len(d.get('data',[])))"
kill %1
```

Expected output: `ok, brands: 96` (or similar non-zero number)

- [ ] **Step 4: Verify /api/v1/bookmarks returns 404**

```bash
DB_FILE=data/prod_local.db node server/index.js &
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:2400/api/v1/bookmarks
kill %1
```

Expected: `404`

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git rm server/routes/bookmarks.js
git commit -m "feat(bookmarks): remove backend bookmarks route"
```

---

## Task 2: Remove bookmark API functions from frontend utils

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Remove the three bookmark functions**

In `client/src/utils/api.js`, delete these three functions (around lines 294–310). Keep `fetchDealById` — it is used by `DealSharePage`.

```js
// DELETE these three functions entirely:

export function fetchBookmarks() {
  // ...
}

export function addBookmark(dealId) {
  // ...
}

export function removeBookmark(dealId) {
  // ...
}
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -rn "fetchBookmarks\|addBookmark\|removeBookmark" client/src --include="*.js" --include="*.jsx"
```

Expected: 0 matches (if DealsPage imports haven't been cleaned yet, you'll see matches there — that's fine, Task 4 covers it)

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(bookmarks): remove bookmark API functions from frontend utils"
```

---

## Task 3: Remove SavedDealsPage and /saved route

**Files:**
- Delete: `client/src/pages/SavedDealsPage.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Delete SavedDealsPage**

```bash
git rm client/src/pages/SavedDealsPage.jsx
```

- [ ] **Step 2: Remove import and route from App.jsx**

In `client/src/App.jsx`, remove:

```js
// Remove this lazy import (around line 18):
const SavedDealsPage = lazy(() => import("./pages/SavedDealsPage"));

// Remove this Route (around line 116):
<Route path="/saved" element={<SavedDealsPage />} />
```

- [ ] **Step 3: Build to verify no import errors**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors referencing `SavedDealsPage`.

- [ ] **Step 4: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat(bookmarks): remove SavedDealsPage and /saved route"
```

---

## Task 4: Add fullWidth variant to CartButton

**Files:**
- Modify: `client/src/components/CartButton.jsx`

- [ ] **Step 1: Replace CartButton with fullWidth-capable version**

Replace the entire content of `client/src/components/CartButton.jsx` with:

```jsx
import React, { useContext } from "react";
import { CartContext } from "../hooks/CartContext";

export default function CartButton({ deal, fullWidth = false, className = "" }) {
  const { addItem, items } = useContext(CartContext);

  const inCart = items.some(i =>
    (deal.canonical_id && i.canonical_id === deal.canonical_id) ||
    i.raw_item_text === deal.product_name
  );

  function handleAdd(e) {
    e.preventDefault();
    e.stopPropagation();
    addItem({
      raw_item_text: deal.product_name,
      canonical_id: deal.canonical_id || null,
      quantity: deal.weight_value || null,
      quantity_unit: deal.weight_unit || null,
      item_count: 1,
    });
  }

  if (fullWidth) {
    return (
      <button
        onClick={handleAdd}
        type="button"
        aria-label={inCart ? "In cart" : "Add to cart"}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-[14px] border text-[13px] font-semibold transition-colors ${className}`}
        style={{
          height: 44,
          background: inCart ? "#16a34a" : "#fff",
          borderColor: inCart ? "#16a34a" : "#e2e8f0",
          color: inCart ? "#fff" : "#1e293b",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        {inCart ? "Added!" : "Add to cart"}
      </button>
    );
  }

  return (
    <button
      onClick={handleAdd}
      className={`shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border transition-colors ${
        inCart
          ? "bg-orange-500 border-orange-500 text-white"
          : "border-slate-200 bg-white hover:bg-orange-50 hover:border-orange-300 text-slate-500"
      } ${className}`}
      title={inCart ? "In cart" : "Add to cart"}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        {!inCart && <><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></>}
      </svg>
    </button>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd client && npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/CartButton.jsx
git commit -m "feat(cart): add fullWidth variant to CartButton"
```

---

## Task 5: Remove all bookmark code from DealsPage + swap deal card buttons

**Files:**
- Modify: `client/src/pages/DealsPage.jsx`

This is the largest task. Work section by section — find each block with `grep -n`, then remove it.

### Step 1: Remove bookmark imports

- [ ] In `client/src/pages/DealsPage.jsx`, find and remove these three imports from the `../utils/api` import block (around lines 22–30):

```js
// Remove these three lines:
  addBookmark,
  fetchBookmarks,
  removeBookmark,
```

### Step 2: Remove BookmarkIcon component

- [ ] Find and delete the `BookmarkIcon` function component (around line 182, ~16 lines):

```bash
grep -n "function BookmarkIcon" client/src/pages/DealsPage.jsx
```

Remove the entire function from `function BookmarkIcon(` through its closing `}`.

### Step 3: Remove BookmarksPanel component

- [ ] Find and delete the entire `BookmarksPanel` function component:

```bash
grep -n "function BookmarksPanel" client/src/pages/DealsPage.jsx
```

Remove from `function BookmarksPanel(` through its closing `}` (~100 lines).

### Step 4: Remove bookmark-related state (in main DealsPage component)

- [ ] Find and remove these three `useState` lines (around line 1545–1547):

```js
// Remove these three lines:
const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
const [bookmarkedDeals, setBookmarkedDeals] = useState({});
const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false);
```

### Step 5: Remove bookmarkDealId resume logic

- [ ] Find and remove the resume-state block for bookmarks (around line 1723–1730):

```bash
grep -n "bookmarkDealId" client/src/pages/DealsPage.jsx
```

Remove this block:
```js
if (resumeState.bookmarkDealId) {
  const bookmarkDealId = resumeState.bookmarkDealId;
  setBookmarkedIds((prev) => new Set(prev).add(bookmarkDealId));
  addBookmark(bookmarkDealId)
    // ... (remove the entire if-block through its closing brace)
```

### Step 6: Remove bookmarkedDeals sync effect and syncBookmarks

- [ ] Find and remove the `setBookmarkedDeals` effect (~line 1782, ~12 lines):

```bash
grep -n "Keep bookmarkedDeals map" client/src/pages/DealsPage.jsx
```

Remove the entire `useEffect` block with that comment.

- [ ] Find and remove the `syncBookmarks` `useCallback` (~line 1793–1803):

```bash
grep -n "const syncBookmarks" client/src/pages/DealsPage.jsx
```

Remove the entire `useCallback`.

- [ ] Find and remove the "Load bookmarks" `useEffect` (the one that calls `syncBookmarks`, ~line 1806–1840):

```bash
grep -n "Load bookmarks" client/src/pages/DealsPage.jsx
```

Remove the entire `useEffect` block.

### Step 7: Remove handleBookmark callback

- [ ] Find and remove the `handleBookmark` `useCallback` (around line 2039, ~55 lines):

```bash
grep -n "const handleBookmark" client/src/pages/DealsPage.jsx
```

Remove the entire `useCallback` assignment through its closing `);`.

### Step 8: Remove DealCard bookmark props (isBookmarked / onBookmark)

- [ ] In the `DealCard` function signature (around line 424–431), remove these two destructured props:

```js
// Remove these two lines from the DealCard props destructure:
  isBookmarked,
  onBookmark,
```

### Step 9: Remove /saved nav link from header

- [ ] Find and remove the `/saved` `<Link>` block (around line 2167, ~14 lines):

```bash
grep -n 'to="/saved"' client/src/pages/DealsPage.jsx
```

Remove the entire `<Link to="/saved" ...>...</Link>` element including its badge `<span>`.

### Step 10: Remove isBookmarked + onBookmark from DealCard usage site

- [ ] Find and remove these two props from where `DealCard` is instantiated (around line 2641–2642):

```bash
grep -n "isBookmarked={" client/src/pages/DealsPage.jsx
```

Remove these two lines:
```jsx
isBookmarked={bookmarkedIds.has(deal.id)}
onBookmark={handleBookmark}
```

### Step 11: Replace CartButton + Snatch Deal with fullWidth CartButton

- [ ] Find the deal card action buttons block (around line 787):

```bash
grep -n "CartButton deal={deal}" client/src/pages/DealsPage.jsx
```

Replace this block:

```jsx
<CartButton deal={deal} />
<a
  href={resolveUrl(deal, deal.product_url)}
  target="_blank"
  rel="noopener noreferrer"
  onClick={() =>
    trackAnalyticsEvent(
      "snatch_deal_click",
      buildDealAnalyticsPayload(deal, analyticsContext),
    )
  }
  className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline hover:no-underline"
  style={{ textDecoration: "none" }}
>
  <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">
    Snatch Deal
  </span>
</a>
```

With:

```jsx
<CartButton deal={deal} fullWidth />
```

### Step 12: Build and verify

- [ ] **Build the frontend**

```bash
cd client && npm run build 2>&1 | grep -E "error|warning|built" | tail -20
```

Expected: successful build with no errors.

- [ ] **Commit**

```bash
git add client/src/pages/DealsPage.jsx
git commit -m "feat(bookmarks): remove all bookmark state, handlers, and UI from DealsPage; replace Snatch Deal with Add to cart"
```

---

## Task 6: Remove Snatch Deal from ProductCard

**Files:**
- Modify: `client/src/components/ProductCard.jsx`

- [ ] **Step 1: Find and remove the Snatch Deal conditional**

```bash
grep -n "Snatch Deal\|context.*deals\|deals.*context" client/src/components/ProductCard.jsx
```

Remove this entire conditional block (around line 148–158):

```jsx
{context === "deals" && product.product_url && (
  <a
    href={product.product_url}
    target="_blank"
    rel="noopener noreferrer"
    className="flex-1 flex items-center justify-center rounded-[14px] py-2.5 text-white text-[12px] font-extrabold tracking-[0.04em] uppercase no-underline"
    style={{ background: "#16a34a" }}
  >
    Snatch Deal
  </a>
)}
```

- [ ] **Step 2: Build**

```bash
cd client && npm run build 2>&1 | grep -E "error|built" | tail -10
```

Expected: successful build.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/ProductCard.jsx
git commit -m "feat(bookmarks): remove Snatch Deal link from ProductCard"
```

---

## Task 7: Manual verification

- [ ] Start dev server: `DB_FILE=data/prod_local.db npm run dev` + `cd client && npm run dev`
- [ ] Navigate to `/deals` — no bookmark icon in header, no "Snatch Deal" button on cards, deal cards show full-width "Add to cart" / "Added!" button
- [ ] Click "Add to cart" on a deal card — button turns green with "Added!" text
- [ ] Navigate to `/saved` — returns blank/404 page (no route)
- [ ] Navigate to `/share/deal/<any-id>` — DealSharePage still works
- [ ] Check browser console — no errors referencing `fetchBookmarks`, `addBookmark`, `removeBookmark`
- [ ] Open "All products" (catalog) — `ProductCard` shows no "Snatch Deal" button, only "Add to cart"
