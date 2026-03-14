import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  buildListStoreCartTransfer,
  fetchList,
  getAuthSession,
  recommendList,
  searchListReplacements,
  updateListItem,
  warmup,
} from "../utils/api";
import { formatPrice as formatEuro } from "../utils/formatters";
import {
  formatCombinationSummary,
  formatMatchedTotalQuantity,
  getCombinationTotal,
} from "../utils/combinationDisplay";
import {
  normalizeRequestedSmartListItems,
  readSmartListSessionDrafts,
} from "../utils/smartListSession";

const RECOMMEND_RETRY_MAX = 8;
const RECOMMEND_RETRY_DELAY_MS = 1200;
const MASS_VOLUME_UNITS = new Set(["kg", "g", "l", "ml"]);
const REPLACEMENT_NOISE_TOKENS = new Set([
  "brand",
  "fresh",
  "premium",
  "best",
  "quality",
  "desi",
  "indian",
  "organic",
  "whole",
  "split",
  "small",
  "large",
  "extra",
  "new",
  "old",
  "pack",
  "packet",
  "pkt",
  "gm",
  "g",
  "kg",
  "ml",
  "l",
  "ltr",
  "pcs",
  "piece",
  "pieces",
  "nos",
  "no",
  "each",
]);

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

function toKg(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = String(unit || "").toLowerCase();
  if (u === "kg") return n;
  if (u === "g") return n / 1000;
  return null;
}

function formatMassFromKg(kgValue) {
  const n = Number(kgValue);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1) return `${Math.round(n * 1000)} gm`;
  return `${Number(n.toFixed(3))} kg`;
}

function formatMoney(value) {
  const n = Number(value || 0);
  return `EUR ${n.toFixed(2)}`;
}

function formatMatchedDisplayName(item) {
  const combination = Array.isArray(item?.combination) ? item.combination : [];
  if (combination.length === 1) {
    const row = combination[0] || {};
    const count = Number(row?.count || 0);
    const productName = String(row?.product_name || item?.product_name || "").trim();
    if (productName && count > 1) return `${productName} x ${count}`;
  }
  return String(item?.product_name || item?.query || "").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function normalizeSearchToken(token) {
  const cleaned = String(token || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!cleaned) return "";
  const softened = cleaned.replace(/([aeiou])\1+/g, "$1");
  if (softened === "daal" || softened === "dhal") return "dal";
  if (softened === "tur" || softened === "arhar" || softened === "thuvar")
    return "toor";
  if (softened === "ata" || softened === "aata") return "atta";
  return softened;
}

function tokenizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => normalizeSearchToken(token))
    .filter(Boolean);
}

function hasAttaIntentTokens(tokens) {
  const set = new Set(Array.isArray(tokens) ? tokens : []);
  if (set.has("atta") || set.has("ata")) return true;
  if (set.has("flour")) return true;
  if (set.has("wheat")) return true;
  if (set.has("multigrain")) return true;
  if (set.has("chakki")) return true;
  return false;
}

function isAttaLikeProduct(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  return /\b(atta|ata|wheat flour|whole wheat|multigrain|chakki)\b/.test(text);
}

function buildReplacementSearchPlan(rawQuery, brandPref) {
  const sourceTokens = tokenizeSearchText(rawQuery);
  const brandTokens = new Set(tokenizeSearchText(brandPref));
  const withoutBrandTokens = sourceTokens.filter(
    (token) => !brandTokens.has(token),
  );
  const baseTokens =
    withoutBrandTokens.length > 0 ? withoutBrandTokens : sourceTokens;
  const commodityTokens = baseTokens.filter(
    (token) => !REPLACEMENT_NOISE_TOKENS.has(token) && !/^\d+$/.test(token),
  );
  let focusTokens =
    commodityTokens.length >= 2
      ? commodityTokens.slice(-2)
      : commodityTokens.length === 1
        ? commodityTokens
        : baseTokens.length >= 2
          ? baseTokens.slice(-2)
          : baseTokens;

  const variants = [];
  const seen = new Set();
  const addVariant = (value) => {
    const text = Array.isArray(value)
      ? value.join(" ").trim()
      : String(value || "").trim();
    if (text.length < 2 || seen.has(text)) return;
    seen.add(text);
    variants.push(text);
  };

  addVariant(String(rawQuery || "").trim());
  addVariant(sourceTokens);
  addVariant(baseTokens);
  addVariant(focusTokens);
  if (baseTokens.length >= 3) addVariant(baseTokens.slice(1));
  if (baseTokens.length >= 3) addVariant(baseTokens.slice(-2));

  if (hasAttaIntentTokens(baseTokens)) {
    const attaVariants = [
      "atta",
      "ata",
      "flour",
      "wheat",
      "multigrain",
      "chakki",
    ];
    focusTokens = Array.from(new Set([...focusTokens, ...attaVariants]));
    addVariant(["atta"]);
    addVariant(["wheat", "flour"]);
    addVariant(["multigrain", "atta"]);
    addVariant(["chakki", "atta"]);
  }

  return {
    queryVariants: variants.slice(0, 8),
    focusTokens,
  };
}

function filterDealsByFocusTokens(rows, focusTokens, options = {}) {
  const deals = Array.isArray(rows) ? rows : [];
  if (focusTokens.length === 0) return deals;
  const mode = String(options.mode || "all");
  return deals.filter((deal) => {
    const tokenSet = new Set(tokenizeSearchText(deal?.product_name));
    const matchedCount = focusTokens.filter((token) =>
      tokenSet.has(token),
    ).length;
    if (mode === "any") return matchedCount >= 1;
    const requiredCount =
      focusTokens.length <= 2
        ? focusTokens.length
        : Math.max(2, Math.ceil(focusTokens.length * 0.5));
    return matchedCount >= requiredCount;
  });
}

function rankDealsByFocusTokens(rows, focusTokens) {
  const deals = Array.isArray(rows) ? rows : [];
  if (deals.length === 0) return [];
  const dedupedFocus = Array.from(new Set((focusTokens || []).filter(Boolean)));
  return [...deals]
    .map((deal) => {
      const tokenSet = new Set(tokenizeSearchText(deal?.product_name));
      const matchedCount = dedupedFocus.filter((token) =>
        tokenSet.has(token),
      ).length;
      const score =
        dedupedFocus.length > 0 ? matchedCount / dedupedFocus.length : 0;
      return { deal, score, price: Number(deal?.sale_price || 0) };
    })
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .map((row) => row.deal);
}

function inferReplacementTypeFromText(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (
    /\b(masala|spice|powder|seasoning|chaat|garam|rasam|sambar|biryani|chole)\b/.test(
      text,
    ) ||
    /dal\s+(masala|mix|makhani|tadka|fry)\b/.test(text)
  )
    return "masala";
  if (
    /\b(dal|dhal|lentil|toor|arhar|tuvar|moong|mung|urad|masoor|rajma|chana)\b/.test(
      text,
    )
  )
    return "dal";
  if (
    /\b(rice|basmati|sona masoori|sona masuri|ponni|parboiled|idli rice)\b/.test(
      text,
    )
  )
    return "rice";
  if (/\b(atta|maida|besan|flour)\b/.test(text)) return "flour";
  if (/\b(oil|ghee)\b/.test(text)) return "oil";
  return null;
}

function inferReplacementType(query, category) {
  const queryType = inferReplacementTypeFromText(query);
  if (queryType) return queryType;
  return inferReplacementTypeFromText(category);
}

function filterReplacementCandidatesByType(rows, expectedType) {
  const deals = Array.isArray(rows) ? rows : [];
  if (!expectedType) return deals;
  return deals.filter((deal) => {
    const nameType = inferReplacementTypeFromText(deal?.product_name);
    if (!nameType) return true;
    return nameType === expectedType;
  });
}

function buildPartialMatchesFromStores(stores) {
  return (Array.isArray(stores) ? stores : [])
    .map((row) => {
      const matchedItems = Array.isArray(row?.matched_items)
        ? row.matched_items
        : [];
      const missingItems = Array.isArray(row?.items_not_found)
        ? row.items_not_found
        : [];
      const itemsTotal =
        toSafeNumber(row?.items_total, 0) > 0
          ? toSafeNumber(row.items_total, 0)
          : matchedItems.length + missingItems.length;
      return {
        store: row?.store,
        items_matched: matchedItems.length,
        items_total: itemsTotal,
        items_not_found: missingItems,
        matched_queries: matchedItems
          .map((item) => item?.query)
          .filter(Boolean),
      };
    })
    .filter((row) => row.items_matched !== row.items_total);
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
        .map((row) => ({
          product_url: row?.product_url,
          count: Number(row?.count || 0),
          sale_price: row?.sale_price,
          weight_value: row?.weight_value,
          weight_unit: row?.weight_unit,
          product_name: row?.product_name,
        }))
        .filter((row) => row.product_url && row.count > 0)
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
      getCombinationTotal(combination)?.value ??
      (deal?.matched_total_quantity != null
        ? deal.matched_total_quantity
        : (existingItem?.matched_total_quantity ?? null)),
    matched_total_unit:
      getCombinationTotal(combination)?.unit ??
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

function deliveryHours(row) {
  const h = Number(row?.delivery?.estimated_hours);
  if (Number.isFinite(h) && h > 0) return h;
  const days = Number(row?.delivery?.estimated_days);
  if (Number.isFinite(days) && days > 0) return days * 24;
  return Number.POSITIVE_INFINITY;
}

function rankStores(stores, mode) {
  const rows = Array.isArray(stores) ? [...stores] : [];
  const missingCount = (row) =>
    Array.isArray(row?.items_not_found) ? row.items_not_found.length : 0;

  if (mode === "delivery_speed") {
    rows.sort((a, b) => {
      const durA = deliveryHours(a);
      const durB = deliveryHours(b);
      if (durA !== durB) return durA - durB;
      const missA = missingCount(a);
      const missB = missingCount(b);
      if (missA !== missB) return missA - missB;
      return Number(a?.total || 0) - Number(b?.total || 0);
    });
    return rows;
  }

  if (mode === "availability") {
    rows.sort((a, b) => {
      const missA = missingCount(a);
      const missB = missingCount(b);
      if (missA !== missB) return missA - missB;
      return Number(a?.total || 0) - Number(b?.total || 0);
    });
    return rows;
  }

  rows.sort((a, b) => {
    const totalA = Number(a?.total || 0);
    const totalB = Number(b?.total || 0);
    if (totalA !== totalB) return totalA - totalB;
    return missingCount(a) - missingCount(b);
  });
  return rows;
}

function getStoreLogoCandidates(store) {
  const candidates = [];
  const explicitLogo = String(store?.logo_url || "").trim();
  if (explicitLogo) {
    if (/^https?:\/\//i.test(explicitLogo)) {
      candidates.push(explicitLogo);
    } else {
      const baseUrl = String(store?.url || "").trim();
      try {
        candidates.push(new URL(explicitLogo, baseUrl).href);
      } catch {
        // ignore invalid relative logo URL
      }
    }
  }

  const storeUrl = String(store?.url || "").trim();
  if (storeUrl) {
    try {
      const parsed = new URL(storeUrl);
      const origin = parsed.origin.replace(/\/+$/, "");
      candidates.push(`${origin}/favicon.ico`);
      candidates.push(`${origin}/favicon.png`);
      candidates.push(`${origin}/apple-touch-icon.png`);
      candidates.push(
        `https://logo.clearbit.com/${encodeURIComponent(parsed.hostname)}`,
      );
      candidates.push(
        `https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(origin)}`,
      );
    } catch {
      // ignore invalid store URL
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function ItemBreakdownRow({ item, storeRow, onOpenReplacement, onOpenDetail }) {
  const quantity = Number(item?.packs_needed || 1);
  const lineTotal = Number(item?.effective_price ?? item?.sale_price ?? 0);
  const unitPrice = quantity > 1 ? lineTotal / quantity : null;
  const displayName = formatMatchedDisplayName(item);
  const requestedName = String(item?.query || "").trim();
  const showRequestedName =
    requestedName &&
    displayName &&
    normalizeText(requestedName) !== normalizeText(displayName);

  const requestedKg = toKg(item?.requested_quantity, item?.requested_unit);
  const matchedPackKg = toKg(item?.weight_value, item?.weight_unit);
  const matchedTotalKgExplicit = toKg(
    item?.matched_total_quantity,
    item?.matched_total_unit,
  );
  const matchedTotalKg =
    matchedTotalKgExplicit != null
      ? matchedTotalKgExplicit
      : requestedKg != null && matchedPackKg != null
      ? matchedPackKg * quantity
      : null;
  const hasSizeDiff =
    requestedKg != null &&
    matchedTotalKg != null &&
    Math.abs(requestedKg - matchedTotalKg) >= 0.0005;

  const hasBrandDiff = item?.brand_status === "changed";
  const hasIssue = hasBrandDiff || hasSizeDiff;

  return (
    <li className="py-2 border-b border-[#f1f5f9] last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={`flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
              hasIssue
                ? "bg-amber-100 text-amber-600"
                : "bg-[#dcfce7] text-[#16a34a]"
            }`}
          >
            {hasIssue ? "!" : "✓"}
          </span>
          <button
            type="button"
            className="flex-1 text-sm text-[#0f172a] truncate text-left hover:text-[#16a34a] transition-colors min-w-0"
            onClick={() => onOpenDetail && onOpenDetail(item, storeRow)}
          >
            {displayName || requestedName}
          </button>
        </div>
        <span className="text-xs text-[#64748b] shrink-0 ml-1 font-medium">
          {formatEuro(lineTotal)}
        </span>
      </div>
      {/* Combination breakdown — shows exact pack split e.g. "500g × 4" */}
      {formatCombinationSummary(item?.combination) ? (
        <p className="text-xs text-[#16a34a] font-semibold pl-7 mt-0.5">
          {formatCombinationSummary(item.combination)}
          {matchedTotalKg != null && (
            <span className="text-[#64748b] font-normal">
              {" "}= {formatMassFromKg(matchedTotalKg)}
            </span>
          )}
        </p>
      ) : quantity > 1 ? (
        <p className="text-xs text-[#64748b] pl-7 mt-0.5">
          {quantity} × {formatEuro(unitPrice)}
        </p>
      ) : null}
      {showRequestedName && (
        <p className="text-xs text-[#64748b] pl-7 mt-0.5">
          Requested: {requestedName}
        </p>
      )}
      {hasBrandDiff && (
        <p className="text-xs text-amber-700 font-semibold pl-7 mt-0.5">
          Brand changed
        </p>
      )}
      {hasSizeDiff && (
        <p className="text-xs text-sky-700 font-semibold pl-7 mt-0.5">
          Size differs: {formatMassFromKg(requestedKg)} →{" "}
          {formatMassFromKg(matchedTotalKg)}
        </p>
      )}
      {(hasBrandDiff || hasSizeDiff) && (
        <button
          type="button"
          className="mt-1 ml-7 text-xs font-semibold text-amber-700 hover:underline"
          onClick={() =>
            onOpenReplacement(storeRow, {
              query: item?.query || item?.product_name,
              listItemId: item?.list_item_id || null,
              reason: hasBrandDiff ? "brand_change" : "size_change",
              category: item?.product_category || null,
              brandPref: item?.brand_pref || item?.requested_brand || null,
            })
          }
        >
          Search replacement
        </button>
      )}
    </li>
  );
}

function StoreCard({
  row,
  onOpenReplacement,
  onOpenDetail,
  highlighted = false,
  showBestTag = false,
  savings = null,
}) {
  const [expanded, setExpanded] = useState(false);
  const storeName = row?.store?.name || "Store";
  const missing = Array.isArray(row?.items_not_found)
    ? row.items_not_found
    : [];
  const matchedItems = Array.isArray(row?.matched_items)
    ? row.matched_items
    : [];
  const previewItems = expanded ? matchedItems : matchedItems.slice(0, 3);
  const logoCandidates = useMemo(
    () => getStoreLogoCandidates(row?.store),
    [row?.store?.id, row?.store?.logo_url, row?.store?.url],
  );
  const [logoIndex, setLogoIndex] = useState(0);
  const storeLogo = logoCandidates[logoIndex] || null;
  const isBest = highlighted && showBestTag;

  useEffect(() => {
    setLogoIndex(0);
  }, [logoCandidates]);

  const handleLogoError = () =>
    setLogoIndex((current) =>
      current + 1 < logoCandidates.length ? current + 1 : current,
    );

  const logoContent = storeLogo ? (
    <img
      src={storeLogo}
      alt={`${storeName} logo`}
      className="w-full h-full object-contain"
      onError={handleLogoError}
    />
  ) : (
    <span className="text-xs font-bold text-[#64748b]">
      {storeName.slice(0, 2).toUpperCase()}
    </span>
  );

  return (
    <article
      className="bg-white rounded-[32px] shadow-[0px_4px_20px_0px_rgba(0,0,0,0.05)] border-2 border-[#22c55e]"
    >
      {/* Mobile-only: green hero area for best store */}
      {isBest && (
        <div className="sm:hidden relative h-[128px] bg-[rgba(22,163,74,0.1)] flex items-center justify-center overflow-hidden rounded-t-[32px]">
          {storeLogo ? (
            <img
              src={storeLogo}
              alt={`${storeName} logo`}
              className="max-h-16 max-w-[55%] object-contain"
              onError={handleLogoError}
            />
          ) : (
            <span className="text-xl font-bold text-[#16a34a]">
              {storeName}
            </span>
          )}
          <span className="absolute top-3 left-3 bg-[#16a34a] text-white text-[10px] font-bold px-2.5 py-1 rounded-full tracking-wide uppercase">
            Best Value
          </span>
        </div>
      )}

      <div className="p-4 sm:p-8">
        {/* Store header row */}
        <div className="flex items-start justify-between gap-4 mb-4 sm:mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Logo */}
            {isBest ? (
              <div className="hidden sm:flex w-20 h-20 rounded-full border border-[#f1f5f9] bg-white items-center justify-center overflow-hidden flex-shrink-0">
                {logoContent}
              </div>
            ) : (
              <div className="w-10 h-10 sm:w-20 sm:h-20 rounded-[8px] bg-[#f8fafc] flex items-center justify-center overflow-hidden flex-shrink-0">
                {logoContent}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-[#0f172a] text-base sm:text-[24px] leading-tight sm:leading-[32px]">
                  {storeName}
                </h3>
                {isBest && (
                  <span className="hidden sm:inline bg-[#dcfce7] text-[#22c55e] text-[10px] font-bold px-2 py-0.5 rounded-[4px] tracking-[0.5px] uppercase">
                    Best Value
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <span className="text-base sm:text-[36px] font-bold text-black">
                  {formatEuro(row?.total)}
                </span>
                {isBest && savings != null && savings > 0.005 && (
                  <span className="text-xs sm:text-[14px] font-semibold text-[#22c55e]">
                    Save {formatEuro(savings)}
                  </span>
                )}
                {!isBest && (
                  <span className="text-xs sm:text-[14px] text-[#94a3b8]">
                    {Number(row?.items_matched || 0) ===
                    Number(row?.items_total || 0)
                      ? "Full match"
                      : `${Number(row?.items_matched || 0)}/${Number(row?.items_total || 0)} items`}
                  </span>
                )}
              </div>
            </div>
          </div>
          {/* Desktop: buy button in header row */}
          {(row?.cart_url || row?.store?.url) && (
            <a
              href={row.cart_url || row.store.url}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:flex items-center justify-center px-8 py-3 rounded-[16px] text-base font-bold transition-all shrink-0 bg-white border-2 border-[#16a34a] text-[#16a34a] hover:bg-[#f0fdf4]"
            >
              {`Buy on ${storeName}`}
            </a>
          )}
        </div>

        {/* Items area with light bg */}
        <div className="bg-[#f8fafc] rounded-[16px] p-4 sm:p-6">
          {/* Missing items */}
          {missing.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M8 1.5L14.5 13H1.5L8 1.5Z"
                    fill="#fed7aa"
                    stroke="#f97316"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 6v3"
                    stroke="#ea580c"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                  <circle cx="8" cy="11" r="0.6" fill="#ea580c" />
                </svg>
                <span className="text-[10px] font-bold text-[#ea580c] uppercase tracking-[1px]">
                  Missing Items ({missing.length})
                </span>
              </div>
              <div className="space-y-2 sm:space-y-3">
                {missing.map((itemName) => (
                  <div
                    key={`${storeName}-${itemName}`}
                    className="bg-white border border-[#ffedd5] rounded-[12px] px-4 py-3 flex items-center justify-between"
                  >
                    <p className="text-[14px] text-[#334155] truncate min-w-0">
                      {itemName}
                    </p>
                    <button
                      type="button"
                      className="text-[10px] font-bold text-[#f97316] uppercase tracking-[0.5px] shrink-0 ml-3 hover:text-[#ea580c]"
                      onClick={() =>
                        onOpenReplacement(row, {
                          query: itemName,
                          reason: "missing",
                        })
                      }
                    >
                      Search Replacement
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key items */}
          {matchedItems.length > 0 && (
            <>
              <p className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-[1px] mb-3 sm:mb-4">
                {isBest
                  ? `Key Items (${Number(row?.items_total || matchedItems.length)} Total)`
                  : "Key Items"}
              </p>
              <ul className="mb-0">
                {previewItems.map((item, idx) => (
                  <ItemBreakdownRow
                    key={item?.deal_id || idx}
                    item={item}
                    storeRow={row}
                    onOpenReplacement={onOpenReplacement}
                    onOpenDetail={onOpenDetail}
                  />
                ))}
              </ul>
            </>
          )}

          {/* Expand toggle */}
          {matchedItems.length > 3 && (
            <button
              type="button"
              className="text-xs font-semibold text-[#16a34a] mt-2 mb-1 hover:underline"
              onClick={() => setExpanded((prev) => !prev)}
            >
              {expanded
                ? "Show less ▴"
                : `Show all ${Number(row?.items_total || matchedItems.length)} items ▾`}
            </button>
          )}

          {/* View full list / breakdown */}
          {(matchedItems.length > 0 || missing.length > 0) && (
            <div className="flex items-center justify-center pt-3 sm:pt-4">
              <button
                type="button"
                className={`text-[14px] font-bold hover:underline ${isBest ? "text-[#22c55e]" : "text-[#64748b]"}`}
              >
                {isBest ? "View Full List" : "View Breakdown"}
              </button>
            </div>
          )}
        </div>

        {/* Mobile: CTA at bottom */}
        {(row?.cart_url || row?.store?.url) && (
          <a
            href={row.cart_url || row.store.url}
            target="_blank"
            rel="noreferrer"
            className="sm:hidden flex items-center justify-center gap-1.5 w-full py-3 mt-4 rounded-[12px] text-sm font-semibold transition-all bg-white border-2 border-[#16a34a] text-[#16a34a] hover:bg-[#f0fdf4]"
          >
            {`Buy on ${storeName}`}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 10L10 2M10 2H4M10 2V8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        )}
      </div>
    </article>
  );
}

function EmptyRecommendationState({ partialStores, requestedItems }) {
  const hasPartial = partialStores.length > 0;

  return (
    <div className="rounded-xl border border-slate-300 bg-gradient-to-r from-slate-50 to-sky-50 p-5">
      <h3 className="text-2xl font-extrabold text-slate-900">
        {hasPartial
          ? "No store has all items right now"
          : "No items from your list were found"}
      </h3>
      <p className="text-sm text-slate-700 mt-1">
        {hasPartial
          ? "Some items were matched. Missing items are listed below per store."
          : "Try simpler names or change item preferences and try again."}
      </p>

      {hasPartial ? (
        <div className="mt-4 space-y-3">
          {partialStores.map((row, idx) => (
            <div
              key={`${row?.store?.id || "store"}-${idx}`}
              className="rounded-lg border border-border bg-card p-4"
            >
              <p className="text-base font-semibold text-near-black">
                {idx + 1}. {row?.store?.name || "Store"}
              </p>
              <p className="text-sm text-text-secondary">
                Matched {Number(row?.items_matched || 0)}/
                {Number(row?.items_total || 0)} items
              </p>
              <p className="text-sm text-rose-700 mt-1">
                Not found:{" "}
                {Array.isArray(row?.items_not_found)
                  ? row.items_not_found.join(", ")
                  : "-"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        requestedItems.length > 0 && (
          <p className="text-sm text-near-black mt-4">
            Not found:{" "}
            <span className="font-medium">{requestedItems.join(", ")}</span>
          </p>
        )
      )}
    </div>
  );
}

// previous layout kept below for reference
function _DeprecatedStoreCard() {
  return null;
}

export default function RecommendationPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const location = useLocation();
  // Items passed from ShoppingListPage with derived quantities (hint × item_count).
  const navStateItems = Array.isArray(location.state?.items)
    ? location.state.items
    : [];

  const [preference, setPreference] = useState("cheapest");
  const [rankMode, setRankMode] = useState("total");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [listItems, setListItems] = useState([]);

  const [replacementContext, setReplacementContext] = useState(null);
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [replacementResults, setReplacementResults] = useState([]);
  const [replacementError, setReplacementError] = useState("");
  const [replacementInfo, setReplacementInfo] = useState("");
  const [applyingReplacement, setApplyingReplacement] = useState(false);
  const [sessionFallbackItems] = useState(() => readSessionFallbackItems());
  const [storeOrder, setStoreOrder] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const localReplacementPatchRef = useRef(false);

  const categoryByListItemId = useMemo(() => {
    const map = new Map();
    const stores = Array.isArray(result?.stores) ? result.stores : [];
    for (const row of stores) {
      const matched = Array.isArray(row?.matched_items)
        ? row.matched_items
        : [];
      for (const item of matched) {
        const listItemId = item?.list_item_id;
        const category = String(item?.product_category || "").trim();
        if (listItemId == null || !category) continue;
        if (!map.has(String(listItemId))) map.set(String(listItemId), category);
      }
    }
    return map;
  }, [result?.stores]);

  const categoryByQuery = useMemo(() => {
    const counters = new Map();
    const stores = Array.isArray(result?.stores) ? result.stores : [];
    for (const row of stores) {
      const matched = Array.isArray(row?.matched_items)
        ? row.matched_items
        : [];
      for (const item of matched) {
        const queryKey = normalizeText(item?.query);
        const category = String(item?.product_category || "").trim();
        if (!queryKey || !category) continue;
        const bucket = counters.get(queryKey) || new Map();
        bucket.set(category, (bucket.get(category) || 0) + 1);
        counters.set(queryKey, bucket);
      }
    }

    const resolved = new Map();
    for (const [queryKey, bucket] of counters.entries()) {
      const best = Array.from(bucket.entries()).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0];
      if (best?.[0]) resolved.set(queryKey, best[0]);
    }
    return resolved;
  }, [result?.stores]);

  async function runRecommendationWithRetry({
    listId,
    deliveryPreference,
    postcode,
    fallbackItems,
  }) {
    await warmup().catch(() => {});
    let attempts = 0;
    while (attempts < RECOMMEND_RETRY_MAX) {
      attempts += 1;
      try {
        const fallbackPayload =
          fallbackItems.length > 0
            ? {
                items: fallbackItems,
                raw_input: fallbackItems
                  .map((item) => item.raw_item_text)
                  .join(", "),
                input_method: "text",
                name: "Smart List",
              }
            : {};
        try {
          return await recommendList(listId, {
            delivery_preference: deliveryPreference,
            postcode,
            ...fallbackPayload,
          });
        } catch (err) {
          const isListNotFound = String(err?.message || "")
            .toLowerCase()
            .includes("list not found");
          if (!isListNotFound) throw err;
          if (fallbackItems.length > 0) {
            return await recommendList(listId, {
              delivery_preference: deliveryPreference,
              postcode,
              items: fallbackItems,
              raw_input: fallbackItems
                .map((item) => item.raw_item_text)
                .join(", "),
              input_method: "text",
              name: "Smart List",
            });
          }

          const fetchedList = await fetchList(listId).catch(() => null);
          const fetchedItems = Array.isArray(fetchedList?.items)
            ? fetchedList.items
                .map((item) => ({
                  raw_item_text: String(item?.raw_item_text || "").trim(),
                  quantity:
                    item?.quantity == null || item?.quantity === ""
                      ? null
                      : Number(item.quantity),
                  quantity_unit:
                    item?.quantity_unit == null
                      ? null
                      : String(item.quantity_unit || "")
                          .trim()
                          .toLowerCase() || null,
                  item_count: Math.max(1, Number(item?.item_count) || 1),
                }))
                .filter((item) => item.raw_item_text)
            : [];
          if (fetchedItems.length > 0) {
            return await recommendList(listId, {
              delivery_preference: deliveryPreference,
              postcode,
              items: fetchedItems,
              raw_input: fetchedItems
                .map((item) => item.raw_item_text)
                .join(", "),
              input_method: "text",
              name: "Smart List",
            });
          }
          throw err;
        }
      } catch (err) {
        const msg = String(err?.message || "").toLowerCase();
        const warmingUp =
          msg.includes("warming up") ||
          msg.includes("deals_unavailable") ||
          msg.includes("pricing data is warming up");
        if (!warmingUp || attempts >= RECOMMEND_RETRY_MAX) throw err;
        await warmup().catch(() => {});
        await sleep(RECOMMEND_RETRY_DELAY_MS);
      }
    }
    throw new Error("Pricing data is warming up. Please try again.");
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    const postcode = getAuthSession()?.user?.postcode || "";
    (async () => {
      const fetchedList = await fetchList(id).catch(() => null);
      const fetchedItems = Array.isArray(fetchedList?.items)
        ? fetchedList.items
            .map((item) => ({
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
            }))
            .filter((item) => item.raw_item_text)
        : [];
      const effectiveFallbackItems = pickBestFallbackItems(
        navStateItems,
        fetchedItems,
        sessionFallbackItems,
      );
      return runRecommendationWithRetry({
        listId: id,
        deliveryPreference: preference,
        postcode,
        fallbackItems: effectiveFallbackItems,
      });
    })()
      .then((res) => {
        if (!cancelled && res) setResult(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err.message || "").toLowerCase().includes("access token")) {
          navigate("/login");
          return;
        }
        setError(err.message || "Failed to generate recommendation");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, navStateItems, navigate, preference, sessionFallbackItems]);

  useEffect(() => {
    let cancelled = false;

    fetchList(id)
      .then((res) => {
        if (cancelled) return;
        setListItems(Array.isArray(res?.items) ? res.items : []);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err.message || "").toLowerCase().includes("access token")) {
          navigate("/login");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  useEffect(() => {
    if (!result) {
      setStoreOrder([]);
      return;
    }
    if (localReplacementPatchRef.current) {
      localReplacementPatchRef.current = false;
      return;
    }

    const ranked = rankStores(result?.stores || [], rankMode);
    const nextOrder = ranked
      .map((row) => String(row?.store?.id || "").trim())
      .filter(Boolean);
    setStoreOrder(nextOrder);
  }, [result, rankMode]);

  async function searchStoreReplacements(context, queryInput) {
    const ctx = context || replacementContext;
    if (!ctx?.storeId) return;

    const query = String(queryInput || "").trim();
    const category = String(ctx.category || "").trim();
    const hasCategory = Boolean(category);

    setReplacementLoading(true);
    setReplacementError("");
    setReplacementInfo("");
    try {
      // First: try strict exact-combo search (quantity-aware).
      const listItem =
        ctx.listItemId != null
          ? listItems.find(
              (item) => String(item?.id || "") === String(ctx.listItemId),
            ) || { id: ctx.listItemId, raw_item_text: ctx.missingItem }
          : findListItemForMissing(query || ctx.missingItem, {
              brandPref: ctx.brandPref,
            });
      if (listItem?.id) {
        try {
          const strictRes = await searchListReplacements(id, {
            store_id: ctx.storeId,
            list_item_id: listItem.id,
            query: query || undefined,
            limit: 40,
          });
          const payload = strictRes?.data || {};
          const rows = Array.isArray(payload?.results) ? payload.results : [];
          if (rows.length > 0) {
            setReplacementResults(rows);
            const targetLabel =
              formatMatchedTotalQuantity(
                payload?.requested_quantity,
                payload?.requested_unit,
              ) ||
              formatMatchedTotalQuantity(
                rows[0]?.matched_total_quantity,
                rows[0]?.matched_total_unit,
              );
            if (payload?.fallback_applied) {
              setReplacementInfo(
                `Requested brand unavailable. Showing ${targetLabel ? `${targetLabel} ` : ""}"${payload.base_product}" alternatives.`,
              );
            } else if (payload?.stage === "brand_strict") {
              setReplacementInfo(
                `Showing exact brand and ${targetLabel ? `${targetLabel} ` : ""}quantity matches for "${payload.base_product}".`,
              );
            } else {
              setReplacementInfo(
                `Showing exact ${targetLabel ? `${targetLabel} ` : ""}quantity matches for "${payload.base_product}".`,
              );
            }
            return;
          }
        } catch {
          // fall through to fetchDeals approach
        }
      }

      // Fallback: multi-pass fetchDeals approach.
      const { queryVariants, focusTokens } = buildReplacementSearchPlan(
        query || ctx.missingItem,
        ctx.brandPref,
      );
      const expectedType = inferReplacementType(
        query || ctx.missingItem,
        hasCategory ? category : "",
      );
      const attaIntent =
        expectedType === "flour" ||
        hasAttaIntentTokens(tokenizeSearchText(query || ctx.missingItem));

      // Pass 1: direct query variants.
      const directVariants = queryVariants.slice(0, 3);
      for (const variant of directVariants) {
        const directRes = await fetchDeals({
          q: variant.length >= 2 ? variant : undefined,
          store: ctx.storeId,
          availability: "in_stock",
          sort: "price_asc",
          limit: 60,
        });
        const directRows = filterReplacementCandidatesByType(
          Array.isArray(directRes?.data) ? directRes.data : [],
          expectedType,
        );
        if (directRows.length > 0) {
          const rankedRows = attaIntent
            ? rankDealsByFocusTokens(directRows, focusTokens)
            : directRows;
          setReplacementResults(rankedRows.slice(0, 60));
          setReplacementInfo(
            variant !== (query || ctx.missingItem)
              ? `No exact match for "${query || ctx.missingItem}". Showing store matches for "${variant}".`
              : `Showing store matches for "${variant}".`,
          );
          return;
        }
      }

      // Pass 2: category fallback.
      if (hasCategory) {
        const categoryRes = await fetchDeals({
          store: ctx.storeId,
          category,
          availability: "in_stock",
          sort: "price_asc",
          limit: 200,
        });
        const categoryRows = filterReplacementCandidatesByType(
          Array.isArray(categoryRes?.data) ? categoryRes.data : [],
          expectedType,
        );
        const narrowed = attaIntent
          ? categoryRows.filter((deal) => isAttaLikeProduct(deal?.product_name))
          : categoryRows;
        const focused = attaIntent
          ? narrowed
          : filterDealsByFocusTokens(narrowed, focusTokens);
        const ranked = rankDealsByFocusTokens(
          focused.length > 0 ? focused : narrowed,
          focusTokens,
        ).slice(0, 80);
        if (ranked.length > 0) {
          setReplacementResults(ranked);
          setReplacementInfo(
            `No exact match. Showing ${category} items matching "${focusTokens.join(" ").trim() || query}".`,
          );
          return;
        }
      }

      // Pass 3: store-wide fallback.
      const storeRes = await fetchDeals({
        store: ctx.storeId,
        availability: "in_stock",
        sort: "price_asc",
        limit: 200,
      });
      const storeRows = filterReplacementCandidatesByType(
        Array.isArray(storeRes?.data) ? storeRes.data : [],
        expectedType,
      );
      const narrowed = attaIntent
        ? storeRows.filter((deal) => isAttaLikeProduct(deal?.product_name))
        : storeRows;
      const focused = attaIntent
        ? narrowed
        : filterDealsByFocusTokens(narrowed, focusTokens);
      const ranked = rankDealsByFocusTokens(
        focused.length > 0 ? focused : narrowed,
        focusTokens,
      ).slice(0, 80);
      if (ranked.length > 0) {
        setReplacementResults(ranked);
        setReplacementInfo(
          `Showing store items matching "${focusTokens.join(" ").trim() || query}".`,
        );
        return;
      }

      setReplacementResults([]);
      setReplacementError(`No replacement found for "${query || ctx.missingItem}" in this store.`);
    } catch (err) {
      setReplacementError(err.message || "Failed to search replacements");
      setReplacementResults([]);
      setReplacementInfo("");
    } finally {
      setReplacementLoading(false);
    }
  }

  function replacementReasonLabel(reason) {
    if (reason === "brand_change") return "Brand changed";
    if (reason === "size_change") return "Size changed";
    return "Missing item";
  }

  function openReplacementModal(row, target) {
    const fallbackQuery =
      typeof target === "string" ? target : target?.query || "";
    const matchedListItem =
      target?.listItemId != null
        ? listItems.find(
            (item) => String(item?.id || "") === String(target.listItemId),
          )
        : findListItemForMissing(fallbackQuery, {
            brandPref: target?.brandPref,
          });
    const listItemId = matchedListItem?.id || target?.listItemId || null;
    const inferredCategory =
      String(target?.category || "").trim() ||
      (listItemId != null
        ? categoryByListItemId.get(String(listItemId))
        : "") ||
      categoryByQuery.get(normalizeText(fallbackQuery)) ||
      "";
    const inferredBrandPref =
      String(target?.brandPref || matchedListItem?.brand_pref || "").trim() ||
      "";

    const context = {
      storeId: row?.store?.id,
      storeName: row?.store?.name || "Store",
      missingItem: String(fallbackQuery || "").trim(),
      listItemId,
      category: inferredCategory || null,
      brandPref: inferredBrandPref || null,
      reason: target?.reason || "missing",
    };
    setReplacementContext(context);
    setReplacementQuery(context.missingItem);
    setReplacementResults([]);
    setReplacementError("");
    setReplacementInfo("");
    searchStoreReplacements(context, context.missingItem);
  }

  function closeReplacementModal() {
    if (applyingReplacement) return;
    setReplacementContext(null);
    setReplacementQuery("");
    setReplacementResults([]);
    setReplacementError("");
    setReplacementInfo("");
  }

  function openProductDetail(item, storeRow) {
    setSelectedProduct({ item, storeRow });
  }

  function closeProductDetail() {
    setSelectedProduct(null);
  }

  function findListItemForMissing(missingName, options = {}) {
    const targetRaw = String(missingName || "").trim();
    if (!targetRaw) return null;

    const target = normalizeText(targetRaw);
    const normalized = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const exact = listItems.find(
      (item) => normalizeText(item?.raw_item_text) === target,
    );
    if (exact) return exact;

    const targetNormalized = normalized(targetRaw);
    const exactNormalized = listItems.find(
      (item) => normalized(item?.raw_item_text) === targetNormalized,
    );
    if (exactNormalized) return exactNormalized;

    const containsMatch = listItems.find((item) => {
      const text = normalized(item?.raw_item_text);
      return (
        text &&
        (text.includes(targetNormalized) || targetNormalized.includes(text))
      );
    });
    if (containsMatch) return containsMatch;

    const plan = buildReplacementSearchPlan(targetRaw, options.brandPref || "");
    const targetTokens =
      plan.focusTokens.length > 0
        ? plan.focusTokens
        : tokenizeSearchText(targetRaw);
    if (targetTokens.length === 0) return null;
    const targetSet = new Set(targetTokens);

    let best = null;
    let bestScore = -Infinity;
    for (const item of listItems) {
      const text = String(item?.raw_item_text || "").trim();
      if (!text) continue;
      const itemTokens = tokenizeSearchText(text);
      if (itemTokens.length === 0) continue;
      const itemSet = new Set(itemTokens);
      const overlap = targetTokens.filter((token) => itemSet.has(token)).length;
      const minOverlap = targetSet.size >= 2 ? 2 : 1;
      if (overlap < minOverlap) continue;
      const coverage = overlap / targetSet.size;
      const precision = overlap / itemSet.size;
      const score = coverage * 0.75 + precision * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }

    return best || null;
  }

  async function applyReplacement(deal) {
    if (!replacementContext) return;

    const expectedType = inferReplacementType(
      replacementContext.missingItem,
      replacementContext.category || "",
    );
    const selectedType = inferReplacementTypeFromText(deal?.product_name);
    if (expectedType && selectedType && expectedType !== selectedType) {
      setReplacementError(
        `Selected item looks like ${selectedType}, but requested item is ${expectedType}. Please choose a closer replacement.`,
      );
      return;
    }

    const listItem =
      replacementContext.listItemId != null
        ? listItems.find(
            (item) =>
              String(item?.id || "") === String(replacementContext.listItemId),
          ) || { id: replacementContext.listItemId }
        : findListItemForMissing(replacementContext.missingItem, {
            brandPref: replacementContext.brandPref,
          });
    if (!listItem?.id) {
      setReplacementError(
        `Could not map \"${replacementContext.missingItem}\" to a list item for replacement.`,
      );
      return;
    }

    setApplyingReplacement(true);
    setReplacementError("");
    try {
      const storeId = String(replacementContext.storeId || "");
      const previousListText = String(
        listItem?.raw_item_text || replacementContext.missingItem || "",
      ).trim();
      const replacementPayload = {
        listItemId: listItem.id,
        missingItem: replacementContext.missingItem,
        previousListText,
        deal,
        fallbackCategory: replacementContext.category,
      };

      const currentStores = Array.isArray(result?.stores) ? result.stores : [];
      const currentStoreRow =
        currentStores.find((row) => String(row?.store?.id || "") === storeId) ||
        null;
      if (!currentStoreRow) {
        setReplacementError(
          "Could not locate this store in current recommendations. Please refresh and try again.",
        );
        return;
      }

      const previewStoreRow = patchStoreRowWithReplacement(
        currentStoreRow,
        replacementPayload,
      );
      const previewMatchedItems = Array.isArray(previewStoreRow?.matched_items)
        ? previewStoreRow.matched_items
        : [];
      if (previewMatchedItems.length === 0) {
        setReplacementError(
          "Could not build an updated cart with this replacement. Please choose another item.",
        );
        return;
      }

      const transferResult = await buildListStoreCartTransfer(id, {
        store_id: storeId,
        matched_items: previewMatchedItems.map((item) => ({
          product_url: item?.product_url,
          packs_needed: item?.packs_needed,
          combination: Array.isArray(item?.combination)
            ? item.combination.map((row) => ({
                product_url: row?.product_url,
                count: row?.count,
              }))
            : undefined,
        })),
      });
      const transfer = transferResult?.data || null;
      if (!transfer?.cart_url) {
        setReplacementError(
          "Selected replacement could not be added to cart for this store. Please choose another item.",
        );
        return;
      }

      await updateListItem(id, listItem.id, {
        raw_item_text: deal.product_name,
        canonical_id: deal.canonical_id || null,
        resolved: Boolean(deal.canonical_id),
        unresolvable: false,
      });

      const listItemId = String(listItem.id || "");

      setListItems((prev) =>
        prev.map((item) =>
          String(item?.id || "") === listItemId
            ? {
                ...item,
                raw_item_text: String(
                  deal?.product_name || item?.raw_item_text || "",
                ).trim(),
                canonical_id: deal?.canonical_id || null,
                resolved: Boolean(deal?.canonical_id),
                unresolvable: false,
              }
            : item,
        ),
      );
      localReplacementPatchRef.current = true;
      setResult((prev) => {
        if (!prev) return prev;
        const stores = Array.isArray(prev?.stores) ? prev.stores : [];
        const nextStores = stores.map((row) =>
          String(row?.store?.id || "") === storeId
            ? {
                ...patchStoreRowWithReplacement(row, replacementPayload),
                cart_url: transfer.cart_url,
                cart_transfer_method:
                  transfer.method || row?.cart_transfer_method || null,
              }
            : row,
        );
        return {
          ...prev,
          stores: nextStores,
          partial_matches: buildPartialMatchesFromStores(nextStores),
        };
      });

      closeReplacementModal();
    } catch (err) {
      setReplacementError(err.message || "Failed to apply replacement");
    } finally {
      setApplyingReplacement(false);
    }
  }

  const rankedStores = useMemo(() => {
    const allRanked = rankStores(result?.stores || [], rankMode);
    // Only show stores that matched ALL requested items.
    const fullMatch = allRanked.filter(
      (row) =>
        Array.isArray(row?.items_not_found) && row.items_not_found.length === 0,
    );
    const ranked = fullMatch.length > 0 ? fullMatch : allRanked;
    if (ranked.length === 0 || storeOrder.length === 0) return ranked;

    const byStoreId = new Map(
      ranked.map((row) => [String(row?.store?.id || "").trim(), row]),
    );
    const ordered = [];
    for (const storeId of storeOrder) {
      const row = byStoreId.get(storeId);
      if (!row) continue;
      ordered.push(row);
      byStoreId.delete(storeId);
    }
    for (const row of ranked) {
      const storeId = String(row?.store?.id || "").trim();
      if (!storeId || !byStoreId.has(storeId)) continue;
      ordered.push(row);
      byStoreId.delete(storeId);
    }
    return ordered.length === ranked.length ? ordered : ranked;
  }, [result?.stores, rankMode, storeOrder]);
  const partialStores = Array.isArray(result?.partial_matches)
    ? result.partial_matches
    : [];
  const requestedItems = Array.isArray(result?.requested_items)
    ? result.requested_items.filter(Boolean)
    : [];

  const sortTabs = [
    { label: "Price", mode: "total", pref: "cheapest" },
    { label: "Availability", mode: "availability", pref: "cheapest" },
    { label: "Delivery", mode: "delivery_speed", pref: "fastest" },
  ];

  const savings =
    rankedStores.length > 1
      ? Math.max(
          0,
          Number(rankedStores[1]?.total || 0) -
            Number(rankedStores[0]?.total || 0),
        )
      : null;

  return (
    <div className="min-h-screen bg-[#f8fdf9]">
      {/* ── MOBILE: sticky header ── */}
      <div className="sm:hidden sticky top-0 z-40 bg-[rgba(248,253,249,0.88)] backdrop-blur-[10px] border-b border-[#f1f5f9]">
        <div className="flex items-center justify-between px-4 h-14">
          <button
            type="button"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[#f1f5f9] text-[#0f172a]"
            onClick={() => navigate("/list")}
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 12L6 8L10 4"
                stroke="#0f172a"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="text-base font-bold text-[#0f172a]">Best Prices</h1>
          <Link
            to="/profile"
            className="w-9 h-9 flex items-center justify-center rounded-full bg-[#f1f5f9]"
            aria-label="Profile"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle
                cx="9"
                cy="6.5"
                r="3.5"
                stroke="#0f172a"
                strokeWidth="1.5"
              />
              <path
                d="M2 17c0-3.866 3.134-7 7-7s7 3.134 7 7"
                stroke="#0f172a"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </Link>
        </div>
        {/* Sort tabs */}
        <div className="flex border-t border-[#f1f5f9]">
          {sortTabs.map(({ label, mode, pref }) => (
            <button
              key={mode}
              type="button"
              className={`flex-1 py-2.5 text-[11px] font-semibold border-b-2 transition-colors ${
                rankMode === mode
                  ? "text-[#16a34a] border-[#16a34a]"
                  : "text-[#64748b] border-transparent"
              }`}
              onClick={() => {
                setRankMode(mode);
                setPreference(pref);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── DESKTOP layout ── */}
      <div className="hidden sm:block max-w-[1280px] mx-auto px-8 py-10">
        {/* Page header: back + heading/subtitle on left, sort tabs on right */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <button
              type="button"
              className="flex items-center gap-2 text-[16px] text-[#475569] border border-[#e2e8f0] rounded-[8px] px-4 py-2.5 hover:bg-[#f8fafc] transition-colors mb-8"
              onClick={() => navigate("/list")}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 12L6 8L10 4"
                  stroke="#475569"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Back to list
            </button>
            <h1 className="text-[36px] font-bold text-[#0f172a] leading-[40px]">
              Best matches for your list
            </h1>
            {!loading && rankedStores.length > 0 && (
              <p className="text-[16px] text-[#64748b] mt-1">
                Comparing {Number(rankedStores[0]?.items_total || 0)} items
                across {rankedStores.length} available local store
                {rankedStores.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          {/* Sort tabs */}
          <div className="flex items-center gap-1 bg-[#f1f5f9] rounded-[12px] p-1">
            {sortTabs.map(({ label, mode, pref }) => (
              <button
                key={mode}
                type="button"
                className={`px-6 py-2 rounded-[8px] text-sm font-semibold transition-all ${
                  rankMode === mode
                    ? "bg-[#0f172a] text-white shadow-sm"
                    : "text-[#475569] hover:text-[#0f172a]"
                }`}
                onClick={() => {
                  setRankMode(mode);
                  setPreference(pref);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-[32px] border border-[#f1f5f9] p-10 text-center">
            <p className="text-[#64748b]">Finding best prices across stores…</p>
          </div>
        )}
        {error && (
          <div className="bg-white rounded-[32px] border border-red-100 p-6">
            <p className="text-red-600">{error}</p>
          </div>
        )}
        {!loading && !error && (
          <div className="grid grid-cols-2 gap-6">
            {rankedStores.length === 0 ? (
              <div className="col-span-2">
                <EmptyRecommendationState
                  partialStores={partialStores}
                  requestedItems={requestedItems}
                />
              </div>
            ) : (
              rankedStores.map((row, index) => (
                <StoreCard
                  key={`${row?.store?.id || "store"}-${index}`}
                  row={row}
                  onOpenReplacement={openReplacementModal}
                  onOpenDetail={openProductDetail}
                  highlighted={index === 0}
                  showBestTag={rankMode === "total" && index === 0}
                  savings={index === 0 ? savings : null}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* ── MOBILE: scrollable store cards ── */}
      <div className="sm:hidden px-4 pt-4 pb-[100px] space-y-3">
        {loading && (
          <div className="bg-white rounded-[16px] p-10 text-center border border-[#f1f5f9]">
            <p className="text-[#64748b] text-sm">Finding best prices…</p>
          </div>
        )}
        {error && (
          <div className="bg-white rounded-[16px] border border-red-100 p-4">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}
        {!loading &&
          !error &&
          (rankedStores.length === 0 ? (
            <EmptyRecommendationState
              partialStores={partialStores}
              requestedItems={requestedItems}
            />
          ) : (
            rankedStores.map((row, index) => (
              <StoreCard
                key={`${row?.store?.id || "store"}-${index}`}
                row={row}
                onOpenReplacement={openReplacementModal}
                onOpenDetail={openProductDetail}
                highlighted={index === 0}
                showBestTag={rankMode === "total" && index === 0}
                savings={index === 0 ? savings : null}
              />
            ))
          ))}
      </div>

      {/* ── MOBILE: floating bottom nav ── */}
      <div
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30"
        style={{
          background:
            "linear-gradient(to top, #f8fdf9 60%, rgba(248,253,249,0) 100%)",
        }}
      >
        <nav className="flex items-center justify-around px-4 pb-6 pt-3">
          {[
            {
              to: "/",
              label: "Home",
              active: false,
              icon: (
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path
                    d="M2 9.5L11 2L20 9.5V19a1 1 0 01-1 1H3a1 1 0 01-1-1V9.5z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </svg>
              ),
            },
            {
              to: "/list",
              label: "My Lists",
              active: true,
              icon: (
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect
                    x="3"
                    y="3"
                    width="16"
                    height="16"
                    rx="3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M7 8h8M7 12h5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ),
            },
            {
              to: "/deals",
              label: "Deals",
              active: false,
              icon: (
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path
                    d="M4 6h14M6 6V4a1 1 0 011-1h8a1 1 0 011 1v2M6 6l1 13h8l1-13"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ),
            },
            {
              to: "/profile",
              label: "Profile",
              active: false,
              icon: (
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <circle
                    cx="11"
                    cy="8"
                    r="3.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M3.5 19c0-4.142 3.358-7.5 7.5-7.5s7.5 3.358 7.5 7.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ),
            },
          ].map(({ to, label, active, icon }) => (
            <Link
              key={to}
              to={to}
              className={`flex flex-col items-center gap-1 ${active ? "text-[#16a34a]" : "text-[#94a3b8]"}`}
            >
              {icon}
              <span className="text-[10px] font-semibold">{label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* ── MOBILE: product detail bottom sheet ── */}
      {selectedProduct && (
        <div
          className="sm:hidden fixed inset-0 z-50"
          onClick={closeProductDetail}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-tl-[24px] rounded-tr-[24px] p-5 pb-10"
            style={{ maxHeight: "82vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="w-10 h-1 bg-[#e2e8f0] rounded-full mx-auto mb-5" />

            {/* Product image */}
            {selectedProduct.item?.image_url && (
              <div className="w-full h-44 bg-[#f8fafc] rounded-[16px] mb-4 flex items-center justify-center overflow-hidden border border-[#f1f5f9]">
                <img
                  src={selectedProduct.item.image_url}
                  alt={selectedProduct.item.product_name || "Product"}
                  className="max-h-40 max-w-[70%] object-contain"
                />
              </div>
            )}

            {/* Badges */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs font-semibold text-[#64748b] bg-[#f1f5f9] px-2.5 py-1 rounded-full">
                {selectedProduct.storeRow?.store?.name || "Store"}
              </span>
              {selectedProduct.item?.product_category && (
                <span className="text-xs font-semibold text-[#16a34a] bg-[#dcfce7] px-2.5 py-1 rounded-full">
                  {selectedProduct.item.product_category}
                </span>
              )}
            </div>

            {/* Product name */}
            <h2 className="text-lg font-bold text-[#0f172a] mb-1 leading-snug">
              {formatMatchedDisplayName(selectedProduct.item) || "Product"}
            </h2>

            {/* Weight */}
            {selectedProduct.item?.weight_value &&
              selectedProduct.item?.weight_unit && (
                <p className="text-sm text-[#64748b] mb-3">
                  {selectedProduct.item.weight_value}{" "}
                  {selectedProduct.item.weight_unit}
                  {Number(selectedProduct.item?.packs_needed || 1) > 1 && (
                    <span>
                      {" "}
                      · {Number(selectedProduct.item.packs_needed)}× needed
                    </span>
                  )}
                  {selectedProduct.item?.matched_total_quantity &&
                    selectedProduct.item?.matched_total_unit && (
                      <span>
                        {" "}
                        · total{" "}
                        {selectedProduct.item.matched_total_quantity}{" "}
                        {selectedProduct.item.matched_total_unit}
                      </span>
                    )}
                </p>
              )}

            {/* Price */}
            <div className="flex items-end gap-2 mb-5">
              <span className="text-3xl font-bold text-[#16a34a]">
                {formatEuro(
                  selectedProduct.item?.effective_price ??
                    selectedProduct.item?.sale_price,
                )}
              </span>
              {Number(selectedProduct.item?.packs_needed || 1) > 1 && (
                <span className="text-sm text-[#64748b] mb-1">
                  ({formatEuro(selectedProduct.item?.sale_price)} each)
                </span>
              )}
            </div>

            {/* Buy CTA */}
            {(selectedProduct.storeRow?.cart_url ||
              selectedProduct.item?.product_url) && (
              <a
                href={
                  selectedProduct.storeRow?.cart_url ||
                  selectedProduct.item.product_url
                }
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#16a34a] text-white rounded-[14px] text-base font-semibold shadow-[0_4px_14px_rgba(22,163,74,0.35)] mb-3 hover:bg-[#15803d] transition-colors"
              >
                Buy on {selectedProduct.storeRow?.store?.name || "Store"}
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 12L12 2M12 2H5M12 2V9"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            )}

            {/* Find replacement */}
            <button
              type="button"
              className="w-full py-3 bg-[#f1f5f9] text-[#64748b] rounded-[14px] text-sm font-semibold hover:bg-[#e2e8f0] transition-colors"
              onClick={() => {
                closeProductDetail();
                openReplacementModal(selectedProduct.storeRow, {
                  query:
                    selectedProduct.item?.query ||
                    selectedProduct.item?.product_name,
                  listItemId: selectedProduct.item?.list_item_id || null,
                  reason: "missing",
                  category: selectedProduct.item?.product_category || null,
                });
              }}
            >
              Find Replacement
            </button>
          </div>
        </div>
      )}

      {/* ── Replacement modal ── */}
      {replacementContext && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-2xl rounded-tl-[24px] rounded-tr-[24px] sm:rounded-[20px] bg-white p-5 space-y-4 shadow-2xl border border-[#f1f5f9]">
            <div className="w-10 h-1 bg-[#e2e8f0] rounded-full mx-auto sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-[#0f172a]">
                  Replace in {replacementContext.storeName}
                </h3>
                <p className="text-sm text-[#64748b] mt-1">
                  {replacementReasonLabel(replacementContext.reason)}:{" "}
                  <span className="font-semibold text-[#0f172a]">
                    {replacementContext.missingItem}
                  </span>
                </p>
                {replacementContext.category && (
                  <p className="text-xs text-[#64748b] mt-0.5">
                    Category:{" "}
                    <span className="font-semibold text-[#0f172a]">
                      {replacementContext.category}
                    </span>
                  </p>
                )}
              </div>
              <button
                type="button"
                className="w-8 h-8 flex items-center justify-center rounded-full bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] flex-shrink-0"
                onClick={closeReplacementModal}
                disabled={applyingReplacement}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                searchStoreReplacements(replacementContext, replacementQuery);
              }}
              className="flex flex-wrap gap-2"
            >
              <input
                value={replacementQuery}
                onChange={(e) => setReplacementQuery(e.target.value)}
                className="aura-input flex-1 min-w-[200px]"
                placeholder="Search within this store…"
              />
              <button
                type="submit"
                className="btn-primary"
                disabled={replacementLoading}
              >
                {replacementLoading ? "Searching…" : "Search"}
              </button>
            </form>

            {replacementError && (
              <p className="text-sm text-red-600">{replacementError}</p>
            )}
            {!replacementError && replacementInfo && (
              <p className="text-sm text-amber-700">{replacementInfo}</p>
            )}

            <div className="max-h-[320px] overflow-auto rounded-[12px] border border-[#f1f5f9]">
              {replacementResults.length === 0 ? (
                <p className="p-4 text-sm text-[#64748b]">
                  {replacementLoading
                    ? "Loading candidates…"
                    : "No candidates loaded yet."}
                </p>
              ) : (
                <ul>
                  {replacementResults.map((deal, index) => (
                    <li
                      key={
                        deal?.id || `${deal?.product_name || "deal"}-${index}`
                      }
                      className={`px-4 py-3 flex items-center justify-between gap-3 border-b border-[#f1f5f9] last:border-b-0 ${
                        index % 2 === 0 ? "bg-white" : "bg-[#f8fafc]"
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#0f172a] truncate">
                          {deal.product_name}
                        </p>
                        <p className="text-xs text-[#64748b]">
                          {deal.product_category
                            ? `${deal.product_category} · `
                            : ""}
                          {[
                            formatCombinationSummary(deal.combination) ||
                              (deal.weight_value && deal.weight_unit
                                ? `${deal.weight_value} ${deal.weight_unit}`
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
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm font-semibold text-[#16a34a]">
                          {formatMoney(
                            deal.effective_price ?? deal.sale_price,
                          )}
                        </span>
                        <button
                          type="button"
                          className="btn-outline text-xs"
                          onClick={() => applyReplacement(deal)}
                          disabled={applyingReplacement}
                        >
                          {applyingReplacement ? "Applying…" : "Use this"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
