import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import useDeals from "../hooks/useStoreProducts";
import {
  formatBestBefore,
  formatPrice,
  formatPricePerKg,
} from "../utils/formatters";
import {
  addBookmark,
  fetchBookmarks,
  fetchCanonicalPriceData,
  fetchDealStores,
  fetchDeals,
  fetchOAuthAuthUrl,
  getAuthSession,
  logoutUser,
  removeBookmark,
} from "../utils/api";
import {
  buildDealsSearchParams,
  readDealsViewState,
} from "../utils/dealsViewState.mjs";
import { trackAnalyticsEvent } from "../utils/analytics";
import { proxyDealImageUrl } from "../utils/images";
import { buildDealPageUrl, buildWhatsAppDealShareUrl, buildWhatsAppShareUrl, buildWhatsAppSuspectDiscountShareText } from "../utils/share";
import CartButton from "../components/CartButton";
import ReplacementsModal from "../components/ReplacementsModal";
import { CartContext } from "../hooks/CartContext";

const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";
const POST_LOGIN_RESUME_STATE_STORAGE_KEY = "dd24_post_login_resume_state";
const HEADER_HEADLINE = "Best Desi grocery deals in Germany.";

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID)
    return window.crypto.randomUUID();
  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// ── Google SVG ────────────────────────────────────────────────────────────────
function GoogleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

// ── Lock icon ─────────────────────────────────────────────────────────────────
function LockIcon({ size = 16, color = "white" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SearchIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7.5" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function FilterIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle
        cx="14"
        cy="6"
        r="2.5"
        fill="white"
        stroke={color}
        strokeWidth="2"
      />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle
        cx="8"
        cy="12"
        r="2.5"
        fill="white"
        stroke={color}
        strokeWidth="2"
      />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle
        cx="16"
        cy="18"
        r="2.5"
        fill="white"
        stroke={color}
        strokeWidth="2"
      />
    </svg>
  );
}

function UserCircleIcon({ size = 22, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="9" r="3" />
      <path d="M7 18c1.2-2.15 3.03-3.22 5.5-3.22S16.8 15.85 18 18" />
    </svg>
  );
}

function BookmarkIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CartIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="20" r="1.75" />
      <circle cx="18" cy="20" r="1.75" />
      <path d="M3 4h2.5l2.1 10.1a1.2 1.2 0 0 0 1.18.95h8.72a1.2 1.2 0 0 0 1.18-.94L20.6 8H7.1" />
    </svg>
  );
}

function CloseIcon({ size = 10, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M1 1l10 10M11 1L1 11" />
    </svg>
  );
}

function ChevronDownIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ── Green unlock card (Image 1 design) ────────────────────────────────────────
function UnlockCard({ title, description, onSignIn }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "#16a34a" }}
    >
      <div className="px-5 py-5 flex flex-col gap-3">
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.2)" }}
        >
          <LockIcon size={20} />
        </div>
        <div>
          <p className="text-[17px] font-extrabold text-white leading-snug">
            Unlock this feature
          </p>
          <p
            className="text-[13px] mt-1 leading-relaxed"
            style={{ color: "rgba(255,255,255,0.85)" }}
          >
            {description}
          </p>
          <p className="text-[13px] font-bold text-white mt-2">
            Sign up, it's free.
          </p>
        </div>
        {onSignIn && (
          <button
            type="button"
            onClick={onSignIn}
            className="w-full flex items-center justify-center gap-2.5 rounded-xl py-3 text-[14px] font-semibold transition-colors"
            style={{ background: "rgba(255,255,255,0.18)", color: "white" }}
          >
            <GoogleIcon size={18} />
            Continue with Google
          </button>
        )}
      </div>
    </div>
  );
}

// ── Login modal ───────────────────────────────────────────────────────────────
function LoginModal({ message, resumeState, onClose }) {
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  async function handleGoogle() {
    setAuthError("");
    setLoading(true);
    trackAnalyticsEvent("login_google_click", {
      source: "login_modal",
    });
    try {
      const state = createOAuthState();
      const redirectTo =
        `${window.location.pathname}${window.location.search}${window.location.hash}` ||
        "/";
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, redirectTo);
      if (resumeState) {
        sessionStorage.setItem(
          POST_LOGIN_RESUME_STATE_STORAGE_KEY,
          JSON.stringify(resumeState),
        );
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
          <UnlockCard title="Unlock this feature" description={message} />
        )}
        {authError && (
          <p className="text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">
            {authError}
          </p>
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
        <button
          type="button"
          onClick={onClose}
          className="text-center text-[13px] text-slate-400 hover:text-slate-600 transition-colors"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function resolveUrl(deal, url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const storeBase = String(deal?.store?.url || "").replace(/\/+$/, "");
  return storeBase
    ? `${storeBase}${raw.startsWith("/") ? "" : "/"}${raw}`
    : raw;
}

function buildDealAnalyticsPayload(deal, context = {}) {
  return {
    page_type: context.pageType || "deals",
    page_number: context.pageNumber,
    sort: context.sort,
    search_active: context.searchActive ? 1 : 0,
    filter_count: context.filterCount,
    deal_id: deal?.id || undefined,
    store_id: deal?.store?.id || undefined,
    store_name: deal?.store?.name || undefined,
    category: deal?.product_category || undefined,
    highlighted: context.highlighted ? 1 : 0,
  };
}

const REAL_SAVINGS_DEBUG_LABELS = {
  no_canonical:      "Not matched to any canonical product",
  no_history:        "No price history for this canonical",
  not_cheaper:       "Deal price ≥ market median",
  rating_too_low:    "Discount < 5% (below threshold)",
  badge_suppressed:  "Too close to store's stated discount",
  no_price_per_kg:   "Missing price-per-kg on this deal",
  no_original_price: "No original price data",
  no_price_data:     "No sale price data",
  unknown:           "Unknown reason",
};

// ── Deal card ─────────────────────────────────────────────────────────────────
function proxyImageUrl(imageUrl) {
  if (!imageUrl) return null;
  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

function dealPermalink(dealId) {
  return buildDealPageUrl(dealId);
}


function DealCard({
  deal,
  isBookmarked,
  onBookmark,
  highlighted,
  highlightRef,
  priority,
  analyticsContext,
  isAdmin,
}) {
  const [imgError, setImgError] = useState(false);
  const [showAdminTooltip, setShowAdminTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [showImageDebug, setShowImageDebug] = useState(false);
  const [imageDebugPos, setImageDebugPos] = useState({ top: 0, left: 0 });
  const [loadingCanonical, setLoadingCanonical] = useState(false);
  const [canonicalData, setCanonicalData] = useState(null);
  const badgeRef = useRef(null);

  const proxyImg = proxyDealImageUrl(deal);
  const discountPct = deal?.discount_percent ? Math.round(deal.discount_percent) : null;
  const realSavings = deal?.real_savings ?? null;
  const isUsualPrice = deal?.real_savings_debug === 'not_cheaper' && (discountPct > 0 || !!deal.original_price) && !deal.best_before;
  const bestBeforeText = deal?.best_before ? formatBestBefore(deal.best_before) : null;
  const priceText = formatPrice(deal.sale_price, deal.currency);
  const originalPriceText = deal.original_price
    ? formatPrice(deal.original_price, deal.currency)
    : null;
  const weightText = [
    deal.weight_raw || null,
    deal.price_per_kg ? formatPricePerKg(deal.price_per_kg, deal.weight_unit) : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const permalink = dealPermalink(deal.id);
  return (
    <div
      ref={highlightRef}
      className={`bg-white rounded-[20px] flex flex-col transition-shadow ${
        highlighted ? "border-2 border-[#16a34a]" : "border border-[#f1f5f9]"
      }`}
      style={{
        boxShadow: highlighted
          ? "0 0 0 4px rgba(22,163,74,0.15), 0px 2px 12px rgba(0,0,0,0.06)"
          : "0px 2px 12px rgba(0,0,0,0.06)",
      }}
    >
      {/* Image — not clickable */}
      <div
        className="relative block w-full h-[200px] bg-white flex items-center justify-center p-5 overflow-hidden rounded-t-[20px]"
        onMouseEnter={isAdmin && !realSavings && deal.real_savings_debug ? (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setImageDebugPos({ top: rect.top, left: rect.left });
          setShowImageDebug(true);
        } : undefined}
        onMouseLeave={isAdmin && !realSavings && deal.real_savings_debug ? () => setShowImageDebug(false) : undefined}
      >
        <img
          src={
            imgError || !proxyImg
              ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">🛒</text></svg>'
              : proxyImg
          }
          alt={deal.product_name}
          loading={priority ? "eager" : "lazy"}
          fetchpriority={priority ? "high" : "auto"}
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
        {isAdmin && !realSavings && deal.real_savings_debug && (
          <div className="absolute bottom-2 right-2 w-5 h-5 bg-slate-600/70 rounded-full flex items-center justify-center pointer-events-none">
            <span className="text-white text-[10px] font-bold leading-none">?</span>
          </div>
        )}
        {isAdmin && showImageDebug && !realSavings && deal.real_savings_debug && createPortal(
          <div
            className="bg-[#1e293b] text-white rounded-xl p-3 shadow-2xl pointer-events-none"
            style={{ position: "fixed", top: imageDebugPos.top + 8, left: imageDebugPos.left + 8, zIndex: 9999, maxWidth: 260 }}
          >
            <p className="text-[10px] font-extrabold uppercase tracking-[1.2px] text-slate-400 mb-1.5">Real Savings Debug</p>
            <p className="text-[12px] text-slate-200">
              {REAL_SAVINGS_DEBUG_LABELS[deal.real_savings_debug] || deal.real_savings_debug}
            </p>
            <div className="border-t border-slate-600 mt-2 pt-1.5 flex flex-col gap-1">
              {deal.canonical_id ? (
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-[10px] text-slate-500 shrink-0">Canonical</span>
                  <span className="text-[10px] text-slate-400 text-right truncate">{deal.canonical_id}</span>
                </div>
              ) : (
                <p className="text-[10px] text-slate-500">deal #{deal.id} · no canonical</p>
              )}
            </div>
          </div>,
          document.body,
        )}
        {discountPct > 0 && !isUsualPrice && (
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
              {originalPriceText && !isUsualPrice && (
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

        {isUsualPrice && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[10px] bg-slate-100 w-fit">
            <span className="text-[12px] font-semibold text-slate-500">Usual price</span>
          </div>
        )}
        {!isUsualPrice && realSavings ? (() => {
          const realPct = Math.round(realSavings.real_discount_pct);
          const gap = discountPct ? Math.abs(realSavings.real_discount_pct - discountPct) : 0;
          const isGreat = realSavings.rating === "great";
          const isGood  = realSavings.rating === "good";
          const isFakeDeal = !!deal?.is_fake_deal;
          const isLayer1 = realSavings.reference_source === "canonical_historical";
          return (
            <div
              ref={badgeRef}
              className="relative"
              onMouseEnter={() => {
                if (!isAdmin) return;
                const rect = badgeRef.current?.getBoundingClientRect();
                if (rect) setTooltipPos({ top: rect.top, left: rect.left });
                setShowAdminTooltip(true);
                if (realSavings.canonical_id && !canonicalData && !loadingCanonical) {
                  setLoadingCanonical(true);
                  fetchCanonicalPriceData(realSavings.canonical_id, deal.store?.id)
                    .then((data) => setCanonicalData(data))
                    .catch(() => {})
                    .finally(() => setLoadingCanonical(false));
                }
              }}
              onMouseLeave={() => setShowAdminTooltip(false)}
            >
              <div className={`flex items-center justify-between rounded-[14px] px-3.5 py-3 ${
                isFakeDeal ? "bg-amber-50 border border-amber-200"
                : isGreat || isGood ? "bg-[#f0fdf4] border border-[#bbf7d0]"
                : "bg-[#f0fdf4] border border-[#dcfce7]"
              }`}>
                <div className="flex items-center gap-2.5">
                  <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                    isFakeDeal ? "bg-amber-100" : isGreat || isGood ? "bg-[#16a34a]" : "bg-green-100"
                  }`}>
                    {isFakeDeal ? (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="13"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isGreat || isGood ? "white" : "#16a34a"} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className={`text-[10px] font-extrabold uppercase tracking-[1.4px] leading-none mb-[3px] ${
                      isFakeDeal ? "text-amber-700" : isGreat || isGood ? "text-[#15803d]" : "text-green-500"
                    }`}>Real Savings</p>
                    <p className="text-[11px] text-slate-500 leading-none">
                      {realSavings.reference_source === "store_original" ? "vs store's original price" : "vs market price"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-[22px] font-extrabold leading-none ${
                    isFakeDeal ? "text-amber-600" : isGreat || isGood ? "text-[#16a34a]" : "text-green-500"
                  }`}>{realPct}%</p>
                  {gap >= 3 && discountPct && (
                    <p className="text-[10px] text-slate-500 leading-none mt-1">store says {discountPct}%</p>
                  )}
                </div>
              </div>

              {isAdmin && showAdminTooltip && createPortal(
                <div
                  className="w-72 bg-[#1e293b] text-white rounded-xl p-3.5 shadow-2xl pointer-events-none"
                  style={{
                    position: "fixed",
                    top: tooltipPos.top - 8,
                    left: tooltipPos.left,
                    transform: "translateY(-100%)",
                    zIndex: 9999,
                  }}
                >
                  <p className="text-[10px] font-extrabold uppercase tracking-[1.2px] text-slate-400 mb-2.5">Real Savings Breakdown</p>

                  {/* Calculation */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[11px] text-slate-400">Reference</span>
                      <span className="text-[12px] font-semibold text-white">
                        {isLayer1
                          ? `€${realSavings.reference_price_per_kg?.toFixed(2)}/kg`
                          : `€${realSavings.reference_price?.toFixed(2)}`}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-[11px] text-slate-400">Deal price</span>
                      <span className="text-[12px] font-semibold text-white">
                        {isLayer1 && deal.price_per_kg
                          ? `€${Number(deal.price_per_kg).toFixed(2)}/kg`
                          : `€${Number(deal.sale_price).toFixed(2)}`}
                      </span>
                    </div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-[11px] text-slate-400">Real savings</span>
                      <span className="text-[12px] font-bold text-emerald-400">{realSavings.real_discount_pct.toFixed(1)}%</span>
                    </div>
                    {discountPct && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-[11px] text-slate-400">Store states</span>
                        <span className="text-[12px] font-semibold text-white">{discountPct}%</span>
                      </div>
                    )}
                  </div>

                  {/* Source + canonical */}
                  <div className="border-t border-slate-600 mt-2.5 pt-2 flex flex-col gap-1">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[10px] text-slate-500">Source</span>
                      <span className="text-[10px] text-slate-400">
                        {isLayer1 ? `market median (${realSavings.observations ?? "?"} obs)` : "store original"}
                      </span>
                    </div>
                    {realSavings.canonical_id && (
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="text-[10px] text-slate-500 shrink-0">Canonical</span>
                        <span className="text-[10px] text-slate-400 text-right truncate">{realSavings.canonical_id}</span>
                      </div>
                    )}
                  </div>

                  {/* Market prices across stores */}
                  <div className="border-t border-slate-600 mt-2.5 pt-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-[1.2px] text-slate-500 mb-1.5">Market Prices</p>
                    {loadingCanonical && (
                      <p className="text-[10px] text-slate-500 italic">Loading…</p>
                    )}
                    {canonicalData && (
                      <>
                        {canonicalData.canonical_name && (
                          <p className="text-[10px] text-slate-300 mb-1.5 truncate">{canonicalData.canonical_name}</p>
                        )}
                        <div className="flex flex-col gap-1">
                          {canonicalData.stores.map((s) => (
                            <div key={s.store_name} className="flex justify-between items-baseline">
                              <span className="text-[11px] text-slate-400 truncate max-w-[140px]">{s.store_name}</span>
                              <span className="text-[11px] font-semibold text-white shrink-0 ml-2">
                                {s.min_price === s.max_price
                                  ? `€${s.min_price.toFixed(2)}`
                                  : `€${s.min_price.toFixed(2)}–${s.max_price.toFixed(2)}`}
                                {s.count > 1 && <span className="text-[10px] text-slate-500 ml-1">×{s.count}</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                        <p className="text-[10px] text-slate-600 mt-1.5">
                          {canonicalData.total_active} active · {canonicalData.total_all} total deals
                        </p>
                      </>
                    )}
                    {!loadingCanonical && !canonicalData && (
                      <p className="text-[10px] text-slate-600">No market data</p>
                    )}
                  </div>

                  {/* Same-spec alternatives at other stores */}
                  {canonicalData?.same_spec_alts?.length > 0 && (
                    <div className="border-t border-slate-600 mt-2.5 pt-2">
                      <p className="text-[10px] font-extrabold uppercase tracking-[1.2px] text-slate-500 mb-1.5">Same Spec at Other Stores</p>
                      <div className="flex flex-col gap-2">
                        {canonicalData.same_spec_alts.map((store) => (
                          <div key={store.store_id}>
                            <p className="text-[10px] font-semibold text-slate-400 mb-0.5">{store.store_name}</p>
                            {store.deals.slice(0, 3).map((d) => (
                              <div key={d.id} className="flex justify-between items-baseline ml-1.5 gap-1">
                                <span className="text-[10px] text-slate-500 truncate">{d.product_name}</span>
                                <span className="text-[10px] font-semibold text-white shrink-0">
                                  {d.sale_price != null ? `€${d.sale_price.toFixed(2)}` : "—"}
                                  {d.discount_percent ? <span className="text-[9px] text-green-400 ml-1">-{Math.round(d.discount_percent)}%</span> : null}
                                </span>
                              </div>
                            ))}
                            {store.deals.length > 3 && (
                              <p className="text-[9px] text-slate-600 ml-1.5">+{store.deals.length - 3} more</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {canonicalData && !canonicalData.same_spec_alts?.length && (
                    <div className="border-t border-slate-600 mt-2.5 pt-2">
                      <p className="text-[10px] font-extrabold uppercase tracking-[1.2px] text-slate-500 mb-1">Same Spec at Other Stores</p>
                      <p className="text-[10px] text-slate-600">None found</p>
                    </div>
                  )}
                </div>,
                document.body,
              )}
            </div>
          );
        })() : null}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <CartButton deal={deal} />
          <a
            href={resolveUrl(deal, deal.product_url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackAnalyticsEvent(
                "snatch_deal_click",
                buildDealAnalyticsPayload(deal, analyticsContext),
              )
            }
            className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline hover:no-underline"
            style={{ textDecoration: "none" }}
          >
            <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">
              Snatch Deal
            </span>
          </a>
          {/* WhatsApp share — shares DesiDeals24 permalink, WA shows branded OG preview */}
          <a
            href={(() => {
              const realPct = realSavings ? Math.round(realSavings.real_discount_pct) : null;
              const isSuspect = deal.is_fake_deal && realPct != null;
              return isSuspect
                ? buildWhatsAppShareUrl(buildWhatsAppSuspectDiscountShareText({
                    dealId: deal.id,
                    productName: deal.product_name,
                    salePrice: deal.sale_price,
                    storeName: deal.store?.name,
                    storeDiscount: discountPct,
                    realSaving: realPct,
                  }))
                : buildWhatsAppDealShareUrl({
                    dealId: deal.id,
                    productName: deal.product_name,
                    priceText,
                    originalPriceText,
                    storeName: deal.store?.name,
                  });
            })()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackAnalyticsEvent(
                "whatsapp_share_click",
                buildDealAnalyticsPayload(deal, analyticsContext),
              )
            }
            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border border-slate-200 bg-white hover:bg-[#e7fbe9] hover:border-[#25D366] transition-colors"
            title="Share on WhatsApp"
          >
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path
                d="M16 3C9.373 3 4 8.373 4 15c0 2.385.67 4.61 1.832 6.5L4 29l7.697-1.803A12.94 12.94 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3z"
                fill="#25D366"
              />
              <path
                d="M21.786 18.618c-.306-.153-1.81-.894-2.09-.994-.28-.1-.484-.153-.688.153-.204.306-.79.994-.968 1.198-.178.204-.356.23-.662.077-.306-.153-1.29-.476-2.458-1.516-.908-.81-1.522-1.81-1.7-2.116-.178-.306-.019-.47.134-.622.137-.136.306-.356.459-.535.153-.178.204-.306.306-.51.102-.204.051-.382-.025-.535-.077-.153-.688-1.658-.942-2.27-.248-.595-.5-.514-.688-.524l-.586-.01c-.204 0-.535.077-.816.382-.28.306-1.07 1.045-1.07 2.55s1.095 2.96 1.248 3.164c.153.204 2.154 3.29 5.22 4.614.73.315 1.3.503 1.744.644.733.233 1.4.2 1.927.121.588-.087 1.81-.74 2.065-1.455.255-.714.255-1.326.178-1.455-.076-.13-.28-.204-.586-.357z"
                fill="white"
              />
            </svg>
          </a>
          {/* Bookmark */}
          <button
            type="button"
            onClick={() => onBookmark(deal.id)}
            className={`shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border transition-colors ${
              isBookmarked
                ? "bg-[#16a34a] border-[#16a34a] text-white"
                : "border-slate-200 bg-white hover:bg-slate-50 text-slate-500"
            }`}
            title={isBookmarked ? "Remove bookmark" : "Bookmark it"}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill={isBookmarked ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

const CATEGORIES = [
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

const SORT_OPTIONS = [
  { value: "", label: "Random order", compactLabel: "Random order" },
  { value: "real_savings", label: "Sort: Real Savings", compactLabel: "Real Savings" },
  { value: "discount", label: "Sort: Max Discount", compactLabel: "Max Discount" },
  { value: "price_per_kg", label: "Sort: Lowest /Kg Price", compactLabel: "Lowest Price / Kg" },
  { value: "price", label: "Sort: Lowest Price", compactLabel: "Lowest Price" },
];

// ── Filters modal ─────────────────────────────────────────────────────────────
function FiltersModal({
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
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="8" y1="12" x2="20" y2="12" />
              <line x1="12" y1="18" x2="20" y2="18" />
            </svg>
            <span className="text-[18px] font-extrabold text-[#0f172a]">
              Filters
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable, fully explorable by all users */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-6">
          {/* Store */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">
              Store
            </p>
            <div className="flex flex-wrap gap-2">
              {["All stores", ...storeNames].map((name) => {
                const val = name === "All stores" ? "" : name;
                const active =
                  val === "" ? stores.length === 0 : stores.includes(val);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      if (val === "") {
                        onChange({ ...draft, stores: [] });
                        return;
                      }

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
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">
              Category
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label
                className="flex items-center gap-3 cursor-pointer col-span-2"
                onClick={() => onChange({ ...draft, category: "" })}
              >
                <span
                  className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                    category === ""
                      ? "bg-[#0f172a] border-[#0f172a]"
                      : "border-slate-300 bg-white"
                  }`}
                >
                  {category === "" && (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="white"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="text-[14px] text-[#0f172a] font-medium">
                  All categories
                </span>
              </label>
              {CATEGORIES.map((cat) => (
                <label
                  key={cat}
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() =>
                    onChange({
                      ...draft,
                      category: category === cat ? "" : cat,
                    })
                  }
                >
                  <span
                    className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${
                      category === cat
                        ? "bg-[#0f172a] border-[#0f172a]"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    {category === cat && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="white"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
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
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">
              Minimum Discount
            </p>
            <div className="grid grid-cols-4 gap-2">
              {["10", "25", "50", "75"].map((pct) => {
                const active = draft.minDiscount === pct;
                return (
                  <button
                    key={pct}
                    type="button"
                    onClick={() =>
                      onChange({ ...draft, minDiscount: active ? "" : pct })
                    }
                    className={`py-3 rounded-xl border-2 text-[14px] font-semibold transition-colors ${
                      active
                        ? "bg-[#0f172a] border-[#0f172a] text-white"
                        : "bg-white border-slate-200 text-[#0f172a] hover:border-slate-400"
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
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">
              Price Range (€)
            </p>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-[#0f172a] transition-colors">
                <span className="text-slate-400 text-[14px]">€</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Min"
                  value={draft.priceMin}
                  onChange={(e) =>
                    onChange({ ...draft, priceMin: e.target.value })
                  }
                  className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0"
                />
              </div>
              <span className="text-slate-300 text-[18px]">—</span>
              <div className="flex-1 flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-[#0f172a] transition-colors">
                <span className="text-slate-400 text-[14px]">€</span>
                <input
                  type="number"
                  min="0"
                  placeholder="Max"
                  value={draft.priceMax}
                  onChange={(e) =>
                    onChange({ ...draft, priceMax: e.target.value })
                  }
                  className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0"
                />
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={draft.priceMax || 200}
              onChange={(e) =>
                onChange({
                  ...draft,
                  priceMax: e.target.value === "200" ? "" : e.target.value,
                })
              }
              className="w-full accent-[#0f172a] h-1 cursor-pointer"
            />
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-4">
            {[
              {
                key: "hideExpired",
                label: "Hide expired products",
                sub: "Remove products past best before date",
              },
            ].map(({ key, label, sub }) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[14px] font-bold text-[#0f172a]">
                    {label}
                  </p>
                  <p className="text-[12px] text-slate-400 mt-0.5">{sub}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onChange({ ...draft, [key]: !draft[key] })}
                  className={`relative shrink-0 w-12 h-6 rounded-full transition-colors ${draft[key] ? "bg-[#16a34a]" : "bg-slate-200"}`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${draft[key] ? "translate-x-6" : "translate-x-0"}`}
                  />
                </button>
              </div>
            ))}
          </div>

          {/* Lock card — shown inline in body for non-logged-in users */}
          {!isLoggedIn && (
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: "#16a34a" }}
            >
              <div className="px-5 py-4 flex items-center gap-4">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(255,255,255,0.2)" }}
                >
                  <LockIcon size={20} />
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-white">
                    Filter by store and category
                  </p>
                  <p
                    className="text-[13px] mt-0.5"
                    style={{ color: "rgba(255,255,255,0.85)" }}
                  >
                    Sign in to narrow down deals exactly how you want.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClear}
            className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-[14px] font-bold text-[#0f172a] hover:bg-slate-50 transition-colors"
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={handleApply}
            className={`flex-[2] py-3 rounded-xl text-white text-[14px] font-bold transition-colors flex items-center justify-center gap-2 ${
              isLoggedIn
                ? "bg-[#16a34a] hover:bg-[#15803d]"
                : "bg-[#16a34a] hover:bg-[#15803d]"
            }`}
          >
            {!isLoggedIn && <LockIcon size={15} />}
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────
function SortDropdown({ value, onChange, toolbar = false }) {
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

  function handleOpen() {
    setOpen((v) => !v);
  }

  function handleSelect(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className="relative w-auto max-w-full" ref={ref}>
      {toolbar ? (
        <button
          type="button"
          onClick={handleOpen}
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
          onClick={handleOpen}
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
                  isSelected
                    ? "bg-[#edf7ef] text-[#0f172a]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {isSelected ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#17874a"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
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

// ── Bookmarks panel ───────────────────────────────────────────────────────────
function BookmarksPanel({ bookmarkedDeals, bookmarkedIds, onRemove, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const saved = Array.from(bookmarkedIds)
    .map((id) => bookmarkedDeals[id])
    .filter(Boolean);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-40"
    >
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-[13px] font-extrabold text-[#0f172a] tracking-wide uppercase">
          Saved Deals
        </span>
        <span className="text-[12px] text-slate-400">
          {saved.length} item{saved.length !== 1 ? "s" : ""}
        </span>
      </div>
      {saved.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <svg
            className="mx-auto mb-2 text-slate-300"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
          <p className="text-[13px] text-slate-400">No saved deals yet.</p>
          <p className="text-[12px] text-slate-300 mt-0.5">
            Tap the bookmark on any deal.
          </p>
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-50">
          {saved.map((deal) => (
            <div
              key={deal.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {deal.image_url ? (
                  <img
                    src={proxyDealImageUrl(deal)}
                    alt=""
                    className="w-full h-full object-contain"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="text-[16px]">🛒</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-bold text-[#0f172a] leading-snug line-clamp-1">
                  {deal.product_name}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {deal.store?.name} ·{" "}
                  {formatPrice(deal.sale_price, deal.currency)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(deal.id)}
                className="shrink-0 text-slate-300 hover:text-red-400 transition-colors p-1"
                title="Remove bookmark"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;

  const pages = [];
  const delta = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 ||
      i === totalPages ||
      (i >= page - delta && i <= page + delta)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div className="flex items-center justify-center gap-1.5 py-6">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      {pages.map((p, i) =>
        p === "..." ? (
          <span
            key={`ellipsis-${i}`}
            className="w-9 h-9 flex items-center justify-center text-slate-400 text-[13px]"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`w-9 h-9 rounded-xl border text-[13px] font-bold transition-colors ${
              p === page
                ? "bg-[#0f172a] border-[#0f172a] text-white"
                : "border-slate-200 bg-white text-[#0f172a] hover:bg-slate-50"
            }`}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DealsPage() {
  const { count: cartCount } = React.useContext(CartContext);
  const navigate = useNavigate();
  const { dealId: routeDealId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewState = useMemo(
    () => readDealsViewState(searchParams),
    [searchParams],
  );
  const highlightDealId = routeDealId || searchParams.get("deal") || null;
  const highlightRef = useRef(null);
  const [searchInput, setSearchInput] = useState(() => viewState.searchQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState({
    stores: [],
    category: "",
    minDiscount: "",
    priceMin: "",
    priceMax: "",
    hideExpired: false,
  });
  const [loginModal, setLoginModal] = useState(null);
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());
  const [bookmarkedDeals, setBookmarkedDeals] = useState({});
  const [bookmarksPanelOpen, setBookmarksPanelOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const nextSearchShouldTrackRef = useRef(false);
  const [totalCount, setTotalCount] = useState(null);
  const {
    searchQuery,
    sortValue,
    page,
    filterStores,
    filterCategory,
    filterMinDiscount,
    filterPriceMin,
    filterPriceMax,
    filterHideExpired,
  } = viewState;

  const [session, setSession] = useState(() => getAuthSession());
  const isLoggedIn = Boolean(session?.accessToken);
  const isAdmin = Boolean(session?.user?.is_admin) || import.meta.env.DEV;
  const [includeInactive, setIncludeInactive] = useState(false);
  const analyticsFilterCount =
    Number(filterStores.length > 0) +
    Number(Boolean(filterCategory)) +
    Number(Boolean(filterMinDiscount)) +
    Number(Boolean(filterPriceMin || filterPriceMax)) +
    Number(Boolean(filterHideExpired && isLoggedIn));

  const createResumeState = useCallback(
    (overrides = {}) => ({
      searchInput,
      searchQuery,
      sortValue,
      filterStores,
      filterCategory,
      filterMinDiscount,
      filterPriceMin,
      filterPriceMax,
      filterHideExpired,
      page,
      ...overrides,
    }),
    [
      filterCategory,
      filterHideExpired,
      filterMinDiscount,
      filterPriceMax,
      filterPriceMin,
      filterStores,
      page,
      searchInput,
      searchQuery,
      sortValue,
    ],
  );

  const buildAnalyticsContext = useCallback(
    (overrides = {}) => ({
      pageType: highlightDealId ? "deal_permalink" : "deals",
      pageNumber: highlightDealId ? 1 : page,
      sort: sortValue || "random",
      searchActive: Boolean(searchQuery),
      filterCount: analyticsFilterCount,
      highlighted: Boolean(highlightDealId),
      ...overrides,
    }),
    [analyticsFilterCount, highlightDealId, page, searchQuery, sortValue],
  );

  const updateAppliedState = useCallback(
    (overrides = {}) => {
      const nextState = {
        searchQuery,
        sortValue,
        page,
        filterStores,
        filterCategory,
        filterMinDiscount,
        filterPriceMin,
        filterPriceMax,
        filterHideExpired,
        ...overrides,
      };

      const nextParams = buildDealsSearchParams(
        searchParams,
        nextState,
        routeDealId,
      );
      if (nextParams.toString() === searchParams.toString()) return;
      setSearchParams(nextParams);
    },
    [
      filterCategory,
      filterHideExpired,
      filterMinDiscount,
      filterPriceMax,
      filterPriceMin,
      filterStores,
      page,
      routeDealId,
      searchParams,
      searchQuery,
      setSearchParams,
      sortValue,
    ],
  );

  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (nextSearchShouldTrackRef.current) {
      nextSearchShouldTrackRef.current = false;
    }
  }, [searchQuery]);

  useEffect(() => {
    function onAuthChange() {
      setSession(getAuthSession());
    }
    window.addEventListener("dd24-auth-changed", onAuthChange);
    return () => window.removeEventListener("dd24-auth-changed", onAuthChange);
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;

    const rawResumeState = sessionStorage.getItem(
      POST_LOGIN_RESUME_STATE_STORAGE_KEY,
    );
    if (!rawResumeState) return;

    sessionStorage.removeItem(POST_LOGIN_RESUME_STATE_STORAGE_KEY);

    try {
      const resumeState = JSON.parse(rawResumeState);
      if (!resumeState || typeof resumeState !== "object") return;

      const nextDraft = {
        stores: Array.isArray(resumeState.filterStores)
          ? resumeState.filterStores
          : [],
        category: resumeState.filterCategory || "",
        minDiscount: resumeState.filterMinDiscount || "",
        priceMin: resumeState.filterPriceMin || "",
        priceMax: resumeState.filterPriceMax || "",
        hideExpired: Boolean(resumeState.filterHideExpired),
      };

      setSearchInput(resumeState.searchInput || resumeState.searchQuery || "");
      setSearchParams(
        buildDealsSearchParams(
          searchParams,
          {
            searchQuery: resumeState.searchQuery || "",
            sortValue: resumeState.sortValue || "",
            page:
              Number.isInteger(resumeState.page) && resumeState.page > 0
                ? resumeState.page
                : 1,
            filterStores: nextDraft.stores,
            filterCategory: nextDraft.category,
            filterMinDiscount: nextDraft.minDiscount,
            filterPriceMin: nextDraft.priceMin,
            filterPriceMax: nextDraft.priceMax,
            filterHideExpired: nextDraft.hideExpired,
          },
          routeDealId,
        ),
      );
      setFilterDraft(nextDraft);
      setFiltersOpen(false);
      setLoginModal(null);

      if (resumeState.bookmarkDealId) {
        const bookmarkDealId = resumeState.bookmarkDealId;
        setBookmarkedIds((prev) => new Set(prev).add(bookmarkDealId));
        addBookmark(bookmarkDealId)
          .catch(() => null)
          .then(() => fetchBookmarks().catch(() => null))
          .then((result) => {
            if (result?.data) setBookmarkedIds(new Set(result.data));
          });
      }
    } catch {
      sessionStorage.removeItem(POST_LOGIN_RESUME_STATE_STORAGE_KEY);
    }
  }, [isLoggedIn, routeDealId, searchParams, setSearchParams]);

  const { deals, pagination, loading, error } = useDeals({
    enabled: true,
    page: highlightDealId ? 1 : page,
    limit: highlightDealId ? 1 : 20,
    deal_id: highlightDealId || undefined,
    q: searchQuery || undefined,
    track_search:
      nextSearchShouldTrackRef.current && searchQuery ? "1" : undefined,
    sort: sortValue || undefined,
    store:
      filterStores.length > 0 && isLoggedIn
        ? filterStores.join(",")
        : undefined,
    category: filterCategory && isLoggedIn ? filterCategory : undefined,
    min_discount:
      filterMinDiscount && isLoggedIn ? filterMinDiscount : undefined,
    price_min: filterPriceMin && isLoggedIn ? filterPriceMin : undefined,
    price_max: filterPriceMax && isLoggedIn ? filterPriceMax : undefined,
    in_stock: includeInactive ? undefined : "1",
    hide_expired: filterHideExpired && isLoggedIn ? "1" : undefined,
    include_inactive: isAdmin && includeInactive ? "1" : undefined,
  });

  const displayDeals = useMemo(
    () =>
      (Array.isArray(deals) ? deals : []).filter(
        (d) => d?.product_url && d?.product_name,
      ),
    [deals],
  );

  // Scroll to highlighted deal when deals load
  useEffect(() => {
    if (!highlightDealId || !highlightRef.current) return;
    setTimeout(
      () =>
        highlightRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      300,
    );
  }, [highlightDealId, displayDeals]);

  // Keep bookmarkedDeals map populated from deal pages
  useEffect(() => {
    if (!Array.isArray(deals) || deals.length === 0) return;
    setBookmarkedDeals((prev) => {
      const next = { ...prev };
      deals.forEach((d) => {
        if (d?.id) next[d.id] = d;
      });
      return next;
    });
  }, [deals]);

  const syncBookmarks = useCallback(async () => {
    if (!isLoggedIn) {
      setBookmarkedIds(new Set());
      return;
    }
    try {
      const res = await fetchBookmarks();
      setBookmarkedIds(new Set(res.data || []));
    } catch {
      setBookmarkedIds(new Set());
    }
  }, [isLoggedIn]);

  // Load bookmarks
  useEffect(() => {
    if (!isLoggedIn) {
      setBookmarkedIds(new Set());
      return undefined;
    }

    let cancelled = false;
    let idleId = null;
    let timeoutId = null;

    const runSync = () => {
      if (!cancelled) syncBookmarks();
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(runSync, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(runSync, 900);
    }

    return () => {
      cancelled = true;
      if (
        idleId !== null &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isLoggedIn, syncBookmarks]);

  const [storeNames, setStoreNames] = useState([]);
  useEffect(() => {
    if (!filtersOpen || storeNames.length > 0) return;

    let cancelled = false;
    fetchDeals({ limit: 200 })
      .then((res) => {
        if (cancelled) return;
        const names = new Set();
        (res.data || []).forEach((d) => {
          if (!d?.store?.name) return;
          if (
            String(d.store?.id || "")
              .trim()
              .toLowerCase() === "dookan"
          )
            return;
          names.add(d.store.name);
        });
        setStoreNames(Array.from(names).sort());
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [filtersOpen, storeNames.length]);

  function requireLogin(message, action, resumeState) {
    if (!isLoggedIn) {
      trackAnalyticsEvent("login_prompt_open", {
        source: highlightDealId ? "deal_permalink" : "deals",
        reason: message || "feature_gate",
      });
      setLoginModal({ message, resumeState });
    } else {
      action?.();
    }
  }

  function openFilters() {
    trackAnalyticsEvent("filters_open", buildAnalyticsContext());
    setFilterDraft({
      stores: filterStores,
      category: filterCategory,
      minDiscount: filterMinDiscount,
      priceMin: filterPriceMin,
      priceMax: filterPriceMax,
      hideExpired: filterHideExpired,
    });
    setFiltersOpen(true);
  }

  function handleFiltersSignIn() {
    trackAnalyticsEvent(
      "filters_apply_login_required",
      buildAnalyticsContext({
        filterCount:
          Number(filterDraft.stores.length > 0) +
          Number(Boolean(filterDraft.category)) +
          Number(Boolean(filterDraft.minDiscount)) +
          Number(Boolean(filterDraft.priceMin || filterDraft.priceMax)) +
          Number(Boolean(filterDraft.hideExpired)),
      }),
    );
    setFiltersOpen(false);
    requireLogin(
      "Sign in to filter by store and category.",
      undefined,
      createResumeState({
        filterStores: filterDraft.stores,
        filterCategory: filterDraft.category,
        filterMinDiscount: filterDraft.minDiscount,
        filterPriceMin: filterDraft.priceMin,
        filterPriceMax: filterDraft.priceMax,
        filterHideExpired: filterDraft.hideExpired,
        page: 1,
      }),
    );
  }

  function applyFilters() {
    trackAnalyticsEvent(
      "filters_apply",
      buildAnalyticsContext({
        filterCount:
          Number(filterDraft.stores.length > 0) +
          Number(Boolean(filterDraft.category)) +
          Number(Boolean(filterDraft.minDiscount)) +
          Number(Boolean(filterDraft.priceMin || filterDraft.priceMax)) +
          Number(Boolean(filterDraft.hideExpired)),
        has_store: filterDraft.stores.length > 0 ? 1 : 0,
        has_category: filterDraft.category ? 1 : 0,
        has_min_discount: filterDraft.minDiscount ? 1 : 0,
        has_price_range: filterDraft.priceMin || filterDraft.priceMax ? 1 : 0,
        hide_expired: filterDraft.hideExpired ? 1 : 0,
      }),
    );
    updateAppliedState({
      filterStores: filterDraft.stores,
      filterCategory: filterDraft.category,
      filterMinDiscount: filterDraft.minDiscount,
      filterPriceMin: filterDraft.priceMin,
      filterPriceMax: filterDraft.priceMax,
      filterHideExpired: filterDraft.hideExpired,
      page: 1,
    });
    setFiltersOpen(false);
  }

  function clearFilters() {
    trackAnalyticsEvent("filters_clear_draft", buildAnalyticsContext());
    setFilterDraft({
      stores: [],
      category: "",
      minDiscount: "",
      priceMin: "",
      priceMax: "",
      hideExpired: false,
    });
  }

  function clearSearchAndFilters() {
    trackAnalyticsEvent("filters_clear_all", buildAnalyticsContext());
    setSearchInput("");
    updateAppliedState({
      searchQuery: "",
      sortValue: "",
      filterStores: [],
      filterCategory: "",
      filterMinDiscount: "",
      filterPriceMin: "",
      filterPriceMax: "",
      filterHideExpired: false,
      page: 1,
    });
    setFilterDraft({
      stores: [],
      category: "",
      minDiscount: "",
      priceMin: "",
      priceMax: "",
      hideExpired: false,
    });
  }

  function handleSortChange(val) {
    trackAnalyticsEvent(
      "sort_change",
      buildAnalyticsContext({
        selected_sort: val || "random",
      }),
    );
    updateAppliedState({ sortValue: val, page: 1 });
  }

  function handleSearch() {
    const nextQuery = searchInput.trim();
    trackAnalyticsEvent(
      "search_submit",
      buildAnalyticsContext({
        query_length: nextQuery.length,
      }),
    );
    nextSearchShouldTrackRef.current = Boolean(nextQuery);
    updateAppliedState({ searchQuery: nextQuery, page: 1 });
  }

  function removeFilterChip(type, label) {
    trackAnalyticsEvent(
      "filter_chip_remove",
      buildAnalyticsContext({
        filter_type: type,
      }),
    );
    if (type === "store")
      updateAppliedState({
        filterStores: filterStores.filter((s) => s !== label),
        page: 1,
      });
    if (type === "category")
      updateAppliedState({ filterCategory: "", page: 1 });
    if (type === "sort") updateAppliedState({ sortValue: "", page: 1 });
    if (type === "minDiscount")
      updateAppliedState({ filterMinDiscount: "", page: 1 });
    if (type === "priceRange") {
      updateAppliedState({ filterPriceMin: "", filterPriceMax: "", page: 1 });
    }
  }

  function showToast(message, tone = "success") {
    setToast({ message, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }

  const handleBookmark = useCallback(
    async (dealId) => {
      const deal =
        bookmarkedDeals[dealId] ||
        displayDeals.find((entry) => entry?.id === dealId) ||
        null;
      if (!isLoggedIn) {
        trackAnalyticsEvent(
          "bookmark_login_required",
          buildDealAnalyticsPayload(deal, buildAnalyticsContext()),
        );
        setLoginModal({
          message: "Bookmarks are for registered members only.",
          resumeState: createResumeState({ bookmarkDealId: dealId }),
        });
        return;
      }
      const wasBookmarked = bookmarkedIds.has(dealId);
      trackAnalyticsEvent(
        wasBookmarked ? "bookmark_remove_click" : "bookmark_add_click",
        buildDealAnalyticsPayload(deal, buildAnalyticsContext()),
      );
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (wasBookmarked) next.delete(dealId);
        else next.add(dealId);
        return next;
      });
      showToast(
        wasBookmarked ? "Removed from basket" : "Saved to basket",
        wasBookmarked ? "removed" : "success",
      );
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
    [
      bookmarkedDeals,
      buildAnalyticsContext,
      createResumeState,
      displayDeals,
      isLoggedIn,
      bookmarkedIds,
      syncBookmarks,
    ],
  );

  async function handleLogout() {
    trackAnalyticsEvent("logout_click", buildAnalyticsContext());
    await logoutUser();
    navigate("/", { replace: true });
  }

  const activeChips = [
    ...filterStores.map((s) => ({ type: "store", label: s })),
    filterCategory && { type: "category", label: filterCategory },
    filterMinDiscount && {
      type: "minDiscount",
      label: `${filterMinDiscount}%+ off`,
    },
    (filterPriceMin || filterPriceMax) && {
      type: "priceRange",
      label:
        filterPriceMin && filterPriceMax
          ? `\u20ac${filterPriceMin} \u2013 \u20ac${filterPriceMax}`
          : filterPriceMin
            ? `From \u20ac${filterPriceMin}`
            : `Up to \u20ac${filterPriceMax}`,
    },
  ].filter(Boolean);

  const totalPages = pagination?.total_pages ?? 1;
  const matchingCount = pagination?.total ?? displayDeals.length;
  const filterCount =
    activeChips.length +
    Number(Boolean(searchQuery)) +
    Number(Boolean(filterHideExpired && isLoggedIn));
  const hasActiveState = Boolean(
    searchQuery ||
    sortValue ||
    activeChips.length ||
    (filterHideExpired && isLoggedIn),
  );

  useEffect(() => {
    if (hasActiveState || loading || pagination?.total == null) return;
    setTotalCount((current) =>
      current === pagination.total ? current : pagination.total,
    );
  }, [hasActiveState, loading, pagination?.total]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#ffffff_0%,_#f8fbff_32%,_#f3f6fb_100%)]">
      <div className="sticky top-0 z-50 sm:hidden">
        <div className="bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <div className="flex min-h-[72px] items-center justify-between gap-3 px-4 py-3">
            <Link
              to="/"
              className="flex min-w-0 items-center gap-2.5 no-underline"
              style={{ textDecoration: "none" }}
            >
              <img
                src="/landing/dd24-logo.svg"
                alt="DesiDeals24"
                className="w-5 h-6 object-contain"
              />
              <div className="min-w-0 text-[16px] font-extrabold leading-none tracking-[-0.05em] text-[#15803d]">
                DesiDeals24
              </div>
            </Link>
            <div className="flex items-center gap-2">
              {isLoggedIn ? (
                <>
                  <Link
                    to="/saved"
                    onClick={() =>
                      trackAnalyticsEvent(
                        "saved_deals_open",
                        buildAnalyticsContext(),
                      )
                    }
                    className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50"
                    style={{ textDecoration: "none" }}
                    title="Saved deals"
                  >
                    <CartIcon size={18} color="currentColor" />
                    {bookmarkedIds.size > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#9a6500] text-white text-[10px] font-extrabold flex items-center justify-center leading-none">
                        {bookmarkedIds.size}
                      </span>
                    )}
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
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setMobileMenuOpen(false)}
                        />
                        <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-44 overflow-hidden rounded-[16px] border border-slate-100 bg-white shadow-xl">
                          <Link
                            to="/saved"
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-3 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors no-underline"
                            style={{ textDecoration: "none" }}
                          >
                            <CartIcon size={16} color="currentColor" />
                            Saved deals
                          </Link>
                          <div className="h-px bg-slate-100 mx-3" />
                          <button
                            type="button"
                            onClick={() => {
                              setMobileMenuOpen(false);
                              handleLogout();
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-[14px] font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                              <polyline points="16 17 21 12 16 7" />
                              <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Logout
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    trackAnalyticsEvent(
                      "sign_in_click",
                      buildAnalyticsContext({
                        source: "mobile_header",
                      }),
                    );
                    setLoginModal({});
                  }}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d8eadb] bg-[#eff8f1] text-[13px] font-bold text-[#17874a] transition-colors hover:bg-[#e7f5ea]"
                >
                  <UserCircleIcon size={20} color="#475569" />
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-[#edf2fb] bg-[#edf3ff]/95 px-4 py-3 shadow-[0_10px_22px_rgba(15,23,42,0.08)] backdrop-blur">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex flex-col gap-3"
            >
              <div className="flex gap-3 items-center">
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

                {!hasActiveState && (
                  <button
                    type="button"
                    onClick={openFilters}
                    className="relative inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] border border-white/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                    aria-label="Open filters"
                  >
                    <FilterIcon size={18} color="currentColor" />
                    {filterCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#9a6500] text-white text-[11px] font-extrabold flex items-center justify-center leading-none">
                        {filterCount}
                      </span>
                    )}
                  </button>
                )}
              </div>

              {hasActiveState && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={openFilters}
                    className="relative inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[12px] border border-white/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                    aria-label="Open filters"
                  >
                    <FilterIcon size={18} color="currentColor" />
                    {filterCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#9a6500] text-white text-[11px] font-extrabold flex items-center justify-center leading-none">
                        {filterCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearOpen(true)}
                    className="flex h-[44px] flex-1 items-center rounded-[12px] border border-[#dae6fb] bg-[#e6efff] px-4 text-left shadow-sm transition-colors hover:bg-[#edf3ff]"
                  >
                    <span className="text-[14px] font-extrabold text-[#17874a]">
                      Remove filters
                    </span>
                    <span className="ml-2 text-[14px] text-slate-400">
                      {totalCount != null
                        ? `to see all ${totalCount.toLocaleString()} items`
                        : "to see all items"}
                    </span>
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
      <main className="max-w-[1320px] mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6 flex flex-col gap-6">
        <div className="sticky top-0 sm:top-3 z-50 hidden sm:block">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 sm:rounded-[28px] sm:border sm:border-slate-200/60 bg-white px-4 sm:px-7 lg:px-8 py-4 sm:py-5 shadow-[0_4px_16px_rgba(15,23,42,0.07)] sm:shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
            <Link
              to="/"
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
                onClick={() => navigate("/list")}
                className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-orange-50 hover:border-orange-300"
                title="Shopping list"
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
              {isLoggedIn && (
                <Link
                  to="/saved"
                  onClick={() =>
                    trackAnalyticsEvent(
                      "saved_deals_open",
                      buildAnalyticsContext(),
                    )
                  }
                  className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                  style={{ textDecoration: "none" }}
                  title="Saved deals"
                >
                  <CartIcon size={19} color="currentColor" />
                  {bookmarkedIds.size > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1 rounded-full bg-[#9a6500] text-white text-[11px] font-extrabold flex items-center justify-center leading-none">
                      {bookmarkedIds.size}
                    </span>
                  )}
                </Link>
              )}

              {isLoggedIn ? (
                <>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="hidden sm:inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                  >
                    Logout
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="sm:hidden inline-flex items-center justify-center w-11 h-11 rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                    title="Logout"
                  >
                    <UserCircleIcon size={22} color="currentColor" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    trackAnalyticsEvent(
                      "sign_in_click",
                      buildAnalyticsContext({
                        source: "desktop_header",
                      }),
                    );
                    setLoginModal({});
                  }}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#d8eadb] bg-[#eff8f1] text-[13px] font-bold text-[#17874a] shadow-sm transition-colors hover:bg-[#e7f5ea] sm:h-auto sm:w-auto sm:gap-2 sm:px-4 sm:py-2.5"
                >
                  <UserCircleIcon size={20} color="#475569" />
                  <span className="hidden sm:inline">Sign in</span>
                </button>
              )}
            </div>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-[28px] border border-[#e7eefb] bg-[linear-gradient(180deg,#ffffff_0%,#f7faff_100%)] px-4 py-5 shadow-[0_22px_70px_rgba(15,23,42,0.07)] sm:px-7 sm:py-7 lg:px-8 lg:py-8">
          <div className="absolute inset-y-0 right-0 w-[42%] bg-[radial-gradient(circle_at_center,_rgba(22,163,74,0.12)_0%,_rgba(22,163,74,0)_72%)] pointer-events-none" />
          <div className="relative max-w-[760px]">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-[#17874a]/75 sm:text-[12px]">
              Fresh finds across Germany
            </p>
            <h1
              className="mt-2 text-[30px] font-bold leading-[0.96] tracking-[-0.06em] text-[#0f172a] sm:text-[42px] lg:text-[56px]"
              style={{ fontFamily: '"Plus Jakarta Sans", sans-serif' }}
            >
              Best Desi grocery deals
              <br />
              in Germany.
            </h1>
            <p className="mt-3 max-w-[620px] text-[14px] font-medium leading-[1.55] text-slate-500 sm:text-[16px]">
              Search live deals, compare discounts, and save the best grocery
              picks before they disappear.
            </p>
          </div>
        </section>

        <section className="relative z-10 rounded-[30px] border border-white/80 bg-[#edf3ff] shadow-[0_30px_90px_rgba(15,23,42,0.08)]">
          <div className="relative px-4 sm:px-6 lg:px-8 py-4 sm:py-5 lg:py-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              className="flex flex-col gap-4"
            >
              <div className="hidden sm:block">
                <div className="flex gap-3 items-center">
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

                  <button
                    type="button"
                    onClick={openFilters}
                    className="relative hidden min-h-[58px] items-center justify-center gap-2 rounded-[22px] border border-white/80 bg-white px-4 py-3.5 text-[14px] font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 sm:inline-flex"
                  >
                    <FilterIcon size={18} color="currentColor" />
                    <span>Filters</span>
                    {filterCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#9a6500] text-white text-[11px] font-extrabold flex items-center justify-center leading-none">
                        {filterCount}
                      </span>
                    )}
                  </button>

                  <div className="hidden sm:block">
                    <SortDropdown
                      toolbar
                      value={sortValue}
                      onChange={handleSortChange}
                    />
                  </div>

                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col min-w-0 gap-2">
                    <span className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-[1.5px] text-slate-500 leading-none">
                      Matching Deals
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[22px] sm:text-[26px] font-black text-[#111827] leading-none">
                        {matchingCount.toLocaleString()}
                      </span>
                      {hasActiveState &&
                        totalCount != null &&
                        totalCount !== matchingCount && (
                          <span className="flex items-center gap-1.5">
                            <span className="text-[13px] sm:text-[14px] font-semibold text-slate-500 leading-none">
                              / {totalCount.toLocaleString()}
                            </span>
                            <button
                              type="button"
                              onClick={() => setConfirmClearOpen(true)}
                              className="hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-slate-200 text-slate-500 transition-colors hover:bg-slate-300 hover:text-slate-700 sm:inline-flex"
                              title="Remove all filters"
                            >
                              <CloseIcon size={8} />
                            </button>
                          </span>
                        )}
                    </div>
                  </div>

                  <div className="shrink-0 sm:hidden">
                    <SortDropdown
                      value={sortValue}
                      onChange={handleSortChange}
                    />
                  </div>
                </div>

                {(searchQuery || activeChips.length > 0) && (
                  <div className="hidden sm:flex flex-wrap gap-2">
                    {searchQuery && (
                      <span className="flex items-center gap-2 rounded-[10px] border border-[#dfe7f5] bg-white px-3 py-2 shadow-sm">
                        <span className="text-[11px] font-extrabold uppercase tracking-[1px] text-slate-400">
                          Search
                        </span>
                        <span className="text-[13px] font-semibold text-slate-700">
                          "{searchQuery}"
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSearchInput("");
                            updateAppliedState({ searchQuery: "", page: 1 });
                          }}
                          className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        >
                          <CloseIcon size={8} />
                        </button>
                      </span>
                    )}
                    {activeChips.map((chip) => (
                      <span
                        key={`${chip.type}-${chip.label}`}
                        className="flex items-center gap-2 rounded-[10px] border border-[#dfe7f5] bg-white px-3 py-2 shadow-sm"
                      >
                        <span className="text-[13px] font-semibold text-slate-700">
                          {chip.label}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            removeFilterChip(chip.type, chip.label)
                          }
                          className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        >
                          <CloseIcon size={8} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </form>
          </div>
        </section>

        {/* Admin: include inactive toggle */}
        {isAdmin && import.meta.env.DEV && (
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setIncludeInactive((v) => !v)}
              className={`text-[11px] font-semibold px-3 py-1 rounded-full border transition-colors ${
                includeInactive
                  ? "bg-amber-100 border-amber-400 text-amber-700"
                  : "bg-slate-100 border-slate-300 text-slate-500"
              }`}
            >
              {includeInactive ? "Showing all deals (incl. inactive)" : "Show inactive deals"}
            </button>
          </div>
        )}

        {/* Deals grid */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 20 }).map((_, i) => (
              <div
                key={i}
                className="bg-white rounded-[20px] border border-[#f1f5f9] overflow-hidden"
                style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
              >
                <div className="w-full h-[200px] bg-slate-100 animate-pulse" />
                <div className="p-4 flex flex-col gap-3">
                  <div className="h-4 bg-slate-100 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-slate-100 rounded animate-pulse w-1/2" />
                  <div className="h-5 bg-slate-100 rounded animate-pulse w-1/3" />
                </div>
              </div>
            ))}
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
              ? `No deals found for "${searchQuery}".`
              : "No deals available right now."}
          </div>
        )}
        {!loading && displayDeals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {displayDeals.map((deal, index) => (
              <DealCard
                key={deal.id}
                deal={deal}
                isBookmarked={bookmarkedIds.has(deal.id)}
                onBookmark={handleBookmark}
                highlighted={highlightDealId === deal.id}
                highlightRef={highlightDealId === deal.id ? highlightRef : null}
                priority={index < 4}
                analyticsContext={buildAnalyticsContext()}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={totalPages}
            onChange={(p) => {
              trackAnalyticsEvent(
                "pagination_click",
                buildAnalyticsContext({
                  target_page: p,
                }),
              );
              updateAppliedState({ page: p });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </main>

      {/* Filters modal */}
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

      {/* Login modal */}
      {loginModal && (
        <LoginModal
          message={loginModal.message}
          resumeState={loginModal.resumeState}
          onClose={() => setLoginModal(null)}
        />
      )}

      {/* Confirm clear filters */}
      {confirmClearOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          onClick={() => setConfirmClearOpen(false)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div
            className="relative w-full max-w-sm rounded-[24px] bg-white p-6 shadow-2xl flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-[18px] font-extrabold text-[#111827]">
              Remove all filters?
            </h2>
            <p className="text-[14px] text-slate-500 leading-relaxed">
              This will clear all active filters and display all available
              deals.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="flex-1 rounded-[14px] border border-slate-200 bg-white py-3 text-[14px] font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSearchAndFilters();
                  setConfirmClearOpen(false);
                }}
                className="flex-1 rounded-[14px] bg-[#17874a] py-3 text-[14px] font-bold text-white transition-colors hover:bg-[#136f3c]"
              >
                Remove filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div
            className={`flex items-center gap-2.5 text-[14px] font-semibold px-5 py-3.5 rounded-2xl shadow-xl ${
              toast.tone === "removed"
                ? "bg-[#7c2d12] text-[#fff7ed]"
                : "bg-[#166534] text-white"
            }`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
