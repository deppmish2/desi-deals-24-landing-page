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
