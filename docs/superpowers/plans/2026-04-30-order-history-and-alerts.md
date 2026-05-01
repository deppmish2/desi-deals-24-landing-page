# Order History & Product Alerts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build order history page (past comparison sessions with order intent), accountability prompts, reorder flow, and product alerts management page. Update `alert-evaluator.js` to fire `product_alerts` via email post-crawl.

**Architecture:** Order history reads `comparison_sessions WHERE order_intent_at IS NOT NULL`. Accountability prompts appear for orders > 1 day old with no `self_report_status`. Reorder parses `snapshot_json.items` and pushes them into the cart. Alerts are stored in `product_alerts` (built in the schema+crawl plan) and managed via `server/routes/profile.js`.

**Prerequisites:**
- Plan `2026-04-30-schema-and-crawl.md` complete (`product_alerts` table, `alert-evaluator.js` rewrite)
- Plan `2026-04-30-shopping-list-frontend.md` complete (comparison sessions being created)

**Tech Stack:** React 18 + Tailwind CSS + React Router v6. API calls via `client/src/utils/api.js`.

**DB:** All dev/test uses `data/prod_local.db` (`DB_FILE=data/prod_local.db`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/routes/profile.js` | Modify | Add order history endpoints; replace price_alerts with product_alerts |
| `server/routes/recommend.js` | Modify | Record `order_intent_at` on cart-transfer; add self-report endpoint |
| `client/src/utils/api.js` | Modify | Add order history + alerts API functions |
| `client/src/pages/OrderHistoryPage.jsx` | Create | Order history feed with accountability prompts |
| `client/src/components/AccountabilityPrompt.jsx` | Create | Step-by-step self-report flow |
| `client/src/pages/AlertsPage.jsx` | Create | Product alerts management |
| `client/src/components/SetAlertButton.jsx` | Create | "Alert me" button on deal cards |
| `client/src/App.jsx` | Modify | Add `/orders` and `/alerts` routes |

---

### Task 1: Order history backend endpoints

**Files:**
- Modify: `server/routes/profile.js`
- Modify: `server/routes/recommend.js`

- [ ] **Step 1: Add order history endpoints to profile.js**

In `server/routes/profile.js`, append before `module.exports`:

```js
// GET /api/v1/me/orders — order history (comparison_sessions with order intent)
router.get("/orders", requireUserAuth, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const orders = await db.prepare(`
      SELECT id, list_id, created_at, selected_store_id, order_intent_at,
             self_report_status, self_report_reason, items_all_available,
             price_as_expected, snapshot_json
      FROM comparison_sessions
      WHERE user_id = ? AND order_intent_at IS NOT NULL
      ORDER BY order_intent_at DESC
      LIMIT 50
    `).all(userId);

    const withStore = await Promise.all(orders.map(async (o) => {
      const store = o.selected_store_id
        ? await db.prepare("SELECT id, name, url FROM stores WHERE id = ?").get(o.selected_store_id)
        : null;
      let snapshot;
      try { snapshot = JSON.parse(o.snapshot_json); } catch { snapshot = {}; }
      return {
        ...o,
        store,
        snapshot_json: undefined,
        confirmed_total: snapshot.confirmed_total_with_shipping,
        items: snapshot.items || [],
      };
    }));

    res.json({ data: withStore });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/me/orders/:id — submit accountability self-report
router.patch("/orders/:id", requireUserAuth, async (req, res, next) => {
  try {
    const { self_report_status, self_report_reason, items_all_available, price_as_expected } = req.body;
    const valid = ["ordered", "not_ordered", "still_deciding"];
    if (self_report_status && !valid.includes(self_report_status)) {
      return res.status(400).json({ error: "invalid self_report_status" });
    }

    const sets = [];
    const params = [];
    if (self_report_status) { sets.push("self_report_status = ?"); params.push(self_report_status); }
    if (self_report_reason) { sets.push("self_report_reason = ?"); params.push(self_report_reason); }
    if (items_all_available != null) { sets.push("items_all_available = ?"); params.push(items_all_available ? 1 : 0); }
    if (price_as_expected != null) { sets.push("price_as_expected = ?"); params.push(price_as_expected ? 1 : 0); }

    if (!sets.length) return res.status(400).json({ error: "no fields to update" });

    params.push(req.params.id, req.user.id);
    await db.prepare(
      `UPDATE comparison_sessions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`
    ).run(...params);

    const updated = await db.prepare(
      "SELECT * FROM comparison_sessions WHERE id = ? AND user_id = ?"
    ).get(req.params.id, req.user.id);

    if (!updated) return res.status(404).json({ error: "not found" });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 2: Record order_intent_at on cart-transfer in recommend.js**

In `server/routes/recommend.js`, find the `POST /:id/cart-transfer` handler. After saving the cart transfer, add:

```js
// Record order intent on the most recent comparison session for this list
const session = await db.prepare(
  `SELECT id FROM comparison_sessions
   WHERE list_id = ? AND user_id = ? AND selected_store_id = ?
   ORDER BY created_at DESC LIMIT 1`
).get(req.params.id, req.user.id, req.body.store_id);

if (session) {
  await db.prepare(
    `UPDATE comparison_sessions SET order_intent_at = datetime('now'), selected_store_id = ?
     WHERE id = ?`
  ).run(req.body.store_id, session.id);
}
```

- [ ] **Step 3: Add /orders route mount in server/index.js**

In `server/index.js`, verify `profileRouter` is mounted at `/api/v1/me` (already done). The new `/orders` and `/orders/:id` sub-routes are on the same router — no new mount needed.

- [ ] **Step 4: Write integration test**

Create `tests/integration/order-history.test.js`:

```js
"use strict";
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_FILE = "data/prod_local.db";
const db = require("../../server/db");
const crypto = require("crypto");

describe("order history endpoints", () => {
  let server, baseUrl, authHeader, userId, sessionId;

  before(async () => {
    await new Promise(r => setTimeout(r, 1500));
    const app = require("../../server/index");
    server = app.listen(0);
    const { port } = server.address();
    baseUrl = `http://localhost:${port}`;

    const user = await db.prepare("SELECT id FROM users LIMIT 1").get();
    assert.ok(user);
    userId = user.id;

    // Insert a test comparison session with order_intent_at
    sessionId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO comparison_sessions (id, user_id, created_at, order_intent_at, selected_store_id, snapshot_json)
       VALUES (?, ?, datetime('now'), datetime('now','-2 days'), 'jamoona', '{"items":[],"confirmed_total_with_shipping":25.00}')`
    ).run(sessionId, userId);

    // Get a valid auth token — use the test JWT pattern
    const jwt = require("../../server/utils/jwt");
    const token = jwt.signAccessToken({ id: userId });
    authHeader = `Bearer ${token}`;
  });

  after(async () => {
    await db.prepare("DELETE FROM comparison_sessions WHERE id = ?").run(sessionId);
    server.close();
  });

  it("GET /api/v1/me/orders returns order history", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me/orders`, {
      headers: { Authorization: authHeader },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.data));
    const found = data.data.find(o => o.id === sessionId);
    assert.ok(found, "should include test session");
  });

  it("PATCH /api/v1/me/orders/:id saves self-report", async () => {
    const res = await fetch(`${baseUrl}/api/v1/me/orders/${sessionId}`, {
      method: "PATCH",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ self_report_status: "ordered", items_all_available: true }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.data.self_report_status, "ordered");
    assert.equal(data.data.items_all_available, 1);
  });
});
```

- [ ] **Step 5: Run test — confirm passes**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/order-history.test.js --reporter=spec 2>&1 | tail -10
```
Expected: `pass 2`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/profile.js server/routes/recommend.js tests/integration/order-history.test.js
git commit -m "feat: order history endpoints + order_intent_at recording on cart transfer"
```

---

### Task 2: Replace price_alerts with product_alerts in profile.js

**Files:**
- Modify: `server/routes/profile.js`

- [ ] **Step 1: Replace alerts CRUD in profile.js**

Find the existing `router.get("/alerts"`, `router.post("/alerts"`, `router.put("/alerts/:id"`, `router.delete("/alerts/:id")` blocks and replace them:

```js
// GET /api/v1/me/alerts
router.get("/alerts", requireUserAuth, async (req, res, next) => {
  try {
    const alerts = await db.prepare(`
      SELECT pa.*, cp.canonical_name, s.name AS store_name
      FROM product_alerts pa
      JOIN canonical_products cp ON cp.id = pa.canonical_id
      LEFT JOIN stores s ON s.id = pa.store_id
      WHERE pa.user_id = ?
      ORDER BY pa.created_at DESC
    `).all(req.user.id);
    res.json({ data: alerts });
  } catch (err) { next(err); }
});

// POST /api/v1/me/alerts
router.post("/alerts", requireUserAuth, async (req, res, next) => {
  try {
    const { canonical_id, store_id, alert_type, price_threshold } = req.body;
    const valid = ["price_below", "back_in_stock"];
    if (!canonical_id) return res.status(400).json({ error: "canonical_id required" });
    if (!valid.includes(alert_type)) return res.status(400).json({ error: "invalid alert_type" });
    if (alert_type === "price_below" && !price_threshold) {
      return res.status(400).json({ error: "price_threshold required for price_below" });
    }

    const id = require("crypto").randomUUID();
    await db.prepare(
      `INSERT INTO product_alerts (id, user_id, canonical_id, store_id, alert_type, price_threshold, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(id, req.user.id, canonical_id, store_id || null, alert_type, price_threshold || null);

    const created = await db.prepare("SELECT * FROM product_alerts WHERE id = ?").get(id);
    res.status(201).json({ data: created });
  } catch (err) { next(err); }
});

// DELETE /api/v1/me/alerts/:id
router.delete("/alerts/:id", requireUserAuth, async (req, res, next) => {
  try {
    const result = await db.prepare(
      "DELETE FROM product_alerts WHERE id = ? AND user_id = ?"
    ).run(req.params.id, req.user.id);
    if (result.changes === 0) return res.status(404).json({ error: "not found" });
    res.json({ success: true });
  } catch (err) { next(err); }
});
```

- [ ] **Step 2: Commit**

```bash
git add server/routes/profile.js
git commit -m "feat: replace price_alerts with product_alerts CRUD in profile route"
```

---

### Task 3: Add order history + alerts API functions

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Append to api.js**

```js
// ── Order history ─────────────────────────────────────────────────────────────

export function fetchOrders() {
  return authRequest("/api/v1/me/orders");
}

export async function submitSelfReport(orderId, report) {
  // report: { self_report_status, self_report_reason?, items_all_available?, price_as_expected? }
  return authRequest(`/api/v1/me/orders/${orderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(report),
  });
}

// ── Product alerts ────────────────────────────────────────────────────────────

export function fetchAlerts() {
  return authRequest("/api/v1/me/alerts");
}

export async function createAlert(alert) {
  // alert: { canonical_id, store_id?, alert_type: 'price_below'|'back_in_stock', price_threshold? }
  return authRequest("/api/v1/me/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(alert),
  });
}

export async function deleteAlert(alertId) {
  return authRequest(`/api/v1/me/alerts/${alertId}`, { method: "DELETE" });
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(api): add order history + product alerts API functions"
```

---

### Task 4: AccountabilityPrompt component

**Files:**
- Create: `client/src/components/AccountabilityPrompt.jsx`

- [ ] **Step 1: Create AccountabilityPrompt.jsx**

```jsx
import React, { useState } from "react";
import { submitSelfReport } from "../utils/api";

const REASONS = [
  { value: "price_higher", label: "Price was higher than shown" },
  { value: "items_missing", label: "Items were out of stock" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "website_issue", label: "Website issue" },
  { value: "ordered_elsewhere", label: "Ordered from another store" },
];

export default function AccountabilityPrompt({ order, onDismiss, onSave }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);

  async function save(final) {
    setSaving(true);
    try {
      await submitSelfReport(order.id, final);
      onSave?.(final);
    } catch {
      // ignore
    }
    setSaving(false);
  }

  async function handleStatus(status) {
    const updated = { ...answers, self_report_status: status };
    setAnswers(updated);
    if (status !== "ordered") {
      setStep(3); // jump to reason
    } else {
      setStep(1);
    }
  }

  async function handleAvailable(yes) {
    setAnswers(a => ({ ...a, items_all_available: yes }));
    setStep(2);
  }

  async function handlePriceExpected(yes) {
    const final = { ...answers, price_as_expected: yes };
    await save(final);
    onDismiss?.();
  }

  async function handleReason(reason) {
    const final = { ...answers, self_report_reason: reason };
    await save(final);
    onDismiss?.();
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <p className="text-sm font-semibold text-amber-800 mb-3">
        How did your order at {order.store?.name || "the store"} go?
      </p>

      {step === 0 && (
        <div className="flex flex-wrap gap-2">
          {["ordered", "not_ordered", "still_deciding"].map(s => (
            <button
              key={s}
              onClick={() => handleStatus(s)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-amber-300 hover:bg-amber-100 text-amber-800"
            >
              {{ ordered: "Yes, I ordered", not_ordered: "No, I didn't", still_deciding: "Still deciding" }[s]}
            </button>
          ))}
          <button onClick={onDismiss} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">Skip</button>
        </div>
      )}

      {step === 1 && (
        <div>
          <p className="text-xs text-amber-700 mb-2">Were all items available?</p>
          <div className="flex gap-2">
            <button onClick={() => handleAvailable(true)} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-amber-300 hover:bg-amber-100 text-amber-800">Yes</button>
            <button onClick={() => handleAvailable(false)} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-amber-300 hover:bg-amber-100 text-amber-800">No</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p className="text-xs text-amber-700 mb-2">Was the price as expected?</p>
          <div className="flex gap-2">
            <button onClick={() => handlePriceExpected(true)} disabled={saving} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 disabled:opacity-50">Yes</button>
            <button onClick={() => handlePriceExpected(false)} disabled={saving} className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 disabled:opacity-50">No</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <p className="text-xs text-amber-700 mb-2">Why didn't you order?</p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map(r => (
              <button key={r.value} onClick={() => handleReason(r.value)} disabled={saving}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-white border border-amber-300 hover:bg-amber-100 text-amber-800 disabled:opacity-50">
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AccountabilityPrompt.jsx
git commit -m "feat: AccountabilityPrompt component (step-by-step self-report)"
```

---

### Task 5: Order history page

**Files:**
- Create: `client/src/pages/OrderHistoryPage.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create OrderHistoryPage.jsx**

```jsx
import React, { useEffect, useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOrders } from "../utils/api";
import { CartContext } from "../hooks/CartContext";
import AccountabilityPrompt from "../components/AccountabilityPrompt";

function isPendingAccountability(order) {
  if (order.self_report_status) return false;
  const intentAt = new Date(order.order_intent_at);
  return Date.now() - intentAt.getTime() > 24 * 60 * 60 * 1000;
}

const STATUS_BADGE = {
  ordered: { label: "Ordered", color: "bg-green-100 text-green-700" },
  not_ordered: { label: "Not ordered", color: "bg-gray-100 text-gray-600" },
  still_deciding: { label: "Still deciding", color: "bg-amber-100 text-amber-700" },
};

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(new Set());
  const { clearCart, addItem } = useContext(CartContext);
  const navigate = useNavigate();

  useEffect(() => {
    fetchOrders()
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          setOrders(data.data || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function handleSave(orderId, report) {
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...report } : o));
  }

  function handleReorder(order) {
    const items = order.items || [];
    if (!items.length) return;
    clearCart();
    for (const item of items) {
      addItem({
        raw_item_text: item.name || item.canonical_name || item.raw_item_text,
        canonical_id: item.canonical_id || null,
        quantity: item.quantity || null,
        quantity_unit: item.quantity_unit || null,
      });
    }
    navigate("/list");
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Loading orders…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Order History</h1>

      {orders.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-12">No orders yet.</p>
      )}

      <div className="space-y-4">
        {orders.map(order => {
          const badge = STATUS_BADGE[order.self_report_status];
          const needsReport = isPendingAccountability(order) && !dismissed.has(order.id);

          return (
            <div key={order.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-gray-900">{order.store?.name || "Unknown store"}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(order.order_intent_at).toLocaleDateString("en-DE", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {order.confirmed_total != null && (
                    <p className="font-bold text-orange-600">€{order.confirmed_total.toFixed(2)}</p>
                  )}
                  {badge && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
                  )}
                </div>
              </div>

              {order.items?.length > 0 && (
                <ul className="text-xs text-gray-500 space-y-0.5 mb-3">
                  {order.items.slice(0, 4).map((item, i) => (
                    <li key={i}>{item.name || item.raw_item_text}
                      {item.price != null ? ` — €${item.price.toFixed(2)}` : ""}
                    </li>
                  ))}
                  {order.items.length > 4 && <li className="text-gray-400">+{order.items.length - 4} more</li>}
                </ul>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => handleReorder(order)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-200"
                >
                  Reorder →
                </button>
              </div>

              {needsReport && (
                <div className="mt-3">
                  <AccountabilityPrompt
                    order={order}
                    onDismiss={() => setDismissed(s => new Set([...s, order.id]))}
                    onSave={(report) => handleSave(order.id, report)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `/orders` route to App.jsx**

```jsx
const OrderHistoryPage = lazy(() => import("./pages/OrderHistoryPage"));
// In Routes:
<Route path="/orders" element={<OrderHistoryPage />} />
```

- [ ] **Step 3: Start dev server and verify**

```bash
cd client && npm run dev
```
Navigate to `/orders`. With test data in DB, orders appear. Old orders (>1 day) show accountability prompt. Click through the 3-question flow. Reorder button populates cart and navigates to `/list`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/OrderHistoryPage.jsx client/src/App.jsx
git commit -m "feat: order history page /orders with accountability prompts and reorder"
```

---

### Task 6: Product alerts management page + SetAlertButton

**Files:**
- Create: `client/src/pages/AlertsPage.jsx`
- Create: `client/src/components/SetAlertButton.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create SetAlertButton.jsx**

```jsx
import React, { useState, useContext } from "react";
import { createAlert, getAuthSession } from "../utils/api";

export default function SetAlertButton({ deal, className = "" }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("price_below");
  const [threshold, setThreshold] = useState(deal?.sale_price ? String((deal.sale_price * 0.9).toFixed(2)) : "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const session = getAuthSession();

  if (!session) return null;
  if (!deal?.canonical_id) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await createAlert({
        canonical_id: deal.canonical_id,
        store_id: deal.store_id || null,
        alert_type: type,
        price_threshold: type === "price_below" ? parseFloat(threshold) : null,
      });
      setDone(true);
      setOpen(false);
    } catch {
      setSaving(false);
    }
  }

  if (done) return <span className="text-xs text-green-600 font-medium">Alert set ✓</span>;

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-gray-500 hover:text-orange-600 border border-gray-200 rounded px-2 py-1"
      >
        🔔 Alert
      </button>

      {open && (
        <div className="absolute right-0 top-7 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-30 w-56">
          <p className="text-xs font-semibold text-gray-700 mb-2">Set alert for {deal.product_name}</p>
          <div className="flex flex-col gap-2 mb-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="radio" value="price_below" checked={type === "price_below"} onChange={() => setType("price_below")} />
              Price drops below
            </label>
            {type === "price_below" && (
              <div className="flex items-center gap-1 ml-4">
                <span className="text-xs text-gray-500">€</span>
                <input
                  type="number"
                  value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-xs w-20"
                  min="0"
                  step="0.01"
                />
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input type="radio" value="back_in_stock" checked={type === "back_in_stock"} onChange={() => setType("back_in_stock")} />
              Back in stock
            </label>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || (type === "price_below" && !threshold)}
            className="w-full bg-orange-500 text-white text-xs font-semibold py-1.5 rounded-lg hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Set alert"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create AlertsPage.jsx**

```jsx
import React, { useEffect, useState } from "react";
import { fetchAlerts, deleteAlert } from "../utils/api";

const TYPE_LABEL = { price_below: "Price below", back_in_stock: "Back in stock" };

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts()
      .then(async res => {
        if (res.ok) {
          const data = await res.json();
          setAlerts(data.data || []);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleDelete(id) {
    await deleteAlert(id);
    setAlerts(a => a.filter(x => x.id !== id));
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Product Alerts</h1>

      {alerts.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-12">
          No active alerts. Use the 🔔 button on any deal to set one.
        </p>
      )}

      <div className="space-y-2">
        {alerts.map(alert => (
          <div key={alert.id} className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">{alert.canonical_name}</p>
              <p className="text-xs text-gray-500">
                {TYPE_LABEL[alert.alert_type]}
                {alert.alert_type === "price_below" && alert.price_threshold != null
                  ? ` €${alert.price_threshold.toFixed(2)}`
                  : ""}
                {alert.store_name ? ` · ${alert.store_name}` : " · any store"}
              </p>
            </div>
            <button
              onClick={() => handleDelete(alert.id)}
              className="text-xs text-red-400 hover:text-red-600 ml-4"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `/alerts` route to App.jsx**

```jsx
const AlertsPage = lazy(() => import("./pages/AlertsPage"));
// In Routes:
<Route path="/alerts" element={<AlertsPage />} />
```

- [ ] **Step 4: Wire SetAlertButton into deal cards**

In `DealsPage.jsx`, add `<SetAlertButton deal={deal} className="ml-1" />` near the `<CartButton />` (requires deal to have `canonical_id` populated).

- [ ] **Step 5: Start dev server and verify**

```bash
cd client && npm run dev
```
1. On a deal card with a canonical_id, click 🔔 Alert → popup appears
2. Set "Price drops below €X" → "Set alert" → "Alert set ✓"
3. Navigate to `/alerts` → alert appears in list
4. Click Remove → alert disappears
5. Navigate to `/orders` — verify existing orders, accountability prompts

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/AlertsPage.jsx client/src/components/SetAlertButton.jsx client/src/App.jsx client/src/pages/DealsPage.jsx
git commit -m "feat: product alerts management page /alerts + SetAlertButton on deal cards"
```

---

### Task 7: Wire alert evaluation into post-crawl hook

**Files:**
- Modify: `crawler/index.js`

- [ ] **Step 1: Add post-crawl alert check**

In `crawler/index.js`, after the existing post-crawl FTS rebuild call (added in schema+crawl plan), add:

```js
const { evaluatePriceAlerts, evaluateBackInStockAlerts, consumeAlert } = require("../server/services/alert-evaluator");
const { notifyAlert } = require("../server/services/alert-notifier");

// After fts rebuild:
try {
  const priceMatches = await evaluatePriceAlerts();
  const stockMatches = await evaluateBackInStockAlerts(newlyActivatedDealIds || []);
  for (const match of [...priceMatches, ...stockMatches]) {
    await notifyAlert(match).catch(() => {});
    await consumeAlert(match.alert_id);
  }
  console.log(`[alerts] checked: ${priceMatches.length} price, ${stockMatches.length} stock`);
} catch (err) {
  console.error("[alerts] evaluation error:", err.message);
}
```

Note: `newlyActivatedDealIds` must be tracked by the crawl runner — the existing `crawler/index.js` marks deals `is_active = 0` then `1`; capture the IDs of deals that flipped from 0→1 in this crawl pass.

- [ ] **Step 2: Commit**

```bash
git add crawler/index.js
git commit -m "feat: wire alert evaluation into post-crawl hook"
```

---

### Task 8: Final smoke test

- [ ] **Step 1: Run all integration tests**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/*.test.js --reporter=spec 2>&1 | tail -20
```

- [ ] **Step 2: Test complete user journey in browser**

```bash
DB_FILE=data/prod_local.db npm run dev &
cd client && npm run dev
```

Full journey:
1. Deals page → click "+ Cart" on items → cart badge increments
2. Click 🛒 → `/list` → sign in → "Save to my list"
3. "Compare prices" → `/list/:id/compare` → stores ranked
4. "Order from [Store]" → redirects to store, order intent recorded
5. Navigate to `/orders` → order appears, accountability prompt shows
6. Complete accountability prompt → status badge updates
7. On deal page → 🔔 Alert → set price alert
8. `/alerts` → alert visible, can be removed
9. `/search?q=dal` → results with FTS5 + auto-suggest in header

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add -p
git commit -m "feat: order history + product alerts complete"
```
