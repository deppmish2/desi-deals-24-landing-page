import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  formatPrice,
  formatDiscount,
  formatPricePerKg,
  formatTimeAgo,
  formatWeight,
  formatBestBefore,
} from "../utils/formatters";
import { getAuthSession } from "../utils/api";
import { setDealsNavSelected } from "../utils/deals-nav-selection";
import AlertModal from "./AlertModal";

const PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="%23f1f5f9" width="200" height="200"/><text fill="%2394a3b8" font-size="48" text-anchor="middle" dominant-baseline="middle" x="100" y="100">🛒</text></svg>';
const SMART_LIST_SESSION_KEY = "dd24_smart_list_state_v1";

function normalizeUnit(value) {
  const unit = String(value || "")
    .trim()
    .toLowerCase();
  if (!unit) return "";
  if (
    unit === "piece" ||
    unit === "pieces" ||
    unit === "pc" ||
    unit === "pcs"
  ) {
    return "pcs";
  }
  if (unit === "kilo" || unit === "kilos") return "kg";
  if (unit === "gram" || unit === "grams" || unit === "gm") return "g";
  if (
    unit === "litre" ||
    unit === "litres" ||
    unit === "liter" ||
    unit === "liters"
  )
    return "l";
  if (unit === "milliliter" || unit === "milliliters") return "ml";
  return unit;
}

function extractSmartListItemName(productName) {
  return String(productName || "")
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(kg|kilo|kilos|g|gm|gram|grams|ml|l|litre|litres|liter|liters|ltr|pcs?|pieces?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function readSmartListDrafts() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(SMART_LIST_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toSmartListDraftFromDeal(deal) {
  const rawItemText =
    extractSmartListItemName(deal?.product_name) ||
    String(deal?.product_name || "").trim();
  const weightValue = Number(deal?.weight_value);
  const quantity =
    Number.isFinite(weightValue) && weightValue > 0 ? String(weightValue) : "";
  const quantityUnit = normalizeUnit(deal?.weight_unit);

  return {
    raw_item_text: rawItemText,
    quantity,
    quantity_unit: quantityUnit,
  };
}

function DesktopDealCard({
  deal,
  onOpenAlertModal,
  onAddToSmartShoppingList,
  smartListNotice,
  smartListError,
  goToRedirect,
  proxyImg,
  imgError,
  setImgError,
}) {
  const discountPct = deal.discount_percent
    ? Math.round(deal.discount_percent)
    : null;
  const isSoldOut = deal.availability === "out_of_stock";

  return (
    <div
      className="bg-white border border-[#f1f5f9] rounded-[32px] overflow-hidden flex flex-col"
      style={{ boxShadow: "0px 1px 2px 0px rgba(0,0,0,0.05)" }}
    >
      {/* Image */}
      <a
        href={deal.product_url}
        onClick={goToRedirect}
        className="relative h-[256px] bg-[#f8fafc] overflow-hidden shrink-0 block"
      >
        <img
          src={
            imgError || !proxyImg
              ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="%23f1f5f9" width="200" height="200"/><text fill="%2394a3b8" font-size="48" text-anchor="middle" dominant-baseline="middle" x="100" y="100">🛒</text></svg>'
              : proxyImg
          }
          alt={deal.product_name}
          loading="lazy"
          className={`w-full h-full object-contain p-4 ${isSoldOut ? "opacity-40" : ""}`}
          style={isSoldOut ? { filter: "saturate(0)" } : undefined}
          onError={() => setImgError(true)}
        />
        {/* Discount badge */}
        {discountPct > 0 && (
          <span
            className="absolute left-5 text-white font-extrabold rounded-[16px] px-3 py-1.5"
            style={{
              top: 15,
              backgroundColor: "#ef4444",
              fontSize: 10,
              boxShadow:
                "0px 20px 25px -5px rgba(239,68,68,0.2),0px 8px 10px -6px rgba(239,68,68,0.2)",
            }}
          >
            -{discountPct}%
          </span>
        )}
        {/* Best before badge */}
        {deal.best_before && !isSoldOut && (
          <span
            className="absolute right-5 text-white font-extrabold rounded-[16px] px-3 py-1.5 backdrop-blur-[2px]"
            style={{
              top: 15,
              backgroundColor: "#f97316",
              fontSize: 10,
              boxShadow:
                "0px 10px 15px -3px rgba(249,115,22,0.2),0px 4px 6px -4px rgba(249,115,22,0.2)",
            }}
          >
            Best before {formatBestBefore(deal.best_before)}
          </span>
        )}
        {/* Sold out overlay */}
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(15,23,42,0.4)] pointer-events-none">
            <span
              className="bg-white text-[#0f172a] font-extrabold text-[10px] uppercase tracking-[3px] px-6 py-2 rounded-full"
              style={{ boxShadow: "0px 25px 50px -12px rgba(0,0,0,0.25)" }}
            >
              Sold Out
            </span>
          </div>
        )}
      </a>

      {/* Content */}
      <div className="flex flex-col flex-1 p-8 gap-0">
        {/* Category + name + weight */}
        <div className="mb-6">
          {deal.category && (
            <span
              className="inline-block text-[10px] font-extrabold uppercase tracking-[1px] rounded-full px-3 py-1 mb-2"
              style={{
                backgroundColor: isSoldOut ? "#f1f5f9" : "rgba(22,163,74,0.1)",
                color: isSoldOut ? "#94a3b8" : "#16a34a",
              }}
            >
              {deal.category}
            </span>
          )}
          <p
            className={`text-[16px] font-bold leading-[20px] line-clamp-2 h-[40px] ${isSoldOut ? "text-[#94a3b8]" : "text-[#0f172a]"}`}
          >
            {deal.product_name}
          </p>
          {(deal.weight_raw || deal.price_per_kg) && (
            <p
              className={`text-[12px] font-medium mt-1 ${isSoldOut ? "text-[#94a3b8]" : "text-[#64748b]"}`}
            >
              {deal.weight_raw}
              {deal.weight_raw && deal.price_per_kg ? " | " : ""}
              {deal.price_per_kg
                ? `${formatPricePerKg(deal.price_per_kg)}`
                : ""}
            </p>
          )}
        </div>

        {/* Prices */}
        <div
          className={`flex items-baseline gap-2 mb-6 ${isSoldOut ? "opacity-60" : ""}`}
        >
          <span
            className={`text-[30px] font-extrabold leading-[36px] ${isSoldOut ? "text-[#cbd5e1]" : "text-[#0f172a]"}`}
          >
            {formatPrice(deal.sale_price, deal.currency)}
          </span>
          {deal.original_price && (
            <span
              className={`text-[14px] line-through ${isSoldOut ? "text-[#e2e8f0]" : "text-[#94a3b8]"}`}
            >
              {formatPrice(deal.original_price, deal.currency)}
            </span>
          )}
        </div>

        {/* Buttons */}
        {isSoldOut ? (
          <button
            type="button"
            onClick={onOpenAlertModal}
            className="w-full flex items-center justify-center gap-2 border-2 border-[#cbd5e1] rounded-[24px] py-[18px] text-[14px] font-bold text-[#64748b] uppercase tracking-[1.4px]"
          >
            <svg width="13" height="17" viewBox="0 0 16 20" fill="none">
              <path
                d="M8 2a5 5 0 015 5v3l1.5 2.5H1.5L3 10V7a5 5 0 015-5z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M6.5 17a1.5 1.5 0 003 0"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Notify me
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onAddToSmartShoppingList}
              className="flex-1 flex items-center justify-center gap-2 border-2 border-[#16a34a] text-[#16a34a] text-[14px] font-bold rounded-[24px] py-[18px]"
              style={{
                boxShadow:
                  "0px 20px 25px -5px rgba(22,163,74,0.2),0px 8px 10px -6px rgba(22,163,74,0.2)",
              }}
            >
              <svg width="17" height="18" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 6h14l-1.5 8H4.5L3 6z"
                  stroke="#16a34a"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 10v3M12 10v3"
                  stroke="#16a34a"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Add to List
            </button>
            <button
              type="button"
              onClick={onOpenAlertModal}
              className="flex items-center justify-center border-2 border-[#e2e8f0] rounded-[24px] py-[18px] w-[63px] shrink-0"
            >
              <svg width="13" height="17" viewBox="0 0 16 20" fill="none">
                <path
                  d="M8 2a5 5 0 015 5v3l1.5 2.5H1.5L3 10V7a5 5 0 015-5z"
                  stroke="#64748b"
                  strokeWidth="1.5"
                />
                <path
                  d="M6.5 17a1.5 1.5 0 003 0"
                  stroke="#64748b"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        )}

        {smartListNotice && (
          <p className="text-xs mt-2" style={{ color: "#16a34a" }}>
            {smartListNotice}
          </p>
        )}
        {smartListError && (
          <p className="text-xs text-red-600 mt-2">{smartListError}</p>
        )}
      </div>
    </div>
  );
}

export default function DealCard({
  deal,
  primaryAction = "view_deal",
  variant,
}) {
  const [imgError, setImgError] = useState(false);
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [alertModalTab, setAlertModalTab] = useState("price");
  const [smartListNotice, setSmartListNotice] = useState("");
  const [smartListError, setSmartListError] = useState("");
  const navigate = useNavigate();
  const discount = formatDiscount(deal.discount_percent);

  function goToRedirect(e) {
    e.preventDefault();
    setDealsNavSelected(true);
    navigate(
      `/redirect?url=${encodeURIComponent(deal.product_url)}&store=${encodeURIComponent(deal.store.name)}`,
    );
  }
  const proxyImg = deal.image_url
    ? `/api/v1/admin/proxy/image?url=${encodeURIComponent(deal.image_url)}`
    : null;

  function onOpenAlertModal() {
    const session = getAuthSession();
    if (!session?.accessToken) {
      navigate("/login");
      return;
    }
    setAlertModalTab("price");
    setAlertModalOpen(true);
  }

  function onAddToSmartShoppingList() {
    setSmartListError("");
    setSmartListNotice("");
    try {
      const nextDraft = toSmartListDraftFromDeal(deal);
      const nameKey = String(nextDraft.raw_item_text || "")
        .trim()
        .toLowerCase();
      if (!nameKey) {
        setSmartListError("Could not determine item name.");
        return;
      }

      const existing = readSmartListDrafts();
      const existingIndex = existing.findIndex(
        (item) =>
          String(item?.raw_item_text || "")
            .trim()
            .toLowerCase() === nameKey,
      );

      let updated;
      if (existingIndex !== -1) {
        // Update quantity/unit if the deal provides size info
        if (nextDraft.quantity && nextDraft.quantity_unit) {
          updated = existing.map((item, i) =>
            i === existingIndex
              ? { ...item, quantity: nextDraft.quantity, quantity_unit: nextDraft.quantity_unit }
              : item,
          );
          setSmartListNotice("Updated in Smart Shopping List.");
        } else {
          setSmartListNotice("Already in Smart Shopping List.");
          return;
        }
      } else {
        updated = [nextDraft, ...existing];
      }
      window.sessionStorage.setItem(
        SMART_LIST_SESSION_KEY,
        JSON.stringify(updated),
      );
      window.dispatchEvent(new CustomEvent("dd24-list-changed"));
      setSmartListNotice("Added to Smart Shopping List.");
    } catch {
      setSmartListError("Failed to add item to Smart Shopping List.");
    }
  }

  const discountPct = deal.discount_percent
    ? Math.round(deal.discount_percent)
    : null;

  if (variant === "desktop") {
    return (
      <>
        <DesktopDealCard
          deal={deal}
          onOpenAlertModal={onOpenAlertModal}
          onAddToSmartShoppingList={onAddToSmartShoppingList}
          smartListNotice={smartListNotice}
          smartListError={smartListError}
          goToRedirect={goToRedirect}
          proxyImg={proxyImg}
          imgError={imgError}
          setImgError={setImgError}
        />
        {alertModalOpen && (
          <AlertModal
            deal={deal}
            initialTab={alertModalTab}
            onClose={() => setAlertModalOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <div
      className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden flex flex-col h-full"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
    >
      {/* Image */}
      <a
        href={deal.product_url}
        onClick={goToRedirect}
        className="relative block overflow-hidden"
        style={{ height: "12rem" }}
      >
        <img
          src={imgError || !proxyImg ? PLACEHOLDER : proxyImg}
          alt={deal.product_name}
          loading="lazy"
          className="w-full h-full object-cover bg-[#f1f5f9]"
          onError={() => setImgError(true)}
        />
        {/* Discount badge top-left */}
        {discountPct > 0 && (
          <span
            className="absolute top-2 left-2 text-white text-xs font-bold px-2 py-0.5 rounded"
            style={{
              backgroundColor: "#dc2626",
              fontSize: 11,
              letterSpacing: "0.03em",
            }}
          >
            -{discountPct}% OFF
          </span>
        )}
        {/* Best before badge bottom-left */}
        {deal.best_before && (
          <span
            className="absolute bottom-2 left-2 text-white text-xs font-semibold px-2 py-0.5 rounded"
            style={{ backgroundColor: "#f59e0b", fontSize: 10 }}
          >
            Best before {formatBestBefore(deal.best_before)}
          </span>
        )}
      </a>

      {/* Body */}
      <div className="flex flex-col flex-1 p-4 gap-2">
        {/* Product name */}
        <p
          className="text-base font-bold text-[#0f172a] line-clamp-2 leading-snug"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {deal.product_name}
        </p>

        {/* Weight • price/kg */}
        {(deal.weight_raw || deal.price_per_kg) && (
          <p className="text-xs text-[#64748b]">
            {deal.weight_raw}
            {deal.weight_raw && deal.price_per_kg && " • "}
            {deal.price_per_kg && formatPricePerKg(deal.price_per_kg)}
          </p>
        )}

        {/* Availability */}
        <div className="flex items-center gap-1.5">
          {deal.availability === "in_stock" ? (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <circle
                  cx="6"
                  cy="6"
                  r="5"
                  fill="#dcfce7"
                  stroke="#16a34a"
                  strokeWidth="1"
                />
                <path
                  d="M3.5 6l1.5 1.5L8.5 4"
                  stroke="#16a34a"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                className="text-xs font-medium"
                style={{ color: "#16a34a" }}
              >
                In Stock
              </span>
            </>
          ) : deal.availability === "limited" ? (
            <>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M6 1L11 10H1L6 1z"
                  fill="#fef3c7"
                  stroke="#f59e0b"
                  strokeWidth="1"
                />
                <path
                  d="M6 4.5v2.5"
                  stroke="#f59e0b"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                <circle cx="6" cy="8.5" r="0.5" fill="#f59e0b" />
              </svg>
              <span
                className="text-xs font-medium"
                style={{ color: "#f59e0b" }}
              >
                Low Stock
              </span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 shrink-0" />
              <span className="text-xs text-[#64748b]">Not Available</span>
            </>
          )}
        </div>

        {/* Prices */}
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-xl font-bold text-[#0f172a]">
            {formatPrice(deal.sale_price, deal.currency)}
          </span>
          {deal.original_price && (
            <span className="text-sm line-through" style={{ color: "#94a3b8" }}>
              {formatPrice(deal.original_price, deal.currency)}
            </span>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 mt-1">
          {primaryAction === "add_to_smart_list" ? (
            <button
              type="button"
              onClick={onAddToSmartShoppingList}
              className="flex-1 py-2.5 px-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-1.5"
              style={{ backgroundColor: "#16a34a" }}
            >
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 6h14l-1.5 8H4.5L3 6z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="M8 10v3M12 10v3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Add to List
            </button>
          ) : (
            <a
              href={deal.product_url}
              onClick={
                deal.availability !== "out_of_stock"
                  ? goToRedirect
                  : (e) => e.preventDefault()
              }
              className="flex-1 py-2.5 px-3 rounded-xl text-sm font-bold text-white text-center flex items-center justify-center"
              style={{
                backgroundColor:
                  deal.availability === "out_of_stock" ? "#D1D5DB" : "#16a34a",
                color:
                  deal.availability === "out_of_stock" ? "#6B7280" : "#fff",
                pointerEvents:
                  deal.availability === "out_of_stock" ? "none" : "auto",
              }}
            >
              {deal.availability === "out_of_stock"
                ? "Out of Stock"
                : "View Deal"}
            </a>
          )}
          <button
            type="button"
            onClick={onOpenAlertModal}
            className="py-2.5 px-3 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5"
            style={{ backgroundColor: "#f1f5f9", color: "#334155" }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 2a6 6 0 016 6v3l1.5 2.5H2.5L4 11V8a6 6 0 016-6z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M8.5 16.5a1.5 1.5 0 003 0"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Alert
          </button>
        </div>

        {smartListNotice && (
          <p className="text-xs mt-0.5" style={{ color: "#16a34a" }}>
            {smartListNotice}
          </p>
        )}
        {smartListError && (
          <p className="text-xs text-red-600 mt-0.5">{smartListError}</p>
        )}
      </div>

      {alertModalOpen && (
        <AlertModal
          deal={deal}
          initialTab={alertModalTab}
          onClose={() => setAlertModalOpen(false)}
        />
      )}
    </div>
  );
}
