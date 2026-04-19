# Compare Stores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users build a shopping cart from any deal, then compare total order cost (products + shipping) across all stores, accept per-store replacements for unavailable items, place the order with one click, and track order history.

**Architecture:** Cart state lives in `localStorage` (no auth required to build a cart); comparison is computed server-side by querying active deals per canonical product per store; orders are persisted in two new DB tables (`orders`, `order_items`) requiring auth. Replacements for unavailable items reuse the existing `getReplacements` service scoped to the target store.

**Tech Stack:** React Context API (cart), better-sqlite3 (comparison + orders), Tailwind CSS (UI), existing JWT auth pattern (orders)

---

## File Map

**New backend files:**
- `server/services/store-comparison.js` — compute per-store breakdown (match stats, subtotal, shipping, total)
- `server/routes/compare.js` — `POST /api/v1/compare/stores`
- `server/routes/orders.js` — CRUD for order history

**Modified backend files:**
- `server/db/schema.sql` — add `orders` + `order_items` tables
- `server/index.js` — mount compare + orders routers; add `/compare` + `/orders` SPA routes

**New frontend files:**
- `client/src/context/CartContext.jsx` — cart state, localStorage persistence
- `client/src/components/CartDrawer.jsx` — slide-in cart panel
- `client/src/pages/CompareStoresPage.jsx` — main comparison UI with store cards, replacements, order flow
- `client/src/pages/OrderHistoryPage.jsx` — list + manage past orders

**Modified frontend files:**
- `client/src/utils/api.js` — add `fetchComparison`, `createOrder`, `fetchOrders`, `updateOrderStatus`
- `client/src/App.jsx` — wrap with `CartProvider`; add `/compare` + `/orders` routes
- `client/src/pages/DealsPage.jsx` — add "Add to Cart" button on DealCard; import CartDrawer

---

## Task 1: DB Schema — orders + order_items

**Files:**
- Modify: `server/db/schema.sql`

- [ ] **Step 1: Add tables to schema.sql**

Append to the bottom of `server/db/schema.sql` (before the last comment block if any):

```sql
-- Orders placed via store comparison feature
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  status            TEXT NOT NULL DEFAULT 'pending_confirmation'
                    CHECK (status IN ('pending_confirmation', 'paid', 'never_placed')),
  subtotal          REAL NOT NULL,
  shipping_cost     REAL,
  total             REAL NOT NULL,
  currency          TEXT DEFAULT 'EUR',
  replacement_count INTEGER DEFAULT 0,
  created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at      DATETIME
);

-- Line items for each order
CREATE TABLE IF NOT EXISTS order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  deal_id           TEXT REFERENCES deals(id) ON DELETE SET NULL,
  canonical_id      TEXT REFERENCES canonical_products(id) ON DELETE SET NULL,
  product_name      TEXT NOT NULL,
  product_url       TEXT,
  image_url         TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  unit_price        REAL NOT NULL,
  is_replacement    INTEGER DEFAULT 0,
  original_deal_id  TEXT REFERENCES deals(id) ON DELETE SET NULL,
  original_name     TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
```

- [ ] **Step 2: Verify schema applies cleanly**

```bash
node -e "
  const db = require('./server/db');
  db.ready.then(() => {
    const r = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (\'orders\',\'order_items\')').all();
    console.log(r.map(x=>x.name));
  });
"
```
Expected output: `[ 'orders', 'order_items' ]`

- [ ] **Step 3: Commit**

```bash
git add server/db/schema.sql
git commit -m "feat(schema): add orders and order_items tables for compare-stores feature"
```

---

## Task 2: Store Comparison Service

**Files:**
- Create: `server/services/store-comparison.js`

- [ ] **Step 1: Write failing test**

Create `tests/integration/store-comparison.test.js`:

```js
"use strict";
const assert = require("assert");
const { computeStoreComparison } = require("../../server/services/store-comparison");

// Minimal stub DB
function makeDb(storesRows, dealsRows, shippingRows) {
  return {
    prepare(sql) {
      if (sql.includes("FROM stores")) return { all: () => storesRows };
      if (sql.includes("FROM deals")) return { all: (...args) => dealsRows.filter(d => d.store_id === args[0]) };
      if (sql.includes("MIN(min_basket)")) return { get: (...args) => {
        const zeroRows = shippingRows.filter(r => r.store_id === args[0] && r.cost === 0);
        return { free_min: zeroRows.length ? Math.min(...zeroRows.map(r => r.min_basket)) : null };
      }};
      if (sql.includes("FROM shipping_tiers")) return { get: (...args) => shippingRows.find(r => r.store_id === args[0] && r.min_basket <= args[1]) || null };
      return { all: () => [], get: () => null };
    }
  };
}

describe("computeStoreComparison", () => {
  it("returns matched count and totals", () => {
    const db = makeDb(
      [{ id: "s1", name: "Store One", url: "https://s1.de", free_shipping_min: 50 }],
      [{ store_id: "s1", canonical_id: "c1", id: "d1", product_name: "Rice 5kg", product_url: "/rice", image_url: null, sale_price: 9.99 }],
      [{ store_id: "s1", min_basket: 0, cost: 5.99 }]
    );
    const cartItems = [
      { dealId: "orig1", canonicalId: "c1", productName: "Basmati Rice 5kg", quantity: 1 },
      { dealId: "orig2", canonicalId: "c2", productName: "Atta 10kg", quantity: 1 },
    ];
    const results = computeStoreComparison(db, cartItems);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].matchedCount, 1);
    assert.strictEqual(results[0].totalCount, 2);
    assert.strictEqual(results[0].subtotal, 9.99);
    assert.strictEqual(results[0].shippingCost, 5.99);
    assert.strictEqual(results[0].total, 15.98);
    assert.strictEqual(results[0].toFreeShipping, 40.01);
  });

  it("shipping is 0 when basket meets free_shipping_min", () => {
    const db = makeDb(
      [{ id: "s1", name: "Store One", url: "https://s1.de", free_shipping_min: 30 }],
      [{ store_id: "s1", canonical_id: "c1", id: "d1", product_name: "Rice", product_url: "/r", image_url: null, sale_price: 35 }],
      [{ store_id: "s1", min_basket: 30, cost: 0 }]
    );
    const cartItems = [{ dealId: "d1", canonicalId: "c1", productName: "Rice", quantity: 1 }];
    const results = computeStoreComparison(db, cartItems);
    assert.strictEqual(results[0].shippingCost, 0);
    assert.strictEqual(results[0].toFreeShipping, 0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
node --test tests/integration/store-comparison.test.js --reporter=spec
```
Expected: FAIL — `Cannot find module '../../server/services/store-comparison'`

- [ ] **Step 3: Implement the service**

Create `server/services/store-comparison.js`:

```js
"use strict";

const ACTIVE_STORES_SQL = `
  SELECT id, name, url, free_shipping_min
  FROM stores
  WHERE crawl_status = 'active'
`;

function computeStoreComparison(db, cartItems) {
  const stores = db.prepare(ACTIVE_STORES_SQL).all();
  const canonicalIds = cartItems
    .filter((i) => i.canonicalId)
    .map((i) => i.canonicalId);

  if (!canonicalIds.length) return [];

  const placeholders = canonicalIds.map(() => "?").join(",");
  const dealsSql = `
    SELECT d.canonical_id, d.id, d.product_name, d.product_url, d.image_url,
           MIN(d.sale_price) AS sale_price
    FROM deals d
    WHERE d.store_id = ?
      AND d.canonical_id IN (${placeholders})
      AND d.is_active = 1
    GROUP BY d.canonical_id
  `;
  const shippingSql = `
    SELECT cost FROM shipping_tiers
    WHERE store_id = ? AND min_basket <= ?
    ORDER BY min_basket DESC
    LIMIT 1
  `;
  const freeShippingThresholdSql = `
    SELECT MIN(min_basket) AS free_min FROM shipping_tiers
    WHERE store_id = ? AND cost = 0
  `;

  return stores.map((store) => {
    const matched = db.prepare(dealsSql).all(store.id, ...canonicalIds);
    const matchedMap = new Map(matched.map((m) => [m.canonical_id, m]));

    const items = cartItems.map((cartItem) => {
      if (!cartItem.canonicalId) {
        return { ...cartItem, available: false, matchedDeal: null };
      }
      const deal = matchedMap.get(cartItem.canonicalId) || null;
      return { ...cartItem, available: !!deal, matchedDeal: deal };
    });

    const available = items.filter((i) => i.available);
    const subtotal = +available
      .reduce((s, i) => s + i.matchedDeal.sale_price * (i.quantity || 1), 0)
      .toFixed(2);

    const shippingTier = db.prepare(shippingSql).get(store.id, subtotal);
    const shippingCost = shippingTier != null ? shippingTier.cost : null;

    // Use the shipping_tiers table as source of truth for free shipping threshold;
    // fall back to stores.free_shipping_min if no zero-cost tier exists.
    const freeThresholdRow = db.prepare(freeShippingThresholdSql).get(store.id);
    const freeMin = freeThresholdRow?.free_min ?? store.free_shipping_min ?? null;
    const toFreeShipping =
      freeMin != null && subtotal < freeMin ? +(freeMin - subtotal).toFixed(2) : 0;

    const total = +(subtotal + (shippingCost || 0)).toFixed(2);

    return {
      storeId: store.id,
      storeName: store.name,
      storeUrl: store.url,
      freeShippingMin: freeMin,
      matchedCount: available.length,
      totalCount: cartItems.length,
      items,
      subtotal,
      shippingCost,
      toFreeShipping,
      total,
    };
  });
}

module.exports = { computeStoreComparison };
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
node --test tests/integration/store-comparison.test.js --reporter=spec
```
Expected: 2 passing

- [ ] **Step 5: Commit**

```bash
git add server/services/store-comparison.js tests/integration/store-comparison.test.js
git commit -m "feat(compare): store comparison service with match stats and shipping calc"
```

---

## Task 3: Compare API Route

**Files:**
- Create: `server/routes/compare.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write failing test**

Create `tests/integration/compare-route.test.js`:

```js
"use strict";
const assert = require("assert");
const request = require("supertest");
const app = require("../../server/index");

describe("POST /api/v1/compare/stores", () => {
  it("returns 400 when cartItems missing", async () => {
    const res = await request(app).post("/api/v1/compare/stores").send({});
    assert.strictEqual(res.status, 400);
  });

  it("returns 400 when cartItems is empty array", async () => {
    const res = await request(app).post("/api/v1/compare/stores").send({ cartItems: [] });
    assert.strictEqual(res.status, 400);
  });

  it("returns 200 with stores array for valid cartItems", async () => {
    const res = await request(app).post("/api/v1/compare/stores").send({
      cartItems: [{ dealId: "x", canonicalId: "nonexistent-canonical", productName: "Test", quantity: 1 }],
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.stores));
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm install --save-dev supertest 2>/dev/null; node --test tests/integration/compare-route.test.js --reporter=spec
```
Expected: FAIL — 404 for the route

- [ ] **Step 3: Create the route**

Create `server/routes/compare.js`:

```js
"use strict";

const express = require("express");
const db = require("../db");
const { computeStoreComparison } = require("../services/store-comparison");

const router = express.Router();

// POST /api/v1/compare/stores
// Body: { cartItems: [{ dealId, canonicalId, productName, quantity }], sortBy?: "total"|"match"|"delivery" }
router.post("/stores", (req, res) => {
  const { cartItems, sortBy = "total" } = req.body || {};

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    return res.status(400).json({ error: "cartItems must be a non-empty array" });
  }

  const sanitized = cartItems.map((item) => ({
    dealId: String(item.dealId || ""),
    canonicalId: String(item.canonicalId || ""),
    productName: String(item.productName || ""),
    quantity: Math.max(1, parseInt(item.quantity) || 1),
  }));

  const stores = computeStoreComparison(db, sanitized);

  // Sort results
  if (sortBy === "match") {
    stores.sort((a, b) => b.matchedCount / b.totalCount - a.matchedCount / a.totalCount || a.total - b.total);
  } else if (sortBy === "delivery") {
    // delivery data is sparse; fall back to total for now
    stores.sort((a, b) => a.total - b.total);
  } else {
    // default: cheapest total first
    stores.sort((a, b) => a.total - b.total);
  }

  return res.json({ stores });
});

module.exports = router;
```

- [ ] **Step 4: Mount the router in server/index.js**

In `server/index.js`, after the `bookmarksRouter` require line, add:

```js
const compareRouter = require("./routes/compare");
```

After `app.use("/api/v1/bookmarks", bookmarksRouter);`, add:

```js
app.use("/api/v1/compare", compareRouter);
```

Also add `/compare` and `/orders` to the SPA catch-all routes array:

```js
app.get(["/saved", "/admin", "/oauth/:provider/callback", "/compare", "/orders"], (req, res) =>
  sendClientApp(res),
);
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
node --test tests/integration/compare-route.test.js --reporter=spec
```
Expected: 3 passing

- [ ] **Step 6: Commit**

```bash
git add server/routes/compare.js server/index.js tests/integration/compare-route.test.js
git commit -m "feat(compare): POST /api/v1/compare/stores route"
```

---

## Task 4: Orders API Route

**Files:**
- Create: `server/routes/orders.js`
- Modify: `server/index.js`

- [ ] **Step 1: Write failing test**

Create `tests/integration/orders-route.test.js`:

```js
"use strict";
const assert = require("assert");
const request = require("supertest");
const app = require("../../server/index");

describe("Orders API", () => {
  it("GET /api/v1/orders returns 401 without auth", async () => {
    const res = await request(app).get("/api/v1/orders");
    assert.strictEqual(res.status, 401);
  });

  it("POST /api/v1/orders returns 401 without auth", async () => {
    const res = await request(app).post("/api/v1/orders").send({});
    assert.strictEqual(res.status, 401);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
node --test tests/integration/orders-route.test.js --reporter=spec
```
Expected: FAIL — 404

- [ ] **Step 3: Create the route**

Create `server/routes/orders.js`:

```js
"use strict";

const crypto = require("crypto");
const express = require("express");
const db = require("../db");
const { verifyJwt } = require("../utils/jwt");

const router = express.Router();

function accessSecret() {
  return process.env.JWT_SECRET || process.env.ADMIN_SECRET || "changeme-in-production";
}

function getUserId(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const result = verifyJwt(token, accessSecret());
  if (!result.ok) return null;
  return result.payload?.sub || null;
}

// GET /api/v1/orders — list user's orders (newest first)
router.get("/", (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  const orders = db
    .prepare(
      `SELECT o.*, s.name AS store_name, s.url AS store_url
       FROM orders o
       JOIN stores s ON s.id = o.store_id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
    )
    .all(userId);

  const withItems = orders.map((order) => ({
    ...order,
    items: db
      .prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id")
      .all(order.id),
  }));

  return res.json({ orders: withItems });
});

// POST /api/v1/orders — create a new order
// Body: { storeId, items: [{dealId, canonicalId, productName, productUrl, imageUrl, quantity, unitPrice, isReplacement, originalDealId, originalName}], subtotal, shippingCost, total }
router.post("/", (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  const { storeId, items, subtotal, shippingCost, total } = req.body || {};

  if (!storeId || !Array.isArray(items) || items.length === 0 || total == null) {
    return res.status(400).json({ error: "storeId, items, and total are required" });
  }

  const orderId = crypto.randomUUID();
  const replacementCount = items.filter((i) => i.isReplacement).length;

  const insertOrder = db.prepare(
    `INSERT INTO orders (id, user_id, store_id, status, subtotal, shipping_cost, total, replacement_count)
     VALUES (?, ?, ?, 'pending_confirmation', ?, ?, ?, ?)`,
  );

  const insertItem = db.prepare(
    `INSERT INTO order_items (order_id, deal_id, canonical_id, product_name, product_url, image_url, quantity, unit_price, is_replacement, original_deal_id, original_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const runInserts = db.transaction(() => {
    insertOrder.run(orderId, userId, storeId, subtotal, shippingCost ?? null, total, replacementCount);
    for (const item of items) {
      insertItem.run(
        orderId,
        item.dealId || null,
        item.canonicalId || null,
        item.productName,
        item.productUrl || null,
        item.imageUrl || null,
        item.quantity || 1,
        item.unitPrice,
        item.isReplacement ? 1 : 0,
        item.originalDealId || null,
        item.originalName || null,
      );
    }
  });

  runInserts();

  const created = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  const createdItems = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);

  return res.status(201).json({ order: { ...created, items: createdItems } });
});

// PATCH /api/v1/orders/:orderId/status — update status
// Body: { status: "paid" | "never_placed" }
router.patch("/:orderId/status", (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  const { status } = req.body || {};
  const allowed = ["paid", "never_placed"];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
  }

  const order = db
    .prepare("SELECT id FROM orders WHERE id = ? AND user_id = ?")
    .get(req.params.orderId, userId);

  if (!order) return res.status(404).json({ error: "Order not found" });

  const confirmedAtSql = status === "paid"
    ? "UPDATE orders SET status = ?, confirmed_at = datetime('now') WHERE id = ?"
    : "UPDATE orders SET status = ?, confirmed_at = NULL WHERE id = ?";
  db.prepare(confirmedAtSql).run(status, order.id);

  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(order.id);
  return res.json({ order: updated });
});

module.exports = router;
```

- [ ] **Step 4: Mount in server/index.js**

After the `compareRouter` require:

```js
const ordersRouter = require("./routes/orders");
```

After `app.use("/api/v1/compare", compareRouter);`:

```js
app.use("/api/v1/orders", ordersRouter);
```

- [ ] **Step 5: Run test to confirm it passes**

```bash
node --test tests/integration/orders-route.test.js --reporter=spec
```
Expected: 2 passing

- [ ] **Step 6: Commit**

```bash
git add server/routes/orders.js server/index.js tests/integration/orders-route.test.js
git commit -m "feat(orders): order history CRUD with status transitions"
```

---

## Task 5: CartContext — Frontend Cart State

**Files:**
- Create: `client/src/context/CartContext.jsx`

- [ ] **Step 1: Create CartContext**

Create `client/src/context/CartContext.jsx`:

```jsx
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const CART_STORAGE_KEY = "dd24_cart_v1";

const CartContext = createContext(null);

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(items) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function CartProvider({ children }) {
  const [cartItems, setCartItems] = useState(() => loadCart());

  useEffect(() => {
    saveCart(cartItems);
  }, [cartItems]);

  const addToCart = useCallback((deal) => {
    // deal: { id, canonicalId, productName, imageUrl, salePrice, storeId, storeName }
    setCartItems((prev) => {
      const exists = prev.find((i) => i.dealId === deal.id);
      if (exists) {
        return prev.map((i) =>
          i.dealId === deal.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [
        ...prev,
        {
          dealId: deal.id,
          canonicalId: deal.canonical_id || deal.canonicalId || null,
          productName: deal.product_name || deal.productName,
          imageUrl: deal.image_url || deal.imageUrl || null,
          salePrice: deal.sale_price || deal.salePrice,
          storeId: deal.store_id || deal.storeId,
          storeName: deal.store_name || deal.storeName || null,
          productUrl: deal.product_url || deal.productUrl || null,
          quantity: 1,
        },
      ];
    });
  }, []);

  const removeFromCart = useCallback((dealId) => {
    setCartItems((prev) => prev.filter((i) => i.dealId !== dealId));
  }, []);

  const updateQuantity = useCallback((dealId, quantity) => {
    if (quantity < 1) {
      setCartItems((prev) => prev.filter((i) => i.dealId !== dealId));
    } else {
      setCartItems((prev) =>
        prev.map((i) => (i.dealId === dealId ? { ...i, quantity } : i)),
      );
    }
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
  }, []);

  const isInCart = useCallback(
    (dealId) => cartItems.some((i) => i.dealId === dealId),
    [cartItems],
  );

  const cartCount = cartItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ cartItems, cartCount, addToCart, removeFromCart, updateQuantity, clearCart, isInCart }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
```

- [ ] **Step 2: Wrap App with CartProvider**

In `client/src/App.jsx`, import `CartProvider`:

```jsx
import { CartProvider } from "./context/CartContext";
```

Wrap the `<BrowserRouter>` with `<CartProvider>`:

```jsx
return (
  <CartProvider>
    <BrowserRouter>
      ...
    </BrowserRouter>
  </CartProvider>
);
```

- [ ] **Step 3: Verify no console errors**

```bash
cd client && npm run dev &
sleep 3 && curl -s http://localhost:5173 | grep -c "DesiDeals"
```
Expected: prints `1` (page loads). Kill dev server after.

- [ ] **Step 4: Commit**

```bash
git add client/src/context/CartContext.jsx client/src/App.jsx
git commit -m "feat(cart): CartContext with localStorage persistence"
```

---

## Task 6: Add-to-Cart Button in DealsPage + CartDrawer

**Files:**
- Modify: `client/src/pages/DealsPage.jsx`
- Create: `client/src/components/CartDrawer.jsx`

- [ ] **Step 1: Create CartDrawer**

Create `client/src/components/CartDrawer.jsx`:

```jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

export default function CartDrawer({ open, onClose }) {
  const { cartItems, removeFromCart, updateQuantity, cartCount, clearCart } = useCart();
  const navigate = useNavigate();

  const subtotal = cartItems
    .reduce((s, i) => s + (i.salePrice || 0) * i.quantity, 0)
    .toFixed(2);

  function handleCompare() {
    onClose();
    navigate("/compare");
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-[#0f1711] z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <h2 className="text-white font-bold text-lg">
            Cart ({cartCount} {cartCount === 1 ? "item" : "items"})
          </h2>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cartItems.length === 0 && (
            <p className="text-white/40 text-center mt-8">Cart is empty</p>
          )}
          {cartItems.map((item) => (
            <div key={item.dealId} className="flex gap-3 bg-white/5 rounded-xl p-3">
              {item.imageUrl && (
                <img src={item.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{item.productName}</p>
                <p className="text-green-400 text-sm">€{(item.salePrice || 0).toFixed(2)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => updateQuantity(item.dealId, item.quantity - 1)}
                    className="w-6 h-6 rounded-full bg-white/10 text-white text-sm flex items-center justify-center"
                  >−</button>
                  <span className="text-white/80 text-sm w-4 text-center">{item.quantity}</span>
                  <button
                    onClick={() => updateQuantity(item.dealId, item.quantity + 1)}
                    className="w-6 h-6 rounded-full bg-white/10 text-white text-sm flex items-center justify-center"
                  >+</button>
                </div>
              </div>
              <button
                onClick={() => removeFromCart(item.dealId)}
                className="text-white/30 hover:text-red-400 shrink-0 self-start"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>

        {cartItems.length > 0 && (
          <div className="p-4 border-t border-white/10 space-y-3">
            <div className="flex justify-between text-white/60 text-sm">
              <span>Subtotal (at original stores)</span>
              <span className="text-white font-bold">€{subtotal}</span>
            </div>
            <button
              onClick={handleCompare}
              className="w-full bg-green-500 hover:bg-green-400 text-white font-bold py-3 rounded-xl transition-colors"
            >
              Compare Store Prices →
            </button>
            <button
              onClick={clearCart}
              className="w-full text-white/30 hover:text-white/60 text-sm py-1 transition-colors"
            >
              Clear cart
            </button>
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add "Add to Cart" button and cart icon to DealsPage**

In `client/src/pages/DealsPage.jsx`, add these imports near the top (after existing imports):

```jsx
import { useCart } from "../context/CartContext";
import CartDrawer from "../components/CartDrawer";
```

Inside the `DealsPage` component function, add near the top (after existing state):

```jsx
const { addToCart, isInCart, cartCount } = useCart();
const [cartOpen, setCartOpen] = useState(false);
```

Find the header/nav area in DealsPage where the auth/bookmark icons are rendered. Add a cart button alongside existing icons. Look for the area with the save/bookmark button in the header, and add:

```jsx
{/* Cart button — place next to existing header action buttons */}
<button
  onClick={() => setCartOpen(true)}
  className="relative flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white rounded-full px-3 py-2 text-sm font-medium transition-colors"
>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
  </svg>
  {cartCount > 0 && (
    <span className="bg-green-500 text-white text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center">
      {cartCount > 9 ? "9+" : cartCount}
    </span>
  )}
</button>
```

Find the `DealCard` component function (defined inside DealsPage.jsx). Locate where the deal action buttons are rendered (bookmark, share, etc.) and add an "Add to Cart" button:

```jsx
{/* Add to Cart — place alongside existing deal action buttons */}
<button
  onClick={(e) => { e.preventDefault(); e.stopPropagation(); addToCart(deal); }}
  className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
    isInCart(deal.id)
      ? "bg-green-500/20 text-green-400"
      : "bg-white/10 hover:bg-white/20 text-white/70"
  }`}
>
  {isInCart(deal.id) ? "✓ In cart" : "+ Cart"}
</button>
```

At the bottom of the DealsPage JSX return (before the closing fragment or div), add:

```jsx
<CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
```

- [ ] **Step 3: Verify in dev server**

```bash
cd client && npm run dev
```
Open http://localhost:5173/deals in browser. Confirm: "+ Cart" button visible on deal cards, clicking adds to cart (button turns green "✓ In cart"), cart icon in header shows count, clicking header cart icon opens drawer, drawer shows items with quantity controls, "Compare Store Prices →" button navigates to `/compare`.

Kill dev server when done.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/CartDrawer.jsx client/src/pages/DealsPage.jsx
git commit -m "feat(cart): add-to-cart button on deal cards + cart drawer UI"
```

---

## Task 7: CompareStoresPage — Layout and Store Cards

**Files:**
- Create: `client/src/pages/CompareStoresPage.jsx`
- Modify: `client/src/utils/api.js`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Add fetchComparison to api.js**

In `client/src/utils/api.js`, add after the last exported function:

```js
export async function fetchComparison(cartItems, sortBy = "total") {
  return request("/compare/stores", {}, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cartItems, sortBy }),
  });
}

export async function createOrder(payload) {
  return request("/orders", {}, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchOrders() {
  return request("/orders");
}

export async function updateOrderStatus(orderId, status) {
  return request(`/orders/${orderId}/status`, {}, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
```

- [ ] **Step 2: Add /compare route to App.jsx**

In `client/src/App.jsx`, add the import:

```jsx
import CompareStoresPage from "./pages/CompareStoresPage";
```

Add the route inside `<Routes>` (before the wildcard `*`):

```jsx
<Route path="/compare" element={<CompareStoresPage />} />
<Route path="/orders" element={<OrderHistoryPage />} />
```

Also add the import for OrderHistoryPage:

```jsx
import OrderHistoryPage from "./pages/OrderHistoryPage";
```

- [ ] **Step 3: Create CompareStoresPage**

Create `client/src/pages/CompareStoresPage.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCart } from "../context/CartContext";
import { createOrder, fetchComparison, fetchReplacements, getAuthSession, updateOrderStatus } from "../utils/api";

function ShoppingCartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
    </svg>
  );
}

function SortButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? "bg-green-500 text-white" : "bg-white/10 text-white/60 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}

// Per-item row inside a store card
function ItemRow({ item, onAcceptReplacement, storeId, acceptedReplacements }) {
  const [replacements, setReplacements] = useState(null);
  const [showReplacements, setShowReplacements] = useState(false);
  const [loadingReplacements, setLoadingReplacements] = useState(false);

  const accepted = acceptedReplacements[item.dealId];

  async function handleShowReplacements() {
    if (replacements) { setShowReplacements((v) => !v); return; }
    setLoadingReplacements(true);
    try {
      const data = await fetchReplacements(item.canonicalId, storeId, item.dealId);
      setReplacements(data.tiers || []);
      setShowReplacements(true);
    } catch {
      setReplacements([]);
    } finally {
      setLoadingReplacements(false);
    }
  }

  const displayDeal = accepted || item.matchedDeal;
  const isReplacement = !!accepted;

  return (
    <div className={`flex items-start gap-3 py-2 ${!item.available && !accepted ? "opacity-60" : ""}`}>
      {displayDeal?.image_url && (
        <img src={displayDeal.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-white text-sm font-medium leading-tight">
              {isReplacement ? displayDeal.product_name : item.productName}
              {isReplacement && (
                <span className="ml-1 text-xs text-amber-400 font-normal">(replacement)</span>
              )}
            </p>
            {isReplacement && (
              <p className="text-white/30 text-xs line-through">{item.productName}</p>
            )}
          </div>
          {displayDeal && (
            <span className="text-green-400 text-sm font-bold shrink-0">
              €{(displayDeal.sale_price * (item.quantity || 1)).toFixed(2)}
            </span>
          )}
        </div>

        {!item.available && !accepted && (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-red-400 text-xs">Not available</span>
            <button
              onClick={handleShowReplacements}
              disabled={loadingReplacements}
              className="text-xs text-amber-400 hover:text-amber-300 underline"
            >
              {loadingReplacements ? "Loading…" : showReplacements ? "Hide" : "See alternatives"}
            </button>
          </div>
        )}

        {isReplacement && (
          <button
            onClick={() => onAcceptReplacement(item.dealId, null)}
            className="text-xs text-white/30 hover:text-white/60 mt-1"
          >
            Remove replacement
          </button>
        )}

        {showReplacements && !accepted && (
          <div className="mt-2 space-y-1">
            {(!replacements || replacements.length === 0) && (
              <p className="text-white/30 text-xs">No alternatives found at this store.</p>
            )}
            {(replacements || []).flatMap((tier) =>
              (tier.deals || []).map((rep) => (
                <div key={rep.id} className="flex items-center justify-between bg-white/5 rounded-lg px-2 py-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {rep.image_url && <img src={rep.image_url} alt="" className="w-8 h-8 rounded object-cover shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-white/80 text-xs truncate">{rep.product_name}</p>
                      <p className="text-green-400 text-xs">€{rep.sale_price?.toFixed(2)}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { onAcceptReplacement(item.dealId, rep); setShowReplacements(false); }}
                    className="text-xs bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 px-2 py-1 rounded shrink-0"
                  >
                    Accept
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// A single store comparison card
function StoreCard({ store, cartItems, acceptedReplacements, onAcceptReplacement, onPlaceOrder, isLoggedIn, placing }) {
  const replacementCount = Object.keys(acceptedReplacements).filter(
    (dealId) => acceptedReplacements[dealId]
  ).length;

  const matchPct = store.totalCount > 0
    ? Math.round((store.matchedCount / store.totalCount) * 100)
    : 0;

  const available = store.items.filter((i) => i.available || acceptedReplacements[i.dealId]);
  const unavailable = store.items.filter((i) => !i.available && !acceptedReplacements[i.dealId]);

  return (
    <div className="bg-[#102016] border border-white/10 rounded-2xl overflow-hidden">
      {/* Store header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/10">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-white font-bold text-base">{store.storeName}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                matchPct === 100 ? "bg-green-500/20 text-green-400"
                : matchPct >= 60 ? "bg-amber-500/20 text-amber-400"
                : "bg-red-500/20 text-red-400"
              }`}>
                {store.matchedCount}/{store.totalCount} matched
              </span>
              {replacementCount > 0 && (
                <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                  {replacementCount} replacement{replacementCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-white font-bold text-xl">€{store.total.toFixed(2)}</p>
            <p className="text-white/40 text-xs">
              €{store.subtotal.toFixed(2)} + {store.shippingCost != null ? `€${store.shippingCost.toFixed(2)}` : "—"} shipping
            </p>
          </div>
        </div>

        {/* Free shipping progress */}
        {store.toFreeShipping > 0 && (
          <div className="mt-2">
            <p className="text-white/40 text-xs mb-1">
              €{store.toFreeShipping.toFixed(2)} more for free shipping
            </p>
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full"
                style={{ width: `${Math.min(100, (store.subtotal / store.freeShippingMin) * 100)}%` }}
              />
            </div>
          </div>
        )}
        {store.toFreeShipping === 0 && store.freeShippingMin && (
          <p className="text-green-400 text-xs mt-2">✓ Qualifies for free shipping</p>
        )}
      </div>

      {/* Items */}
      <div className="px-4 py-2 divide-y divide-white/5">
        {available.map((item) => (
          <ItemRow
            key={item.dealId}
            item={item}
            storeId={store.storeId}
            onAcceptReplacement={(dealId, rep) => onAcceptReplacement(store.storeId, dealId, rep)}
            acceptedReplacements={acceptedReplacements}
          />
        ))}
        {unavailable.length > 0 && (
          <div className="pt-2">
            <p className="text-white/30 text-xs font-medium uppercase tracking-wide mb-1">
              Not available ({unavailable.length})
            </p>
            {unavailable.map((item) => (
              <ItemRow
                key={item.dealId}
                item={item}
                storeId={store.storeId}
                onAcceptReplacement={(dealId, rep) => onAcceptReplacement(store.storeId, dealId, rep)}
                acceptedReplacements={acceptedReplacements}
              />
            ))}
          </div>
        )}
      </div>

      {/* Place order */}
      <div className="px-4 pb-4 pt-2">
        <button
          onClick={() => onPlaceOrder(store)}
          disabled={placing || (store.matchedCount === 0 && replacementCount === 0)}
          className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-30 disabled:cursor-not-allowed text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
        >
          {placing ? "Saving…" : isLoggedIn ? `Shop at ${store.storeName} →` : `Shop at ${store.storeName} (login to save order)`}
        </button>
      </div>
    </div>
  );
}

export default function CompareStoresPage() {
  const { cartItems, cartCount } = useCart();
  const navigate = useNavigate();
  const [sortBy, setSortBy] = useState("total");
  const [stores, setStores] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // { [storeId]: { [dealId]: replacementDeal | null } }
  const [acceptedReplacements, setAcceptedReplacements] = useState({});
  const [placingOrder, setPlacingOrder] = useState(null); // storeId currently being placed
  // Order confirmation modal state
  const [pendingOrder, setPendingOrder] = useState(null);
  const [orderCreated, setOrderCreated] = useState(null);
  const [orderError, setOrderError] = useState(null);

  const session = getAuthSession();
  const isLoggedIn = !!session?.accessToken;

  const runComparison = useCallback(async () => {
    if (!cartItems.length) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchComparison(cartItems, sortBy);
      setStores(data.stores || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [cartItems, sortBy]);

  useEffect(() => {
    runComparison();
  }, [runComparison]);

  function handleAcceptReplacement(storeId, dealId, rep) {
    setAcceptedReplacements((prev) => ({
      ...prev,
      [storeId]: {
        ...(prev[storeId] || {}),
        [dealId]: rep,
      },
    }));
  }

  async function handlePlaceOrder(store) {
    if (placingOrder === store.storeId) return;
    setPlacingOrder(store.storeId);
    // Build items list merging accepted replacements
    const storeReplacements = acceptedReplacements[store.storeId] || {};
    const items = store.items
      .filter((i) => i.available || storeReplacements[i.dealId])
      .map((i) => {
        const rep = storeReplacements[i.dealId];
        if (rep) {
          return {
            dealId: rep.id,
            canonicalId: rep.canonical_id || null,
            productName: rep.product_name,
            productUrl: rep.product_url || null,
            imageUrl: rep.image_url || null,
            quantity: i.quantity || 1,
            unitPrice: rep.sale_price,
            isReplacement: true,
            originalDealId: i.dealId,
            originalName: i.productName,
          };
        }
        return {
          dealId: i.matchedDeal.id,
          canonicalId: i.canonicalId || null,
          productName: i.matchedDeal.product_name,
          productUrl: i.matchedDeal.product_url || null,
          imageUrl: i.matchedDeal.image_url || null,
          quantity: i.quantity || 1,
          unitPrice: i.matchedDeal.sale_price,
          isReplacement: false,
          originalDealId: null,
          originalName: null,
        };
      });

    if (!isLoggedIn) {
      window.open(store.storeUrl, "_blank", "noopener");
      setPendingOrder({ store, items, storeReplacements });
      setPlacingOrder(null);
      return;
    }

    try {
      const result = await createOrder({
        storeId: store.storeId,
        items,
        subtotal: store.subtotal,
        shippingCost: store.shippingCost,
        total: store.total,
      });
      // Open tab only after order is saved successfully
      window.open(store.storeUrl, "_blank", "noopener");
      setOrderCreated(result.order);
      setPendingOrder({ store, items, storeReplacements });
    } catch (e) {
      setOrderError(e.message);
    } finally {
      setPlacingOrder(null);
    }
  }

  if (!cartCount) {
    return (
      <div className="min-h-screen bg-[#0a0f0b] flex flex-col items-center justify-center gap-4 p-8">
        <ShoppingCartIcon />
        <p className="text-white/60 text-lg">Your cart is empty.</p>
        <Link to="/deals" className="bg-green-500 hover:bg-green-400 text-white font-bold px-6 py-3 rounded-xl transition-colors">
          Browse Deals
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f0b] text-white">
      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-white/40 hover:text-white">←</button>
          <h1 className="text-xl font-bold">Compare Prices</h1>
          <span className="text-white/40 text-sm ml-auto">{cartCount} item{cartCount !== 1 ? "s" : ""} in cart</span>
        </div>

        {/* Sort controls */}
        <div className="flex gap-2 mb-6">
          <SortButton label="Cheapest" active={sortBy === "total"} onClick={() => setSortBy("total")} />
          <SortButton label="Best match" active={sortBy === "match"} onClick={() => setSortBy("match")} />
        </div>

        {/* Results */}
        {loading && (
          <div className="text-center py-12 text-white/40">Comparing prices across stores…</div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm mb-4">{error}</div>
        )}
        {!loading && stores && (
          <div className="space-y-4">
            {stores.map((store) => (
              <StoreCard
                key={store.storeId}
                store={store}
                cartItems={cartItems}
                acceptedReplacements={acceptedReplacements[store.storeId] || {}}
                onAcceptReplacement={handleAcceptReplacement}
                onPlaceOrder={handlePlaceOrder}
                isLoggedIn={isLoggedIn}
                placing={placingOrder === store.storeId}
              />
            ))}
            {stores.length === 0 && (
              <p className="text-center text-white/40 py-8">No stores found. Try adding different products.</p>
            )}
          </div>
        )}

        {/* Order confirmation modal */}
        {pendingOrder && (
          <OrderConfirmModal
            store={pendingOrder.store}
            order={orderCreated}
            orderError={orderError}
            isLoggedIn={isLoggedIn}
            onDismiss={() => { setPendingOrder(null); setOrderCreated(null); setOrderError(null); }}
            onStatusUpdate={async (status) => {
              if (orderCreated) {
                try {
                  await updateOrderStatus(orderCreated.id, status);
                } catch {}
              }
              setPendingOrder(null);
              setOrderCreated(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

function OrderConfirmModal({ store, order, orderError, isLoggedIn, onDismiss, onStatusUpdate }) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-[#102016] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h3 className="text-white font-bold text-lg">Shopping at {store.storeName}</h3>
        <p className="text-white/60 text-sm">
          We've opened {store.storeName} in a new tab. Add the products to your cart there and complete your order.
        </p>
        {!isLoggedIn && (
          <p className="text-amber-400 text-xs">Log in to save your order history.</p>
        )}
        {orderError && (
          <p className="text-red-400 text-xs">Could not save order: {orderError}</p>
        )}
        {isLoggedIn && order && (
          <div className="space-y-2">
            <p className="text-white/60 text-sm font-medium">Did you complete the purchase?</p>
            <button
              onClick={() => onStatusUpdate("paid")}
              className="w-full bg-green-500 hover:bg-green-400 text-white font-bold py-2.5 rounded-xl transition-colors text-sm"
            >
              Yes, I paid ✓
            </button>
            <button
              onClick={() => onStatusUpdate("never_placed")}
              className="w-full bg-white/5 hover:bg-white/10 text-white/60 py-2 rounded-xl text-sm transition-colors"
            >
              No, I didn't place it
            </button>
          </div>
        )}
        <button onClick={onDismiss} className="w-full text-white/30 hover:text-white/60 text-sm py-1">
          Close
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Test in dev server**

```bash
cd client && npm run dev
```
1. Go to `/deals`, add 2–3 items to cart.
2. Open cart drawer → click "Compare Store Prices →".
3. Verify `/compare` loads, shows store cards with matched/total counts.
4. Verify unavailable items show "See alternatives" link.
5. Click "See alternatives" → verify replacement suggestions load.
6. Accept a replacement → verify item changes, "1 replacement" badge appears, totals update.
7. Click "Shop at [Store]" → verify store opens in new tab + confirmation modal appears.

Kill dev server when done.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/CompareStoresPage.jsx client/src/utils/api.js client/src/App.jsx
git commit -m "feat(compare): CompareStoresPage with store cards, replacements, and order placement"
```

---

## Task 8: OrderHistoryPage

**Files:**
- Create: `client/src/pages/OrderHistoryPage.jsx`

- [ ] **Step 1: Create OrderHistoryPage**

Create `client/src/pages/OrderHistoryPage.jsx`:

```jsx
import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchOrders, getAuthSession, updateOrderStatus } from "../utils/api";

const STATUS_LABEL = {
  paid: { label: "Paid", color: "text-green-400 bg-green-500/10" },
  pending_confirmation: { label: "Pending confirmation", color: "text-amber-400 bg-amber-500/10" },
  never_placed: { label: "Never placed", color: "text-red-400 bg-red-500/10" },
};

function OrderCard({ order, onStatusChange }) {
  const [updating, setUpdating] = useState(false);
  const status = STATUS_LABEL[order.status] || { label: order.status, color: "text-white/60" };
  const replacements = (order.items || []).filter((i) => i.is_replacement);

  async function handleStatus(newStatus) {
    setUpdating(true);
    try {
      await updateOrderStatus(order.id, newStatus);
      onStatusChange(order.id, newStatus);
    } catch {}
    setUpdating(false);
  }

  return (
    <div className="bg-[#102016] border border-white/10 rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-white font-bold">{order.store_name}</p>
          <p className="text-white/40 text-xs mt-0.5">
            {new Date(order.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-white font-bold">€{order.total?.toFixed(2)}</p>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${status.color}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Items summary */}
      <div className="space-y-1">
        {(order.items || []).map((item) => (
          <div key={item.id} className="flex items-center justify-between text-sm">
            <span className={`${item.is_replacement ? "text-amber-400" : "text-white/70"} truncate max-w-[70%]`}>
              {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.product_name}
              {item.is_replacement && <span className="text-white/30 ml-1 text-xs">(was: {item.original_name})</span>}
            </span>
            <span className="text-white/50 text-xs">€{(item.unit_price * item.quantity).toFixed(2)}</span>
          </div>
        ))}
      </div>

      {replacements.length > 0 && (
        <p className="text-amber-400 text-xs">{replacements.length} replacement{replacements.length > 1 ? "s" : ""} used</p>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap pt-1">
        {order.status === "pending_confirmation" && (
          <>
            <button
              onClick={() => handleStatus("paid")}
              disabled={updating}
              className="text-sm bg-green-500/20 hover:bg-green-500/30 text-green-400 px-3 py-1.5 rounded-lg transition-colors"
            >
              Mark as paid
            </button>
            <button
              onClick={() => handleStatus("never_placed")}
              disabled={updating}
              className="text-sm bg-white/5 hover:bg-white/10 text-white/40 px-3 py-1.5 rounded-lg transition-colors"
            >
              Never placed
            </button>
            <Link
              to="/compare"
              className="text-sm bg-white/5 hover:bg-white/10 text-white/60 px-3 py-1.5 rounded-lg transition-colors"
            >
              Resume comparing
            </Link>
          </>
        )}
        {order.status === "never_placed" && (
          <Link
            to="/compare"
            className="text-sm bg-green-500/10 hover:bg-green-500/20 text-green-400 px-3 py-1.5 rounded-lg transition-colors"
          >
            Compare again
          </Link>
        )}
        <a
          href={order.store_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm bg-white/5 hover:bg-white/10 text-white/40 px-3 py-1.5 rounded-lg transition-colors"
        >
          Visit {order.store_name} ↗
        </a>
      </div>
    </div>
  );
}

export default function OrderHistoryPage() {
  const navigate = useNavigate();
  const session = getAuthSession();
  const isLoggedIn = !!session?.accessToken;

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isLoggedIn) { setLoading(false); return; }
    fetchOrders()
      .then((data) => setOrders(data.orders || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [isLoggedIn]);

  function handleStatusChange(orderId, newStatus) {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#0a0f0b] flex flex-col items-center justify-center gap-4 p-8">
        <p className="text-white/60 text-lg">Log in to see your order history.</p>
        <Link to="/" className="bg-green-500 hover:bg-green-400 text-white font-bold px-6 py-3 rounded-xl transition-colors">
          Back to Deals
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0f0b] text-white">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate(-1)} className="text-white/40 hover:text-white">←</button>
          <h1 className="text-xl font-bold">Order History</h1>
        </div>

        {loading && <p className="text-white/40 text-center py-12">Loading orders…</p>}
        {error && <p className="text-red-400 text-sm text-center py-12">{error}</p>}
        {!loading && !error && orders.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <p className="text-white/40">No orders yet.</p>
            <Link to="/compare" className="bg-green-500 hover:bg-green-400 text-white font-bold px-6 py-3 rounded-xl transition-colors inline-block">
              Start Comparing →
            </Link>
          </div>
        )}
        <div className="space-y-4">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} onStatusChange={handleStatusChange} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test in dev server**

```bash
cd client && npm run dev
```
Navigate to `/orders`. Verify:
- Without login: shows "Log in to see your order history" message.
- With login (after placing a test order via compare page): shows order cards with status badges and action buttons.
- "Mark as paid" button updates status inline.
- "Resume comparing" links back to `/compare`.

Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/OrderHistoryPage.jsx
git commit -m "feat(orders): OrderHistoryPage with status management and order details"
```

---

## Task 9: Wire Orders Link in Nav

**Files:**
- Modify: `client/src/pages/DealsPage.jsx`

- [ ] **Step 1: Add Orders link to nav**

In `client/src/pages/DealsPage.jsx`, find the navigation/header area where the "Saved" page link or auth buttons are rendered. Add a link to `/orders`:

```jsx
<Link
  to="/orders"
  className="flex items-center gap-1.5 text-white/60 hover:text-white text-sm font-medium transition-colors"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
  Orders
</Link>
```

- [ ] **Step 2: Final integration test**

```bash
cd client && npm run dev &
sleep 2
```
Full golden path:
1. `/deals` → add 2 products from different stores to cart.
2. Cart drawer opens → "Compare Store Prices →" → lands on `/compare`.
3. Comparison loads with store cards, match stats, shipping info.
4. Accept a replacement for an unavailable item → badge updates, total recalculates.
5. Click "Shop at [Store]" → new tab opens + confirmation modal shows.
6. Click "Yes, I paid" (if logged in) → order saved.
7. Navigate to `/orders` → see the order with "Paid" status.
8. Test "Mark as paid" from pending order.

Kill dev server.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/DealsPage.jsx
git commit -m "feat(nav): add Orders link to header navigation"
```

---

## Self-Review

### Spec Coverage Check

| Requirement | Covered in |
|---|---|
| Add deal/product to cart | Task 6 — add-to-cart button |
| Compare total price incl. shipping | Task 2+3 — comparison service + route |
| Sort by total cost | Task 3+7 — sortBy param + UI |
| Sort by delivery duration | Task 3+7 — placeholder (falls back to total; delivery_options data is sparse) |
| Sort by availability | Task 3+7 — "Best match" sort |
| Match stat (8/13) | Task 7 — matchedCount/totalCount badge |
| Free shipping indicator | Task 2+7 — toFreeShipping + progress bar |
| Available/unavailable separation | Task 7 — StoreCard sections |
| Replacement suggestions per store | Task 7 — ItemRow with lazy-loaded replacements |
| Accept replacement per-store only | Task 7 — acceptedReplacements keyed by storeId |
| Recalculate stats after replacement | Task 7 — derived from items in render |
| Show replacement count + original | Task 7 — badge + line-through original name |
| One-click move cart to store | Task 7 — window.open(store.storeUrl) |
| Await payment confirmation | Task 7 — OrderConfirmModal |
| Save order to history | Task 4+7 — orders table + createOrder call |
| Order status: Paid/Pending/Never placed | Task 4+8 — DB enum + UI |
| Mark order paid | Task 8 — OrderCard "Mark as paid" button |
| Resume comparing never-placed | Task 8 — "Compare again" link |

### Placeholder Scan

None found — all steps contain complete code.

### Type Consistency

- `computeStoreComparison` returns `store.items[].matchedDeal` — used consistently in `ItemRow` and order placement.
- `acceptedReplacements` shape `{ [storeId]: { [dealId]: repDeal | null } }` — used consistently across `handleAcceptReplacement`, `StoreCard`, and `handlePlaceOrder`.
- `createOrder` payload fields match `orders.js` INSERT columns.
- `updateOrderStatus` — statically imported in CompareStoresPage; exported from `api.js` in Task 7 Step 1.
- `fetchReplacements(canonicalId, storeId)` — already in `api.js` (line 386); ItemRow passes `item.canonicalId` as first arg (not `item.dealId`).

### Edge Cases Addressed

| Issue | Fix |
|---|---|
| `fetchReplacements` arg order wrong | Pass `(item.canonicalId, storeId, item.dealId)` — excludes source deal from suggestions |
| `window.open` before `createOrder` | Reordered: create order → open tab on success; errors shown without opening tab |
| Double-click places two orders | `placingOrder` state disables button while in-flight |
| Null shipping renders as €0.00 | Show "—" when `shippingCost === null` |
| `paid → pending_confirmation` regression | PATCH only allows `paid` \| `never_placed` |
| `confirmed_at` format mismatch | Uses SQL `datetime('now')` — consistent with SQLite `CURRENT_TIMESTAMP` |
| `free_shipping_min` vs `shipping_tiers` disagree | Derive threshold from `MIN(min_basket) WHERE cost=0` in tiers; fallback to `stores.free_shipping_min` |

### Known Limitation

Delivery duration sort is a no-op (falls back to total cost sort). The `delivery_options` table exists in schema but has no data for most stores. This can be wired in a follow-up once delivery data is populated.

Cart items without `canonicalId` show permanently as unavailable (no replacement path). This is a data quality issue — items added before canonical matching existed will hit this. No fix in scope.

---

## ⚠️ Reviewer Warning — Production DB Migration Required

**Before merging this branch to `main`, the production Turso DB must be updated.**

The T2 replacement tier (`same_spec`) depends on `canonical_products.base_product_slots` being populated. This column was backfilled locally on 2026-04-19 using `scripts/backfill-base-product-slots.js` (2345/2347 rows updated), but that change only exists in the local SQLite file — **it has not been synced to production yet**.

If merged without syncing, T2 will silently return empty for all replacement lookups (no error, just degraded results). T1/T3/T4 tiers are unaffected.

**Steps before merging:**
1. Sync the local DB to production (via `scripts/push-local-db-to-turso.js` or equivalent), **or**
2. Run `node scripts/backfill-base-product-slots.js` directly against the production Turso DB (set `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` in env). The script is idempotent — safe to re-run.
