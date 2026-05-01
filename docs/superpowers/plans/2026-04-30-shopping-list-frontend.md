# Shopping List & Comparison Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full shopping list frontend — anonymous cart, server-side list management, cross-store comparison view, cart transfer to store, and login gate.

**Architecture:** Anonymous users build a cart in localStorage (`dd24_cart_v1`). At "compare prices", a login wall triggers; post-login, the cart merges into a server-side `shopping_list`. The comparison view calls `POST /api/v1/lists/:id/recommend` and shows stores ranked by total. Clicking "Order from Store" calls `POST /api/v1/lists/:id/cart-transfer`.

**Prerequisite:** Plan `2026-04-30-schema-and-crawl.md` complete (Mode 3 on-demand crawl must exist).

**Tech Stack:** React 18 + Tailwind CSS + React Router v6. API calls via `client/src/utils/api.js`. No frontend test framework — verify by running the dev server.

**DB:** All dev/test uses `data/prod_local.db` (`DB_FILE=data/prod_local.db`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `client/src/utils/api.js` | Modify | Add list + comparison + cart-transfer API functions |
| `client/src/hooks/useCart.js` | Create | Anonymous cart hook (localStorage `dd24_cart_v1`) |
| `client/src/hooks/useLists.js` | Create | Server-side list management hook |
| `client/src/pages/ListPage.jsx` | Create | Shopping list page `/list` |
| `client/src/pages/ComparePage.jsx` | Create | Comparison result view `/list/:id/compare` |
| `client/src/components/CartButton.jsx` | Create | "+ Cart" button on deal cards |
| `client/src/components/LoginGate.jsx` | Create | Modal login wall at "compare prices" |
| `client/src/App.jsx` | Modify | Add `/list` and `/list/:id/compare` routes |

---

### Task 1: Add list + comparison API functions to api.js

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Add functions at the end of api.js**

```js
// ── Shopping lists ──────────────────────────────────────────────────────────

export function fetchLists() {
  return authRequest("/api/v1/lists");
}

export async function createList(name) {
  return authRequest("/api/v1/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function fetchList(listId) {
  return authRequest(`/api/v1/lists/${listId}`);
}

export async function addListItem(listId, item) {
  // item: { raw_item_text, canonical_id?, quantity?, quantity_unit?, item_count?, brand_pref? }
  return authRequest(`/api/v1/lists/${listId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
}

export async function updateListItem(listId, itemId, patch) {
  return authRequest(`/api/v1/lists/${listId}/items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function removeListItem(listId, itemId) {
  return authRequest(`/api/v1/lists/${listId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export async function deleteList(listId) {
  return authRequest(`/api/v1/lists/${listId}`, { method: "DELETE" });
}

export async function mergeCartIntoList(listId, cartItems) {
  // cartItems: array of { raw_item_text, quantity?, quantity_unit?, item_count? }
  return Promise.all(cartItems.map(item => addListItem(listId, item)));
}

// ── Comparison ───────────────────────────────────────────────────────────────

export async function runComparison(listId, items) {
  // items: optional override array from localStorage cart
  return authRequest(`/api/v1/lists/${listId}/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

export async function cartTransfer(listId, storeId, items) {
  return authRequest(`/api/v1/lists/${listId}/cart-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store_id: storeId, items }),
  });
}
```

- [ ] **Step 2: Verify server is running and api.js compiles**

```bash
cd client && npm run build 2>&1 | tail -5
```
Expected: build succeeds (no import errors).

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(api): add shopping list + comparison API functions"
```

---

### Task 2: Anonymous cart hook

**Files:**
- Create: `client/src/hooks/useCart.js`

- [ ] **Step 1: Create useCart.js**

```js
import { useState, useCallback } from "react";

const CART_KEY = "dd24_cart_v1";

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

export function useCart() {
  const [items, setItems] = useState(readCart);

  const addItem = useCallback((item) => {
    // item: { raw_item_text, canonical_id?, quantity?, quantity_unit?, item_count? }
    setItems(prev => {
      // Dedupe by canonical_id or raw_item_text
      const key = item.canonical_id || item.raw_item_text.toLowerCase().trim();
      const exists = prev.find(i =>
        (i.canonical_id && i.canonical_id === item.canonical_id) ||
        i.raw_item_text.toLowerCase().trim() === key
      );
      const next = exists
        ? prev.map(i => (i === exists ? { ...i, item_count: (i.item_count || 1) + 1 } : i))
        : [...prev, { ...item, item_count: item.item_count || 1 }];
      writeCart(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((index) => {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== index);
      writeCart(next);
      return next;
    });
  }, []);

  const updateItem = useCallback((index, patch) => {
    setItems(prev => {
      const next = prev.map((item, i) => (i === index ? { ...item, ...patch } : item));
      writeCart(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    localStorage.removeItem(CART_KEY);
    setItems([]);
  }, []);

  return { items, addItem, removeItem, updateItem, clearCart, count: items.length };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useCart.js
git commit -m "feat: anonymous cart hook (localStorage dd24_cart_v1)"
```

---

### Task 3: CartButton component + wire into deal cards

**Files:**
- Create: `client/src/components/CartButton.jsx`
- Modify: `client/src/pages/DealsPage.jsx` (add CartButton to deal cards)

- [ ] **Step 1: Create CartButton.jsx**

```jsx
import React, { useContext } from "react";
import { CartContext } from "../hooks/CartContext";

export default function CartButton({ deal, className = "" }) {
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

  return (
    <button
      onClick={handleAdd}
      className={`text-xs font-semibold px-2 py-1 rounded border transition-colors ${
        inCart
          ? "bg-green-100 text-green-700 border-green-300"
          : "bg-white text-orange-600 border-orange-300 hover:bg-orange-50"
      } ${className}`}
      title={inCart ? "In cart" : "Add to cart"}
    >
      {inCart ? "✓ In cart" : "+ Cart"}
    </button>
  );
}
```

- [ ] **Step 2: Create CartContext**

Create `client/src/hooks/CartContext.js`:

```js
import { createContext } from "react";
export const CartContext = createContext({ items: [], addItem: () => {}, removeItem: () => {}, clearCart: () => {}, count: 0 });
```

- [ ] **Step 3: Wrap App in CartContext.Provider**

In `client/src/App.jsx`, import `useCart` and `CartContext`, wrap `<AppShell>`:

```jsx
import { useCart } from "./hooks/useCart";
import { CartContext } from "./hooks/CartContext";

export default function App() {
  const cart = useCart();
  return (
    <ErrorBoundary>
      <CartContext.Provider value={cart}>
        <AppShell />
      </CartContext.Provider>
    </ErrorBoundary>
  );
}
```

- [ ] **Step 4: Add CartButton to deal cards in DealsPage.jsx**

In `DealsPage.jsx`, find where the deal card action buttons render (search for "bookmark" or the deal card CTA). Add `<CartButton deal={deal} className="ml-2" />` alongside the existing bookmark button. Exact location will depend on the card component — search for `<button` near the deal card and add after it.

- [ ] **Step 5: Start dev server and verify**

```bash
cd client && npm run dev
```
Open `http://localhost:5173`. Find a deal card. Click "+ Cart". Verify it turns "✓ In cart". Check `localStorage.getItem('dd24_cart_v1')` in browser console — should show the item JSON.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/CartButton.jsx client/src/hooks/CartContext.js client/src/App.jsx client/src/pages/DealsPage.jsx
git commit -m "feat: CartButton component + anonymous cart context in App"
```

---

### Task 4: Shopping list page

**Files:**
- Create: `client/src/pages/ListPage.jsx`
- Modify: `client/src/App.jsx` (add `/list` route)

- [ ] **Step 1: Create ListPage.jsx**

```jsx
import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartContext } from "../hooks/CartContext";
import {
  getAuthSession,
  createList,
  fetchLists,
  addListItem,
  removeListItem,
  mergeCartIntoList,
} from "../utils/api";

export default function ListPage() {
  const { items: cartItems, clearCart } = useContext(CartContext);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const navigate = useNavigate();
  const session = getAuthSession();

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    fetchLists()
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.data?.length) {
          setList(data.data[0]);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleMergeCart() {
    if (!cartItems.length) return;
    setMerging(true);
    let target = list;
    if (!target) {
      const res = await createList("My Shopping List");
      const data = await res.json();
      target = data.data || data;
    }
    await mergeCartIntoList(target.id, cartItems);
    clearCart();
    const res = await fetchLists();
    const data = res.ok ? await res.json() : null;
    setList(data?.data?.[0] || target);
    setMerging(false);
  }

  async function handleRemove(itemId) {
    if (!list) return;
    await removeListItem(list.id, itemId);
    setList(l => ({ ...l, items: l.items.filter(i => i.id !== itemId) }));
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Shopping List</h1>

      {/* Anonymous cart items */}
      {cartItems.length > 0 && (
        <div className="mb-6 bg-orange-50 rounded-xl p-4">
          <p className="text-sm font-semibold text-orange-700 mb-2">
            {cartItems.length} item{cartItems.length > 1 ? "s" : ""} in your cart
          </p>
          <ul className="space-y-1 mb-3">
            {cartItems.map((item, i) => (
              <li key={i} className="text-sm text-gray-700">
                {item.raw_item_text}
                {item.quantity ? ` — ${item.quantity}${item.quantity_unit || ""}` : ""}
              </li>
            ))}
          </ul>
          {session ? (
            <button
              onClick={handleMergeCart}
              disabled={merging}
              className="bg-orange-500 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-orange-600 disabled:opacity-50"
            >
              {merging ? "Saving…" : "Save to my list"}
            </button>
          ) : (
            <p className="text-sm text-gray-600">
              <a href="/login" className="text-orange-600 font-semibold">Sign in</a> to save your list and compare prices.
            </p>
          )}
        </div>
      )}

      {/* Server-side list */}
      {list ? (
        <>
          <p className="text-sm text-gray-500 mb-3">{list.items?.length || 0} items saved</p>
          <ul className="space-y-2 mb-6">
            {(list.items || []).map(item => (
              <li key={item.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3">
                <span className="text-sm text-gray-800">
                  {item.raw_item_text}
                  {item.quantity ? ` — ${item.quantity}${item.quantity_unit || ""}` : ""}
                </span>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="text-gray-400 hover:text-red-500 text-xs ml-4"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => navigate(`/list/${list.id}/compare`)}
            className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl hover:bg-orange-600"
          >
            Compare prices across stores →
          </button>
        </>
      ) : session ? (
        <p className="text-gray-500 text-sm">No saved list yet. Add items from the deals page.</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add `/list` route to App.jsx**

```jsx
const ListPage = lazy(() => import("./pages/ListPage"));
// In Routes:
<Route path="/list" element={<ListPage />} />
```

- [ ] **Step 3: Start dev server and verify**

```bash
cd client && npm run dev
```
Navigate to `http://localhost:5173/list`. With items in localStorage cart, they should appear. Sign in and verify merge works (items disappear from orange section, appear in server list).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ListPage.jsx client/src/App.jsx
git commit -m "feat: shopping list page /list with anonymous cart and server-side list"
```

---

### Task 5: Comparison result page

**Files:**
- Create: `client/src/pages/ComparePage.jsx`
- Modify: `client/src/App.jsx` (add `/list/:id/compare` route)

- [ ] **Step 1: Create ComparePage.jsx**

```jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { runComparison, cartTransfer } from "../utils/api";

function StoreCard({ result, onOrder, ordering }) {
  const { store, confirmed_total, estimated_total, shipping_cost, coverage_pct, items } = result;
  const total = (estimated_total ?? confirmed_total ?? 0) + (shipping_cost ?? 0);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="font-bold text-gray-900">{store.name}</p>
          <p className="text-xs text-gray-500">
            {coverage_pct != null ? `${Math.round(coverage_pct * 100)}% items available` : ""}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-orange-600">€{total.toFixed(2)}</p>
          {shipping_cost > 0 && (
            <p className="text-xs text-gray-400">incl. €{shipping_cost.toFixed(2)} shipping</p>
          )}
        </div>
      </div>

      <ul className="text-xs text-gray-600 space-y-1 mb-3">
        {(items || []).slice(0, 5).map((item, i) => (
          <li key={i} className="flex justify-between">
            <span className={item.status === "estimated" ? "text-amber-600" : ""}>
              {item.name || item.raw_item_text}
              {item.status === "estimated" ? " (est.)" : ""}
            </span>
            <span>{item.price != null ? `€${item.price.toFixed(2)}` : "—"}</span>
          </li>
        ))}
        {(items || []).length > 5 && (
          <li className="text-gray-400">+{(items || []).length - 5} more items</li>
        )}
      </ul>

      <button
        onClick={() => onOrder(store.id)}
        disabled={ordering === store.id}
        className="w-full bg-orange-500 text-white font-semibold text-sm py-2 rounded-lg hover:bg-orange-600 disabled:opacity-50"
      >
        {ordering === store.id ? "Redirecting…" : `Order from ${store.name} →`}
      </button>
    </div>
  );
}

export default function ComparePage() {
  const { id: listId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ordering, setOrdering] = useState(null);
  const [sortBy, setSortBy] = useState("estimated_total");

  useEffect(() => {
    runComparison(listId)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error || "Failed to compare");
          return;
        }
        const data = await res.json();
        setResults(data);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [listId]);

  async function handleOrder(storeId) {
    setOrdering(storeId);
    try {
      const res = await cartTransfer(listId, storeId, results?.items);
      const data = await res.json();
      if (data.cart_url) {
        window.location.href = data.cart_url;
      } else {
        window.open(data.store_url || `#`, "_blank");
        setOrdering(null);
      }
    } catch {
      setOrdering(null);
    }
  }

  const sorted = [...(results?.stores || [])].sort((a, b) => {
    if (sortBy === "estimated_total") return ((a.estimated_total ?? a.confirmed_total ?? 999) + (a.shipping_cost ?? 0)) - ((b.estimated_total ?? b.confirmed_total ?? 999) + (b.shipping_cost ?? 0));
    if (sortBy === "confirmed_total") return ((a.confirmed_total ?? 999) + (a.shipping_cost ?? 0)) - ((b.confirmed_total ?? 999) + (b.shipping_cost ?? 0));
    if (sortBy === "coverage") return (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0);
    return 0;
  });

  if (loading) return <div className="p-6 text-center text-gray-500">Comparing prices…</div>;
  if (error) return <div className="p-6 text-center text-red-500">{error}</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => navigate(`/list`)} className="text-sm text-orange-600">← Back to list</button>
        <h1 className="text-xl font-bold text-gray-900">Price Comparison</h1>
      </div>

      {results?.freshness === "stale" && (
        <div className="bg-amber-50 text-amber-700 text-xs rounded-lg px-3 py-2 mb-4">
          Updating prices… results may be stale.
        </div>
      )}

      <div className="flex gap-2 mb-4 text-xs">
        {["estimated_total", "confirmed_total", "coverage"].map(opt => (
          <button
            key={opt}
            onClick={() => setSortBy(opt)}
            className={`px-3 py-1 rounded-full border font-medium ${
              sortBy === opt ? "bg-orange-500 text-white border-orange-500" : "bg-white text-gray-600 border-gray-300"
            }`}
          >
            {{ estimated_total: "Best price", confirmed_total: "Available now", coverage: "Coverage" }[opt]}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-8">No stores could price your list.</p>
      ) : (
        sorted.map(r => (
          <StoreCard key={r.store.id} result={r} onOrder={handleOrder} ordering={ordering} />
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `/list/:id/compare` route to App.jsx**

```jsx
const ComparePage = lazy(() => import("./pages/ComparePage"));
// In Routes:
<Route path="/list/:id/compare" element={<ComparePage />} />
```

- [ ] **Step 3: Start dev server and verify**

```bash
cd client && npm run dev
```
Navigate to `/list`, add items (or use saved list), click "Compare prices across stores →". Verify stores appear with prices.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ComparePage.jsx client/src/App.jsx
git commit -m "feat: comparison result page /list/:id/compare with store ranking and cart transfer"
```

---

### Task 6: Cart icon / entry point in nav

**Files:**
- Modify: `client/src/pages/DealsPage.jsx` (add cart count badge to nav or header)

- [ ] **Step 1: Add cart count badge in DealsPage.jsx header**

In `DealsPage.jsx`, find the main nav/header section. Add a cart icon with count that links to `/list`:

```jsx
import { useContext } from "react";
import { CartContext } from "../hooks/CartContext";
import { useNavigate } from "react-router-dom";

// Inside component:
const { count } = useContext(CartContext);
const navigate = useNavigate();

// In JSX, in the header area:
<button
  onClick={() => navigate("/list")}
  className="relative text-sm text-gray-700 hover:text-orange-600 font-medium"
>
  🛒 Cart
  {count > 0 && (
    <span className="absolute -top-1.5 -right-2.5 bg-orange-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
      {count}
    </span>
  )}
</button>
```

- [ ] **Step 2: Test in browser**

Add items to cart → badge shows count → click → navigates to `/list`.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/DealsPage.jsx
git commit -m "feat: cart badge in header with count, links to /list"
```

---

### Task 7: Final E2E smoke test

- [ ] **Step 1: Start dev server and backend together**

```bash
# Terminal 1:
DB_FILE=data/prod_local.db npm run dev

# Terminal 2:
cd client && npm run dev
```

- [ ] **Step 2: Test the full flow**

1. Go to `http://localhost:5173/deals`
2. Click "+ Cart" on a deal card → badge increments
3. Click 🛒 Cart → `/list` page shows item in orange section
4. If not logged in: sign in (OAuth or email)
5. After login: click "Save to my list" → item moves to server list section
6. Click "Compare prices across stores →"
7. `/list/:id/compare` loads — stores appear with prices
8. Click "Order from [Store]" → redirects to store cart URL

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -p
git commit -m "feat: shopping list + comparison frontend complete"
```
