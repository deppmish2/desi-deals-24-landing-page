import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import {
  formatBestBefore,
  formatPrice,
  formatPricePerKg,
} from "../utils/formatters";
import {
  addBookmark,
  fetchBookmarks,
  fetchDeals,
  getAuthSession,
  logoutUser,
  removeBookmark,
} from "../utils/api";

const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";

// ── Login required modal ─────────────────────────────────────────────────────
function LoginModal({ message, onClose, onGoLogin }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-8 max-w-sm w-full shadow-2xl flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2">
          <h2 className="text-[20px] font-extrabold text-[#0f172a]">
            Register to unlock
          </h2>
          <p className="text-[14px] text-slate-500 leading-relaxed">
            {message || "Create a free account to access this feature."}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onGoLogin}
            className="w-full bg-[#16a34a] hover:bg-[#15803d] text-white font-bold text-[14px] py-3 rounded-xl transition-colors"
          >
            Register / Sign in
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full border border-slate-200 text-slate-600 font-bold text-[14px] py-3 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function proxyImageUrl(imageUrl) {
  if (!imageUrl) return null;
  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

function resolveUrl(deal, url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const storeBase = String(deal?.store?.url || "").replace(/\/+$/, "");
  return storeBase
    ? `${storeBase}${raw.startsWith("/") ? "" : "/"}${raw}`
    : raw;
}

// ── Deal card ────────────────────────────────────────────────────────────────
function DealCard({ deal, isBookmarked, onBookmark }) {
  const [imgError, setImgError] = useState(false);
  const proxyImg = proxyImageUrl(deal?.image_url);
  const discountPct = deal?.discount_percent
    ? Math.round(deal.discount_percent)
    : null;
  const bestBeforeText = deal?.best_before
    ? formatBestBefore(deal.best_before)
    : null;
  const priceText = formatPrice(deal.sale_price, deal.currency);
  const originalPriceText = deal.original_price
    ? formatPrice(deal.original_price, deal.currency)
    : null;
  const weightText = [
    deal.weight_raw || null,
    deal.price_per_kg ? formatPricePerKg(deal.price_per_kg) : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <div
      className="bg-white border border-[#f1f5f9] rounded-[20px] flex flex-col overflow-hidden"
      style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
    >
      {/* Image */}
      <div className="relative w-full h-[200px] bg-white flex items-center justify-center p-5">
        <img
          src={
            imgError || !proxyImg
              ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">🛒</text></svg>'
              : proxyImg
          }
          alt={deal.product_name}
          loading="lazy"
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
        {discountPct > 0 && (
          <div
            className="absolute top-3 right-3 rounded-[8px] px-2.5 py-1"
            style={{
              backgroundColor:
                discountPct > 50
                  ? "#ffe4e8"
                  : discountPct >= 30
                    ? "#fff3e0"
                    : discountPct >= 20
                      ? "#e8f0fe"
                      : "#f1f5f9",
            }}
          >
            <span
              className="font-bold text-[13px] leading-none"
              style={{
                color:
                  discountPct > 50
                    ? "#e53e3e"
                    : discountPct >= 30
                      ? "#c05200"
                      : discountPct >= 20
                        ? "#1a56db"
                        : "#1e293b",
              }}
            >
              -{discountPct}%
            </span>
          </div>
        )}
        {bestBeforeText && (
          <span className="absolute bottom-3 left-3 bg-[#d5890f] text-white text-[10px] leading-[15px] font-medium rounded-full px-2 py-0.5">
            {bestBeforeText}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 px-5 pt-4 pb-5 gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[#94a3b8] text-[10px] leading-[15px] tracking-[1.5px] uppercase font-extrabold">
            {deal.store?.name || "Store"}
          </p>
          <p className="text-[#1e293b] text-[15px] leading-[22px] font-bold line-clamp-2 min-h-[44px]">
            {deal.product_name}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[#1e293b] text-[22px] leading-[30px] font-extrabold">
                {priceText}
              </span>
              {originalPriceText && (
                <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">
                  {originalPriceText}
                </span>
              )}
            </div>
            {weightText && (
              <span className="text-[#94a3b8] text-[11px] leading-[16px] font-medium text-right shrink-0">
                {weightText}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <a
            href={resolveUrl(deal, deal.product_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline"
          >
            <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">
              Snatch Deal
            </span>
          </a>
          <button
            type="button"
            onClick={() => onBookmark(deal.id)}
            className={`shrink-0 inline-flex items-center justify-center gap-1.5 h-[46px] px-4 rounded-[14px] border transition-colors ${
              isBookmarked
                ? "bg-[#16a34a] border-[#16a34a] text-white"
                : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
            }`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark it"}
            aria-label={isBookmarked ? "Remove bookmark" : "Bookmark it"}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill={isBookmarked ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-[13px] font-bold">
              {isBookmarked ? "Saved" : "Bookmark"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function DealsPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortByDiscount, setSortByDiscount] = useState(false);
  const [filterStore, setFilterStore] = useState("");
  const [loginModal, setLoginModal] = useState(null); // null | { message }
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());

  const session = useMemo(() => getAuthSession(), []);
  const isLoggedIn = Boolean(session?.accessToken);

  const { deals, loading, error } = useDeals({
    enabled: true,
    limit: 24,
    q: searchQuery || undefined,
    sort: sortByDiscount && isLoggedIn ? "discount" : undefined,
    store: filterStore && isLoggedIn ? filterStore : undefined,
  });

  // Load bookmarks if logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchBookmarks()
      .then((res) => setBookmarkedIds(new Set(res.data || [])))
      .catch(() => {});
  }, [isLoggedIn]);

  const displayDeals = useMemo(
    () =>
      (Array.isArray(deals) ? deals : []).filter(
        (d) => d?.product_url && d?.product_name,
      ),
    [deals],
  );

  // Store names for the dropdown — populated once from an unfiltered fetch so
  // the list doesn't disappear when a store filter is active.
  const [storeNames, setStoreNames] = useState([]);
  useEffect(() => {
    fetchDeals({ limit: 200 })
      .then((res) => {
        const names = new Set();
        (res.data || []).forEach((d) => {
          if (d.store?.name) names.add(d.store.name);
        });
        setStoreNames(Array.from(names).sort());
      })
      .catch(() => {});
  }, []);

  function requireLogin(message, action) {
    if (!isLoggedIn) {
      setLoginModal({ message });
    } else {
      action?.();
    }
  }

  function handleSortToggle() {
    requireLogin(
      "Sort by discount % is available to registered members. Sign up — it's free!",
      () => setSortByDiscount((v) => !v),
    );
  }

  function handleStoreFilter(value) {
    if (value && !isLoggedIn) {
      setLoginModal({
        message:
          "Filtering by store is available to registered members. Sign up — it's free!",
      });
      return;
    }
    setFilterStore(value);
  }

  const handleBookmark = useCallback(
    (dealId) => {
      if (!isLoggedIn) {
        setLoginModal({
          message:
            "Bookmark deals to easily find them again. Sign up — it's free!",
        });
        return;
      }
      const wasBookmarked = bookmarkedIds.has(dealId);
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (wasBookmarked) next.delete(dealId);
        else next.add(dealId);
        return next;
      });
      if (wasBookmarked) {
        removeBookmark(dealId).catch(() => {
          setBookmarkedIds((prev) => {
            const next = new Set(prev);
            next.add(dealId);
            return next;
          });
        });
      } else {
        addBookmark(dealId).catch(() => {
          setBookmarkedIds((prev) => {
            const next = new Set(prev);
            next.delete(dealId);
            return next;
          });
        });
      }
    },
    [isLoggedIn, bookmarkedIds],
  );

  async function handleLogout() {
    await logoutUser();
    navigate("/deals", { replace: true });
  }

  function goToLogin() {
    sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, "/deals");
    setLoginModal(null);
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      {/* Header */}
      <header className="backdrop-blur-md bg-white/80 border-b border-slate-200 sticky top-0 z-30">
        <div className="h-16 max-w-[1280px] mx-auto px-4 sm:px-8 flex items-center justify-between gap-4">
          <Link to="/deals" className="flex items-center gap-2 no-underline">
            <img
              src="/landing/dd24-logo.svg"
              alt="DesiDeals24"
              className="w-5 h-6 object-contain"
            />
            <span className="font-extrabold tracking-[-0.5px] text-[20px] text-[#141414]">
              DesiDeals24
            </span>
            <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-slate-400 -translate-y-1">
              · Beta
            </span>
          </Link>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] text-slate-600 transition-colors"
              >
                Logout
              </button>
            ) : (
              <button
                type="button"
                onClick={goToLogin}
                className="rounded-full bg-[#16a34a] hover:bg-[#15803d] text-white px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] transition-colors"
              >
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-8">
        {/* Heading + countdown */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[36px] font-extrabold text-[#0f172a] leading-tight">
              Deals
            </h1>
            <p className="text-slate-500 text-[14px] mt-1">
              Fresh deals from Indian grocery stores in Germany
            </p>
          </div>
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search — always public */}
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search deals, products, categories…"
              className="w-full pl-9 pr-4 py-3 border border-slate-200 rounded-xl bg-white text-[14px] text-slate-800 placeholder-slate-400 outline-none focus:border-[#16a34a] transition-colors"
            />
          </div>

          {/* Store filter — gated */}
          <div className="relative">
            <select
              value={filterStore}
              onChange={(e) => handleStoreFilter(e.target.value)}
              className="appearance-none pl-4 pr-9 py-3 border border-slate-200 rounded-xl bg-white text-[14px] text-slate-600 outline-none focus:border-[#16a34a] transition-colors cursor-pointer"
            >
              <option value="">All stores {!isLoggedIn ? "🔒" : ""}</option>
              {storeNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <svg
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </div>

          {/* Sort by discount — gated */}
          <button
            type="button"
            onClick={handleSortToggle}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-[14px] font-bold transition-colors ${
              sortByDiscount && isLoggedIn
                ? "bg-[#16a34a] border-[#16a34a] text-white"
                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {!isLoggedIn && (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            )}
            Sort by % off
          </button>
        </div>

        {/* Deals grid */}
        {loading && (
          <div className="flex justify-center py-20">
            <div
              className="w-10 h-10 rounded-full border-3 border-slate-200 border-t-[#16a34a] animate-spin"
              style={{ borderTopColor: "#16a34a", borderWidth: 3 }}
            />
          </div>
        )}
        {error && !loading && (
          <div className="text-center py-16 text-slate-500 text-[15px]">
            Could not load deals right now. Please try again later.
          </div>
        )}
        {!loading && !error && displayDeals.length === 0 && (
          <div className="text-center py-16 text-slate-500 text-[15px]">
            {searchQuery
              ? "No deals match your search."
              : "No deals found for today."}
          </div>
        )}
        {!loading && displayDeals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {displayDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                isBookmarked={bookmarkedIds.has(deal.id)}
                onBookmark={handleBookmark}
              />
            ))}
          </div>
        )}
      </main>

      {/* Login modal */}
      {loginModal && (
        <LoginModal
          message={loginModal.message}
          onClose={() => setLoginModal(null)}
          onGoLogin={goToLogin}
        />
      )}
    </div>
  );
}
