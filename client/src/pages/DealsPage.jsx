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
  fetchOAuthAuthUrl,
  getAuthSession,
  logoutUser,
  removeBookmark,
} from "../utils/api";

const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

// ── Login modal with Google OAuth ────────────────────────────────────────────
function LoginModal({ message, onClose }) {
  const [loading, setLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState("");

  async function handleGoogle() {
    setAuthError("");
    setLoading(true);
    try {
      const state = createOAuthState();
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, "/");
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
          <div className="rounded-xl bg-[#f0fdf4] border border-[#bbf7d0] px-4 py-3 text-center">
            <p className="text-[14px] font-semibold text-[#15803d]">{message}</p>
            <p className="text-[12px] text-[#4ade80] mt-0.5" style={{ color: "#16a34a", opacity: 0.75 }}>Sign up for free to unlock this.</p>
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
          <svg width="20" height="20" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
        <button type="button" onClick={onClose} className="text-center text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
          Maybe later
        </button>
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

const CATEGORIES = [
  "Spices & Masalas", "Rice & Grains", "Sauces & Pastes", "Lentils & Pulses",
  "Beverages", "Flours & Baking", "Snacks & Sweets", "Frozen Foods",
  "Noodles & Pasta", "Oils & Ghee", "Fresh Produce", "Dairy & Paneer",
  "Household", "Canned & Packaged", "Personal Care", "Other",
];

const SORT_OPTIONS = [
  { value: "discount", label: "Sort: Max Discount" },
  { value: "price_per_kg", label: "Sort: Lowest /Kg Price" },
  { value: "price", label: "Sort: Lowest Price" },
];

// ── Filters modal ─────────────────────────────────────────────────────────────
function FiltersModal({ storeNames, draft, onChange, onClear, onApply, onClose, isLoggedIn, onSignIn }) {
  const { store, category } = draft;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] flex flex-col shadow-2xl relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="12" y1="18" x2="20" y2="18"/></svg>
            <span className="text-[18px] font-extrabold text-[#0f172a]">Filters</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-6">
          {/* Store */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Store</p>
            <div className="flex flex-wrap gap-2">
              {["All stores", ...storeNames].map((name) => {
                const val = name === "All stores" ? "" : name;
                const active = store === val;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => onChange({ ...draft, store: val })}
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
              {/* All categories */}
              <label className="flex items-center gap-3 cursor-pointer col-span-2">
                <span
                  className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${
                    category === "" ? "bg-[#0f172a] border-[#0f172a]" : "border-slate-300 bg-white"
                  }`}
                  onClick={() => onChange({ ...draft, category: "" })}
                >
                  {category === "" && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </span>
                <span className="text-[14px] text-[#0f172a] font-medium" onClick={() => onChange({ ...draft, category: "" })}>All categories</span>
              </label>
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-3 cursor-pointer">
                  <span
                    className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${
                      category === cat ? "bg-[#0f172a] border-[#0f172a]" : "border-slate-300 bg-white"
                    }`}
                    onClick={() => onChange({ ...draft, category: category === cat ? "" : cat })}
                  >
                    {category === cat && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </span>
                  <span className="text-[14px] text-[#0f172a]" onClick={() => onChange({ ...draft, category: category === cat ? "" : cat })}>{cat}</span>
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
                <input
                  type="number"
                  min="0"
                  placeholder="Min"
                  value={draft.priceMin}
                  onChange={(e) => onChange({ ...draft, priceMin: e.target.value })}
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
                  onChange={(e) => onChange({ ...draft, priceMax: e.target.value })}
                  className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0"
                />
              </div>
            </div>
            <input
              type="range"
              min="0"
              max="200"
              value={draft.priceMax || 200}
              onChange={(e) => onChange({ ...draft, priceMax: e.target.value === "200" ? "" : e.target.value })}
              className="w-full accent-[#0f172a] h-1 cursor-pointer"
            />
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-4 pb-2">
            {[
              { key: "hideOutOfStock", label: "Hide out of stock products", sub: "Remove products currently unavailable" },
              { key: "hideExpired", label: "Hide expired products", sub: "Remove products past best before date" },
            ].map(({ key, label, sub }) => (
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
            onClick={onApply}
            className="flex-[2] py-3 rounded-xl bg-[#16a34a] hover:bg-[#15803d] text-white text-[14px] font-bold transition-colors"
          >
            Apply Filters
          </button>
        </div>

        {/* Lock overlay — shown to non-logged-in users so they can see what they're missing */}
        {!isLoggedIn && (
          <div className="absolute inset-0 flex flex-col items-center justify-end rounded-t-2xl sm:rounded-2xl overflow-hidden">
            {/* Blurred preview of the filters behind */}
            <div className="absolute inset-0" style={{ background: "rgba(255,255,255,0.15)" }} />
            {/* Sign-in card at bottom */}
            <div className="relative w-full bg-white border-t border-slate-100 px-6 pt-6 pb-7 flex flex-col gap-4 shadow-[0_-8px_32px_rgba(0,0,0,0.08)]">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[#16a34a] flex items-center justify-center shrink-0 mt-0.5">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-[#0f172a]">Filter by store and category</p>
                  <p className="text-[13px] text-slate-500 mt-0.5">Sign in to narrow down deals exactly how you want.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onSignIn}
                className="w-full flex items-center justify-center gap-3 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl py-3 text-[15px] font-semibold text-[#1e293b] transition-colors shadow-sm"
              >
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  <path fill="none" d="M0 0h48v48H0z"/>
                </svg>
                Continue with Google
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sort dropdown ─────────────────────────────────────────────────────────────
function SortDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[13px] font-semibold text-[#0f172a] hover:bg-slate-50 transition-colors"
      >
        {current ? current.label : "Sort"}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-[#2d3748] rounded-xl shadow-xl overflow-hidden z-20">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value === value ? "" : opt.value); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-4 py-3 text-[13px] font-medium text-left transition-colors ${
                opt.value === value ? "bg-[#4a5568] text-white" : "text-slate-200 hover:bg-[#3d4a5c]"
              }`}
            >
              {opt.value === value && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {opt.value !== value && <span className="w-[14px]" />}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function DealsPage() {
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortValue, setSortValue] = useState("");
  const [filterStore, setFilterStore] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterMinDiscount, setFilterMinDiscount] = useState("");
  const [filterPriceMin, setFilterPriceMin] = useState("");
  const [filterPriceMax, setFilterPriceMax] = useState("");
  const [filterHideOutOfStock, setFilterHideOutOfStock] = useState(true);
  const [filterHideExpired, setFilterHideExpired] = useState(false);
  // draft holds uncommitted filter state inside the modal
  const [filterDraft, setFilterDraft] = useState({ store: "", category: "", minDiscount: "", priceMin: "", priceMax: "", hideOutOfStock: true, hideExpired: false });
  const [loginModal, setLoginModal] = useState(null);
  const [bookmarkedIds, setBookmarkedIds] = useState(new Set());

  const [session, setSession] = useState(() => getAuthSession());
  const isLoggedIn = Boolean(session?.accessToken);

  // Keep session in sync when auth changes (login, logout, token refresh)
  useEffect(() => {
    function onAuthChange() { setSession(getAuthSession()); }
    window.addEventListener("dd24-auth-changed", onAuthChange);
    return () => window.removeEventListener("dd24-auth-changed", onAuthChange);
  }, []);

  const { deals, pagination, loading, error } = useDeals({
    enabled: true,
    limit: 24,
    q: searchQuery || undefined,
    sort: sortValue && isLoggedIn ? sortValue : undefined,
    store: filterStore && isLoggedIn ? filterStore : undefined,
    category: filterCategory && isLoggedIn ? filterCategory : undefined,
    min_discount: filterMinDiscount && isLoggedIn ? filterMinDiscount : undefined,
    price_min: filterPriceMin && isLoggedIn ? filterPriceMin : undefined,
    price_max: filterPriceMax && isLoggedIn ? filterPriceMax : undefined,
    in_stock: filterHideOutOfStock && isLoggedIn ? "1" : undefined,
    hide_expired: filterHideExpired && isLoggedIn ? "1" : undefined,
  });

  // Load bookmarks if logged in
  useEffect(() => {
    if (!isLoggedIn) return;
    fetchBookmarks()
      .then((res) => setBookmarkedIds(new Set(res.data || [])))
      .catch(() => {});
  }, [isLoggedIn]);

  // Store names — fetched once unfiltered so pills stay stable
  const [storeNames, setStoreNames] = useState([]);
  useEffect(() => {
    fetchDeals({ limit: 200 })
      .then((res) => {
        const names = new Set();
        (res.data || []).forEach((d) => { if (d.store?.name) names.add(d.store.name); });
        setStoreNames(Array.from(names).sort());
      })
      .catch(() => {});
  }, []);

  const displayDeals = useMemo(
    () => (Array.isArray(deals) ? deals : []).filter((d) => d?.product_url && d?.product_name),
    [deals],
  );

  function requireLogin(message, action) {
    if (!isLoggedIn) { setLoginModal({ message }); } else { action?.(); }
  }

  function openFilters() {
    setFilterDraft({ store: filterStore, category: filterCategory, minDiscount: filterMinDiscount, priceMin: filterPriceMin, priceMax: filterPriceMax, hideOutOfStock: filterHideOutOfStock, hideExpired: filterHideExpired });
    setFiltersOpen(true);
  }

  function handleFiltersSignIn() {
    setFiltersOpen(false);
    setLoginModal({ message: "Sign in to filter by store and category." });
  }

  function applyFilters() {
    setFilterStore(filterDraft.store);
    setFilterCategory(filterDraft.category);
    setFilterMinDiscount(filterDraft.minDiscount);
    setFilterPriceMin(filterDraft.priceMin);
    setFilterPriceMax(filterDraft.priceMax);
    setFilterHideOutOfStock(filterDraft.hideOutOfStock);
    setFilterHideExpired(filterDraft.hideExpired);
    setFiltersOpen(false);
  }

  function clearFilters() {
    setFilterDraft({ store: "", category: "", minDiscount: "", priceMin: "", priceMax: "", hideOutOfStock: false, hideExpired: false });
  }

  function handleSortChange(val) {
    requireLogin(
      "Sorting is for registered members only.",
      () => setSortValue(val),
    );
  }

  function removeFilterChip(type) {
    if (type === "store") setFilterStore("");
    if (type === "category") setFilterCategory("");
    if (type === "sort") setSortValue("");
    if (type === "minDiscount") setFilterMinDiscount("");
    if (type === "price" || type === "priceRange") { setFilterPriceMin(""); setFilterPriceMax(""); }
    if (type === "hideOutOfStock") setFilterHideOutOfStock(false);
    if (type === "hideExpired") setFilterHideExpired(false);
  }

  const handleBookmark = useCallback(
    (dealId) => {
      if (!isLoggedIn) {
        setLoginModal({ message: "Bookmarks are for registered members only." });
        return;
      }
      const wasBookmarked = bookmarkedIds.has(dealId);
      setBookmarkedIds((prev) => {
        const next = new Set(prev);
        if (wasBookmarked) next.delete(dealId); else next.add(dealId);
        return next;
      });
      if (wasBookmarked) {
        removeBookmark(dealId).catch(() => setBookmarkedIds((prev) => { const n = new Set(prev); n.add(dealId); return n; }));
      } else {
        addBookmark(dealId).catch(() => setBookmarkedIds((prev) => { const n = new Set(prev); n.delete(dealId); return n; }));
      }
    },
    [isLoggedIn, bookmarkedIds],
  );

  async function handleLogout() {
    await logoutUser();
    navigate("/", { replace: true });
  }

  const activeChips = [
    filterStore && { type: "store", label: filterStore },
    filterCategory && { type: "category", label: filterCategory },
    filterMinDiscount && { type: "minDiscount", label: `${filterMinDiscount}%+ off` },
    (filterPriceMin || filterPriceMax) && {
      type: "priceRange",
      label: filterPriceMin && filterPriceMax
        ? `\u20ac${filterPriceMin} \u2013 \u20ac${filterPriceMax}`
        : filterPriceMin
        ? `From \u20ac${filterPriceMin}`
        : `Up to \u20ac${filterPriceMax}`,
    },
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-[#f7f7f7]">
      {/* Header */}
      <header className="backdrop-blur-md bg-white/80 border-b border-slate-200 sticky top-0 z-30">
        <div className="h-16 max-w-[1280px] mx-auto px-4 sm:px-8 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 no-underline">
            <img src="/landing/dd24-logo.svg" alt="DesiDeals24" className="w-5 h-6 object-contain" />
            <span className="font-extrabold tracking-[-0.5px] text-[20px] text-[#141414]">DesiDeals24</span>
            <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-slate-400 -translate-y-1">· Beta</span>
          </Link>
          <div className="flex items-center gap-3">
            {isLoggedIn ? (
              <button type="button" onClick={handleLogout} className="rounded-full border border-slate-200 bg-white hover:bg-slate-50 px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] text-slate-600 transition-colors">Logout</button>
            ) : (
              <button type="button" onClick={() => setLoginModal({})} className="rounded-full bg-[#16a34a] hover:bg-[#15803d] text-white px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] transition-colors">Sign in</button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-8 py-8 flex flex-col gap-6">
        {/* Title */}
        <div>
          <h1 className="text-[28px] sm:text-[36px] font-extrabold text-[#0f172a] leading-tight">Deals</h1>
          <p className="text-slate-500 text-[14px] mt-1">Fresh deals from Indian grocery stores in Germany</p>
        </div>

        {/* Search bar — open to all */}
        <div className="flex gap-0 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm focus-within:border-[#16a34a] transition-colors">
          <div className="flex items-center pl-4 text-slate-400 pointer-events-none">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          </div>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearchQuery(searchInput.trim())}
            placeholder="Search deals, groceries, or stores..."
            className="flex-1 px-3 py-3.5 text-[14px] text-slate-800 placeholder-slate-400 bg-transparent outline-none"
          />
          <button
            type="button"
            onClick={() => setSearchQuery(searchInput.trim())}
            className="bg-[#16a34a] hover:bg-[#15803d] text-white text-[14px] font-bold px-6 py-3.5 transition-colors"
          >
            Search
          </button>
        </div>

        {/* Filters bar: FILTERS button + active chips + results count + sort */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Filters button */}
          <button
            type="button"
            onClick={openFilters}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 text-[13px] font-bold transition-colors ${
              activeChips.length > 0
                ? "bg-[#0f172a] border-[#0f172a] text-white"
                : "bg-[#0f172a] border-[#0f172a] text-white"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="12" y1="18" x2="20" y2="18"/></svg>
            FILTERS
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
          </button>

          {/* Active filter chips */}
          {activeChips.map((chip) => (
            <span key={chip.type} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[13px] font-medium text-slate-700">
              {chip.label}
              <button onClick={() => removeFilterChip(chip.type)} className="text-slate-400 hover:text-slate-700 transition-colors leading-none">×</button>
            </span>
          ))}

          {/* Search query chip */}
          {searchQuery && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-[13px] font-medium text-slate-700">
              "{searchQuery}"
              <button onClick={() => { setSearchQuery(""); setSearchInput(""); }} className="text-slate-400 hover:text-slate-700 transition-colors leading-none">×</button>
            </span>
          )}

          {/* Results count */}
          {!loading && (
            <div className="ml-auto text-right">
              <p className="text-[10px] font-bold tracking-[1px] uppercase text-slate-400">Results Found</p>
              <p className="text-[18px] font-extrabold text-[#0f172a] leading-tight">{pagination?.total ?? displayDeals.length} Items</p>
            </div>
          )}

          {/* Sort dropdown — gated */}
          <SortDropdown
            value={isLoggedIn ? sortValue : ""}
            onChange={handleSortChange}
          />
        </div>

        {/* Deals grid */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 rounded-full animate-spin" style={{ borderTopColor: "#16a34a", borderWidth: 3, borderStyle: "solid", borderColor: "#e2e8f0", borderTopColor: "#16a34a" }} />
          </div>
        )}
        {error && !loading && (
          <div className="text-center py-16 text-slate-500 text-[15px]">Could not load deals right now. Please try again later.</div>
        )}
        {!loading && !error && displayDeals.length === 0 && (
          <div className="text-center py-16 text-slate-500 text-[15px]">
            {searchQuery ? `No deals found for "${searchQuery}".` : "No deals available right now."}
          </div>
        )}
        {!loading && displayDeals.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {displayDeals.map((deal) => (
              <DealCard key={deal.id} deal={deal} isBookmarked={bookmarkedIds.has(deal.id)} onBookmark={handleBookmark} />
            ))}
          </div>
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
        <LoginModal message={loginModal.message} onClose={() => setLoginModal(null)} />
      )}
    </div>
  );
}
