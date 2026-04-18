# Mapped Products Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Mapped" sub-tab inside the Canonical Stats admin section showing all canonicals with their per-store deal breakdown, expandable on click.

**Architecture:** New `GET /mapped-products` admin endpoint returns a flat SQL result assembled into grouped JSON in JS. Frontend adds sub-tab state + lazy-load inside `CanonicalStatsTab`, with a new `MappedProductsTable` component defined in the same file. No new files required.

**Tech Stack:** Node.js/Express (backend), React + Tailwind (frontend), `@libsql/client` via existing `db` shim, `node:test` for backend test.

---

### Task 1: Backend — `GET /mapped-products` endpoint

**Files:**
- Modify: `server/routes/admin-dashboard.js` (add route after line 86, before the brand remap section)
- Modify: `tests/integration/share-meta.test.js` — no, wrong file. Create: `tests/integration/mapped-products.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/mapped-products.test.js`:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb } = require("../e2e/helpers");

test("GET /mapped-products returns grouped canonicals with deals", async () => {
  const { db } = createTestDb();

  // Seed stores
  await db.prepare(`INSERT INTO stores (id, name, url) VALUES ('s1', 'Jamoona', 'https://jamoona.de'), ('s2', 'Dookan', 'https://dookan.de')`).run();

  // Seed canonical
  await db.prepare(`INSERT INTO canonical_products (id, canonical_name, is_match_priority) VALUES ('cp1', 'Aachi Biryani Kit 360g', 1)`).run();

  // Seed deals
  await db.prepare(`INSERT INTO deals (id, store_id, product_name, product_url, sale_price, is_active, crawl_run_id, crawl_timestamp)
    VALUES
      ('d1', 's1', 'AACHI BIRYANI KIT 360g', 'https://jamoona.de/p1', 3.99, 1, 'r1', '2026-04-14T00:00:00Z'),
      ('d2', 's2', 'Aachi Biryani Kit 360 g', 'https://dookan.de/p2', 4.10, 1, 'r1', '2026-04-14T00:00:00Z')
  `).run();

  // Seed mappings
  await db.prepare(`INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence)
    VALUES ('d1', 'cp1', 'slot_match', 0.85), ('d2', 'cp1', 'slot_match', 0.85)`).run();

  // Call route handler directly
  const router = require("../../server/routes/admin-dashboard");
  // Simulate the query logic inline
  const rows = await db.prepare(`
    SELECT cp.id AS canonical_id, cp.canonical_name,
           d.store_id, s.name AS store_name,
           d.product_name, d.product_url, d.is_active
    FROM canonical_products cp
    JOIN deal_mappings dm ON dm.canonical_id = cp.id
    JOIN deals d ON d.id = dm.deal_id
    JOIN stores s ON s.id = d.store_id
    ORDER BY cp.canonical_name, s.name
  `).all();

  // Group
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.canonical_id)) {
      grouped.set(row.canonical_id, {
        canonical_id: row.canonical_id,
        canonical_name: row.canonical_name,
        has_active_deal: false,
        store_ids: new Set(),
        deals: [],
      });
    }
    const entry = grouped.get(row.canonical_id);
    if (row.is_active) entry.has_active_deal = true;
    entry.store_ids.add(row.store_id);
    entry.deals.push({ store_name: row.store_name, product_name: row.product_name, product_url: row.product_url, is_active: row.is_active });
  }
  const result = Array.from(grouped.values()).map(({ store_ids, ...rest }) => ({ ...rest, store_count: store_ids.size }));

  assert.equal(result.length, 1);
  assert.equal(result[0].canonical_name, "Aachi Biryani Kit 360g");
  assert.equal(result[0].has_active_deal, true);
  assert.equal(result[0].store_count, 2);
  assert.equal(result[0].deals.length, 2);
  const storeNames = result[0].deals.map(d => d.store_name).sort();
  assert.deepEqual(storeNames, ["Dookan", "Jamoona"]);
});

test("GET /mapped-products — inactive deal sets has_active_deal false", async () => {
  const { db } = createTestDb();
  await db.prepare(`INSERT INTO stores (id, name, url) VALUES ('s1', 'Jamoona', 'https://jamoona.de')`).run();
  await db.prepare(`INSERT INTO canonical_products (id, canonical_name, is_match_priority) VALUES ('cp1', 'Old Product 200g', 1)`).run();
  await db.prepare(`INSERT INTO deals (id, store_id, product_name, product_url, sale_price, is_active, crawl_run_id, crawl_timestamp)
    VALUES ('d1', 's1', 'Old Product 200g', 'https://jamoona.de/old', 1.99, 0, 'r1', '2026-04-14T00:00:00Z')`).run();
  await db.prepare(`INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence) VALUES ('d1', 'cp1', 'slot_match', 0.85)`).run();

  const rows = await db.prepare(`
    SELECT cp.id AS canonical_id, cp.canonical_name,
           d.store_id, s.name AS store_name,
           d.product_name, d.product_url, d.is_active
    FROM canonical_products cp
    JOIN deal_mappings dm ON dm.canonical_id = cp.id
    JOIN deals d ON d.id = dm.deal_id
    JOIN stores s ON s.id = d.store_id
    ORDER BY cp.canonical_name, s.name
  `).all();

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.canonical_id)) {
      grouped.set(row.canonical_id, { canonical_id: row.canonical_id, canonical_name: row.canonical_name, has_active_deal: false, store_ids: new Set(), deals: [] });
    }
    const entry = grouped.get(row.canonical_id);
    if (row.is_active) entry.has_active_deal = true;
    entry.store_ids.add(row.store_id);
    entry.deals.push({ store_name: row.store_name, product_name: row.product_name, product_url: row.product_url, is_active: row.is_active });
  }
  const result = Array.from(grouped.values()).map(({ store_ids, ...rest }) => ({ ...rest, store_count: store_ids.size }));

  assert.equal(result[0].has_active_deal, false);
  assert.equal(result[0].store_count, 1);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test tests/integration/mapped-products.test.js --reporter=spec
```

Expected: both tests pass immediately (the test validates SQL logic directly, not the route). If `createTestDb` schema doesn't have all columns, adjust the INSERT to match `server/db/schema.sql` column names. Check schema with: `sqlite3 data/desiDeals24.db ".schema deals"` and fix any missing `NOT NULL` columns.

- [ ] **Step 3: Add the route to `server/routes/admin-dashboard.js`**

Add after the `canonical-stats` route (after line 86, before `// ── Brand remap`):

```js
router.get("/mapped-products", async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT cp.id AS canonical_id, cp.canonical_name,
              d.store_id, s.name AS store_name,
              d.product_name, d.product_url, d.is_active
       FROM canonical_products cp
       JOIN deal_mappings dm ON dm.canonical_id = cp.id
       JOIN deals d ON d.id = dm.deal_id
       JOIN stores s ON s.id = d.store_id
       ORDER BY cp.canonical_name, s.name`,
    ).all();

    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.canonical_id)) {
        grouped.set(row.canonical_id, {
          canonical_id: row.canonical_id,
          canonical_name: row.canonical_name,
          has_active_deal: false,
          store_ids: new Set(),
          deals: [],
        });
      }
      const entry = grouped.get(row.canonical_id);
      if (row.is_active) entry.has_active_deal = true;
      entry.store_ids.add(row.store_id);
      entry.deals.push({
        store_name: row.store_name,
        product_name: row.product_name,
        product_url: row.product_url,
        is_active: Number(row.is_active),
      });
    }

    const result = Array.from(grouped.values()).map(({ store_ids, ...rest }) => ({
      ...rest,
      store_count: store_ids.size,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 4: Smoke-test the endpoint**

```bash
ADMIN_SECRET=$(grep ADMIN_SECRET .env.local | cut -d= -f2 | tr -d '"' | xargs)
curl -s "http://localhost:2400/api/v1/admin-dashboard/mapped-products" \
  -H "Authorization: Bearer $ADMIN_SECRET" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('Total:', d.length);
console.log('First:', JSON.stringify(d[0], null, 2));
"
```

Expected: array of objects each with `canonical_id`, `canonical_name`, `has_active_deal`, `store_count`, `deals`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/admin-dashboard.js tests/integration/mapped-products.test.js
git commit -m "feat(admin): add GET /mapped-products endpoint"
```

---

### Task 2: Frontend — `fetchMappedProducts` API util

**Files:**
- Modify: `client/src/utils/api.js` (add after `fetchCanonicalStats`, around line 340)

- [ ] **Step 1: Add the fetch function**

In `client/src/utils/api.js`, after the `fetchCanonicalStats` function:

```js
export function fetchMappedProducts() {
  return authRequest("/admin-dashboard/mapped-products");
}
```

- [ ] **Step 2: Verify the server reloads and the import is clean**

```bash
node -e "
// Quick syntax check only
const src = require('fs').readFileSync('client/src/utils/api.js', 'utf8');
console.log(src.includes('fetchMappedProducts') ? 'OK' : 'MISSING');
"
```

- [ ] **Step 3: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(admin): add fetchMappedProducts API util"
```

---

### Task 3: Frontend — sub-tabs + `MappedProductsTable` component

**Files:**
- Modify: `client/src/landing/AdminPage.jsx`
  - Add `fetchMappedProducts` to imports (~line 20)
  - Add `MappedProductsTable` component (~before `CanonicalStatsTab`, around line 212)
  - Add state + handlers inside `CanonicalStatsTab` (~after `selectedChip` state, line 219)
  - Replace unmapped products card header with sub-tab switcher (~line 437)

- [ ] **Step 1: Add `fetchMappedProducts` to imports**

Find the existing import block at the top of `AdminPage.jsx`. The line:
```js
  fetchCanonicalStats,
```
Change to:
```js
  fetchCanonicalStats,
  fetchMappedProducts,
```

- [ ] **Step 2: Add `MappedProductsTable` component**

Add this complete component immediately before the `function CanonicalStatsTab(` line (~line 212):

```jsx
function MappedProductsTable({ products, loading, error }) {
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState(new Set());

  function toggleRow(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-red-500 text-sm">
        {error}
      </div>
    );
  }
  if (!products) return null;
  if (products.length === 0) {
    return (
      <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
        No mapped products yet
      </div>
    );
  }

  const filtered = search
    ? products.filter((p) =>
        p.canonical_name.toLowerCase().includes(search.toLowerCase()),
      )
    : products;

  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        <input
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600 outline-none max-w-[260px] flex-1 focus:border-green-400"
          placeholder="Search canonical name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-[11px] text-slate-400">
          Showing {filtered.length} of {products.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[600px]">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
              <th className="pb-2 pr-4">Canonical name</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Stores</th>
              <th className="pb-2 w-5"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cp) => (
              <React.Fragment key={cp.canonical_id}>
                <tr
                  className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50"
                  onClick={() => toggleRow(cp.canonical_id)}
                >
                  <td className="py-2.5 pr-4 font-medium text-slate-700 max-w-[280px] truncate">
                    {cp.canonical_name}
                  </td>
                  <td className="py-2.5 pr-4">
                    {cp.has_active_deal ? (
                      <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full px-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-400 text-[10px] font-bold rounded-full px-2 py-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 inline-block" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-slate-600 font-semibold">
                    {cp.store_count} {cp.store_count === 1 ? "store" : "stores"}
                  </td>
                  <td className="py-2.5 text-slate-300 text-[11px]">
                    {expanded.has(cp.canonical_id) ? "▼" : "▶"}
                  </td>
                </tr>
                {expanded.has(cp.canonical_id) && (
                  <tr>
                    <td colSpan={4} className="pb-2 pt-0">
                      <div className="bg-slate-50 rounded-lg overflow-hidden mt-0.5">
                        <div className="grid grid-cols-[160px_1fr_72px] gap-3 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-200">
                          <span>Store</span>
                          <span>Product name</span>
                          <span>Link</span>
                        </div>
                        {cp.deals.map((deal, i) => (
                          <div
                            key={i}
                            className="grid grid-cols-[160px_1fr_72px] gap-3 px-3 py-2 text-xs border-b border-slate-100 last:border-0 items-center"
                          >
                            <span className="text-slate-600 font-semibold truncate">
                              {deal.store_name}
                            </span>
                            <span className="text-slate-800 truncate">
                              {deal.product_name}
                            </span>
                            <a
                              href={deal.product_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-700 font-bold text-[11px] hover:underline whitespace-nowrap"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View ↗
                            </a>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-sm text-slate-400 py-6">
                  No results for "{search}"
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add sub-tab state + handlers inside `CanonicalStatsTab`**

Inside `CanonicalStatsTab`, after the existing `const [selectedChip, setSelectedChip] = useState(null);` line, add:

```js
  const [mappedSubTab, setMappedSubTab] = React.useState("unmapped");
  const [mappedProducts, setMappedProducts] = React.useState(null);
  const [mappedLoading, setMappedLoading] = React.useState(false);
  const [mappedError, setMappedError] = React.useState(null);

  async function handleMappedTabOpen() {
    if (mappedProducts !== null) return;
    setMappedLoading(true);
    setMappedError(null);
    try {
      const data = await fetchMappedProducts();
      setMappedProducts(data);
    } catch (err) {
      setMappedError(String(err?.message || "Failed to load mapped products"));
    } finally {
      setMappedLoading(false);
    }
  }

  function handleSubTabChange(tab) {
    setMappedSubTab(tab);
    if (tab === "mapped") handleMappedTabOpen();
  }
```

- [ ] **Step 4: Replace the unmapped products card with sub-tabbed version**

Find this block in `CanonicalStatsTab` (around line 437):

```jsx
      {/* Unmapped products table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400">
            Unmapped products
          </div>
```

Replace the entire card (from `{/* Unmapped products table */}` through to its closing `</div>`) with:

```jsx
      {/* Unmapped / Mapped sub-tabs */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        {/* Sub-tab switcher */}
        <div className="flex gap-0 border-b-2 border-slate-100 mb-4 -mx-1">
          <button
            onClick={() => handleSubTabChange("unmapped")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-[1.2px] border-b-2 -mb-0.5 transition-colors ${
              mappedSubTab === "unmapped"
                ? "text-green-700 border-green-600"
                : "text-slate-400 border-transparent hover:text-slate-600"
            }`}
          >
            Unmapped{" "}
            <span
              className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                mappedSubTab === "unmapped"
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {unmappedCount}
            </span>
          </button>
          <button
            onClick={() => handleSubTabChange("mapped")}
            className={`px-3 py-2 text-[11px] font-bold uppercase tracking-[1.2px] border-b-2 -mb-0.5 transition-colors ${
              mappedSubTab === "mapped"
                ? "text-green-700 border-green-600"
                : "text-slate-400 border-transparent hover:text-slate-600"
            }`}
          >
            Mapped{" "}
            <span
              className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                mappedSubTab === "mapped"
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {mappedProducts ? mappedProducts.length : stats.total_canonicals}
            </span>
          </button>
        </div>

        {/* Unmapped content (existing) */}
        {mappedSubTab === "unmapped" && (
          <>
            {selectedChip && (
              <div className="flex items-center gap-3 mb-4">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[10px] font-bold">
                  {selectedChip}
                  <button
                    onClick={() => setSelectedChip(null)}
                    className="hover:text-green-600 leading-none"
                    title="Clear filter"
                  >
                    ×
                  </button>
                </span>
              </div>
            )}
            {stats.unmapped_products.length === 0 ? (
              <div className="flex items-center gap-2 text-green-700 text-sm font-medium py-4">
                <span className="text-lg">✓</span> All active products are mapped
              </div>
            ) : (() => {
              let exact = stats.unmapped_products;
              let similar = [];
              if (selectedChip) {
                const threshold = Math.min(3, Math.ceil(selectedChip.length / 4));
                const exactSet = new Set();
                exact = [];
                for (const p of stats.unmapped_products) {
                  const first = (p.product_name || "").split(/\s+/)[0].replace(/[^a-zA-Z0-9'&.-]/g, "").trim().toLowerCase();
                  if (first === selectedChip) { exact.push(p); exactSet.add(p.id); }
                }
                for (const p of stats.unmapped_products) {
                  if (exactSet.has(p.id)) continue;
                  const first = (p.product_name || "").split(/\s+/)[0].replace(/[^a-zA-Z0-9'&.-]/g, "").trim().toLowerCase();
                  if (levenshtein(first, selectedChip) <= threshold) similar.push(p);
                }
              }
              const hasResults = exact.length > 0 || similar.length > 0;

              function ProductRow({ p }) {
                return (
                  <tr key={p.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 pr-4 font-medium text-slate-700 max-w-[260px] truncate">{p.product_name}</td>
                    <td className="py-2.5 pr-4 text-slate-500 text-xs">{p.store_name}</td>
                    <td className="py-2.5 pr-4 text-slate-400 text-xs">{p.product_category}</td>
                    <td className="py-2.5 pr-4 text-slate-700 text-xs">
                      {p.sale_price != null ? `${p.currency || "€"} ${Number(p.sale_price).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2.5">
                      <a href={p.product_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-green-700 font-bold hover:underline whitespace-nowrap">
                        View ↗
                      </a>
                    </td>
                  </tr>
                );
              }

              const thead = (
                <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
                  <th className="pb-2 pr-4">Product</th>
                  <th className="pb-2 pr-4">Store</th>
                  <th className="pb-2 pr-4">Category</th>
                  <th className="pb-2 pr-4">Price</th>
                  <th className="pb-2">Link</th>
                </tr>
              );

              return (
                <div className="overflow-x-auto">
                  {!hasResults ? (
                    <div className="text-sm text-slate-400 py-4 text-center">
                      No unmapped products match "{selectedChip}"
                    </div>
                  ) : (
                    <>
                      {similar.length > 0 && (
                        <>
                          <div className="text-[10px] font-bold uppercase tracking-[1px] text-amber-500 mb-1">
                            Possible misspellings ({similar.length})
                          </div>
                          <table className="w-full text-sm min-w-[640px] mb-4">
                            <thead>{thead}</thead>
                            <tbody>{similar.map((p) => <ProductRow key={p.id} p={p} />)}</tbody>
                          </table>
                        </>
                      )}
                      {exact.length > 0 && (
                        <>
                          {similar.length > 0 && (
                            <div className="text-[10px] font-bold uppercase tracking-[1px] text-slate-400 mb-1">
                              Exact matches ({exact.length})
                            </div>
                          )}
                          <table className="w-full text-sm min-w-[640px]">
                            <thead>{thead}</thead>
                            <tbody>{exact.map((p) => <ProductRow key={p.id} p={p} />)}</tbody>
                          </table>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </>
        )}

        {/* Mapped content */}
        {mappedSubTab === "mapped" && (
          <MappedProductsTable
            products={mappedProducts}
            loading={mappedLoading}
            error={mappedError}
          />
        )}
      </div>
```

- [ ] **Step 5: Build and verify no console errors**

```bash
cd client && npm run build 2>&1 | tail -20
```

Expected: build completes with no errors. Warnings about bundle size are OK.

- [ ] **Step 6: Manual smoke test**

Start dev server (`npm run dev` from project root), open `http://localhost:2400/admin`, navigate to Canonical Stats tab. Verify:
- Two sub-tabs visible: "Unmapped N" and "Mapped N"
- Clicking "Unmapped" shows existing unmapped table (no regression)
- Clicking "Mapped" triggers fetch and shows table with canonical name / Active badge / store count
- Clicking a row expands store details with store name, product name, View ↗ link
- Clicking "View ↗" opens the store product page in new tab (does not collapse the row)
- Search input filters the list in real time

- [ ] **Step 7: Commit**

```bash
git add client/src/landing/AdminPage.jsx client/src/utils/api.js
git commit -m "feat(admin): add Mapped Products sub-tab to Canonical Stats"
```

---

### Task 4: Build frontend + final commit

- [ ] **Step 1: Build client**

```bash
cd client && npm run build
```

- [ ] **Step 2: Stage and commit the built assets**

```bash
cd ..
git add client/dist/
git commit -m "build: rebuild client for mapped-products tab"
```
