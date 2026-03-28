import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatBestBefore, formatPrice, formatPricePerKg } from "../utils/formatters";
import {
  addBookmark, fetchBookmarks, fetchDealById, getAuthSession, logoutUser, removeBookmark,
} from "../utils/api";
import { buildDealShareUrl, buildWhatsAppDealShareUrl } from "../utils/share";

function proxyImageUrl(imageUrl) {
  if (!imageUrl) return null;
  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

function resolveUrl(deal, url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const storeBase = String(deal?.store?.url || "").replace(/\/+$/, "");
  return storeBase ? `${storeBase}${raw.startsWith("/") ? "" : "/"}${raw}` : raw;
}

function dealPermalink(dealId) {
  return buildDealShareUrl(dealId);
}

function DealCard({ deal, isBookmarked, onBookmark }) {
  const [imgError, setImgError] = useState(false);
  const proxyImg = proxyImageUrl(deal?.image_url);
  const discountPct = deal?.discount_percent ? Math.round(deal.discount_percent) : null;
  const bestBeforeText = deal?.best_before ? formatBestBefore(deal.best_before) : null;
  const priceText = formatPrice(deal.sale_price, deal.currency);
  const originalPriceText = deal.original_price ? formatPrice(deal.original_price, deal.currency) : null;
  const weightText = [
    deal.weight_raw || null,
    deal.price_per_kg ? formatPricePerKg(deal.price_per_kg) : null,
  ].filter(Boolean).join(" | ");

  const permalink = dealPermalink(deal.id);
  return (
    <div
      className="bg-white border border-[#f1f5f9] rounded-[20px] flex flex-col overflow-hidden"
      style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
    >
      <a href={permalink} className="relative block w-full bg-white flex items-center justify-center p-5 no-underline" style={{ height: 200, textDecoration: "none" }}>
        <img
          src={imgError || !proxyImg
            ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">🛒</text></svg>'
            : proxyImg}
          alt={deal.product_name}
          loading="lazy"
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
        {discountPct > 0 && (
          <div className="absolute top-3 right-3 rounded-[8px] px-2.5 py-1"
            style={{ backgroundColor: discountPct > 50 ? "#ffe4e8" : discountPct >= 30 ? "#fff3e0" : discountPct >= 20 ? "#e8f0fe" : "#f1f5f9" }}>
            <span className="font-bold text-[13px] leading-none"
              style={{ color: discountPct > 50 ? "#e53e3e" : discountPct >= 30 ? "#c05200" : discountPct >= 20 ? "#1a56db" : "#1e293b" }}>
              -{discountPct}%
            </span>
          </div>
        )}
        {bestBeforeText && (
          <span className="absolute bottom-3 left-3 bg-[#d5890f] text-white text-[10px] leading-[15px] font-medium rounded-full px-2 py-0.5">
            {bestBeforeText}
          </span>
        )}
      </a>

      <div className="flex flex-col flex-1 px-5 pt-4 pb-5 gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[#94a3b8] text-[10px] leading-[15px] tracking-[1.5px] uppercase font-extrabold">
            {deal.store?.name || "Store"}
          </p>
          <a href={permalink} className="text-[#1e293b] text-[15px] leading-[22px] font-bold line-clamp-2 min-h-[44px] hover:text-[#16a34a] transition-colors" style={{ textDecoration: "none" }}>
            {deal.product_name}
          </a>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[#1e293b] text-[22px] leading-[30px] font-extrabold">{priceText}</span>
              {originalPriceText && (
                <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">{originalPriceText}</span>
              )}
            </div>
            {weightText && (
              <span className="text-[#94a3b8] text-[11px] leading-[16px] font-medium text-right shrink-0">{weightText}</span>
            )}
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 pt-2">
          <a
            href={resolveUrl(deal, deal.product_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline"
            style={{ textDecoration: "none" }}
          >
            <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">Snatch Deal</span>
          </a>
          <a
            href={buildWhatsAppDealShareUrl({
              dealId: deal.id,
              productName: deal.product_name,
              priceText,
              originalPriceText,
              storeName: deal.store?.name,
            })}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border border-slate-200 bg-white hover:bg-[#e7fbe9] hover:border-[#25D366] transition-colors"
            title="Share on WhatsApp"
          >
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.67 4.61 1.832 6.5L4 29l7.697-1.803A12.94 12.94 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
              <path d="M21.786 18.618c-.306-.153-1.81-.894-2.09-.994-.28-.1-.484-.153-.688.153-.204.306-.79.994-.968 1.198-.178.204-.356.23-.662.077-.306-.153-1.29-.476-2.458-1.516-.908-.81-1.522-1.81-1.7-2.116-.178-.306-.019-.47.134-.622.137-.136.306-.356.459-.535.153-.178.204-.306.306-.51.102-.204.051-.382-.025-.535-.077-.153-.688-1.658-.942-2.27-.248-.595-.5-.514-.688-.524l-.586-.01c-.204 0-.535.077-.816.382-.28.306-1.07 1.045-1.07 2.55s1.095 2.96 1.248 3.164c.153.204 2.154 3.29 5.22 4.614.73.315 1.3.503 1.744.644.733.233 1.4.2 1.927.121.588-.087 1.81-.74 2.065-1.455.255-.714.255-1.326.178-1.455-.076-.13-.28-.204-.586-.357z" fill="white"/>
            </svg>
          </a>
          <button
            type="button"
            onClick={() => onBookmark(deal.id)}
            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border transition-colors bg-[#16a34a] border-[#16a34a] text-white"
            title="Remove bookmark"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SavedDealsPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState(() => getAuthSession());
  const isLoggedIn = Boolean(session?.accessToken);

  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
  const [savedDeals, setSavedDeals] = useState([]);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingBookmarks, setLoadingBookmarks] = useState(true);

  useEffect(() => {
    function onAuthChange() { setSession(getAuthSession()); }
    window.addEventListener("dd24-auth-changed", onAuthChange);
    return () => window.removeEventListener("dd24-auth-changed", onAuthChange);
  }, []);

  // Redirect to home if not logged in
  useEffect(() => {
    if (!isLoggedIn) navigate("/", { replace: true });
  }, [isLoggedIn, navigate]);

  const syncBookmarks = useCallback(async () => {
    if (!isLoggedIn) {
      setBookmarkedIds(new Set());
      setLoadingBookmarks(false);
      return;
    }
    setLoadingBookmarks(true);
    try {
      const res = await fetchBookmarks();
      setBookmarkedIds(new Set(res.data || []));
    } catch {
      setBookmarkedIds(new Set());
    } finally {
      setLoadingBookmarks(false);
    }
  }, [isLoggedIn]);

  // Fetch bookmarked IDs
  useEffect(() => {
    syncBookmarks();
  }, [syncBookmarks]);

  // Fetch exact saved deals by bookmark IDs so count and list stay in sync.
  useEffect(() => {
    let cancelled = false;

    if (!isLoggedIn) {
      setSavedDeals([]);
      setLoadingDeals(false);
      return () => {
        cancelled = true;
      };
    }

    if (bookmarkedIds.size === 0) {
      setSavedDeals([]);
      setLoadingDeals(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingDeals(true);
    Promise.all(
      Array.from(bookmarkedIds).map((dealId) =>
        fetchDealById(dealId).catch(() => null),
      ),
    )
      .then((rows) => {
        if (cancelled) return;
        setSavedDeals(
          rows.filter((deal) => deal?.id && deal?.product_url && deal?.product_name),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSavedDeals([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingDeals(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, bookmarkedIds]);

  const handleBookmark = useCallback(
    async (dealId) => {
      const wasBookmarked = bookmarkedIds.has(dealId);
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (wasBookmarked) next.delete(dealId); else next.add(dealId);
        return next;
      });
      try {
        if (wasBookmarked) {
          await removeBookmark(dealId);
        } else {
          await addBookmark(dealId);
        }
      } catch {
        setBookmarkedIds((prev) => {
          const next = new Set(prev);
          if (wasBookmarked) next.add(dealId);
          else next.delete(dealId);
          return next;
        });
      } finally {
        syncBookmarks();
      }
    },
    [bookmarkedIds, syncBookmarks],
  );

  async function handleLogout() {
    await logoutUser();
    navigate("/", { replace: true });
  }

  const loading = loadingDeals || loadingBookmarks;

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      {/* Header — same as DealsPage */}
      <header className="backdrop-blur-md bg-white/80 border-b border-slate-200 sticky top-0 z-30">
        <div className="h-16 max-w-[1280px] mx-auto px-4 sm:px-8 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2" style={{ textDecoration: "none" }}>
            <img src="/landing/dd24-logo.svg" alt="DesiDeals24" className="w-5 h-6 object-contain" />
            <span className="font-extrabold tracking-[-0.5px] text-[20px] text-[#141414]">DesiDeals24</span>
            <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-slate-400 -translate-y-1">· Beta</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] text-slate-600 transition-colors"
              style={{ textDecoration: "none" }}
            >
              All Deals
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] text-slate-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-[28px] sm:text-[36px] font-extrabold text-[#0f172a] leading-tight">Saved Deals</h1>
            <p className="text-slate-500 text-[14px] mt-1">Your bookmarked deals</p>
          </div>
          {!loading && (
            <p className="text-[18px] font-extrabold text-[#0f172a]">{savedDeals.length} item{savedDeals.length !== 1 ? "s" : ""}</p>
          )}
        </div>

        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 rounded-full animate-spin" style={{ borderWidth: 3, borderStyle: "solid", borderColor: "#e2e8f0", borderTopColor: "#16a34a" }} />
          </div>
        )}

        {!loading && savedDeals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <svg className="text-slate-200" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <p className="text-[18px] font-bold text-slate-400">No saved deals yet</p>
            <p className="text-[14px] text-slate-300">Tap the bookmark icon on any deal to save it here.</p>
            <Link
              to="/"
              className="mt-2 bg-[#16a34a] hover:bg-[#15803d] text-white text-[14px] font-bold px-6 py-3 rounded-xl transition-colors"
              style={{ textDecoration: "none" }}
            >
              Browse Deals
            </Link>
          </div>
        )}

        {!loading && savedDeals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {savedDeals.map((deal) => (
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
    </div>
  );
}
