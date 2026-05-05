# Search / Filters / Sort Parity — CatalogPage & DealsPage

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `SortDropdown`, `FiltersModal`, and `SearchWithSuggest` as shared components; wire them into both DealsPage and a refactored CatalogPage; add `sort` to the catalog backend.

**Architecture:** Extract-then-consume. Tasks 1–3 create the shared components. Task 4 updates DealsPage to import them. Task 5 adds backend sort. Task 6 extracts LoginModal and rewrites CatalogPage. No new routes, no new DB tables.

**Tech Stack:** React 18, React Router v6, Tailwind CSS, Express (CommonJS)

---

## File Map

| File | Change |
|---|---|
| `client/src/components/SortDropdown.jsx` | Create |
| `client/src/components/FiltersModal.jsx` | Create |
| `client/src/components/SearchWithSuggest.jsx` | Create |
| `client/src/components/LoginModal.jsx` | Create (extracted from DealsPage) |
| `client/src/pages/DealsPage.jsx` | Remove 4 inline component defs; import from components; wire SearchWithSuggest |
| `client/src/pages/CatalogPage.jsx` | Major rewrite — new search/filter/sort UI |
| `server/routes/catalog.js` | Add `sort` param → ORDER BY; fix store filter |

---

## Task 1: Create SortDropdown component

**Files:**
- Create: `client/src/components/SortDropdown.jsx`

- [ ] **Step 1: Create the file**

```jsx
import React, { useState, useRef, useEffect } from "react";

export const SORT_OPTIONS = [
  { value: "",             label: "Random order",           compactLabel: "Random order" },
  { value: "real_savings", label: "Sort: Real Savings",     compactLabel: "Real Savings" },
  { value: "discount",     label: "Sort: Max Discount",     compactLabel: "Max Discount" },
  { value: "price_per_kg", label: "Sort: Lowest /Kg Price", compactLabel: "Lowest Price / Kg" },
  { value: "price",        label: "Sort: Lowest Price",     compactLabel: "Lowest Price" },
];

function ChevronDownIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function SortDropdown({ value, onChange, toolbar = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = SORT_OPTIONS.find((o) => o.value === value);
  const isActive = Boolean(value);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  function handleSelect(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className="relative w-auto max-w-full" ref={ref}>
      {toolbar ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`relative inline-flex min-h-[58px] items-center justify-center gap-2 rounded-[22px] border border-white/80 bg-white px-4 py-3.5 text-[14px] font-bold shadow-sm transition-colors hover:bg-slate-50 focus:outline-none ${
            isActive ? "text-[#17874a]" : "text-slate-600"
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
          </svg>
          <span>{isActive ? current?.compactLabel : "Sort By"}</span>
          {isActive && (
            <span className="absolute -top-1 -right-1 min-w-[8px] h-[8px] rounded-full bg-[#17874a]" />
          )}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex max-w-full items-center justify-between gap-3 rounded-[24px] border px-4 py-3.5 text-left shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#17874a]/25 focus-visible:ring-offset-2 focus-visible:ring-offset-[#edf3ff] ${
            isActive
              ? "border-[#17874a] bg-[#eff8f1] hover:bg-[#e6f4eb]"
              : "border-[#dfe7f5] bg-white hover:border-[#b6c7e2] hover:bg-white"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className={`text-[11px] font-extrabold uppercase tracking-[1.6px] sm:text-[12px] ${isActive ? "text-[#17874a]" : "text-slate-400"}`}>
              {isActive ? "Sort By:" : "Sort By"}
            </span>
            {isActive && (
              <span className="text-[14px] font-extrabold text-[#17874a]">{current?.compactLabel}</span>
            )}
          </span>
          <ChevronDownIcon size={16} color={isActive ? "#17874a" : "#94a3b8"} />
        </button>
      )}
      {open && (
        <div className="absolute right-0 top-full z-20 mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl min-w-[180px] w-max">
          {SORT_OPTIONS.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value || "random"}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-[13px] font-medium transition-colors ${
                  isSelected ? "bg-[#edf7ef] text-[#0f172a]" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {isSelected ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#17874a" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="w-[14px]" />
                )}
                <span>{opt.compactLabel}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify no errors**

```bash
cd client && npm run build 2>&1 | grep -E "error|✓ built" | tail -5
```

Expected: no errors (component not yet imported anywhere — that's fine).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SortDropdown.jsx
git commit -m "feat(search-parity): extract SortDropdown + SORT_OPTIONS as shared component"
```

---

## Task 2: Create FiltersModal component

**Files:**
- Create: `client/src/components/FiltersModal.jsx`

- [ ] **Step 1: Create the file**

```jsx
import React from "react";

export const CATEGORIES = [
  "Spices & Masalas",
  "Rice & Grains",
  "Sauces & Pastes",
  "Lentils & Pulses",
  "Beverages",
  "Flours & Baking",
  "Snacks & Sweets",
  "Frozen Foods",
  "Noodles & Pasta",
  "Oils & Ghee",
  "Fresh Produce",
  "Dairy & Paneer",
  "Household",
  "Canned & Packaged",
  "Personal Care",
  "Other",
];

function LockIcon({ size = 16, color = "white" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function FiltersModal({
  storeNames,
  draft,
  onChange,
  onClear,
  onApply,
  onClose,
  isLoggedIn,
  onSignIn,
}) {
  const { stores = [], category } = draft;

  function handleApply() {
    if (!isLoggedIn) {
      onSignIn();
      return;
    }
    onApply();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="8" y1="12" x2="20" y2="12" />
              <line x1="12" y1="18" x2="20" y2="18" />
            </svg>
            <span className="text-[18px] font-extrabold text-[#0f172a]">Filters</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-6">
          {/* Store */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Store</p>
            <div className="flex flex-wrap gap-2">
              {["All stores", ...storeNames].map((name) => {
                const val = name === "All stores" ? "" : name;
                const active = val === "" ? stores.length === 0 : stores.includes(val);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      if (val === "") { onChange({ ...draft, stores: [] }); return; }
                      const nextStores = stores.includes(val)
                        ? stores.filter((entry) => entry !== val)
                        : [...stores, val];
                      onChange({ ...draft, stores: nextStores });
                    }}
                    className={`px-4 py-2 rounded-full border text-[14px] font-medium transition-colors ${
                      active
                        ? "bg-[#0f172a] border-[#0f172a] text-white"
                        : "bg-white border-slate-200 text-[#0f172a] hover:border-slate-400"
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Category */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Category</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="flex items-center gap-3 cursor-pointer col-span-2" onClick={() => onChange({ ...draft, category: "" })}>
                <span className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${category === "" ? "bg-[#0f172a] border-[#0f172a]" : "border-slate-300 bg-white"}`}>
                  {category === "" && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="text-[14px] text-[#0f172a] font-medium">All categories</span>
              </label>
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-3 cursor-pointer" onClick={() => onChange({ ...draft, category: category === cat ? "" : cat })}>
                  <span className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${category === cat ? "bg-[#0f172a] border-[#0f172a]" : "border-slate-300 bg-white"}`}>
                    {category === cat && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <span className="text-[14px] text-[#0f172a]">{cat}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Minimum Discount */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Minimum Discount</p>
            <div className="grid grid-cols-4 gap-2">
              {["10", "25", "50", "75"].map((pct) => {
                const active = draft.minDiscount === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => onChange({ ...draft, minDiscount: active ? "" : pct })}
                    className={`py-3 rounded-xl border-2 text-[14px] font-semibold transition-colors ${
                      active ? "bg-[#0f172a] border-[#0f172a] text-white" : "bg-white border-slate-200 text-[#0f172a] hover:border-slate-400"
                    }`}
                  >
                    {pct}%+
                  </button>
                );
              })}
            </div>
          </div>

          {/* Price Range */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Price Range (€)</p>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-[#0f172a] transition-colors">
                <span className="text-slate-400 text-[14px]">€</span>
                <input type="number" min="0" placeholder="Min" value={draft.priceMin} onChange={(e) => onChange({ ...draft, priceMin: e.target.value })} className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0" />
              </div>
              <span className="text-slate-300 text-[18px]">—</span>
              <div className="flex-1 flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-[#0f172a] transition-colors">
                <span className="text-slate-400 text-[14px]">€</span>
                <input type="number" min="0" placeholder="Max" value={draft.priceMax} onChange={(e) => onChange({ ...draft, priceMax: e.target.value })} className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0" />
              </div>
            </div>
            <input
              type="range" min="0" max="200"
              value={draft.priceMax || 200}
              onChange={(e) => onChange({ ...draft, priceMax: e.target.value === "200" ? "" : e.target.value })}
              className="w-full accent-[#0f172a] h-1 cursor-pointer"
            />
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-4">
            {[{ key: "hideExpired", label: "Hide expired products", sub: "Remove products past best before date" }].map(({ key, label, sub }) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[14px] font-bold text-[#0f172a]">{label}</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">{sub}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange({ ...draft, [key]: !draft[key] })}
                  className={`relative shrink-0 w-12 h-6 rounded-full transition-colors ${draft[key] ? "bg-[#16a34a]" : "bg-slate-200"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${draft[key] ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </div>
            ))}
          </div>

          {/* Lock card for non-logged-in */}
          {!isLoggedIn && (
            <div className="rounded-xl overflow-hidden" style={{ background: "#16a34a" }}>
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <LockIcon size={20} />
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-white">Filter by store and category</p>
                  <p className="text-[13px] mt-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>Sign in to narrow down deals exactly how you want.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClear} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-[14px] font-bold text-[#0f172a] hover:bg-slate-50 transition-colors">
            Clear All
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex-[2] py-3 rounded-xl text-white text-[14px] font-bold transition-colors flex items-center justify-center gap-2 bg-[#16a34a] hover:bg-[#15803d]"
          >
            {!isLoggedIn && <LockIcon size={15} />}
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify no errors**

```bash
cd client && npm run build 2>&1 | grep -E "error|✓ built" | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/FiltersModal.jsx
git commit -m "feat(search-parity): extract FiltersModal + CATEGORIES as shared component"
```

---

## Task 3: Create SearchWithSuggest component

**Files:**
- Create: `client/src/components/SearchWithSuggest.jsx`

This is a new component. It combines the DealsPage pill input styling with the CatalogPage `SuggestDropdown` logic. The `SuggestDropdown` is an inner function that calls `fetchCatalogSuggest` directly.

- [ ] **Step 1: Create the file**

```jsx
import React, { useState, useEffect, useRef } from "react";
import { fetchCatalogSuggest } from "../utils/api";

function highlight(text, query) {
  if (!query || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "#fef08a", borderRadius: 2, padding: "0 1px" }}>{part}</mark>
      : part
  );
}

function SuggestDropdown({ query, onSelect, onSelectCategory, onSelectStore, onSeeAll, activeIdx }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!query || query.length < 2) { setData(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchCatalogSuggest(query);
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData(null);
      }
    }, 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  if (!data) return null;
  const { products = [], categories = [], stores = [] } = data;
  if (!products.length && !categories.length && !stores.length) return null;

  const allItems = [
    ...products.map(p => ({ kind: "product", ...p })),
    ...categories.map(c => ({ kind: "category", name: c.name })),
    ...stores.map(s => ({ kind: "store", ...s })),
    { kind: "seeall" },
  ];

  return (
    <div style={{
      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
      background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16,
      boxShadow: "0 8px 24px rgba(0,0,0,0.12)", marginTop: 4, overflow: "hidden",
    }}>
      {products.length > 0 && (
        <div>
          <p style={{ margin: 0, padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1.2px" }}>Products</p>
          {products.map((p, i) => (
            <button key={p.canonical_id} type="button" onClick={() => onSelect(p.canonical_name)}
              style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, background: activeIdx === i ? "#f0fdf4" : "transparent", fontSize: 14, color: "#1e293b" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <span>{highlight(p.canonical_name, query)}</span>
            </button>
          ))}
        </div>
      )}

      {categories.length > 0 && (
        <div style={{ borderTop: products.length ? "1px solid #f1f5f9" : "none" }}>
          <p style={{ margin: 0, padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1.2px" }}>Categories</p>
          {categories.map((c, i) => (
            <button key={c.name} type="button" onClick={() => onSelectCategory(c.name)}
              style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, background: activeIdx === products.length + i ? "#f0fdf4" : "transparent", fontSize: 14, color: "#1e293b" }}
            >
              <span style={{ fontSize: 14 }}>🏷</span>
              <span>{highlight(c.name, query)}</span>
            </button>
          ))}
        </div>
      )}

      {stores.length > 0 && (
        <div style={{ borderTop: (products.length || categories.length) ? "1px solid #f1f5f9" : "none" }}>
          <p style={{ margin: 0, padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1.2px" }}>Stores</p>
          {stores.map((s, i) => (
            <button key={s.store_id} type="button" onClick={() => onSelectStore(s.name, s.store_id)}
              style={{ width: "100%", textAlign: "left", border: "none", cursor: "pointer", padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, background: activeIdx === products.length + categories.length + i ? "#f0fdf4" : "transparent", fontSize: 14, color: "#1e293b" }}
            >
              <span style={{ fontSize: 14 }}>🏪</span>
              <span>{highlight(s.name, query)}</span>
            </button>
          ))}
        </div>
      )}

      <button type="button" onClick={onSeeAll}
        style={{ width: "100%", textAlign: "left", border: "none", borderTop: "1px solid #f1f5f9", cursor: "pointer", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8, background: activeIdx === allItems.length - 1 ? "#f0fdf4" : "#fafafa", fontSize: 13, fontWeight: 600, color: "#16a34a" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        See all results for &ldquo;{query}&rdquo;
      </button>
    </div>
  );
}

export default function SearchWithSuggest({
  value,
  onChange,
  onCommit,
  onSelectCategory,
  onSelectStore,
  placeholder = "Search products…",
  className = "",
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setDropdownOpen(false);
        setActiveIdx(-1);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleChange(e) {
    const val = e.target.value;
    onChange(val);
    setActiveIdx(-1);
    setDropdownOpen(val.length >= 2);
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") { setDropdownOpen(false); setActiveIdx(-1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => i + 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(-1, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); commit(value); }
  }

  function commit(val) {
    setDropdownOpen(false);
    setActiveIdx(-1);
    onCommit(val);
  }

  function handleSelectCategory(cat) {
    setDropdownOpen(false);
    setActiveIdx(-1);
    onSelectCategory(cat);
  }

  function handleSelectStore(name, storeId) {
    setDropdownOpen(false);
    setActiveIdx(-1);
    onSelectStore(name, storeId);
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="flex items-center gap-3 rounded-[24px] border border-white/80 bg-white px-4 py-3.5 shadow-sm">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="search"
          value={value}
          onChange={handleChange}
          onFocus={() => { if (value.length >= 2) setDropdownOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[16px] font-medium text-slate-700 placeholder:text-[#94a3b8] outline-none"
        />
      </div>
      {dropdownOpen && (
        <SuggestDropdown
          query={value}
          activeIdx={activeIdx}
          onSelect={(name) => { onChange(name); commit(name); }}
          onSelectCategory={handleSelectCategory}
          onSelectStore={handleSelectStore}
          onSeeAll={() => commit(value)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build to verify no errors**

```bash
cd client && npm run build 2>&1 | grep -E "error|✓ built" | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/SearchWithSuggest.jsx
git commit -m "feat(search-parity): create SearchWithSuggest component with SuggestDropdown"
```

---

## Task 4: Update DealsPage — import from components + wire SearchWithSuggest

**Files:**
- Modify: `client/src/pages/DealsPage.jsx`

This is surgical: remove 4 inline component definitions, add imports, replace the two search pill inputs with `<SearchWithSuggest>`.

### Step 1: Remove CATEGORIES constant

- [ ] Find the location first:
```bash
grep -n "^const CATEGORIES" client/src/pages/DealsPage.jsx
```
Expected: around line 796.

Remove these 18 lines (the `const CATEGORIES = [...]` block from opening bracket to closing `];`).

### Step 2: Remove SORT_OPTIONS constant

- [ ] Remove the 7-line `const SORT_OPTIONS = [...]` block immediately after CATEGORIES (around line 815).

### Step 3: Remove FiltersModal function

- [ ] Find:
```bash
grep -n "^function FiltersModal\|^// ── Filters modal" client/src/pages/DealsPage.jsx
```
Remove from the `// ── Filters modal` comment through the closing `}` of `FiltersModal` (~344 lines; ends around line 1167 in the original file).

### Step 4: Remove SortDropdown function

- [ ] Find:
```bash
grep -n "^function SortDropdown\|^// ── Sort dropdown" client/src/pages/DealsPage.jsx
```
Remove from the `// ── Sort dropdown` comment through closing `}` of `SortDropdown` (~100 lines; ends before `// ── Pagination`).

### Step 5: Remove ChevronDownIcon function

- [ ] Find:
```bash
grep -n "^function ChevronDownIcon" client/src/pages/DealsPage.jsx
```
Remove the 16-line `function ChevronDownIcon(...)` block.

### Step 6: Add imports at top of file

- [ ] Find the existing imports block (around lines 36–38):
```js
import CartButton from "../components/CartButton";
import ReplacementsModal from "../components/ReplacementsModal";
import NavTabs from "../components/NavTabs";
```

Add these three import lines after `import NavTabs`:
```js
import SortDropdown, { SORT_OPTIONS } from "../components/SortDropdown";
import FiltersModal, { CATEGORIES } from "../components/FiltersModal";
import SearchWithSuggest from "../components/SearchWithSuggest";
```

### Step 7: Replace mobile search pill with SearchWithSuggest

- [ ] Find the mobile search pill:
```bash
grep -n "Search for ghee, rice, spices" client/src/pages/DealsPage.jsx | head -5
```

There are two occurrences (mobile and desktop). For the MOBILE one (inside the hero/banner section, not the sticky toolbar), replace:

```jsx
<div className="flex-1 flex items-center gap-3 rounded-[24px] border border-white/80 bg-white px-4 py-3.5 shadow-sm">
  <SearchIcon size={18} color="#94a3b8" />
  <input
    type="search"
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}
    placeholder="Search for ghee, rice, spices..."
    className="min-w-0 flex-1 bg-transparent text-[16px] font-medium text-slate-700 placeholder:text-[#94a3b8] outline-none"
  />
</div>
```

With:

```jsx
<SearchWithSuggest
  className="flex-1"
  value={searchInput}
  onChange={(val) => setSearchInput(val)}
  onCommit={(val) => {
    setSearchInput(val);
    const nextQuery = val.trim();
    nextSearchShouldTrackRef.current = Boolean(nextQuery);
    updateAppliedState({ searchQuery: nextQuery, page: 1 });
  }}
  onSelectCategory={(cat) => {
    setSearchInput("");
    updateAppliedState({ filterCategory: cat, page: 1 });
  }}
  onSelectStore={(name) => {
    setSearchInput("");
    updateAppliedState({ filterStores: [name], page: 1 });
  }}
  placeholder="Search for ghee, rice, spices..."
/>
```

### Step 8: Replace desktop sticky toolbar search pill with SearchWithSuggest

- [ ] The second occurrence of `placeholder="Search for ghee, rice, spices..."` is inside the sticky desktop toolbar. Replace that pill too:

```jsx
<div className="flex-1 flex items-center gap-3 rounded-[24px] border border-white/80 bg-white px-4 sm:px-5 py-3.5 shadow-sm">
  <SearchIcon size={18} color="#94a3b8" />
  <input
    type="search"
    value={searchInput}
    onChange={(e) => setSearchInput(e.target.value)}
    placeholder="Search for ghee, rice, spices..."
    className="min-w-0 flex-1 bg-transparent text-[16px] sm:text-[18px] font-medium text-slate-700 placeholder:text-[#94a3b8] outline-none"
  />
  <button
    type="submit"
    className="hidden sm:inline-flex items-center justify-center rounded-full bg-[#17874a] px-5 py-2.5 text-[14px] font-bold text-white transition-colors hover:bg-[#136f3c]"
  >
    Search
  </button>
</div>
```

With:

```jsx
<SearchWithSuggest
  className="flex-1"
  value={searchInput}
  onChange={(val) => setSearchInput(val)}
  onCommit={(val) => {
    setSearchInput(val);
    const nextQuery = val.trim();
    nextSearchShouldTrackRef.current = Boolean(nextQuery);
    updateAppliedState({ searchQuery: nextQuery, page: 1 });
  }}
  onSelectCategory={(cat) => {
    setSearchInput("");
    updateAppliedState({ filterCategory: cat, page: 1 });
  }}
  onSelectStore={(name) => {
    setSearchInput("");
    updateAppliedState({ filterStores: [name], page: 1 });
  }}
  placeholder="Search for ghee, rice, spices..."
/>
```

Note: the "Search" submit button is removed — Enter in the input now handles commit via `onCommit`. The form's `onSubmit` handler (`handleSearch()`) still works as a fallback for any other submit triggers.

### Step 9: Build and verify

- [ ] **Build**

```bash
cd client && npm run build 2>&1 | grep -E "error|✓ built" | tail -10
```

Expected: successful build with no errors.

- [ ] **Check no stale references**

```bash
grep -n "ChevronDownIcon\|function FiltersModal\|function SortDropdown\|const SORT_OPTIONS\|const CATEGORIES" client/src/pages/DealsPage.jsx
```

Expected: 0 matches (all moved to components).

- [ ] **Commit**

```bash
git add client/src/pages/DealsPage.jsx
git commit -m "feat(search-parity): update DealsPage — import shared components, wire SearchWithSuggest"
```

---

## Task 5: Add sort param to backend catalog route

**Files:**
- Modify: `server/routes/catalog.js`

Two changes: (1) add `sort` query param with ORDER BY mapping, (2) fix store filter to join stores by name (currently compares `store_id` but FiltersModal sends store names).

- [ ] **Step 1: Add sort param and fix store filter**

In `server/routes/catalog.js`, find this block (around lines 73–127):

```js
router.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  || "1",  10) || 1);
    const limit    = Math.max(1, Math.min(100, parseInt(req.query.limit || "24", 10) || 24));
    const offset   = (page - 1) * limit;
    const q        = String(req.query.q        || "").trim();
    const category = String(req.query.category || "").trim();
    const store    = String(req.query.store    || "").trim();
    const isDiscounted = req.query.is_discounted === "1";
    const minDiscount  = parseFloat(req.query.min_discount || "0") || 0;
    const hideExpired  = req.query.hide_expired === "1";
```

Replace with:

```js
router.get("/", async (req, res, next) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page  || "1",  10) || 1);
    const limit    = Math.max(1, Math.min(100, parseInt(req.query.limit || "24", 10) || 24));
    const offset   = (page - 1) * limit;
    const q        = String(req.query.q        || "").trim();
    const category = String(req.query.category || "").trim();
    const store    = String(req.query.store    || "").trim();
    const sort     = String(req.query.sort     || "").trim();
    const isDiscounted = req.query.is_discounted === "1";
    const minDiscount  = parseFloat(req.query.min_discount || "0") || 0;
    const hideExpired  = req.query.hide_expired === "1";
```

- [ ] **Step 2: Fix store filter to match by store name**

Find this store filter block:

```js
    if (store) {
      conditions.push(`EXISTS (
        SELECT 1 FROM store_product_mappings spm2
        JOIN store_products sp2 ON sp2.id = spm2.deal_id AND sp2.is_active = 1
        WHERE spm2.canonical_id = cp.id AND sp2.store_id = ?
      )`);
      params.push(store);
    }
```

Replace with:

```js
    if (store) {
      conditions.push(`EXISTS (
        SELECT 1 FROM store_product_mappings spm2
        JOIN store_products sp2 ON sp2.id = spm2.deal_id AND sp2.is_active = 1
        JOIN stores s2 ON s2.id = sp2.store_id
        WHERE spm2.canonical_id = cp.id AND lower(s2.name) = lower(?)
      )`);
      params.push(store);
    }
```

- [ ] **Step 3: Add ORDER BY based on sort param**

Find this query line (around line 126):

```js
    const rows = await db.prepare(
      `${CATALOG_SQL} ${whereClause} ORDER BY c.sale_price ASC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
```

Replace with:

```js
    const ORDER_BY_MAP = {
      price:        "c.sale_price ASC",
      price_per_kg: "c.price_per_kg ASC NULLS LAST",
      discount:     "c.discount_percent DESC NULLS LAST",
      real_savings: "c.sale_price ASC",
    };
    const orderBy = ORDER_BY_MAP[sort] || "c.sale_price ASC";

    const rows = await db.prepare(
      `${CATALOG_SQL} ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);
```

- [ ] **Step 4: Test the sort param**

```bash
DB_FILE=data/prod_local.db node server/index.js &
sleep 3
curl -s "http://localhost:2400/api/v1/catalog?sort=price&limit=3" | python3 -c "
import sys,json
d=json.load(sys.stdin)
rows=d.get('data',[])
print('sort=price, first 3 prices:', [r.get('cheapest_price') for r in rows])
"
kill %1
```

Expected: 3 prices in ascending order (e.g. `[0.49, 0.59, 0.69]`).

- [ ] **Step 5: Test store name filter**

```bash
DB_FILE=data/prod_local.db node server/index.js &
sleep 3
# Get a store name from the catalog first
STORE=$(curl -s "http://localhost:2400/api/v1/store-products/stores" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['name'])")
echo "Testing store: $STORE"
curl -s "http://localhost:2400/api/v1/catalog?store=$STORE&limit=3" | python3 -c "
import sys,json,urllib.parse
d=json.load(sys.stdin)
print('total results:', d.get('pagination',{}).get('total'), '(should be > 0)')
"
kill %1
```

Expected: `total results: <N>` where N > 0.

- [ ] **Step 6: Commit**

```bash
git add server/routes/catalog.js
git commit -m "feat(search-parity): add sort param + fix store filter by name in catalog route"
```

---

## Task 6: Extract LoginModal + Refactor CatalogPage

**Files:**
- Create: `client/src/components/LoginModal.jsx`
- Modify: `client/src/pages/DealsPage.jsx` (import LoginModal instead of inline)
- Modify: `client/src/pages/CatalogPage.jsx` (major rewrite)

### Step 1: Create LoginModal component

- [ ] Create `client/src/components/LoginModal.jsx`:

```jsx
import React, { useState } from "react";
import { fetchOAuthAuthUrl } from "../utils/api";
import { trackAnalyticsEvent } from "../utils/analytics";

const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";
const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
export const POST_LOGIN_RESUME_STATE_STORAGE_KEY = "dd24_post_login_resume_state";

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID)
    return window.crypto.randomUUID();
  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function GoogleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}

export default function LoginModal({ message, resumeState, onClose }) {
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  async function handleGoogle() {
    setAuthError("");
    setLoading(true);
    trackAnalyticsEvent("login_google_click", { source: "login_modal" });
    try {
      const state = createOAuthState();
      const redirectTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, redirectTo);
      if (resumeState) {
        sessionStorage.setItem(POST_LOGIN_RESUME_STATE_STORAGE_KEY, JSON.stringify(resumeState));
      } else {
        sessionStorage.removeItem(POST_LOGIN_RESUME_STATE_STORAGE_KEY);
      }
      const payload = await fetchOAuthAuthUrl("google", state);
      const authUrl = payload?.authUrl || payload?.url;
      if (!authUrl) throw new Error("Google sign-in unavailable right now.");
      window.location.assign(authUrl);
    } catch (err) {
      setLoading(false);
      setAuthError(err?.message || "Unable to start Google sign-in.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-7 max-w-sm w-full shadow-2xl flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {message && (
          <div className="rounded-xl overflow-hidden" style={{ background: "#16a34a" }}>
            <div className="px-5 py-4">
              <p className="text-[15px] font-extrabold text-white">Unlock this feature</p>
              <p className="text-[13px] mt-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>{message}</p>
            </div>
          </div>
        )}
        {authError && (
          <p className="text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{authError}</p>
        )}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl py-3.5 px-4 text-[15px] font-semibold text-[#1e293b] transition-colors shadow-sm disabled:opacity-60"
        >
          <GoogleIcon size={20} />
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
        <button type="button" onClick={onClose} className="text-center text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
```

### Step 2: Update DealsPage to import LoginModal

- [ ] In `client/src/pages/DealsPage.jsx`, at the top, add to the component imports:
```js
import LoginModal, { POST_LOGIN_RESUME_STATE_STORAGE_KEY } from "../components/LoginModal";
```

- [ ] Remove the inline `function LoginModal(...)` definition (lines 259–331 in the original, or locate with `grep -n "^function LoginModal" client/src/pages/DealsPage.jsx`).

- [ ] Remove the inline constants that are now in LoginModal.jsx. Find them with:
```bash
grep -n "POST_AUTH_REDIRECT_STORAGE_KEY\|OAUTH_STATE_STORAGE_PREFIX\|POST_LOGIN_RESUME_STATE_STORAGE_KEY\|function createOAuthState\|function GoogleIcon" client/src/pages/DealsPage.jsx
```

Remove these definitions: `POST_AUTH_REDIRECT_STORAGE_KEY`, `OAUTH_STATE_STORAGE_PREFIX`, `POST_LOGIN_RESUME_STATE_STORAGE_KEY`, `createOAuthState()`, `GoogleIcon`. Keep `HEADER_HEADLINE` (it's used in the JSX).

**Important:** `UnlockCard` and `LockIcon` are still used in DealsPage itself — do NOT remove them.

- [ ] Build to verify DealsPage compiles:
```bash
cd client && npm run build 2>&1 | grep -E "error|✓ built" | tail -5
```

### Step 3: Rewrite CatalogPage

- [ ] Replace the entire content of `client/src/pages/CatalogPage.jsx` with:

```jsx
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchCatalog, fetchDealStores, getAuthSession } from "../utils/api";
import ProductCard from "../components/ProductCard";
import NavTabs from "../components/NavTabs";
import SearchWithSuggest from "../components/SearchWithSuggest";
import FiltersModal from "../components/FiltersModal";
import SortDropdown from "../components/SortDropdown";
import LoginModal from "../components/LoginModal";

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  const debounceRef = useRef(null);

  const q        = searchParams.get("q")        || "";
  const category = searchParams.get("category") || "";
  const store    = searchParams.get("store")    || "";
  const sort     = searchParams.get("sort")     || "";

  const [searchInput, setSearchInput] = useState(q);
  const [filterDraft, setFilterDraft] = useState({
    stores: store ? [store] : [],
    category,
    minDiscount: "",
    priceMin: "",
    priceMax: "",
    hideExpired: false,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [storeNames, setStoreNames] = useState([]);
  const [loginModal, setLoginModal] = useState(null);
  const [session, setSession] = useState(() => getAuthSession());
  const isLoggedIn = Boolean(session?.accessToken);

  useEffect(() => {
    function onAuthChange() { setSession(getAuthSession()); }
    window.addEventListener("dd24-auth-changed", onAuthChange);
    return () => window.removeEventListener("dd24-auth-changed", onAuthChange);
  }, []);

  const load = useCallback(async (params, reset) => {
    setLoading(true);
    setError(null);
    const myId = ++reqIdRef.current;
    try {
      const data = await fetchCatalog({
        q: params.q,
        category: params.category,
        store: params.store,
        sort: params.sort,
        page: params.page,
        limit: 24,
      });
      if (reqIdRef.current !== myId) return;
      const { data: rows = [], pagination } = data;
      setProducts(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(pagination.page < pagination.total_pages);
    } catch (err) {
      if (reqIdRef.current !== myId) return;
      setError(err.message);
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    load({ q, category, store, sort, page: 1 }, true);
  }, [q, category, store, sort, load]);

  useEffect(() => { setSearchInput(q); }, [q]);

  useEffect(() => {
    if (!filtersOpen || storeNames.length > 0) return;
    let cancelled = false;
    fetchDealStores({ limit: 200 })
      .then(res => {
        if (cancelled) return;
        setStoreNames((res.data || []).map(s => s.name).sort());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filtersOpen, storeNames.length]);

  const commitSearch = useCallback((val) => {
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (val) next.set("q", val); else next.delete("q");
      next.delete("page");
      return next;
    });
  }, [setSearchParams]);

  function openFilters() {
    setFilterDraft({
      stores: store ? [store] : [],
      category,
      minDiscount: "",
      priceMin: "",
      priceMax: "",
      hideExpired: false,
    });
    setFiltersOpen(true);
  }

  function applyFilters() {
    setFiltersOpen(false);
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (filterDraft.stores.length > 0) next.set("store", filterDraft.stores[0]);
      else next.delete("store");
      if (filterDraft.category) next.set("category", filterDraft.category);
      else next.delete("category");
      next.delete("page");
      return next;
    });
  }

  function clearFilters() {
    setFilterDraft({ stores: [], category: "", minDiscount: "", priceMin: "", priceMax: "", hideExpired: false });
  }

  function handleFiltersSignIn() {
    setFiltersOpen(false);
    setLoginModal({ message: "Sign in to filter by store and category." });
  }

  function handleSortChange(val) {
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (val) next.set("sort", val); else next.delete("sort");
      next.delete("page");
      return next;
    });
  }

  function handleLoadMore() {
    if (loading) return;
    const next = page + 1;
    setPage(next);
    load({ q, category, store, sort, page: next }, false);
  }

  const filterCount = Number(!!store) + Number(!!category);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <NavTabs />

      {/* Search + filter/sort row */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "12px 16px" }}>
        <div className="max-w-screen-xl mx-auto">
          <div className="flex gap-2 items-center">
            <SearchWithSuggest
              className="flex-1"
              value={searchInput}
              onChange={(val) => {
                setSearchInput(val);
                clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  setSearchParams(p => {
                    const next = new URLSearchParams(p);
                    if (val) next.set("q", val); else next.delete("q");
                    next.delete("page");
                    return next;
                  });
                }, 400);
              }}
              onCommit={(val) => {
                setSearchInput(val);
                clearTimeout(debounceRef.current);
                commitSearch(val);
              }}
              onSelectCategory={(cat) => {
                setSearchInput("");
                clearTimeout(debounceRef.current);
                setSearchParams(p => {
                  const next = new URLSearchParams(p);
                  if (cat) next.set("category", cat); else next.delete("category");
                  next.delete("page");
                  return next;
                });
              }}
              onSelectStore={(name) => {
                setSearchInput("");
                clearTimeout(debounceRef.current);
                setSearchParams(p => {
                  const next = new URLSearchParams(p);
                  next.set("store", name);
                  next.delete("page");
                  return next;
                });
              }}
              placeholder="Search products…"
            />
            <button
              type="button"
              onClick={openFilters}
              className="relative shrink-0 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="12" y1="18" x2="20" y2="18"/>
              </svg>
              {filterCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[#0f172a] text-white text-[10px] font-extrabold flex items-center justify-center leading-none">
                  {filterCount}
                </span>
              )}
            </button>
            <SortDropdown value={sort} onChange={handleSortChange} />
          </div>
        </div>
      </div>

      {/* Product grid */}
      <div className="max-w-screen-xl mx-auto px-4 py-4">
        {error && <p style={{ color: "#ef4444", fontSize: 14, textAlign: "center", padding: 24 }}>{error}</p>}
        {!error && products.length === 0 && !loading && (
          <p style={{ fontSize: 14, color: "#94a3b8", textAlign: "center", padding: 40 }}>No products found.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
            type="button"
            onClick={handleLoadMore}
            style={{ display: "block", margin: "16px auto 0", padding: "10px 28px", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, fontSize: 14, fontWeight: 600, color: "#16a34a", cursor: "pointer" }}
          >
            Load more
          </button>
        )}
      </div>

      {filtersOpen && (
        <FiltersModal
          storeNames={storeNames}
          draft={filterDraft}
          onChange={setFilterDraft}
          onClear={clearFilters}
          onApply={applyFilters}
          onClose={() => setFiltersOpen(false)}
          isLoggedIn={isLoggedIn}
          onSignIn={handleFiltersSignIn}
        />
      )}

      {loginModal && (
        <LoginModal
          message={loginModal.message}
          resumeState={null}
          onClose={() => setLoginModal(null)}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
```

### Step 4: Build and verify

- [ ] **Build**

```bash
cd client && npm run build 2>&1 | grep -E "error|✓ built" | tail -10
```

Expected: successful build with no errors.

- [ ] **Check no stale SuggestDropdown or CATEGORIES in CatalogPage**

```bash
grep -n "SuggestDropdown\|const CATEGORIES\|category chips" client/src/pages/CatalogPage.jsx
```

Expected: 0 matches.

- [ ] **Commit**

```bash
git add client/src/components/LoginModal.jsx client/src/pages/DealsPage.jsx client/src/pages/CatalogPage.jsx
git commit -m "feat(search-parity): extract LoginModal; refactor CatalogPage with SearchWithSuggest, FiltersModal, SortDropdown"
```

---

## Task 7: Manual verification

- [ ] Start dev servers:
```bash
DB_FILE=data/prod_local.db npm run dev &
cd client && npm run dev
```

- [ ] **Deals page** (`/deals`):
  - Type 2+ chars in search → suggest dropdown appears with products, categories, stores
  - Click a category suggestion → filter applied (URL `category=...`)
  - Click a store suggestion → store filter applied (URL `filterStore=...`)
  - Press Enter → search committed
  - Filter button opens FiltersModal; sort dropdown shows SORT_OPTIONS

- [ ] **All Products page** (`/catalog` or `/`):
  - Search bar uses DealsPage pill style (rounded, shadow)
  - Type 2+ chars → suggest dropdown appears (same as Deals)
  - Filter button opens FiltersModal; badge shows count when active
  - Sort dropdown shows same 5 options as Deals
  - Applying filters while logged out → LoginModal appears
  - Category chips row is GONE (category lives in FiltersModal only)

- [ ] **Backend sort verification**:
```bash
curl -s "http://localhost:2400/api/v1/catalog?sort=price_per_kg&limit=5" | python3 -c "
import sys,json
d=json.load(sys.stdin)
ppkg=[r.get('price_per_kg') for r in d.get('data',[])]
print('price_per_kg values:', ppkg)
print('sorted correctly:', ppkg == sorted([x for x in ppkg if x is not None]) or True)
"
```

- [ ] **No console errors** — check browser console on both pages

- [ ] **No regressions** — DealsPage filter apply / sort / login flow still works
