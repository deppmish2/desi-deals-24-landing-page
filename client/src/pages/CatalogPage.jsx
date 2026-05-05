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

  useEffect(() => () => clearTimeout(debounceRef.current), []);

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
          onChange={(newDraft) => {
            if (newDraft.stores.length > 1) {
              const added = newDraft.stores.find(s => !filterDraft.stores.includes(s));
              setFilterDraft({ ...newDraft, stores: added ? [added] : newDraft.stores.slice(0, 1) });
            } else {
              setFilterDraft(newDraft);
            }
          }}
          onClear={clearFilters}
          onApply={applyFilters}
          onClose={() => setFiltersOpen(false)}
          isLoggedIn={isLoggedIn}
          onSignIn={handleFiltersSignIn}
          showExtendedFilters={false}
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
