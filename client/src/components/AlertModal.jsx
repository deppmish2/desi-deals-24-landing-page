import React, { useState } from "react";
import { createAlert } from "../utils/api";
import { formatPrice } from "../utils/formatters";

const PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="%23f1f5f9" width="200" height="200"/><text fill="%2394a3b8" font-size="48" text-anchor="middle" dominant-baseline="middle" x="100" y="100">🛒</text></svg>';

function GlobeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="#16a34a" strokeWidth="1.5" />
      <path
        d="M10 2c-2 0-3.5 3.5-3.5 8s1.5 8 3.5 8 3.5-3.5 3.5-8S12 2 10 2z"
        stroke="#16a34a"
        strokeWidth="1.5"
      />
      <path d="M2 10h16" stroke="#16a34a" strokeWidth="1.5" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg width="20" height="18" viewBox="0 0 20 18" fill="none">
      <path
        d="M1 6l2-5h14l2 5M1 6v11a1 1 0 001 1h14a1 1 0 001-1V6M1 6h18"
        stroke="#16a34a"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7 6v2a3 3 0 006 0V6"
        stroke="#16a34a"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RadioDot({ selected }) {
  return (
    <div
      className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? "border-[#16a34a]" : "border-[#e2e8f0]"
      }`}
    >
      {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#16a34a]" />}
    </div>
  );
}

export default function AlertModal({ deal, initialTab = "price", onClose }) {
  const [tab, setTab] = useState(initialTab); // "price" | "stock"
  const [targetPrice, setTargetPrice] = useState("");
  const [productQuery, setProductQuery] = useState(deal?.product_name || "");
  const [storeScope, setStoreScope] = useState("any"); // "any" | "specific"
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [priceError, setPriceError] = useState("");
  const [imgError, setImgError] = useState(false);

  const proxyImg = deal?.image_url
    ? `/api/v1/admin/proxy/image?url=${encodeURIComponent(deal.image_url)}`
    : null;

  const storeName = deal?.store?.name || "Selected store";
  const hasSpecificStore = Boolean(deal?.store?.id);

  async function handleSave() {
    setError("");
    setPriceError("");
    setNotice("");
    const query = String(productQuery || deal?.product_name || "").trim();

    const parsedTargetPrice = Number.parseFloat(targetPrice);
    if (
      tab === "price" &&
      (!Number.isFinite(parsedTargetPrice) || parsedTargetPrice <= 0)
    ) {
      setPriceError("Enter a valid target price greater than 0,00 €");
      return;
    }

    if (!query) {
      setError("Please enter a product name for this alert.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        alert_type:
          tab === "price"
            ? "price"
            : storeScope === "specific" && hasSpecificStore
              ? "restock_store"
              : "restock_any",
        product_query: query,
      };
      if (tab === "price") {
        payload.target_price = parsedTargetPrice;
      }
      if (tab !== "price" && storeScope === "specific" && hasSpecificStore) {
        payload.target_store_id = deal.store.id;
      }
      await createAlert(payload);
      setNotice("Alert saved!");
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err.message || "Failed to save alert");
    } finally {
      setSaving(false);
    }
  }

  const imgSrc = imgError || !proxyImg ? PLACEHOLDER : proxyImg;

  // ─── Shared sub-sections ──────────────────────────────────────────────────

  function ProductCard({ imageSize = "md" }) {
    const sizeClass = imageSize === "lg" ? "w-24 h-24" : "w-16 h-16";
    const displayName =
      String(productQuery || deal?.product_name || "").trim() ||
      "Custom product alert";
    return (
      <div className="bg-[#f8fafc] border border-[#f1f5f9] rounded-[16px] p-[13px] flex items-center gap-4">
        <div
          className={`shrink-0 ${sizeClass} border border-[#e2e8f0] rounded-[16px] shadow-sm overflow-hidden bg-white flex items-center justify-center`}
        >
          <img
            src={imgSrc}
            alt={displayName}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        </div>
        <div className="min-w-0">
          <p
            className="font-semibold text-[#0f172a] truncate"
            style={{ fontSize: imageSize === "lg" ? 18 : 16 }}
          >
            {displayName}
          </p>
          {deal?.sale_price && imageSize === "lg" ? (
            <p className="text-[14px] text-[#64748b] mt-1">
              Current Price:{" "}
              <span className="font-bold text-[#0f172a]">
                {formatPrice(deal.sale_price, deal.currency)}
              </span>
            </p>
          ) : deal?.sale_price ? (
            <p className="text-[14px] font-bold text-[#0f172a]">
              {formatPrice(deal.sale_price, deal.currency)}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  function ProductQueryInput() {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[14px] font-bold text-[#0f172a]">Product Name</p>
        <input
          value={productQuery}
          onChange={(e) => setProductQuery(e.target.value)}
          placeholder="e.g. Aashirvaad Atta, Toor Dal, Jeera"
          className="w-full bg-[#f8fafc] border border-[#e2e8f0] h-12 px-4 text-[15px] text-[#0f172a] placeholder:text-[#64748b] focus:outline-none focus:border-[#16a34a] transition-colors rounded-[14px]"
        />
      </div>
    );
  }

  function Tabs({ activeClass = "" }) {
    return (
      <div className={`flex border-b border-[#f1f5f9] ${activeClass}`}>
        <button
          onClick={() => setTab("price")}
          className={`flex-1 pb-3.5 pt-2 text-[14px] text-center border-b-2 transition-colors ${
            tab === "price"
              ? "border-[#16a34a] text-[#16a34a] font-bold"
              : "border-transparent text-[#64748b] font-semibold"
          }`}
        >
          Price Below
        </button>
        <button
          onClick={() => setTab("stock")}
          className={`flex-1 pb-3.5 pt-2 text-[14px] text-center border-b-2 transition-colors ${
            tab === "stock"
              ? "border-[#16a34a] text-[#16a34a] font-bold"
              : "border-transparent text-[#64748b] font-semibold"
          }`}
        >
          Back in Stock
        </button>
      </div>
    );
  }

  function TargetPriceInput({ rounded = "24px" }) {
    if (tab !== "price") return null;
    const hasError = Boolean(priceError);
    return (
      <div
        className="flex flex-col gap-2 p-4 rounded-[16px]"
        style={{
          backgroundColor: hasError ? "#fef2f2" : "rgba(22,163,74,0.04)",
          border: `1.5px solid ${hasError ? "#fca5a5" : "rgba(22,163,74,0.2)"}`,
        }}
      >
        {/* Label row with inline error */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-bold text-[#0f172a] uppercase tracking-[0.5px]">
            Target Price
            <span className="text-[#ef4444] ml-0.5">*</span>
          </p>
          {hasError && (
            <span className="text-[12px] font-semibold text-[#dc2626] flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle
                  cx="6"
                  cy="6"
                  r="5.5"
                  stroke="#dc2626"
                  strokeWidth="1"
                />
                <path
                  d="M6 3.5v3M6 8.5h.01"
                  stroke="#dc2626"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              {priceError}
            </span>
          )}
        </div>

        {/* Large price input */}
        <div className="relative">
          <input
            type="number"
            min="0"
            step="0.01"
            placeholder="0,00"
            value={targetPrice}
            onChange={(e) => {
              setTargetPrice(e.target.value);
              if (priceError) setPriceError("");
            }}
            className="w-full bg-white h-[72px] pl-4 pr-12 text-[32px] font-black text-[#0f172a] placeholder:text-[#cbd5e1] focus:outline-none transition-colors"
            style={{
              borderRadius: rounded,
              border: `2px solid ${hasError ? "#f87171" : "#16a34a"}`,
              letterSpacing: "-0.5px",
            }}
            autoFocus
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[22px] font-black text-[#16a34a]">
            €
          </span>
        </div>

        <p className="text-[12px] text-[#64748b]">
          We'll alert you as soon as the price drops below this amount.
        </p>
      </div>
    );
  }

  function StoreSelection({
    rowRounded = "24px",
    iconRounded = "16px",
    iconSize = "sm",
  }) {
    const iconClass = iconSize === "lg" ? "w-12 h-12" : "w-10 h-10";
    const anyDesc =
      tab === "price"
        ? "Monitor price drop across all stores."
        : "Monitor stock across all stores.";
    const specificDesc =
      tab === "price"
        ? "Monitor price drop only on this store."
        : "Monitor stock on this store only.";

    return (
      <div className="flex flex-col gap-3">
        <p className="text-[11px] font-bold text-[#64748b] uppercase tracking-[0.55px] px-1">
          Select Store
        </p>
        {/* Any store */}
        <button
          onClick={() => setStoreScope("any")}
          className={`flex items-center gap-4 p-[18px] border-2 text-left w-full transition-colors ${
            storeScope === "any"
              ? "bg-[rgba(240,253,244,0.5)] border-[#16a34a]"
              : "bg-white border-[#f1f5f9]"
          }`}
          style={{ borderRadius: rowRounded }}
        >
          <div
            className={`${iconClass} bg-[rgba(22,163,74,0.1)] flex items-center justify-center shrink-0`}
            style={{ borderRadius: iconRounded }}
          >
            <GlobeIcon />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-[#0f172a]">Any store</p>
            <p className="text-[12px] text-[#64748b]">{anyDesc}</p>
          </div>
          <RadioDot selected={storeScope === "any"} />
        </button>
        {/* Specific store */}
        <button
          onClick={() => {
            if (hasSpecificStore) setStoreScope("specific");
          }}
          disabled={!hasSpecificStore}
          className={`flex items-center gap-4 p-[18px] border-2 text-left w-full transition-colors ${
            storeScope === "specific" && hasSpecificStore
              ? "bg-[rgba(240,253,244,0.5)] border-[#16a34a]"
              : "bg-white border-[#f1f5f9]"
          } ${hasSpecificStore ? "" : "opacity-60 cursor-not-allowed"}`}
          style={{ borderRadius: rowRounded }}
        >
          <div
            className={`${iconClass} bg-[rgba(22,163,74,0.1)] flex items-center justify-center shrink-0`}
            style={{ borderRadius: iconRounded }}
          >
            <StoreIcon />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold text-[#0f172a]">{storeName}</p>
            <p className="text-[12px] text-[#64748b]">
              {hasSpecificStore
                ? specificDesc
                : "Available when launched from a store deal"}
            </p>
          </div>
          <RadioDot selected={storeScope === "specific"} />
        </button>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Mobile bottom sheet (< sm) ─────────────────────────── */}
      <div className="sm:hidden fixed inset-0 z-50 flex flex-col justify-end">
        <div
          className="absolute inset-0 bg-[rgba(15,23,42,0.4)]"
          onClick={onClose}
        />
        <div className="relative bg-white rounded-tl-[24px] rounded-tr-[24px] w-full shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] flex flex-col">
          {/* Drag handle */}
          <div className="flex items-center justify-center pt-2 h-6">
            <div className="bg-[#e2e8f0] h-1.5 w-12 rounded-full" />
          </div>
          {/* Header */}
          <div className="flex items-center justify-between pl-4 pr-14 py-2">
            <button
              onClick={onClose}
              className="p-2 text-[#64748b] hover:text-[#0f172a]"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <span className="flex-1 text-[18px] font-bold text-[#0f172a] text-center">
              {tab === "price" ? "Price Alert" : "Stock Alert"}
            </span>
          </div>

          <div className="px-4 pt-2">
            <ProductCard imageSize="sm" />
          </div>

          <div className="px-4 pt-6">
            <Tabs />
          </div>

          {tab === "price" && (
            <div className="px-4 pt-4">
              <TargetPriceInput rounded="16px" />
            </div>
          )}

          <div className="px-4 pt-4">
            <ProductQueryInput />
          </div>

          <div className="px-4 pt-6">
            <StoreSelection
              rowRounded="24px"
              iconRounded="16px"
              iconSize="sm"
            />
          </div>

          {/* Actions */}
          <div className="px-4 pt-6 pb-8 flex flex-col gap-3">
            {notice && (
              <p className="text-sm text-center text-[#16a34a]">{notice}</p>
            )}
            {error && (
              <p className="text-sm text-center text-red-600">{error}</p>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-[#16a34a] text-white font-bold text-[16px] py-4 rounded-[24px] shadow-[0px_10px_15px_-3px_rgba(22,163,74,0.2),0px_4px_6px_-4px_rgba(22,163,74,0.2)] hover:bg-[#15803d] transition-colors disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Alert"}
            </button>
            <button
              onClick={onClose}
              className="text-[14px] font-semibold text-[#64748b] text-center py-3 hover:text-[#334155] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      {/* ── Desktop centered modal (≥ sm) ──────────────────────── */}
      <div
        className="hidden sm:flex fixed inset-0 z-50 items-center justify-center p-4"
        style={{
          backdropFilter: "blur(6px)",
          backgroundColor: "rgba(15,23,42,0.4)",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="bg-white rounded-[24px] w-full max-w-[600px] shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="relative flex items-center justify-center px-6 pt-4 pb-[17px] border-b border-[#f1f5f9]">
            <h2 className="text-[20px] font-bold text-[#111827]">
              {tab === "price" ? "Price Alert" : "Stock Alert"}
            </h2>
            <button
              onClick={onClose}
              className="absolute right-6 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#64748b] transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 6L6 18M6 6l12 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex px-6 border-b border-[#f1f5f9]">
            <button
              onClick={() => setTab("price")}
              className={`flex-1 py-4 text-[14px] font-semibold text-center border-b-2 transition-colors ${
                tab === "price"
                  ? "border-[#16a34a] text-[#16a34a]"
                  : "border-transparent text-[#64748b]"
              }`}
            >
              Price Below
            </button>
            <button
              onClick={() => setTab("stock")}
              className={`flex-1 py-4 text-[14px] font-semibold text-center border-b-2 transition-colors ${
                tab === "stock"
                  ? "border-[#16a34a] text-[#16a34a]"
                  : "border-transparent text-[#64748b]"
              }`}
            >
              Back in Stock
            </button>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-5 p-6 overflow-y-auto">
            <ProductCard imageSize="lg" />
            <TargetPriceInput rounded="16px" />
            <ProductQueryInput />
            <StoreSelection
              rowRounded="16px"
              iconRounded="9999px"
              iconSize="lg"
            />
          </div>

          {/* Footer */}
          <div className="px-6 pt-5 pb-6 border-t border-[#f1f5f9]">
            {notice && (
              <p className="text-sm text-center text-[#16a34a] mb-3">
                {notice}
              </p>
            )}
            {error && (
              <p className="text-sm text-center text-red-600 mb-3">{error}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-[#16a34a] text-white font-bold text-[16px] py-3.5 rounded-[16px] hover:bg-[#15803d] transition-colors disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Alert"}
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-[#f1f5f9] text-[#334155] font-bold text-[16px] py-3.5 rounded-[16px] hover:bg-[#e2e8f0] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
