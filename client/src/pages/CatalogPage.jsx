import React, { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchCatalog, fetchCatalogSuggest } from "../utils/api";
import ProductCard from "../components/ProductCard";
import NavTabs from "../components/NavTabs";

const CATEGORIES = [
  "All", "Rice & Grains", "Flours & Baking", "Lentils & Pulses",
  "Spices & Masalas", "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets",
  "Beverages", "Dairy & Paneer", "Frozen Foods", "Fresh Produce",
  "Noodles & Pasta", "Canned & Packaged", "Personal Care", "Household",
];

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

function SuggestDropdown({ query, onSelect, onSelectCategory, onSeeAll, activeIdx }) {
  const [data, setData] = useState(null);
  const fetchRef = useRef(null);

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
    fetchRef.current = () => { cancelled = true; clearTimeout(timer); };
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  if (!data) return null;
  const { products = [], categories = [], stores = [] } = data;
  if (!products.length && !categories.length && !stores.length) return null;

  const allItems = [
    ...products.map(p => ({ kind: "product", ...p })),
    ...categories.map(c => ({ kind: "category", name: c.name })),
    ...stores.map(s => ({ kind: "store", name: s.name, store_id: s.store_id })),
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
          <p style={{ margin: 0, padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1.2px" }}>
            Products
          </p>
          {products.map((p, i) => (
            <button
              key={p.canonical_id}
              type="button"
              onClick={() => onSelect(p.canonical_name)}
              style={{
                width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                padding: "8px 14px", display: "flex", alignItems: "center", gap: 10,
                background: activeIdx === i ? "#f0fdf4" : "transparent",
                fontSize: 14, color: "#1e293b",
              }}
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
          <p style={{ margin: 0, padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1.2px" }}>
            Categories
          </p>
          {categories.map((c, i) => (
            <button
              key={c.name}
              type="button"
              onClick={() => onSelectCategory(c.name)}
              style={{
                width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                padding: "8px 14px", display: "flex", alignItems: "center", gap: 10,
                background: activeIdx === products.length + i ? "#f0fdf4" : "transparent",
                fontSize: 14, color: "#1e293b",
              }}
            >
              <span style={{ fontSize: 14 }}>🏷</span>
              <span>{highlight(c.name, query)}</span>
            </button>
          ))}
        </div>
      )}

      {stores.length > 0 && (
        <div style={{ borderTop: (products.length || categories.length) ? "1px solid #f1f5f9" : "none" }}>
          <p style={{ margin: 0, padding: "8px 14px 4px", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "1.2px" }}>
            Stores
          </p>
          {stores.map((s, i) => (
            <button
              key={s.store_id}
              type="button"
              onClick={() => onSelect(s.name)}
              style={{
                width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                padding: "8px 14px", display: "flex", alignItems: "center", gap: 10,
                background: activeIdx === products.length + categories.length + i ? "#f0fdf4" : "transparent",
                fontSize: 14, color: "#1e293b",
              }}
            >
              <span style={{ fontSize: 14 }}>🏪</span>
              <span>{highlight(s.name, query)}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onSeeAll}
        style={{
          width: "100%", textAlign: "left", border: "none", borderTop: "1px solid #f1f5f9",
          cursor: "pointer", padding: "10px 14px", display: "flex", alignItems: "center", gap: 8,
          background: activeIdx === allItems.length - 1 ? "#f0fdf4" : "#fafafa",
          fontSize: 13, fontWeight: 600, color: "#16a34a",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        See all results for &ldquo;{query}&rdquo;
      </button>
    </div>
  );
}

export default function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  const q = searchParams.get("q") || "";
  const category = searchParams.get("category") || "";
  const [searchInput, setSearchInput] = useState(q);

  const commitSearch = useCallback((val) => {
    setDropdownOpen(false);
    setActiveIdx(-1);
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (val) next.set("q", val); else next.delete("q");
      return next;
    });
  }, [setSearchParams]);

  const load = useCallback(async (params, reset) => {
    setLoading(true);
    setError(null);
    const myId = ++reqIdRef.current;
    try {
      const data = await fetchCatalog({ q: params.q, category: params.category, page: params.page, limit: 24 });
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
    load({ q, category, page: 1 }, true);
  }, [q, category, load]);

  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  // Close dropdown on outside click
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

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearchInput(val);
    setActiveIdx(-1);
    setDropdownOpen(val.length >= 2);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams(p => {
        const next = new URLSearchParams(p);
        if (val) next.set("q", val); else next.delete("q");
        return next;
      });
    }, 400);
  };

  const handleKeyDown = (e) => {
    if (!dropdownOpen) return;
    if (e.key === "Escape") { setDropdownOpen(false); setActiveIdx(-1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => i + 1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(-1, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); commitSearch(searchInput); }
  };

  const handleCategory = (cat) => {
    setDropdownOpen(false);
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (cat && cat !== "All") next.set("category", cat); else next.delete("category");
      return next;
    });
  };

  const handleLoadMore = () => {
    if (loading) return;
    const next = page + 1;
    setPage(next);
    load({ q, category, page: next }, false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <NavTabs />

      {/* Search + filters */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "12px 16px" }}>
        <div className="max-w-screen-xl mx-auto">
          {/* Search with dropdown */}
          <div ref={containerRef} style={{ position: "relative", marginBottom: 10 }}>
            <div style={{ position: "relative" }}>
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
              >
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={inputRef}
                type="search"
                placeholder="Search products…"
                value={searchInput}
                onChange={handleSearch}
                onFocus={() => { if (searchInput.length >= 2) setDropdownOpen(true); }}
                onKeyDown={handleKeyDown}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px 10px 36px", borderRadius: 14,
                  border: "1px solid #e2e8f0", fontSize: 14, color: "#1e293b",
                  outline: "none", background: "#f8fafc",
                }}
              />
            </div>

            {dropdownOpen && (
              <SuggestDropdown
                query={searchInput}
                activeIdx={activeIdx}
                onSelect={(name) => {
                  setSearchInput(name);
                  commitSearch(name);
                }}
                onSelectCategory={(cat) => {
                  setSearchInput("");
                  handleCategory(cat);
                }}
                onSeeAll={() => commitSearch(searchInput)}
              />
            )}
          </div>

          {/* Category chips */}
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            {CATEGORIES.map(cat => {
              const active = cat === "All" ? !category : category === cat;
              return (
                <button
                  key={cat}
                  type="button"
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
