import React, { useState, useEffect, useCallback, useRef } from "react";
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

  const [searchInput, setSearchInput] = useState(q);
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

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

  const handleSearch = (e) => {
    const val = e.target.value;
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchParams(p => {
        const next = new URLSearchParams(p);
        if (val) next.set("q", val); else next.delete("q");
        return next;
      });
    }, 400);
  };

  const handleCategory = (cat) => {
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
        <div className="max-w-2xl mx-auto">
          <input
            type="search"
            placeholder="Search products…"
            value={searchInput}
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
