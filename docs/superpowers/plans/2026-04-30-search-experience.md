# Search Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fast search experience — auto-suggest dropdown (client-side JSON index) + full FTS5 results page — and wire it into the existing deals page header.

**Architecture:** `GET /api/v1/search/suggest-index` returns a gzipped JSON index fetched once per session. Client scores it on each keystroke (debounced 80ms). Submitting a query calls `GET /api/v1/search?q=<term>` which runs an FTS5 query. Results are canonical product cards showing cheapest price. FTS5 index is rebuilt post-crawl via `crawler/fts-rebuild.js` (built in the schema+crawl plan).

**Prerequisite:** Plan `2026-04-30-schema-and-crawl.md` complete (`fts_canonicals` table populated, `crawler/fts-rebuild.js` and `/api/v1/search/suggest-index` endpoint exist).

**Tech Stack:** React 18 + Tailwind CSS + React Router v6. `client/src/utils/api.js` for API calls.

**DB:** All dev/test uses `data/prod_local.db` (`DB_FILE=data/prod_local.db`).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `server/routes/search.js` | Modify | Add FTS5 full search endpoint `GET /api/v1/search` |
| `client/src/utils/api.js` | Modify | Add `fetchSearch`, `fetchSuggestIndex` |
| `client/src/hooks/useSuggestIndex.js` | Create | Fetch + cache suggest index, expose search scorer |
| `client/src/components/SearchInput.jsx` | Create | Search input with auto-suggest dropdown |
| `client/src/pages/SearchPage.jsx` | Create | Full search results page `/search` |
| `client/src/App.jsx` | Modify | Add `/search` route |

---

### Task 1: Add FTS5 full search endpoint to server/routes/search.js

**Files:**
- Modify: `server/routes/search.js`

- [ ] **Step 1: Read current search.js**

```bash
cat server/routes/search.js
```

- [ ] **Step 2: Write integration test**

Create `tests/integration/search-fts.test.js`:

```js
"use strict";
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

process.env.DB_FILE = "data/prod_local.db";
let server, baseUrl;

before(async () => {
  const app = require("../../server/index");
  await new Promise(r => setTimeout(r, 2000));
  server = app.listen(0);
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
});

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return res;
}

describe("GET /api/v1/search", () => {
  it("returns canonical cards for a keyword query", async () => {
    const res = await get("/api/v1/search?q=dal");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.results), "results array");
    assert.ok(data.results.length > 0, "has results for 'dal'");
    const first = data.results[0];
    assert.ok(first.id, "has id");
    assert.ok(first.canonical_name, "has canonical_name");
  });

  it("returns empty array for non-matching query", async () => {
    const res = await get("/api/v1/search?q=xyznotaproduct999");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.results, []);
  });

  it("GET /api/v1/search/suggest-index returns products/brands/categories", async () => {
    const res = await get("/api/v1/search/suggest-index");
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(Array.isArray(data.products));
    assert.ok(Array.isArray(data.brands));
    assert.ok(Array.isArray(data.categories));
  });
});
```

- [ ] **Step 3: Run test to confirm search endpoint fails**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/search-fts.test.js --reporter=spec 2>&1 | tail -10
```

- [ ] **Step 4: Add FTS5 search endpoint to server/routes/search.js**

In `server/routes/search.js`, add before `module.exports`:

```js
const db = require("../db");

const VALID_SORTS = new Set(["relevance", "cheapest", "most_stores"]);
const VALID_CATEGORIES = new Set([
  "Rice & Grains", "Flours & Baking", "Lentils & Pulses", "Spices & Masalas",
  "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets", "Beverages",
  "Dairy & Paneer", "Frozen Foods", "Fresh Produce", "Noodles & Pasta",
  "Canned & Packaged", "Personal Care", "Household", "Other",
]);

router.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ results: [] });

    const sort = VALID_SORTS.has(req.query.sort) ? req.query.sort : "relevance";
    const category = VALID_CATEGORIES.has(req.query.category) ? req.query.category : null;
    const storeId = req.query.store_id || null;

    // FTS5 query — sanitize special chars
    const ftsQuery = q.replace(/['"*\-()]/g, " ").trim() + "*";

    let sql = `
      SELECT
        cp.id,
        cp.canonical_name,
        cp.category,
        cp.image_url,
        fts.rank,
        COUNT(DISTINCT sp.store_id) AS store_count,
        MIN(CASE WHEN (sp.best_before IS NULL OR sp.best_before > date('now','+60 days')) THEN sp.sale_price END) AS cheapest_price,
        MIN(CASE WHEN (sp.best_before IS NOT NULL AND sp.best_before <= date('now','+60 days')) THEN sp.sale_price END) AS bbd_price,
        (SELECT s2.name FROM stores s2 JOIN store_products sp2 ON sp2.store_id = s2.id
         WHERE sp2.canonical_id = cp.id AND sp2.is_active = 1
           AND (sp2.best_before IS NULL OR sp2.best_before > date('now','+60 days'))
         ORDER BY sp2.sale_price ASC LIMIT 1) AS cheapest_store_name
      FROM fts_canonicals fts
      JOIN canonical_products cp ON cp.id = fts.canonical_id
      JOIN store_products sp ON sp.canonical_id = cp.id AND sp.is_active = 1
      WHERE fts_canonicals MATCH ?
    `;

    const params = [ftsQuery];

    if (category) {
      sql += " AND cp.category = ?";
      params.push(category);
    }
    if (storeId) {
      sql += " AND sp.store_id = ?";
      params.push(storeId);
    }

    sql += " GROUP BY cp.id";

    if (sort === "cheapest") {
      sql += " ORDER BY cheapest_price ASC NULLS LAST";
    } else if (sort === "most_stores") {
      sql += " ORDER BY store_count DESC";
    } else {
      sql += " ORDER BY fts.rank + (store_count * 0.1) DESC";
    }

    sql += " LIMIT 40";

    const results = await db.prepare(sql).all(...params);
    res.json({ results, q, sort });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 5: Run test — confirm passes**

```bash
DB_FILE=data/prod_local.db node --test tests/integration/search-fts.test.js --reporter=spec 2>&1 | tail -10
```
Expected: `pass 3`.

- [ ] **Step 6: Commit**

```bash
git add server/routes/search.js tests/integration/search-fts.test.js
git commit -m "feat: FTS5 full search endpoint GET /api/v1/search"
```

---

### Task 2: Add search API functions to api.js

**Files:**
- Modify: `client/src/utils/api.js`

- [ ] **Step 1: Append to api.js**

```js
// ── Search ────────────────────────────────────────────────────────────────────

export function fetchSearch(q, { sort, category, store_id } = {}) {
  return request("/api/v1/search", { q, sort, category, store_id });
}

let suggestIndexCache = null;
export async function fetchSuggestIndex() {
  if (suggestIndexCache) return suggestIndexCache;
  const res = await fetch("/api/v1/search/suggest-index");
  if (!res.ok) throw new Error("Failed to load suggest index");
  suggestIndexCache = await res.json();
  return suggestIndexCache;
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/utils/api.js
git commit -m "feat(api): add fetchSearch + fetchSuggestIndex"
```

---

### Task 3: useSuggestIndex hook

**Files:**
- Create: `client/src/hooks/useSuggestIndex.js`

- [ ] **Step 1: Create useSuggestIndex.js**

```js
import { useState, useEffect, useCallback } from "react";
import { fetchSuggestIndex } from "../utils/api";

export function useSuggestIndex() {
  const [index, setIndex] = useState(null);

  useEffect(() => {
    fetchSuggestIndex()
      .then(setIndex)
      .catch(() => {}); // fail silently — search still works server-side
  }, []);

  const score = useCallback((query) => {
    if (!index || !query.trim()) return { products: [], brands: [], categories: [] };

    const q = query.toLowerCase();
    const tokens = q.split(/\s+/).filter(t => t.length > 1);

    function scoreStr(str) {
      const s = str.toLowerCase();
      if (s === q) return 100;
      if (s.startsWith(q)) return 90;
      if (tokens.every(t => s.includes(t))) return 80;
      const matched = tokens.filter(t => s.includes(t)).length;
      return matched > 0 ? Math.round((matched / tokens.length) * 60) : 0;
    }

    const products = index.products
      .map(p => {
        const nameScore = scoreStr(p.name);
        const aliasScore = (p.aliases || []).reduce((max, a) => Math.max(max, scoreStr(a)), 0);
        return { ...p, _score: Math.max(nameScore, aliasScore) };
      })
      .filter(p => p._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 5);

    const brands = index.brands
      .map(b => ({ ...b, _score: scoreStr(b.name) }))
      .filter(b => b._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 3);

    const categories = index.categories
      .map(c => ({ ...c, _score: scoreStr(c.name) }))
      .filter(c => c._score > 0)
      .sort((a, b) => b._score - a._score)
      .slice(0, 3);

    return { products, brands, categories };
  }, [index]);

  return { index, score };
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/hooks/useSuggestIndex.js
git commit -m "feat: useSuggestIndex hook with client-side scoring"
```

---

### Task 4: SearchInput component with auto-suggest dropdown

**Files:**
- Create: `client/src/components/SearchInput.jsx`

- [ ] **Step 1: Create SearchInput.jsx**

```jsx
import React, { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSuggestIndex } from "../hooks/useSuggestIndex";

function mark(text, query) {
  if (!query) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) ? <mark key={i} className="bg-yellow-200 not-italic">{part}</mark> : part
  );
}

export default function SearchInput({ className = "", placeholder = "Search products, brands…" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [suggestions, setSuggestions] = useState({ products: [], brands: [], categories: [] });
  const debounceRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();
  const { score } = useSuggestIndex();

  const runScore = useCallback((q) => {
    if (!q.trim()) { setSuggestions({ products: [], brands: [], categories: [] }); return; }
    setSuggestions(score(q));
  }, [score]);

  function handleChange(e) {
    const q = e.target.value;
    setQuery(q);
    setActiveIdx(-1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runScore(q), 80);
    setOpen(true);
  }

  function handleSubmit(q = query) {
    if (!q.trim()) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  function handleKeyDown(e) {
    const flat = [
      ...suggestions.products,
      ...suggestions.brands,
      ...suggestions.categories,
    ];
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flat.length)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    if (e.key === "Escape") { setOpen(false); }
    if (e.key === "Enter") {
      if (activeIdx >= 0 && flat[activeIdx]) {
        const item = flat[activeIdx];
        if (item.category) navigate(`/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(item.name)}`);
        else if (item.count !== undefined) navigate(`/search?q=${encodeURIComponent(item.name)}`); // brand
        else navigate(`/search?q=${encodeURIComponent(item.name)}`); // product
        setOpen(false);
      } else {
        handleSubmit();
      }
    }
  }

  // Close on outside click
  useEffect(() => {
    function handler(e) { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hasResults = suggestions.products.length > 0 || suggestions.brands.length > 0 || suggestions.categories.length > 0;

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex">
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => query && setOpen(true)}
          placeholder={placeholder}
          className="w-full border border-gray-300 rounded-l-lg px-4 py-2 text-sm focus:outline-none focus:border-orange-400"
        />
        <button
          onClick={() => handleSubmit()}
          className="bg-orange-500 text-white px-4 py-2 rounded-r-lg hover:bg-orange-600 text-sm font-semibold"
        >
          Search
        </button>
      </div>

      {open && hasResults && (
        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 mt-1 overflow-hidden">
          {suggestions.products.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase px-3 pt-2 pb-1">Products</p>
              {suggestions.products.map((p, i) => (
                <button
                  key={p.id}
                  onMouseDown={() => { navigate(`/search?q=${encodeURIComponent(p.name)}`); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-gray-50 text-sm ${activeIdx === i ? "bg-gray-100" : ""}`}
                >
                  {p.img && <img src={p.img} alt="" className="w-8 h-8 object-cover rounded" />}
                  <span className="flex-1">{mark(p.name, query)}</span>
                  {p.cheapest_price != null && (
                    <span className="text-orange-600 font-semibold text-xs">€{p.cheapest_price.toFixed(2)}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {suggestions.brands.length > 0 && (
            <div className="border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase px-3 pt-2 pb-1">Brands</p>
              {suggestions.brands.map((b, i) => (
                <button
                  key={b.name}
                  onMouseDown={() => { navigate(`/search?q=${encodeURIComponent(b.name)}`); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${activeIdx === suggestions.products.length + i ? "bg-gray-100" : ""}`}
                >
                  {mark(b.name, query)}
                  <span className="text-gray-400 ml-1 text-xs">({b.count})</span>
                </button>
              ))}
            </div>
          )}

          {suggestions.categories.length > 0 && (
            <div className="border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase px-3 pt-2 pb-1">Categories</p>
              {suggestions.categories.map((c, i) => (
                <button
                  key={c.name}
                  onMouseDown={() => { navigate(`/search?q=${encodeURIComponent(query)}&category=${encodeURIComponent(c.name)}`); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${activeIdx === suggestions.products.length + suggestions.brands.length + i ? "bg-gray-100" : ""}`}
                >
                  {mark(c.name, query)}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-gray-100">
            <button
              onMouseDown={() => handleSubmit()}
              className="w-full text-left px-3 py-2 text-sm text-orange-600 font-semibold hover:bg-gray-50"
            >
              See all results for "{query}" →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and test auto-suggest**

```bash
cd client && npm run dev
```
Integrate `<SearchInput />` temporarily into DealsPage.jsx header, type "dal" — dropdown should appear with products/brands/categories.

- [ ] **Step 3: Wire SearchInput into DealsPage.jsx**

In `DealsPage.jsx`, find the existing search input (search for `<input` near the header). Replace it with `<SearchInput />` or wrap the existing input — adapt to the existing structure.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/SearchInput.jsx client/src/pages/DealsPage.jsx
git commit -m "feat: SearchInput component with auto-suggest dropdown"
```

---

### Task 5: Search results page

**Files:**
- Create: `client/src/pages/SearchPage.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create SearchPage.jsx**

```jsx
import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { fetchSearch } from "../utils/api";
import SearchInput from "../components/SearchInput";
import CartButton from "../components/CartButton";

const SORT_LABELS = { relevance: "Most relevant", cheapest: "Cheapest first", most_stores: "Most stores" };

function ProductCard({ product }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex gap-3">
      {product.image_url && (
        <img src={product.image_url} alt={product.canonical_name} className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm leading-tight">{product.canonical_name}</p>
        <p className="text-xs text-gray-500 mt-0.5">{product.category}</p>
        {product.cheapest_price != null && (
          <p className="text-orange-600 font-bold text-base mt-1">
            €{product.cheapest_price.toFixed(2)}
            {product.cheapest_store_name && (
              <span className="text-xs font-normal text-gray-500 ml-1">at {product.cheapest_store_name}</span>
            )}
          </p>
        )}
        {product.bbd_price != null && (
          <p className="text-amber-600 text-xs mt-0.5">⏰ Expiring soon: €{product.bbd_price.toFixed(2)}</p>
        )}
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-gray-400">{product.store_count} store{product.store_count !== 1 ? "s" : ""}</p>
          <CartButton deal={{ product_name: product.canonical_name, canonical_id: product.id }} />
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") || "";
  const sort = searchParams.get("sort") || "relevance";
  const category = searchParams.get("category") || "";

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!q) return;
    setLoading(true);
    setError(null);
    fetchSearch(q, { sort, category: category || undefined })
      .then(async (res) => {
        if (!res.ok) { setError("Search failed"); setLoading(false); return; }
        const data = await res.json();
        setResults(data.results || []);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [q, sort, category]);

  function setSort(s) { setSearchParams(p => { p.set("sort", s); return p; }); }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <SearchInput className="mb-4" />

      {q && (
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            {loading ? "Searching…" : `${results.length} result${results.length !== 1 ? "s" : ""} for "${q}"`}
            {category && <span className="ml-1 text-orange-600">in {category}</span>}
          </p>
          <div className="flex gap-1">
            {Object.entries(SORT_LABELS).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`text-xs px-2 py-1 rounded-full border ${sort === k ? "bg-orange-500 text-white border-orange-500" : "text-gray-600 border-gray-300 hover:bg-gray-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {!loading && !q && (
        <p className="text-gray-500 text-sm text-center py-12">Type something to search…</p>
      )}

      <div className="space-y-3">
        {results.map(product => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {!loading && q && results.length === 0 && (
        <p className="text-gray-500 text-sm text-center py-8">No results for "{q}".</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add `/search` route to App.jsx**

```jsx
const SearchPage = lazy(() => import("./pages/SearchPage"));
// In Routes:
<Route path="/search" element={<SearchPage />} />
```

- [ ] **Step 3: Start dev server and verify**

```bash
cd client && npm run dev
```
1. Type "toor dal" in the search input → suggestions appear
2. Press Enter or click "See all results" → `/search?q=toor+dal`
3. Results page loads with product cards, cheapest price, store count
4. Click sort options — results re-rank
5. "+ Cart" on a result adds to cart

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/SearchPage.jsx client/src/App.jsx
git commit -m "feat: search results page /search with FTS5 + sort options + cart integration"
```
