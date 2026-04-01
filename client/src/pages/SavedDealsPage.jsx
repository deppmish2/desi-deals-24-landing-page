import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatBestBefore, formatPrice, formatPricePerKg } from "../utils/formatters";
import {
  addBookmark, fetchBookmarks, fetchDealById, getAuthSession, logoutUser, removeBookmark,
} from "../utils/api";
import { trackAnalyticsEvent } from "../utils/analytics";
import { buildDealPageUrl, buildWhatsAppDealShareUrl } from "../utils/share";

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
  return buildDealPageUrl(dealId);
}

function buildSavedDealAnalyticsPayload(deal) {
  return {
    page_type: "saved_deals",
    deal_id: deal?.id || undefined,
    store_id: deal?.store?.id || undefined,
    store_name: deal?.store?.name || undefined,
    category: deal?.product_category || undefined,
  };
}

function UserCircleIcon({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M7 18c1.2-2.15 3.03-3.22 5.5-3.22S16.8 15.85 18 18" />
    </svg>
  );
}

function TrashIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function GridIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

function DealCard({ deal, onRemove }) {
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

  return (
    <div
      className="bg-white border border-[#f1f5f9] rounded-[20px] flex flex-col overflow-hidden"
      style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
    >
      {/* Image — not clickable */}
      <div className="relative w-full bg-white flex items-center justify-center p-5" style={{ height: 200 }}>
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
      </div>

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
            onClick={() =>
              trackAnalyticsEvent(
                "snatch_deal_click",
                buildSavedDealAnalyticsPayload(deal),
              )
            }
            className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline hover:no-underline"
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
            onClick={() =>
              trackAnalyticsEvent(
                "whatsapp_share_click",
                buildSavedDealAnalyticsPayload(deal),
              )
            }
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
            onClick={() => {
              trackAnalyticsEvent(
                "saved_deal_remove_click",
                buildSavedDealAnalyticsPayload(deal),
              );
              onRemove(deal.id);
            }}
            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border border-slate-200 bg-white hover:bg-red-50 hover:border-red-200 text-slate-400 hover:text-red-500 transition-colors"
            title="Remove from saved"
          >
            <TrashIcon size={16} />
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
  const [savedDeals, setSavedDeals] = useState([]);
  const [loadingDeals, setLoadingDeals] = useState(true);
  const [loadingBookmarks, setLoadingBookmarks] = useState(true);

  useEffect(() => {
    function onAuthChange() { setSession(getAuthSession()); }
    window.addEventListener("dd24-auth-changed", onAuthChange);
    return () => window.removeEventListener("dd24-auth-changed", onAuthChange);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) navigate("/", { replace: true });
  }, [isLoggedIn, navigate]);

  const syncBookmarks = useCallback(async () => {
    if (!isLoggedIn) { setBookmarkedIds(new Set()); setLoadingBookmarks(false); return; }
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

  useEffect(() => { syncBookmarks(); }, [syncBookmarks]);

  useEffect(() => {
    let cancelled = false;
    if (!isLoggedIn) { setSavedDeals([]); setLoadingDeals(false); return () => { cancelled = true; }; }
    if (bookmarkedIds.size === 0) { setSavedDeals([]); setLoadingDeals(false); return () => { cancelled = true; }; }
    setLoadingDeals(true);
    Promise.all(Array.from(bookmarkedIds).map((id) => fetchDealById(id).catch(() => null)))
      .then((rows) => { if (!cancelled) setSavedDeals(rows.filter((d) => d?.id && d?.product_url && d?.product_name)); })
      .catch(() => { if (!cancelled) setSavedDeals([]); })
      .finally(() => { if (!cancelled) setLoadingDeals(false); });
    return () => { cancelled = true; };
  }, [isLoggedIn, bookmarkedIds]);

  const [confirmRemoveId, setConfirmRemoveId] = useState(null);

  const handleRemove = useCallback(async (dealId) => {
    trackAnalyticsEvent("saved_deal_remove_confirmed", {
      page_type: "saved_deals",
      deal_id: dealId,
    });
    setBookmarkedIds((prev) => { const next = new Set(prev); next.delete(dealId); return next; });
    try { await removeBookmark(dealId); } catch { syncBookmarks(); }
  }, [syncBookmarks]);

  async function handleLogout() {
    trackAnalyticsEvent("logout_click", { page_type: "saved_deals" });
    await logoutUser();
    navigate("/", { replace: true });
  }

  const loading = loadingDeals || loadingBookmarks;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#ffffff_0%,_#f8fbff_32%,_#f3f6fb_100%)]">

      {/* Mobile header — matches DealsPage style */}
      <div className="sticky top-0 z-50 sm:hidden">
        <div className="flex h-[60px] items-center justify-between gap-4 bg-white px-6 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <Link to="/" className="flex items-center gap-2 no-underline" style={{ textDecoration: "none" }}>
            <img src="/landing/dd24-logo.svg" alt="DesiDeals24" className="w-5 h-6 object-contain" />
            <span className="font-bold tracking-[-1.2px] text-[24px] text-[#15803d]">DesiDeals24</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
              style={{ textDecoration: "none" }}
              title="Explore all deals"
            >
              <GridIcon size={17} color="currentColor" />
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
              >
                <UserCircleIcon size={20} color="currentColor" />
              </button>
              {mobileMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMobileMenuOpen(false)} />
                  <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-[16px] border border-slate-100 bg-white shadow-xl">
                    <Link
                      to="/"
                      onClick={() => {
                        trackAnalyticsEvent("explore_all_deals_click", {
                          page_type: "saved_deals",
                          source: "mobile_menu",
                        });
                        setMobileMenuOpen(false);
                      }}
                      className="flex items-center gap-3 px-4 py-3 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors no-underline"
                      style={{ textDecoration: "none" }}
                    >
                      <GridIcon size={15} color="currentColor" />
                      Explore deals
                    </Link>
                    <div className="h-px bg-slate-100 mx-3" />
                    <button
                      type="button"
                      onClick={() => { setMobileMenuOpen(false); handleLogout(); }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                      </svg>
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Desktop header */}
      <div className="sticky top-3 z-50 hidden sm:block max-w-[1320px] mx-auto px-6 lg:px-8 pt-3">
        <div className="flex items-center justify-between gap-4 rounded-[28px] border border-slate-200/60 bg-white px-7 lg:px-8 py-5 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
          <Link to="/" className="flex items-center gap-2.5 no-underline" style={{ textDecoration: "none" }}>
            <img src="/landing/dd24-logo.svg" alt="DesiDeals24" className="w-7 h-8 object-contain" />
            <span className="font-extrabold tracking-[-0.8px] text-[26px] text-[#17874a]">DesiDeals24</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link
              to="/"
              onClick={() =>
                trackAnalyticsEvent("explore_all_deals_click", {
                  page_type: "saved_deals",
                  source: "desktop_header",
                })
              }
              className="inline-flex items-center gap-2 rounded-full border border-[#d8eadb] bg-[#eff8f1] px-4 py-2.5 text-[13px] font-bold text-[#17874a] transition-colors hover:bg-[#e7f5ea]"
              style={{ textDecoration: "none" }}
            >
              <GridIcon size={15} color="#17874a" />
              Explore all deals
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-[1320px] mx-auto px-3 sm:px-6 lg:px-8 py-6 flex flex-col gap-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-[1.5px] text-slate-400 leading-none">
              Saved Deals
            </span>
            {!loading && (
              <span className="text-[22px] sm:text-[26px] font-black text-[#111827] leading-none">
                {savedDeals.length} item{savedDeals.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
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
              onClick={() =>
                trackAnalyticsEvent("explore_all_deals_click", {
                  page_type: "saved_deals",
                  source: "empty_state",
                })
              }
              className="mt-2 inline-flex items-center gap-2 bg-[#16a34a] hover:bg-[#15803d] text-white text-[14px] font-bold px-6 py-3 rounded-xl transition-colors no-underline"
              style={{ textDecoration: "none" }}
            >
              <GridIcon size={15} color="white" />
              Explore all deals
            </Link>
          </div>
        )}

        {!loading && savedDeals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {savedDeals.map((deal) => (
              <DealCard
                key={deal.id}
                deal={deal}
                onRemove={(id) => setConfirmRemoveId(id)}
              />
            ))}
          </div>
        )}
      </main>

      {confirmRemoveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" onClick={() => setConfirmRemoveId(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-extrabold text-[#111827]">Remove this deal?</h2>
            <p className="text-[14px] text-slate-500 leading-relaxed">This deal will be removed from your saved list.</p>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setConfirmRemoveId(null)}
                className="flex-1 rounded-[14px] border border-slate-200 bg-white py-3 text-[14px] font-bold text-slate-600 transition-colors hover:bg-slate-50">
                Cancel
              </button>
              <button type="button" onClick={() => { handleRemove(confirmRemoveId); setConfirmRemoveId(null); }}
                className="flex-1 rounded-[14px] bg-red-500 py-3 text-[14px] font-bold text-white transition-colors hover:bg-red-600">
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
