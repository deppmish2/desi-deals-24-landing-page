import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  buildListStoreCartTransfer,
  createList,
  fetchList,
  getAuthSession,
  recommendList,
  searchListReplacements,
  warmup,
} from "../utils/api";
import { formatPrice } from "../utils/formatters";
import {
  formatCombinationPriceSummary,
  formatCombinationSummary,
  formatMatchedTotalQuantity,
  getCombinationTotal,
} from "../utils/combinationDisplay";
import {
  normalizeRequestedSmartListItems,
  readSmartListSessionDrafts,
  writeSmartListSessionDrafts,
} from "../utils/smartListSession";

// ─── Constants ────────────────────────────────────────────────────────────────
const RECOMMEND_RETRY_MAX = 8;
const RECOMMEND_RETRY_DELAY_MS = 1200;
const MASS_VOLUME_UNITS = new Set(["kg", "g", "l", "ml"]);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readSessionFallbackItems() {
  return normalizeRequestedSmartListItems(readSmartListSessionDrafts());
}

function hasStructuredSize(item) {
  const quantity = Number(item?.quantity);
  const unit = String(item?.quantity_unit || "").trim().toLowerCase();
  return (
    Number.isFinite(quantity) &&
    quantity > 0 &&
    MASS_VOLUME_UNITS.has(unit)
  );
}

function pickBestFallbackItems(...sources) {
  const nonEmpty = sources.filter((items) => Array.isArray(items) && items.length > 0);
  const structured = nonEmpty.find((items) => items.some(hasStructuredSize));
  return structured || nonEmpty[0] || [];
}

function normalizeUnit(value) {
  const unit = String(value || "").trim().toLowerCase();
  if (!unit) return "";
  if (unit === "piece" || unit === "pieces" || unit === "pc" || unit === "pcs") {
    return "pcs";
  }
  if (unit === "kilo" || unit === "kilos") return "kg";
  if (unit === "gram" || unit === "grams" || unit === "gm" || unit === "gms") return "g";
  if (unit === "litre" || unit === "litres" || unit === "liter" || unit === "liters") return "l";
  if (unit === "milliliter" || unit === "milliliters") return "ml";
  return unit;
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toSafeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractSmartListItemName(productName) {
  return String(productName || "")
    .replace(
      /\b\d+(?:[.,]\d+)?\s*(kg|kilo|kilos|g|gm|gms|gram|grams|ml|l|litre|litres|liter|liters|ltr|pcs?|pieces?)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function patchStoreRowWithReplacement(row, payload) {
  const { listItemId, missingItem, previousListText, deal, fallbackCategory } =
    payload;
  const listItemKey = String(listItemId || "");
  const matchedItems = Array.isArray(row?.matched_items)
    ? [...row.matched_items]
    : [];
  const existingIndex = matchedItems.findIndex(
    (item) => String(item?.list_item_id || "") === listItemKey,
  );
  const existingItem = existingIndex >= 0 ? matchedItems[existingIndex] : null;

  const combination = Array.isArray(deal?.combination)
    ? deal.combination
        .map((entry) => ({
          product_url: entry?.product_url,
          count: Number(entry?.count || 0),
          sale_price: entry?.sale_price,
          weight_value: entry?.weight_value,
          weight_unit: entry?.weight_unit,
          product_name: entry?.product_name,
        }))
        .filter((entry) => entry.product_url && entry.count > 0)
    : Array.isArray(existingItem?.combination)
      ? existingItem.combination
      : null;
  const packsNeeded =
    toSafeNumber(deal?.packs_needed, 0) > 0
      ? toSafeNumber(deal.packs_needed, 1)
      : toSafeNumber(existingItem?.packs_needed, 0) > 0
        ? toSafeNumber(existingItem.packs_needed, 1)
        : 1;
  const salePrice = toSafeNumber(deal?.sale_price, 0);
  const effectivePrice =
    toSafeNumber(deal?.effective_price, 0) > 0
      ? toSafeNumber(deal.effective_price, 0)
      : Number((salePrice * packsNeeded).toFixed(2));
  const combinationTotal = getCombinationTotal(combination);
  const nextItem = {
    ...(existingItem || {}),
    list_item_id: listItemId,
    query: String(
      deal?.product_name || previousListText || missingItem || "",
    ).trim(),
    deal_id: deal?.id ?? existingItem?.deal_id ?? null,
    product_name: String(
      deal?.product_name ||
        existingItem?.product_name ||
        previousListText ||
        missingItem ||
        "",
    ).trim(),
    product_category:
      String(deal?.product_category || "").trim() ||
      existingItem?.product_category ||
      fallbackCategory ||
      null,
    product_url: deal?.product_url || existingItem?.product_url || null,
    image_url: deal?.image_url || existingItem?.image_url || null,
    sale_price: salePrice,
    currency: deal?.currency || existingItem?.currency || "EUR",
    weight_value:
      deal?.weight_value != null
        ? deal.weight_value
        : (existingItem?.weight_value ?? null),
    weight_unit:
      deal?.weight_unit != null
        ? deal.weight_unit
        : (existingItem?.weight_unit ?? null),
    packs_needed: packsNeeded,
    effective_price: effectivePrice,
    combination,
    matched_total_quantity:
      combinationTotal?.value ??
      (deal?.matched_total_quantity != null
        ? deal.matched_total_quantity
        : (existingItem?.matched_total_quantity ?? null)),
    matched_total_unit:
      combinationTotal?.unit ??
      (deal?.matched_total_unit != null
        ? deal.matched_total_unit
        : (existingItem?.matched_total_unit ?? null)),
    warnings: [],
  };

  if (existingIndex >= 0) {
    matchedItems[existingIndex] = nextItem;
  } else {
    matchedItems.push(nextItem);
  }

  const namesToRemove = new Set(
    [
      missingItem,
      previousListText,
      existingItem?.query,
      existingItem?.product_name,
      nextItem.query,
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean),
  );
  const itemsNotFound = (
    Array.isArray(row?.items_not_found) ? row.items_not_found : []
  ).filter((name) => !namesToRemove.has(normalizeText(name)));

  const subtotal = Number(
    matchedItems
      .reduce(
        (sum, item) =>
          sum + toSafeNumber(item?.effective_price ?? item?.sale_price, 0),
        0,
      )
      .toFixed(2),
  );
  const deliveryTotal = toSafeNumber(
    row?.delivery?.total_delivery_cost,
    toSafeNumber(row?.delivery?.shipping_cost, 0) +
      toSafeNumber(row?.delivery?.surcharge, 0),
  );
  const total = Number((subtotal + deliveryTotal).toFixed(2));
  const itemsTotal =
    toSafeNumber(row?.items_total, 0) > 0
      ? toSafeNumber(row.items_total, 0)
      : Math.max(
          matchedItems.length + itemsNotFound.length,
          matchedItems.length,
        );

  return {
    ...row,
    matched_items: matchedItems,
    items_not_found: itemsNotFound,
    items_matched: matchedItems.length,
    items_total: itemsTotal,
    subtotal,
    total,
    brand_info: Array.isArray(row?.brand_info)
      ? row.brand_info.filter(
          (entry) => String(entry?.list_item_id || "") !== listItemKey,
        )
      : row?.brand_info,
  };
}

function persistSessionItems(items) {
  writeSmartListSessionDrafts(Array.isArray(items) ? items : []);
}

function normalizeListItemRow(item) {
  return {
    id: item?.id || null,
    raw_item_text: String(item?.raw_item_text || "").trim(),
    quantity:
      item?.quantity == null || item?.quantity === ""
        ? null
        : Number(item.quantity),
    quantity_unit:
      item?.quantity_unit == null
        ? null
        : String(item.quantity_unit || "").trim().toLowerCase() || null,
    item_count: Math.max(1, Number(item?.item_count) || 1),
    brand_pref: item?.brand_pref || null,
  };
}

function getReplacementTargetLabel(data, deal = null) {
  const requested = formatMatchedTotalQuantity(
    data?.requested_quantity,
    data?.requested_unit,
  );
  if (requested) return requested;
  return formatMatchedTotalQuantity(
    deal?.matched_total_quantity ?? deal?.candidate_total_quantity,
    deal?.matched_total_unit ?? deal?.candidate_total_unit,
  );
}

function toSessionDraftFromReplacement(deal) {
  const rawItemText =
    extractSmartListItemName(deal?.product_name) ||
    String(deal?.base_product || deal?.product_name || "").trim();
  const quantityValue =
    deal?.matched_total_quantity != null && deal?.matched_total_quantity !== ""
      ? Number(deal.matched_total_quantity)
      : deal?.weight_value != null && deal?.weight_value !== ""
        ? Number(deal.weight_value)
        : null;
  const quantityUnit = normalizeUnit(
    deal?.matched_total_unit || deal?.weight_unit,
  );

  return {
    raw_item_text: rawItemText,
    quantity:
      Number.isFinite(quantityValue) && quantityValue > 0 ? quantityValue : null,
    quantity_unit: quantityUnit || null,
    item_count: 1,
  };
}

function replaceItemInSession(itemName, replacementDeal, sourceItems = null) {
  const current =
    Array.isArray(sourceItems) && sourceItems.length > 0
      ? sourceItems.map(normalizeListItemRow)
      : readSessionFallbackItems();
  const target = String(itemName || "").trim().toLowerCase();
  const replacement = toSessionDraftFromReplacement(replacementDeal);
  if (!target || !replacement.raw_item_text) return current;

  let replaced = false;
  const updated = current.map((item) => {
    const textLower = String(item?.raw_item_text || "").trim().toLowerCase();
    const matches =
      textLower === target ||
      textLower.includes(target) ||
      target.includes(textLower);
    if (!matches || replaced) return item;
    replaced = true;
    return replacement;
  });
  const nextItems = replaced ? updated : [replacement, ...current];
  persistSessionItems(nextItems);
  return nextItems;
}

function findListItemForMissing(listItems, missingName) {
  const target = String(missingName || "").trim().toLowerCase();
  if (!target) return null;
  return (
    listItems.find(
      (item) =>
        String(item?.raw_item_text || "").trim().toLowerCase() === target,
    ) ||
    listItems.find((item) => {
      const text = String(item?.raw_item_text || "").trim().toLowerCase();
      return text.includes(target) || target.includes(text);
    }) ||
    null
  );
}

async function filterStoresByReplacementCoverage(result, { listId, listItems }) {
  const rows = Array.isArray(result?.stores) ? result.stores : [];
  if (!listId || !Array.isArray(listItems) || listItems.length === 0) {
    return result;
  }

  const visibility = await Promise.all(
    rows.map(async (row) => {
      const missingItems = Array.isArray(row?.items_not_found)
        ? row.items_not_found
        : [];
      if (missingItems.length === 0) return true;

      const storeId = String(row?.store?.id || "").trim();
      if (!storeId) return false;

      for (const missingName of missingItems) {
        const listItem = findListItemForMissing(listItems, missingName);
        if (!listItem?.id) return false;
        try {
          const replacement = await searchListReplacements(listId, {
            store_id: storeId,
            list_item_id: listItem.id,
            limit: 1,
          });
          const candidates = Array.isArray(replacement?.data?.results)
            ? replacement.data.results
            : [];
          if (candidates.length === 0) return false;
        } catch {
          return false;
        }
      }

      return true;
    }),
  );

  return {
    ...result,
    stores: rows.filter((_, index) => visibility[index]),
  };
}

function removeItemFromSession(itemName, sourceItems = null) {
  try {
    const parsed =
      Array.isArray(sourceItems) && sourceItems.length > 0
        ? sourceItems.map(normalizeListItemRow)
        : readSmartListSessionDrafts();
    const nameLower = itemName.toLowerCase().trim();
    const updated = parsed.filter((item) => {
      const textLower = String(item?.raw_item_text || "").toLowerCase().trim();
      // Remove if there's a clear substring match in either direction
      return !textLower.includes(nameLower) && !nameLower.includes(textLower);
    });
    persistSessionItems(updated);
    return updated;
  } catch {
    return [];
  }
}

function getStoreLogoCandidates(store) {
  const candidates = [];
  const explicitLogo = String(store?.logo_url || "").trim();
  if (explicitLogo) {
    if (/^https?:\/\//i.test(explicitLogo)) {
      candidates.push(explicitLogo);
    } else {
      try { candidates.push(new URL(explicitLogo, store?.url || "").href); } catch {}
    }
  }
  const storeUrl = String(store?.url || "").trim();
  if (storeUrl) {
    try {
      const parsed = new URL(storeUrl);
      const origin = parsed.origin.replace(/\/+$/, "");
      candidates.push(`${origin}/favicon.ico`);
      candidates.push(`https://logo.clearbit.com/${encodeURIComponent(parsed.hostname)}`);
      candidates.push(`https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(origin)}`);
    } catch {}
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

async function runRecommendationWithRetry({ listId, deliveryPreference, postcode, fallbackItems }) {
  await warmup().catch(() => {});
  let attempts = 0;
  while (attempts < RECOMMEND_RETRY_MAX) {
    attempts += 1;
    try {
      const fallbackPayload = fallbackItems.length > 0
        ? { items: fallbackItems, raw_input: fallbackItems.map((i) => i.raw_item_text).join(", "), input_method: "text", name: "Smart List" }
        : {};
      return await recommendList(listId, { delivery_preference: deliveryPreference, postcode, ...fallbackPayload });
    } catch (err) {
      const msg = String(err?.message || "").toLowerCase();
      const warmingUp = msg.includes("warming up") || msg.includes("deals_unavailable") || msg.includes("pricing data is warming up");
      if (!warmingUp || attempts >= RECOMMEND_RETRY_MAX) throw err;
      await warmup().catch(() => {});
      await sleep(RECOMMEND_RETRY_DELAY_MS);
    }
  }
  throw new Error("Pricing data is warming up. Please try again.");
}

// Transform API store row → card data
function transformStore(row, isWinner, secondTotal, stableState = null) {
  const matchedItems = Array.isArray(row?.matched_items) ? row.matched_items : [];
  const missingNames = Array.isArray(row?.items_not_found) ? row.items_not_found : [];
  const availableCount = Number(row?.items_matched || matchedItems.length);
  const totalItems = Number(row?.items_total || availableCount + missingNames.length);
  const isFullMatch = missingNames.length === 0;
  const total = Number(row?.total || 0);
  const winner = stableState?.winner ?? isWinner;
  const savedAmount =
    stableState?.savedAmount ??
    (winner && secondTotal > 0 ? Number((secondTotal - total).toFixed(2)) : 0);
  const shippingCost = Number(row?.shipping_cost ?? row?.store?.shipping_cost ?? 0);
  const freeShippingThreshold = row?.free_shipping_min_basket != null
    ? Number(row.free_shipping_min_basket)
    : row?.store?.min_basket != null
    ? Number(row.store.min_basket)
    : null;
  const subtotal = Number(row?.subtotal ?? (total - shippingCost));

  return {
    id: String(row?.store?.id || row?.store?.name || ""),
    name: String(row?.store?.name || "Store"),
    store: row?.store,
    totalPrice: total,
    subtotal,
    shippingCost,
    freeShippingThreshold,
    savedAmount,
    matchType: isFullMatch ? "full" : "partial",
    badge: winner ? "Best Value" : null,
    winner,
    orderUrl: row?.cart_url || row?.store?.url || "#",
    availableCount,
    missingCount: missingNames.length,
    totalItems,
    baseSortPrice: stableState?.baseSortPrice ?? total,
    baseSortAvailability: stableState?.baseSortAvailability ?? availableCount,
    baseSortMissing: stableState?.baseSortMissing ?? missingNames.length,
    baseRankIndex: stableState?.baseRankIndex ?? 0,
    availableItems: matchedItems.map((item) => ({
      combination: Array.isArray(item?.combination) ? item.combination : [],
      name: String(item?.product_name || item?.query || ""),
      qty: Number(item?.packs_needed || 1),
      unitPrice: Number(item?.sale_price || 0),
      totalPrice: Number(item?.effective_price ?? item?.sale_price ?? 0),
      matchedTotalQuantity:
        getCombinationTotal(item?.combination)?.value ??
        item?.matched_total_quantity ??
        null,
      matchedTotalUnit:
        getCombinationTotal(item?.combination)?.unit ??
        item?.matched_total_unit ??
        null,
      combinationSummary: formatCombinationSummary(item?.combination),
      priceSummary: formatCombinationPriceSummary(
        item?.combination,
        formatPrice,
      ),
    })),
    missingItems: missingNames.map((name) => ({ name: String(name), expectedPrice: null })),
  };
}

// ─── Icons ────────────────────────────────────────────────────────────────────
function ChevronIcon({ up }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: up ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SearchSmallIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function XIcon({ size = 11 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="18" height="16" viewBox="0 0 24 21" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" /><path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function SearchMedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="18" height="9" viewBox="0 0 18 9" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="0" y1="4.5" x2="14" y2="4.5" /><polyline points="10 1 14 4.5 10 8" />
    </svg>
  );
}

function ShoppingBagIcon() {
  return (
    <svg width="24" height="30" viewBox="0 0 24 30" fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.96-1.61L23 6H6" />
    </svg>
  );
}

function TimerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// Compute delivery estimate: cutoff is 15:00 local time, delivery next business day
function getDeliveryEstimate() {
  const now = new Date();
  const cutoffHour = 15;
  const minsLeft = (cutoffHour * 60) - (now.getHours() * 60 + now.getMinutes());
  const orderWindow = minsLeft > 0
    ? `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m`
    : null;

  // Delivery = next business day (skip Sat/Sun)
  const delivery = new Date(now);
  delivery.setDate(delivery.getDate() + 1);
  while (delivery.getDay() === 0 || delivery.getDay() === 6) {
    delivery.setDate(delivery.getDate() + 1);
  }
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = delivery.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? "st" : day === 2 || day === 22 ? "nd" : day === 3 || day === 23 ? "rd" : "th";
  const deliveryStr = `${days[delivery.getDay()]}, ${months[delivery.getMonth()]} ${day}${suffix}`;

  return { orderWindow, deliveryStr };
}

// ─── Shipping info box ────────────────────────────────────────────────────────
function ShippingInfoBox({ shippingCost, freeThreshold, subtotal, isFull }) {
  const isFree = shippingCost === 0;
  const progressPct = freeThreshold && freeThreshold > 0
    ? Math.min(100, Math.round((subtotal / freeThreshold) * 100))
    : isFree ? 100 : 0;
  const remaining = freeThreshold && freeThreshold > 0 ? Math.max(0, freeThreshold - subtotal) : 0;
  const barColor = isFull ? "#16a34a" : "#fb923c";
  const borderColor = isFull ? "rgba(220,252,231,0.5)" : "rgba(255,237,213,0.5)";
  const { orderWindow, deliveryStr } = useMemo(() => getDeliveryEstimate(), []);

  return (
    <div className="flex flex-col gap-2 p-[17px] rounded-[16px] bg-[rgba(255,255,255,0.6)] border" style={{ borderColor }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#475569]">
          Shipping: {formatPrice(shippingCost)}
        </span>
        {isFree ? (
          <span className="text-[11px] font-bold text-[#16a34a] uppercase tracking-[0.55px]">
            {progressPct === 100 && subtotal > 0 ? "Free Reached!" : "Free Shipping!"}
          </span>
        ) : remaining > 0 ? (
          <span className="text-[10px] text-[#94a3b8]">
            Spend {formatPrice(remaining)} more for free shipping
          </span>
        ) : null}
      </div>
      <div className="h-[6px] bg-[#f1f5f9] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${progressPct}%`, backgroundColor: barColor }} />
      </div>
      {/* Delivery estimate */}
      <div className="flex items-center gap-1.5 pt-[2px]">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
        <p className="text-[10px] leading-[15px]">
          {orderWindow ? (
            <>
              <span className="font-bold text-[#334155]">Order in the next {orderWindow}</span>
              <span className="text-[#64748b]"> for delivery by </span>
              <span className="font-bold text-[#334155]">{deliveryStr}</span>
            </>
          ) : (
            <span className="text-[#64748b]">Delivery by <span className="font-bold text-[#334155]">{deliveryStr}</span></span>
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Redirect modal (full-page overlay) ──────────────────────────────────────
function RedirectModal({ store, onClose, navigate }) {
  const [phase, setPhase] = useState("before"); // "before" | "after"

  useEffect(() => {
    function handleKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleBuyClick() {
    window.open(store.orderUrl, "_blank", "noopener,noreferrer");
    setPhase("after");
  }

  const isBefore = phase === "before";
  const accent = isBefore ? "#16a34a" : "#007aff";
  const accentBg = isBefore ? "rgba(22,163,74,0.2)" : "rgba(0,122,255,0.2)";
  const headerBg = isBefore ? "rgba(236,253,245,0.5)" : "rgba(239,246,255,0.5)";

  /* ── Shared branding header ── */
  const BrandHeader = () => (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-[4px] bg-[#16a34a] flex items-center justify-center shrink-0">
          <span className="text-white text-[18px] font-black leading-none">D</span>
        </div>
        <span className="text-[20px] font-black text-[#111827] tracking-[-0.5px]">
          DesiDeals<span className="text-[#16a34a]">24</span>
        </span>
      </div>
      <span className="text-[14px] text-[#94a3b8]">Secure Checkout Handover</span>
    </div>
  );

  /* ── Shared warning banner ── */
  const WarningBanner = () => (
    <div className="flex items-start gap-3 bg-[#fffbeb] border border-[#fef3c7] rounded-[8px] px-[17px] py-[16px]">
      <svg width="22" height="20" viewBox="0 0 22 20" fill="none" className="shrink-0 mt-0.5">
        <path d="M9.27 3.16L1.21 17a2 2 0 001.72 3h16.14a2 2 0 001.72-3L12.73 3.16a2 2 0 00-3.46 0z" fill="#fbbf24" stroke="#f59e0b" strokeWidth="1" strokeLinejoin="round" />
        <line x1="11" y1="9" x2="11" y2="13" stroke="#92400e" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="11" cy="16" r="0.75" fill="#92400e" />
      </svg>
      <p className="text-[14px] text-[#78350f] leading-[17.5px]">
        <span className="font-bold">Do not close this tab.</span>
        {" "}You must return here after <span className="font-bold">COMPLETING</span> payment at {store.name}.
      </p>
    </div>
  );

  /* ── Sync arrows icon (inline SVG) ── */
  const SyncIcon = ({ color }) => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <polyline points="23 20 23 14 17 14" />
      <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" />
    </svg>
  );

  /* ── Small check SVG ── */
  const CheckSmall = ({ color }) => (
    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 3.5 6.5 9 1" />
    </svg>
  );

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f8fafc] flex items-center justify-center px-8 py-16">
      <div className="flex flex-col gap-8 w-full max-w-[576px] items-start">

        {/* Branding */}
        <BrandHeader />

        {/* Card */}
        <div className="bg-white border border-[#f1f5f9] rounded-[16px] w-full overflow-hidden"
          style={{ boxShadow: "0px 20px 25px -5px rgba(0,0,0,0.1), 0px 8px 10px -6px rgba(0,0,0,0.1)" }}>

          {/* Top progress bar */}
          <div className="h-[4px] bg-[#f1f5f9] w-full">
            <div className="h-full transition-all duration-500" style={{ width: isBefore ? "50%" : "100%", backgroundColor: accent }} />
          </div>

          {/* Card header */}
          <div className="relative h-[190px] flex flex-col items-center" style={{ backgroundColor: headerBg }}>
            {/* Icon with glow ring */}
            <div className="mt-6 relative flex items-center justify-center">
              <div className="absolute w-[44px] h-[44px] rounded-full" style={{ backgroundColor: accentBg }} />
              <div className="relative w-[44px] h-[44px] rounded-full flex items-center justify-center" style={{ backgroundColor: accent }}>
                <SyncIcon color="white" />
              </div>
            </div>
            {/* Title + subtitle */}
            <h2 className="text-[20px] font-black text-[#0f172a] text-center mt-3 px-6">
              {isBefore ? `Transferring to ${store.name}...` : `Payment completed at ${store.name}?`}
            </h2>
            <p className="text-[14px] text-[#64748b] text-center px-6 mt-1">
              {isBefore
                ? "We're moving your cart to a new tab."
                : "Confirm by marking this order as completed here to save to your history."}
            </p>
            {/* Inner progress bar */}
            <div className="absolute bottom-[24px] left-6 right-6 h-[6px] bg-[#f1f5f9] rounded-full overflow-hidden">
              <div className="h-full w-full rounded-full" style={{ backgroundColor: accent }} />
            </div>
          </div>

          {/* Instructions body */}
          <div className="flex flex-col gap-6 p-8">
            <p className="text-[16px] font-bold text-[#1e293b]">
              {isBefore ? "How to complete your order:" : "Final steps:"}
            </p>

            <div className="flex flex-col gap-6">
              {/* Step 1 */}
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: isBefore ? "#f1f5f9" : "#d1fae5",
                    boxShadow: isBefore ? "0 0 0 1px rgba(22,163,74,0.2)" : "0 0 0 1px #a7f3d0" }}>
                  {isBefore ? (
                    <svg width="10" height="12" viewBox="0 0 10 14" fill="none" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 1h4a2 2 0 012 2v8a2 2 0 01-2 2H3a2 2 0 01-2-2V3a2 2 0 012-2z" />
                      <line x1="5" y1="5" x2="5" y2="9" /><line x1="3.5" y1="7" x2="6.5" y2="7" />
                    </svg>
                  ) : (
                    <CheckSmall color="#059669" />
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-bold text-[#0f172a]">
                    {isBefore ? `Finish checkout at ${store.name}.` : `Payment at ${store.name}.`}
                  </span>
                  <span className="text-[14px] text-[#64748b]">
                    {isBefore
                      ? "Your items have been pre-loaded in the new tab."
                      : "Hopefully you've finished your purchase in the other tab."}
                  </span>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex items-start gap-4">
                <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: isBefore ? "rgba(22,163,74,0.1)" : "rgba(0,122,255,0.1)",
                    boxShadow: `0 0 0 1px ${accentBg}` }}>
                  <svg width="11" height="8" viewBox="0 0 14 10" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 2 1 5 4 5" />
                    <polyline points="13 8 13 5 10 5" />
                    <path d="M11.5 3A5 5 0 003.5 3M2.5 7a5 5 0 008 0" />
                  </svg>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-bold text-[#0f172a]">
                    {isBefore ? "Return here to confirm." : "Return to DesiDeals24."}
                  </span>
                  <span className="text-[14px] text-[#64748b]">
                    Crucial for syncing with your{" "}
                    <button type="button" onClick={() => { onClose(); navigate("/orders"); }}
                      className="font-normal" style={{ color: accent }}>
                      Order History
                    </button>
                    {" "}and tracking.
                  </span>
                </div>
              </div>
            </div>

            {/* Warning banner */}
            <WarningBanner />

            {/* CTA */}
            <div className="flex flex-col gap-4 pt-2">
              <button type="button"
                onClick={isBefore ? handleBuyClick : () => { onClose(); navigate("/orders"); }}
                className="w-full flex items-center justify-center py-[14px] rounded-[12px] text-[16px] font-black text-white transition-colors"
                style={{ backgroundColor: accent, boxShadow: "0px 4px 6px -1px rgba(0,0,0,0.1), 0px 2px 4px -2px rgba(0,0,0,0.1)" }}>
                {isBefore ? `Go to ${store.name} Store` : "Mark as Completed & Save to History"}
              </button>
              <p className="text-[11px] font-bold uppercase tracking-[0.55px] text-[#94a3b8] text-center">
                {isBefore ? "Keep this window open in the background" : "Keep this window open until confirmed"}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center w-full">
          <span className="text-[12px] text-[#94a3b8]">
            Need help?{" "}
            <button type="button" onClick={onClose} className="text-[#16a34a] hover:underline text-[12px]">
              Contact Support
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Store logo ───────────────────────────────────────────────────────────────
function StoreLogo({ store: storeData }) {
  const candidates = useMemo(() => getStoreLogoCandidates(storeData?.store), [storeData?.store?.id]);
  const [idx, setIdx] = useState(0);
  const logoUrl = candidates[idx] || null;
  const initials = String(storeData?.name || "?").slice(0, 3).toUpperCase();

  return (
    <div className="w-12 h-12 rounded-[12px] flex items-center justify-center shrink-0 border border-[#f1f5f9] overflow-hidden bg-white"
      style={{ boxShadow: "0px 1px 2px rgba(0,0,0,0.05)" }}>
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={storeData?.name}
          className="w-full h-full object-contain p-1.5"
          onError={() => setIdx((p) => (p + 1 < candidates.length ? p + 1 : p))}
        />
      ) : (
        <span className="text-[10px] font-black text-[#94a3b8] tracking-tight">{initials}</span>
      )}
    </div>
  );
}

// ─── Replacement modal ────────────────────────────────────────────────────────
function ReplacementModal({
  item,
  listId,
  listItems,
  mode,
  applyingReplacement,
  actionError,
  onClose,
  onConfirmRemove,
  onModeChange,
  onAddReplacement,
}) {
  const searchRef = useRef(null);
  const [query, setQuery] = useState(String(item?.name || ""));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const listItem = useMemo(
    () => findListItemForMissing(listItems, item?.name),
    [item?.name, listItems],
  );

  const runSearch = useCallback(
    async (queryInput) => {
      if (!listId || !item?.storeId) {
        setError("Missing store context for replacement search.");
        setResults([]);
        setInfo("");
        return;
      }
      if (!listItem?.id) {
        setError("Could not map this missing item back to your shopping list.");
        setResults([]);
        setInfo("");
        return;
      }

      setLoading(true);
      setError("");
      setInfo("");
      try {
        const payload = await searchListReplacements(listId, {
          store_id: item.storeId,
          list_item_id: listItem.id,
          query: String(queryInput || "").trim() || undefined,
          limit: 40,
        });
        const data = payload?.data || {};
        const rows = Array.isArray(data?.results) ? data.results : [];
        setResults(rows);

        if (rows.length === 0) {
          setError(`No replacement found for "${item.name}" in ${item.storeName}.`);
          return;
        }

        const targetLabel = getReplacementTargetLabel(data, rows[0]);

        if (data?.fallback_applied) {
          setInfo(
            `Exact brand unavailable. Showing ${targetLabel ? `${targetLabel} ` : ""}${item.storeName} options for "${data.base_product || item.name}".`,
          );
        } else if (data?.results_mode === "exact" && data?.more_options_included) {
          setInfo(
            `Showing exact ${targetLabel ? `${targetLabel} ` : ""}matches first, plus more ${item.storeName} ${data.base_product || item.name} options.`,
          );
        } else if (data?.results_mode === "exact") {
          setInfo(
            `Showing exact ${targetLabel ? `${targetLabel} ` : ""}matches from ${item.storeName}.`,
          );
        } else {
          setInfo(
            `Showing available ${targetLabel ? `${targetLabel} ` : ""}${item.storeName} options for this item.`,
          );
        }
      } catch (err) {
        setResults([]);
        setInfo("");
        setError(err.message || "Failed to search replacements");
      } finally {
        setLoading(false);
      }
    },
    [item?.name, item?.storeId, item?.storeName, listId, listItem?.id],
  );

  useEffect(() => {
    if (searchRef.current) searchRef.current.focus();
  }, []);

  useEffect(() => {
    const initialQuery = String(item?.name || "");
    setQuery(initialQuery);
    if (item) runSearch(initialQuery);
  }, [item, runSearch]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(15,23,42,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[512px] rounded-[12px] flex flex-col overflow-hidden"
        style={{ boxShadow: "0px 25px 50px -12px rgba(0,0,0,0.25)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-[17px] border-b border-[#f1f5f9] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#fef3c7] flex items-center justify-center shrink-0">
              <WarningIcon />
            </div>
            <div className="flex flex-col">
              <span className="text-[18px] font-black text-[#0f172a] leading-[22px]">Replace item</span>
              <span className="text-[12px] text-[#64748b] leading-[16px]">{item.name} is unavailable</span>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#94a3b8] hover:text-[#64748b] hover:bg-[#f8fafc] transition-colors">
            <XIcon size={14} />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-5 bg-[rgba(248,250,252,0.5)] shrink-0">
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none">
              <SearchMedIcon />
            </div>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a manual replacement..."
              className="w-full bg-white border border-[#e2e8f0] rounded-[12px] pl-[45px] pr-4 py-[14px] text-[14px] text-[#0f172a] placeholder-[#94a3b8] outline-none focus:border-[#16a34a] transition-colors"
            />
          </div>
          <div className="pt-3 flex justify-end">
            <button
              type="button"
              onClick={() => runSearch(query)}
              disabled={loading}
              className="bg-[#16a34a] hover:bg-[#15803d] disabled:opacity-60 text-white text-[13px] font-black px-4 py-2 rounded-[10px] transition-colors"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 overflow-y-auto flex-1">
          <p className="text-[14px] font-black text-[#0f172a] tracking-[0.7px] uppercase py-4">
            Suggested Replacements
          </p>
          {error && (
            <p className="pb-3 text-[13px] text-red-600">{error}</p>
          )}
          {!error && actionError && (
            <p className="pb-3 text-[13px] text-red-600">{actionError}</p>
          )}
          {!error && info && (
            <p className="pb-3 text-[13px] text-[#b45309]">{info}</p>
          )}
          <div className="flex flex-col gap-3 pb-4">
            {results.length === 0 ? (
              <p className="text-[13px] text-[#94a3b8] py-6 text-center">
                {loading ? "Searching store inventory…" : "No candidates loaded yet."}
              </p>
            ) : results.map((deal, i) => (
              <div key={deal?.id || i} className="bg-white border border-[#f1f5f9] rounded-[12px] flex items-center gap-4 p-[13px]">
                {/* Product image */}
                <div className="w-16 h-16 rounded-[8px] border border-[#f8fafc] shrink-0 overflow-hidden bg-[#f1f5f9]">
                  {deal?.image_url ? (
                    <img src={deal.image_url} alt={deal.product_name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] font-black text-[#94a3b8]">
                      ITEM
                    </div>
                  )}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  {/* Name */}
                  <span className="text-[14px] font-semibold text-[#0f172a] leading-[20px]">
                    {deal.product_name}
                  </span>
                  {/* Price row */}
                  <span className="text-[11px] text-[#64748b]">
                    {[
                      formatCombinationSummary(deal.combination) ||
                        (deal.weight_value && deal.weight_unit
                          ? `${deal.weight_value}${deal.weight_unit}`
                          : "size not listed"),
                      formatMatchedTotalQuantity(
                        deal?.matched_total_quantity,
                        deal?.matched_total_unit,
                      )
                        ? `total ${formatMatchedTotalQuantity(
                            deal?.matched_total_quantity,
                            deal?.matched_total_unit,
                          )}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-black text-[#16a34a]">
                      {formatPrice(deal.effective_price ?? deal.sale_price)}
                    </span>
                    {deal?.brand_status === "changed" && (
                      <span className="text-[10px] font-black uppercase tracking-[0.35px] text-[#ea580c]">
                        Brand changed
                      </span>
                    )}
                  </div>
                </div>
                {/* Add button */}
                <button type="button"
                  onClick={() => onAddReplacement(item.name, deal, item.storeId)}
                  disabled={applyingReplacement}
                  className="bg-[#16a34a] hover:bg-[#15803d] text-white text-[14px] font-black px-5 py-2 rounded-[8px] shrink-0 transition-colors">
                  {applyingReplacement ? "Adding…" : "Add"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#f1f5f9] shrink-0">
          {mode === "find" ? (
            <div className="flex flex-col gap-3 px-6 pt-6 pb-6">
              <button type="button" onClick={() => onModeChange("confirm")}
                className="w-full flex items-center justify-center gap-2 text-[#dc2626] text-[14px] font-black py-3 px-4 rounded-[12px] hover:bg-[#fef2f2] transition-colors">
                <TrashIcon />
                Remove from the shopping list
              </button>
              <button type="button" onClick={onClose}
                className="w-full flex items-center justify-center text-[14px] font-black text-[#0f172a] py-3 px-4 rounded-[12px] bg-[#f1f5f9] hover:bg-[#e2e8f0] transition-colors">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4 px-6 pt-6 pb-6">
              <p className="text-[14px] text-[#475569] text-center">
                Are you sure you want to remove this item from your shopping list?
              </p>
              <div className="flex flex-col gap-3">
                <button type="button" onClick={onConfirmRemove}
                  className="w-full flex items-center justify-center text-[14px] font-black text-white py-3 px-4 rounded-[12px] bg-[#dc2626] hover:bg-[#b91c1c] transition-colors"
                  style={{ boxShadow: "0px 1px 2px rgba(0,0,0,0.05)" }}>
                  Yes, remove
                </button>
                <button type="button" onClick={() => onModeChange("find")}
                  className="w-full flex items-center justify-center text-[14px] font-black text-[#0f172a] py-3 px-4 rounded-[12px] bg-[#f1f5f9] hover:bg-[#e2e8f0] transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Missing item row ─────────────────────────────────────────────────────────
function MissingItemRow({ item, onDismiss, onReplace }) {
  return (
    <div className="bg-[rgba(254,242,242,0.3)] border border-dashed border-[#fecaca] rounded-[12px] flex items-start justify-between p-[13px]">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12px] font-bold text-[#334155] leading-[16px]">{item.name}</span>
        {item.expectedPrice != null && (
          <span className="text-[11px] text-[#94a3b8]">Expected: {formatPrice(item.expectedPrice)}</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" onClick={onDismiss}
          className="w-6 h-6 flex items-center justify-center rounded-[6px] text-[#94a3b8] hover:text-red-500 hover:bg-[#fef2f2] transition-colors"
          aria-label="Dismiss">
          <XIcon />
        </button>
        <button type="button" onClick={onReplace}
          className="flex items-center gap-1.5 bg-[rgba(255,247,237,0.5)] border border-[#fed7aa] text-[#ea580c] text-[9px] font-black uppercase tracking-[0.5px] px-[9px] py-[4px] rounded-[8px] hover:bg-[rgba(255,237,213,0.7)] transition-colors">
          <SearchSmallIcon />
          Replacement
        </button>
      </div>
    </div>
  );
}

// ─── Store card ───────────────────────────────────────────────────────────────
function StoreCard({
  store,
  listId,
  listItems,
  applyingReplacement,
  onRemoveItem,
  onAddReplacement,
  onOrder,
}) {
  const [availableOpen, setAvailableOpen] = useState(store.winner || store.matchType === "full");
  const [dismissed, setDismissed] = useState({});
  const [replacementModal, setReplacementModal] = useState(null); // null or { item, mode }
  const [replacementActionError, setReplacementActionError] = useState("");
  const visibleMissing = store.missingItems.filter((_, i) => !dismissed[i]);

  // Match label + color (red ≤50%, orange >50% partial, green full)
  const matchPct = store.totalItems > 0 ? Math.round((store.availableCount / store.totalItems) * 100) : 0;
  const matchLabel = store.matchType === "full"
    ? "Full Match"
    : matchPct <= 50
    ? `${store.availableCount}/${store.totalItems} MATCH (${matchPct}%)`
    : `${store.availableCount}/${store.totalItems} MATCH`;
  const matchColor = store.matchType === "full" ? "#16a34a" : matchPct <= 50 ? "#ef4444" : "#f97316";

  // Card border — partial cards adopt the match color (red or orange)
  const borderStyle = store.winner
    ? { boxShadow: "0 0 0 2px #16a34a" }
    : store.missingCount > 0
    ? { boxShadow: `0 0 0 1.5px ${matchColor}` }
    : { boxShadow: "0px 10px 30px -10px rgba(0,0,0,0.04)" };

  // Header tint — shifts from amber→rose for low match scores
  const isLowMatch = store.matchType === "partial" && matchPct <= 50;
  const headerBg = store.matchType === "full" || store.winner
    ? "rgba(240,253,244,0.5)"
    : isLowMatch ? "rgba(254,242,242,0.5)" : "rgba(255,247,237,0.5)";
  const headerBorderColor = store.matchType === "full" || store.winner
    ? "rgba(220,252,231,0.5)"
    : isLowMatch ? "rgba(254,226,226,0.5)" : "rgba(255,237,213,0.5)";

  function handleOpenReplacement(item) {
    setReplacementActionError("");
    setReplacementModal({
      item: {
        ...item,
        storeId: store.id,
        storeName: store.name,
      },
      mode: "find",
    });
  }

  function handleConfirmRemove() {
    const item = replacementModal.item;
    setReplacementModal(null);
    // Remove from session and re-run comparison
    onRemoveItem(item.name);
  }

  return (
    <>
      {replacementModal && (
        <ReplacementModal
          item={replacementModal.item}
          listId={listId}
          listItems={listItems}
          mode={replacementModal.mode}
          applyingReplacement={applyingReplacement}
          actionError={replacementActionError}
          onClose={() => setReplacementModal(null)}
          onConfirmRemove={handleConfirmRemove}
          onModeChange={(mode) => setReplacementModal((p) => ({ ...p, mode }))}
          onAddReplacement={async (itemName, deal, storeId) => {
            try {
              setReplacementActionError("");
              await onAddReplacement(itemName, deal, storeId);
              setReplacementModal(null);
            } catch (err) {
              setReplacementActionError(
                err?.message || "Failed to add replacement for this store.",
              );
            }
          }}
        />
      )}

      <div className="bg-white rounded-[24px] overflow-hidden flex flex-col" style={borderStyle}>
        {/* Header */}
        <div className="flex flex-col gap-6 px-8 pt-8 pb-8 border-b shrink-0"
          style={{ backgroundColor: headerBg, borderBottomColor: headerBorderColor }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <StoreLogo store={store} />
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[20px] font-black text-[#0f172a] leading-[28px]">{store.name}</span>
                  {store.badge && (
                    <span className="bg-[#0f172a] text-white text-[9px] font-black uppercase tracking-[0.5px] px-[6px] py-[2px] rounded-[4px]">
                      {store.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-black uppercase tracking-[1.5px]" style={{ color: matchColor }}>
                  {matchLabel}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <div className="flex items-baseline gap-1">
                <span className="text-[24px] font-black text-[#0f172a] leading-[32px]">{formatPrice(store.totalPrice)}</span>
                {store.matchType === "partial" && (
                  <span className="text-[10px] text-[#94a3b8]">+ opt.</span>
                )}
              </div>
              <span className="text-[10px] text-[#94a3b8]">including shipping</span>
              {store.savedAmount > 0 && (
                <span className="text-white text-[9px] font-black uppercase px-2 py-[2px] rounded-[4px] mt-1" style={{ backgroundColor: "#16a34a" }}>
                  SAVE {formatPrice(store.savedAmount)}
                </span>
              )}
            </div>
          </div>

          {/* Shipping info */}
          <ShippingInfoBox
            shippingCost={store.shippingCost}
            freeThreshold={store.freeShippingThreshold}
            subtotal={store.subtotal}
            isFull={store.matchType === "full" || store.winner}
          />

          {store.winner ? (
            <button type="button" onClick={() => onOrder(store)}
              className="w-full flex items-center justify-center py-3 rounded-[12px] text-[14px] font-black text-white bg-[#16a34a] hover:bg-[#15803d] transition-colors"
              style={{ boxShadow: "0px 10px 15px -3px rgba(220,252,231,0.8), 0px 4px 6px -4px rgba(220,252,231,0.8)" }}>
              Order from {store.name}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => onOrder(store)}
                className="w-full flex items-center justify-center py-[13px] rounded-[12px] text-[14px] font-black text-[#0f172a] bg-white border border-[#e2e8f0] hover:bg-[#f8fafc] transition-colors"
                style={{ boxShadow: "0px 1px 2px rgba(0,0,0,0.05)" }}>
                Order from {store.name}
              </button>
              {store.missingCount > 0 && (
                <p className="text-[10px] text-[#94a3b8] text-center">Missing items won't be added to your cart.</p>
              )}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col gap-4 px-8 pt-6 pb-8">
          {/* Available items */}
          <div>
            <button type="button" onClick={() => setAvailableOpen((p) => !p)}
              className="w-full flex items-center justify-between py-2 text-[#94a3b8] hover:text-[#64748b] transition-colors">
              <span className="text-[10px] font-black uppercase tracking-[1px]">
                Available Items ({store.availableCount})
              </span>
              <ChevronIcon up={availableOpen} />
            </button>
            {availableOpen && store.availableItems.length > 0 && (
              <div className="flex flex-col overflow-hidden" style={{ maxHeight: 280 }}>
                {store.availableItems.map((item, i) => (
                  <div key={i} className="flex items-start justify-between py-[17px] pr-2"
                    style={{ borderTop: i === 0 ? "none" : "1px solid #f8fafc" }}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[14px] text-[#334155]">{item.name}</span>
                      <span className="text-[11px] text-[#94a3b8]">
                        {item.priceSummary ||
                          `${item.qty > 1 ? `${item.qty} × ` : ""}${formatPrice(item.unitPrice)}`}
                      </span>
                      {item.combinationSummary ? (
                        <span className="text-[11px] text-[#64748b]">
                          {item.combinationSummary}
                          {item.matchedTotalQuantity && item.matchedTotalUnit
                            ? ` · total ${formatMatchedTotalQuantity(
                                item.matchedTotalQuantity,
                                item.matchedTotalUnit,
                              )}`
                            : ""}
                        </span>
                      ) : item.matchedTotalQuantity && item.matchedTotalUnit ? (
                        <span className="text-[11px] text-[#64748b]">
                          total{" "}
                          {formatMatchedTotalQuantity(
                            item.matchedTotalQuantity,
                            item.matchedTotalUnit,
                          )}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[14px] font-black text-[#0f172a]">{formatPrice(item.totalPrice)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Missing items */}
          {store.missingCount > 0 && (
            <div className="border-t border-[#fee2e2] pt-[9px]">
              <div className="flex items-center justify-between py-2 text-[#dc2626]">
                <span className="text-[10px] font-black uppercase tracking-[1px]">
                  Missing {store.missingCount === 1 ? "Item" : "Items"} ({store.missingCount})
                </span>
                <ChevronIcon up={true} />
              </div>
              {visibleMissing.length > 0 && (
                <div className="flex flex-col gap-5 pt-4">
                  {visibleMissing.map((item, i) => (
                    <MissingItemRow key={i} item={item}
                      onDismiss={() => {
                        const idx = store.missingItems.indexOf(item);
                        setDismissed((p) => ({ ...p, [idx]: true }));
                      }}
                      onReplace={() => handleOpenReplacement(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No missing items */}
          {store.missingCount === 0 && (
            <div className="border-t border-[#f1f5f9] pt-[9px]">
              <div className="flex items-center justify-between py-2">
                <span className="text-[10px] font-black uppercase tracking-[1px] text-[#cbd5e1]">No Missing Items</span>
                <CheckIcon />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Sort toggle ──────────────────────────────────────────────────────────────
const SORT_OPTIONS = ["Price", "Availability", "Delivery"];

function SortToggle({ value, onChange }) {
  return (
    <div className="flex gap-1 p-1 rounded-[12px]" style={{ backgroundColor: "rgba(226,232,240,0.5)" }}>
      {SORT_OPTIONS.map((opt) => (
        <button key={opt} type="button" onClick={() => onChange(opt)}
          className={`px-5 py-[6px] rounded-[8px] text-[12px] transition-colors ${
            value === opt ? "bg-white font-bold text-[#0f172a]" : "text-[#64748b] hover:text-[#0f172a]"
          }`}
          style={value === opt ? { boxShadow: "0px 1px 2px rgba(0,0,0,0.05)" } : {}}>
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded-[24px] overflow-hidden animate-pulse" style={{ boxShadow: "0 0 0 1px #f1f5f9" }}>
          <div className="h-[206px] bg-[#f8fafc]" />
          <div className="p-8 flex flex-col gap-4">
            <div className="h-3 bg-[#f1f5f9] rounded w-1/2" />
            <div className="h-3 bg-[#f1f5f9] rounded w-3/4" />
            <div className="h-3 bg-[#f1f5f9] rounded w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CompareStoresPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialListId = location.state?.listId;

  const [sort, setSort] = useState("Price");
  const [loading, setLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [error, setError] = useState("");
  const [stores, setStores] = useState([]);
  const [storeRows, setStoreRows] = useState([]);
  const [listItems, setListItems] = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [redirectStore, setRedirectStore] = useState(null); // store object | null
  const [applyingStoreId, setApplyingStoreId] = useState("");
  const cancelledRef = useRef(false);
  // Track current listId — may be replaced after item removals
  const currentListId = useRef(initialListId);

  const applyResult = useCallback((res) => {
    const rawStores = Array.isArray(res?.stores) ? res.stores : [];
    const priceSorted = [...rawStores].sort((a, b) => Number(a?.total || 0) - Number(b?.total || 0));
    const secondTotal = priceSorted.length > 1 ? Number(priceSorted[1]?.total || 0) : 0;
    const transformed = priceSorted.map((row, i) =>
      transformStore(row, i === 0, secondTotal, {
        winner: i === 0,
        savedAmount:
          i === 0 && secondTotal > 0
            ? Number((secondTotal - Number(row?.total || 0)).toFixed(2))
            : 0,
        baseSortPrice: Number(row?.total || 0),
        baseSortAvailability: Number(
          row?.items_matched ||
            (Array.isArray(row?.matched_items) ? row.matched_items.length : 0),
        ),
        baseSortMissing: Array.isArray(row?.items_not_found)
          ? row.items_not_found.length
          : 0,
        baseRankIndex: i,
      }),
    );
    const allItems = Number(priceSorted[0]?.items_total || transformed[0]?.totalItems || 0);
    setStoreRows(priceSorted);
    setStores(transformed);
    setTotalItems(allItems);
  }, []);

  // Initial fetch — mirrors what CompareStoresPage receives on first navigation
  useEffect(() => {
    if (!initialListId) {
      setError("No list ID provided. Please go back and try again.");
      setLoading(false);
      return;
    }
    cancelledRef.current = false;
    const postcode = getAuthSession()?.user?.postcode || "";

    (async () => {
      const navItems = Array.isArray(location.state?.items) ? location.state.items : [];
      const sessionItems = readSessionFallbackItems();
      const fetchedList = await fetchList(initialListId).catch(() => null);
      const fetchedItems = Array.isArray(fetchedList?.items)
        ? fetchedList.items.map(normalizeListItemRow).filter((item) => item.raw_item_text)
        : [];
      if (!cancelledRef.current) {
        setListItems(fetchedItems);
      }
      const fallbackItems = pickBestFallbackItems(navItems, fetchedItems, sessionItems);

      const res = await runRecommendationWithRetry({
        listId: initialListId,
        deliveryPreference: "cheapest",
        postcode,
        fallbackItems,
      });
      return filterStoresByReplacementCoverage(res, {
        listId: initialListId,
        listItems: fetchedItems,
      });
    })()
      .then((res) => { if (!cancelledRef.current) applyResult(res); })
      .catch((err) => {
        if (cancelledRef.current) return;
        if ((err.message || "").toLowerCase().includes("access token")) { navigate("/login"); return; }
        setError(err.message || "Failed to load store comparison.");
      })
      .finally(() => { if (!cancelledRef.current) setLoading(false); });

    return () => { cancelledRef.current = true; };
  }, [initialListId, location.state, applyResult, navigate]);

  // Called when user confirms removal — mirrors "Find best prices" exactly:
  // 1. remove item from session, 2. create a new list, 3. run recommendation with new listId
  const handleRemoveItem = useCallback(async (itemName) => {
    const baseItems = pickBestFallbackItems(listItems, readSessionFallbackItems());
    const remainingItems = removeItemFromSession(itemName, baseItems);

    if (remainingItems.length === 0) {
      navigate("/list");
      return;
    }

    setRefetching(true);
    try {
      const postcode = getAuthSession()?.user?.postcode || "";
      const rawInput = remainingItems.map((i) => i.raw_item_text).join(", ");

      // Create a fresh list with remaining items — same as "Find best prices" does
      const created = await createList({
        name: "Smart List",
        raw_input: rawInput,
        input_method: "text",
        items: remainingItems,
      });
      const newListId = created?.data?.id;
      if (!newListId) throw new Error("Failed to create updated list.");

      currentListId.current = newListId;
      setListItems(
        Array.isArray(created?.items)
          ? created.items.map(normalizeListItemRow).filter((item) => item.raw_item_text)
          : remainingItems.map(normalizeListItemRow).filter((item) => item.raw_item_text),
      );

      const res = await runRecommendationWithRetry({
        listId: newListId,
        deliveryPreference: "cheapest",
        postcode,
        fallbackItems: [],
      });
      const filteredRes = await filterStoresByReplacementCoverage(res, {
        listId: newListId,
        listItems: Array.isArray(created?.items)
          ? created.items.map(normalizeListItemRow).filter((item) => item.raw_item_text)
          : remainingItems.map(normalizeListItemRow).filter((item) => item.raw_item_text),
      });
      if (!cancelledRef.current) applyResult(filteredRes);
    } catch (err) {
      if (cancelledRef.current) return;
      if ((err.message || "").toLowerCase().includes("access token")) { navigate("/login"); return; }
      setError(err.message || "Failed to update comparison.");
    } finally {
      if (!cancelledRef.current) setRefetching(false);
    }
  }, [applyResult, listItems, navigate]);

  const handleAddReplacement = useCallback(async (itemName, replacementDeal, storeIdInput) => {
    const storeId = String(storeIdInput || "").trim();
    if (!storeId) {
      throw new Error("Missing store context for this replacement.");
    }

    const listId = currentListId.current;
    if (!listId) {
      throw new Error("Missing list context for this replacement.");
    }

    const listItem = findListItemForMissing(listItems, itemName);
    if (!listItem?.id) {
      throw new Error(`Could not map "${itemName}" back to your shopping list.`);
    }

    const currentStoreRow =
      storeRows.find((row) => String(row?.store?.id || "") === storeId) || null;
    const currentStoreCard =
      stores.find((row) => String(row?.id || "") === storeId) || null;
    if (!currentStoreRow || !currentStoreCard) {
      throw new Error(
        "Could not locate this store in the current comparison. Please refresh and try again.",
      );
    }

    const previousListText = String(
      listItem?.raw_item_text || itemName || "",
    ).trim();
    const replacementPayload = {
      listItemId: listItem.id,
      missingItem: itemName,
      previousListText,
      deal: replacementDeal,
      fallbackCategory:
        replacementDeal?.product_category || currentStoreRow?.store?.category || null,
    };
    const previewStoreRow = patchStoreRowWithReplacement(
      currentStoreRow,
      replacementPayload,
    );
    const previewMatchedItems = Array.isArray(previewStoreRow?.matched_items)
      ? previewStoreRow.matched_items
      : [];
    if (previewMatchedItems.length === 0) {
      throw new Error(
        "Could not build an updated cart with this replacement. Please choose another item.",
      );
    }

    setApplyingStoreId(storeId);
    try {
      const transferResult = await buildListStoreCartTransfer(listId, {
        store_id: storeId,
        matched_items: previewMatchedItems.map((item) => ({
          product_url: item?.product_url,
          packs_needed: item?.packs_needed,
          combination: Array.isArray(item?.combination)
            ? item.combination.map((entry) => ({
                product_url: entry?.product_url,
                count: entry?.count,
              }))
            : undefined,
        })),
      });
      const transfer = transferResult?.data || null;
      if (!transfer?.cart_url) {
        throw new Error(
          "Selected replacement could not be added to cart for this store. Please choose another item.",
        );
      }

      const nextRow = {
        ...previewStoreRow,
        cart_url: transfer.cart_url,
        cart_transfer_method:
          transfer.method || currentStoreRow?.cart_transfer_method || null,
      };

      if (!cancelledRef.current) {
        setStoreRows((prev) =>
          prev.map((row) =>
            String(row?.store?.id || "") === storeId ? nextRow : row,
          ),
        );
        setStores((prev) =>
          prev.map((row) =>
            String(row?.id || "") === storeId
              ? transformStore(nextRow, row.winner, 0, row)
              : row,
          ),
        );
      }
    } catch (err) {
      if (!cancelledRef.current && (err.message || "").toLowerCase().includes("access token")) {
        navigate("/login");
      }
      throw err;
    } finally {
      if (!cancelledRef.current) setApplyingStoreId("");
    }
  }, [listItems, navigate, storeRows, stores]);

  const sorted = useMemo(() => {
    return [...stores].sort((a, b) => {
      if (sort === "Price") {
        if (a.baseSortPrice !== b.baseSortPrice) {
          return a.baseSortPrice - b.baseSortPrice;
        }
      } else if (sort === "Availability") {
        if (a.baseSortAvailability !== b.baseSortAvailability) {
          return b.baseSortAvailability - a.baseSortAvailability;
        }
      } else if (a.baseSortMissing !== b.baseSortMissing) {
        return a.baseSortMissing - b.baseSortMissing;
      }
      return a.baseRankIndex - b.baseRankIndex;
    });
  }, [stores, sort]);

  return (
    <>
    {redirectStore && (
      <RedirectModal
        store={redirectStore}
        onClose={() => setRedirectStore(null)}
        navigate={navigate}
      />
    )}
    <div className="min-h-screen bg-[#f8fafc] pb-16">
      <div className="max-w-[1152px] mx-auto px-8 py-12">

        {/* Page header */}
        <div className="flex items-end justify-between mb-12">
          <div className="flex flex-col">
            <button type="button" onClick={() => navigate("/list")}
              className="flex items-center gap-2 text-[14px] text-[#94a3b8] hover:text-[#64748b] transition-colors mb-4">
              <ArrowLeftIcon />
              Back to list
            </button>
            <h1 className="text-[30px] font-black text-[#0f172a] leading-[36px] mb-1">
              Best matches for your list
            </h1>
            <p className="text-[14px] text-[#64748b] mb-2">
              {loading
                ? "Finding best prices across stores..."
                : refetching
                ? "Updating prices..."
                : `Comparing ${totalItems} items across available stores in your area`}
            </p>
            {/* Shipping to row */}
            {(() => {
              const user = getAuthSession()?.user;
              const postcode = user?.postcode || "";
              const city = user?.city || "";
              const addressStr = [postcode, city].filter(Boolean).join(" ");
              return addressStr ? (
                <div className="flex items-center gap-1.5 mt-1">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.375 4.5 8.5 4.5 8.5S12.5 9.375 12.5 6c0-2.485-2.015-4.5-4.5-4.5z" stroke="#94a3b8" strokeWidth="1.3" strokeLinejoin="round" />
                    <circle cx="8" cy="6" r="1.5" stroke="#94a3b8" strokeWidth="1.3" />
                  </svg>
                  <span className="text-[11px] font-bold uppercase tracking-[0.275px] text-[#94a3b8]">Shipping to:</span>
                  <span className="text-[11px] font-bold text-[#475569]">{addressStr}, Germany</span>
                  <button type="button" onClick={() => navigate("/addresses")}
                    className="text-[10px] font-black text-[#16a34a] uppercase hover:underline ml-1">
                    CHANGE
                  </button>
                </div>
              ) : null;
            })()}
          </div>
          <SortToggle value={sort} onChange={setSort} />
        </div>

        {/* Content */}
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="bg-white rounded-[24px] p-8 text-center" style={{ boxShadow: "0 0 0 1px #f1f5f9" }}>
            <p className="text-[15px] text-red-600 mb-4">{error}</p>
            <button type="button" onClick={() => navigate("/list")}
              className="text-[14px] font-bold text-[#16a34a] hover:underline">
              ← Back to Smart List
            </button>
          </div>
        ) : stores.length === 0 ? (
          <div className="bg-white rounded-[24px] p-8 text-center" style={{ boxShadow: "0 0 0 1px #f1f5f9" }}>
            <p className="text-[15px] text-[#64748b]">No stores found for your list. Try adding more items.</p>
          </div>
        ) : (
          <div className="relative">
            {refetching && (
              <div className="absolute inset-0 z-10 rounded-[24px] flex items-start justify-center pt-12 pointer-events-none"
                style={{ backgroundColor: "rgba(248,250,252,0.7)" }}>
                <div className="bg-white rounded-[12px] px-5 py-3 flex items-center gap-3"
                  style={{ boxShadow: "0px 4px 16px rgba(0,0,0,0.08)" }}>
                  <div className="w-4 h-4 border-2 border-[#16a34a] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[13px] font-bold text-[#0f172a]">Updating prices…</span>
                </div>
              </div>
            )}
            <div className={`grid grid-cols-1 lg:grid-cols-2 gap-5 items-start transition-opacity duration-200 ${refetching ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
              {sorted.map((store) => (
                <StoreCard
                  key={store.id}
                  store={store}
                  listId={currentListId.current}
                  listItems={listItems}
                  applyingReplacement={applyingStoreId === store.id}
                  onRemoveItem={handleRemoveItem}
                  onAddReplacement={handleAddReplacement}
                  onOrder={setRedirectStore}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
