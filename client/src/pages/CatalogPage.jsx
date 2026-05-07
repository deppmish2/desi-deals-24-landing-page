import React, { useContext, useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fetchCatalog, fetchDealStores, getAuthSession, logoutUser } from "../utils/api";
import ProductCard from "../components/ProductCard";
import NavTabs from "../components/NavTabs";
import SearchWithSuggest from "../components/SearchWithSuggest";
import FiltersModal from "../components/FiltersModal";
import SortDropdown from "../components/SortDropdown";
import LoginModal from "../components/LoginModal";
import { CartContext } from "../hooks/CartContext";

function UserCircleIcon({ size = 22, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M7 18c1.2-2.15 3.03-3.22 5.5-3.22S16.8 15.85 18 18" />
    </svg>
  );
}

export default function CatalogPage() {
  const navigate = useNavigate();
  const { count: cartCount } = useContext(CartContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalProducts, setTotalProducts] = useState(null);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);
  const debounceRef = useRef(null);

  const q           = searchParams.get("q")           || "";
  const category    = searchParams.get("category")    || "";
  const store       = searchParams.get("store")       || "";
  const sort        = searchParams.get("sort")        || "";
  const hideExpired = searchParams.get("hide_expired") === "1";

  const [searchInput, setSearchInput] = useState(q);
  const [filterDraft, setFilterDraft] = useState({
    stores: store ? [store] : [],
    category,
    minDiscount: "",
    priceMin: "",
    priceMax: "",
    hideExpired,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [storeNames, setStoreNames] = useState([]);
  const [loginModal, setLoginModal] = useState(null);
  const [session, setSession] = useState(() => getAuthSession());
  const isLoggedIn = Boolean(session?.accessToken);
  const isAdmin = Boolean(session?.user?.is_admin) || import.meta.env.DEV;

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
        hide_expired: params.hideExpired ? "1" : undefined,
      });
      if (reqIdRef.current !== myId) return;
      const { data: rows = [], pagination } = data;
      setProducts(prev => reset ? rows : [...prev, ...rows]);
      setHasMore(pagination.page < pagination.total_pages);
      if (reset) setTotalProducts(pagination.total ?? null);
    } catch (err) {
      if (reqIdRef.current !== myId) return;
      setError(err.message);
    } finally {
      if (reqIdRef.current === myId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(1);
    load({ q, category, store, sort, hideExpired, page: 1 }, true);
  }, [q, category, store, sort, hideExpired, load]);

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
      hideExpired,
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
      if (filterDraft.hideExpired) next.set("hide_expired", "1");
      else next.delete("hide_expired");
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
    load({ q, category, store, sort, hideExpired, page: next }, false);
  }

  async function handleLogout() {
    await logoutUser();
    navigate("/products", { replace: true });
  }

  const filterCount = Number(!!store) + Number(!!category) + Number(hideExpired);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <NavTabs />

      <main className="max-w-[1320px] mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6 flex flex-col gap-6">

        {/* Site header — logo + cart + sign in */}
        <div className="sticky top-0 sm:top-3 z-50 hidden sm:block">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 sm:rounded-[28px] sm:border sm:border-slate-200/60 bg-white px-4 sm:px-7 lg:px-8 py-4 sm:py-5 shadow-[0_4px_16px_rgba(15,23,42,0.07)] sm:shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
            <Link
              to="/products"
              className="flex min-w-0 items-center gap-3 no-underline"
              style={{ textDecoration: "none" }}
            >
              <img
                src="/landing/dd24-logo.svg"
                alt="DesiDeals24"
                className="w-6 h-7 sm:w-7 sm:h-8 object-contain"
              />
              <div className="min-w-0 text-[28px] font-extrabold leading-none tracking-[-0.06em] text-[#17874a]">
                DesiDeals24
              </div>
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => navigate("/cart")}
                className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-orange-50 hover:border-orange-300"
                title="Cart"
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                </svg>
                {cartCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-extrabold flex items-center justify-center leading-none">
                    {cartCount}
                  </span>
                )}
              </button>

              {isLoggedIn ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                >
                  Logout
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setLoginModal({})}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#d8eadb] bg-[#eff8f1] text-[13px] font-bold text-[#17874a] shadow-sm transition-colors hover:bg-[#e7f5ea] sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5"
                >
                  <UserCircleIcon size={20} color="#475569" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Hero section */}
        <section className="relative overflow-hidden rounded-[28px] border border-[#e7eefb] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] px-4 py-5 shadow-[0_22px_70px_rgba(15,23,42,0.07)] sm:px-7 sm:py-7 lg:px-8 lg:py-8">
          <div className="absolute inset-y-0 right-0 w-[42%] bg-[radial-gradient(circle_at_center,_rgba(22,163,74,0.12)_0%,_rgba(22,163,74,0)_72%)] pointer-events-none" />
          <div className="relative max-w-[760px]">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#17874a]/75 sm:text-[12px]">
              Largest collection of Desi groceries
            </p>
            <h1
              className="mt-2 text-[30px] font-bold leading-[0.96] tracking-[-0.06em] text-[#0f172a] sm:text-[42px] lg:text-[56px]"
              style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}
            >
              Stop overpaying for
              <br />
              Desi groceries!
            </h1>
            <p className="mt-3 max-w-[620px] text-[14px] font-medium leading-[1.55] text-slate-500 sm:text-[16px]">
              We find the cheapest price for your Desi grocery list.
            </p>
          </div>
        </section>

        {/* Search + filter/sort card */}
        <section className="relative z-10 rounded-[30px] border border-white/80 bg-[#edf3ff] shadow-[0_30px_90px_rgba(15,23,42,0.08)]">
          <div className="relative px-4 sm:px-6 lg:px-8 py-4 sm:py-5 lg:py-6 flex flex-col gap-4">
            <div className="flex gap-3 items-center">
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
                placeholder="Search for ghee, rice, spices..."
              />
              <button
                type="button"
                onClick={openFilters}
                className="relative hidden min-h-[58px] items-center justify-center gap-2 rounded-[22px] border border-white/80 bg-white px-4 py-3.5 text-[14px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 sm:inline-flex"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="12" y1="18" x2="20" y2="18"/>
                </svg>
                <span>Filters</span>
                {filterCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#9a6500] text-white text-[11px] font-extrabold flex items-center justify-center leading-none">
                    {filterCount}
                  </span>
                )}
              </button>
              <div className="hidden sm:block">
                <SortDropdown toolbar value={sort} onChange={handleSortChange} />
              </div>
            </div>

            {/* Matching Products count */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col min-w-0 gap-2">
                <span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-[1.5px] text-slate-500 leading-none">
                  Matching Products
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[22px] sm:text-[26px] font-black text-[#111827] leading-none">
                    {totalProducts !== null ? totalProducts.toLocaleString() : (
                      <span style={{ display: "inline-block", width: 48, height: 20, borderRadius: 6, background: "linear-gradient(90deg,#dde6f5 25%,#c8d6ee 50%,#dde6f5 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s ease-in-out infinite" }} />
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Product grid */}
        <div>
          {error && <p style={{ color: "#ef4444", fontSize: 14, textAlign: "center", padding: 24 }}>{error}</p>}
          {!error && products.length === 0 && !loading && (
            <p style={{ fontSize: 14, color: "#94a3b8", textAlign: "center", padding: 40 }}>No products found.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {products.map(p => (
              <ProductCard key={p.canonical_id} product={p} context="catalog" isAdmin={isAdmin} />
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
      </main>

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
          showExtendedFilters={true}
        />
      )}

      {loginModal && (
        <LoginModal
          message={loginModal.message}
          resumeState={null}
          onClose={() => setLoginModal(null)}
        />
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
