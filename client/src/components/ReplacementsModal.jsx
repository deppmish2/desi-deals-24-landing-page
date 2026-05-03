import React from "react";
import { createPortal } from "react-dom";
import { formatPricePerKg } from "../utils/formatters";

const TIER_LABELS = {
  same_pack: "Same product, different size",
  same_spec: "Same product, other brands",
  same_base_product: "Same product, other brands",
  same_brand: "Same brand, other products",
  same_category: "More from this category",
};

function highlightDiffName(sourceName, targetName) {
  const sourceTokens = new Set((sourceName || "").toLowerCase().split(/\s+/));
  return targetName.split(/(\s+)/).map((part, i) => {
    if (/^\s+$/.test(part)) return part;
    return !sourceTokens.has(part.toLowerCase())
      ? <strong key={i} className="font-bold text-slate-900">{part}</strong>
      : <span key={i}>{part}</span>;
  });
}

function ReplacementDealRow({ deal, emphasisSize, sourceName, sourcePricePerKg, onSelect }) {
  const [imgErr, setImgErr] = React.useState(false);
  const kgSavingPct = sourcePricePerKg && deal.price_per_kg != null
    ? Math.round((sourcePricePerKg - deal.price_per_kg) / sourcePricePerKg * 100)
    : null;
  return (
    <a
      href={deal.product_url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onSelect ? (e) => { e.preventDefault(); onSelect(); } : undefined}
      className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-[#16a34a] hover:bg-[#f0fdf4] transition-colors no-underline"
      style={{ textDecoration: "none" }}
    >
      {!imgErr && deal.image_url ? (
        <img
          src={deal.image_url}
          alt={deal.product_name}
          className="w-12 h-12 object-contain rounded-lg bg-slate-50 shrink-0"
          onError={() => setImgErr(true)}
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-slate-50 shrink-0 flex items-center justify-center text-xl">🛒</div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-normal text-slate-800 line-clamp-2 leading-tight">
          {sourceName ? highlightDiffName(sourceName, deal.product_name) : deal.product_name}
        </p>
        {(deal.weight_raw || deal.price_per_kg != null) && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {deal.weight_raw && (
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  emphasisSize === "mismatch"
                    ? "bg-red-100 text-red-700 border border-red-300"
                    : emphasisSize
                      ? "bg-amber-100 text-amber-700 border border-amber-300"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {deal.weight_raw}
              </span>
            )}
            {deal.price_per_kg != null && (
              <span className="text-[10px] text-slate-400">{formatPricePerKg(deal.price_per_kg, deal.weight_unit)}</span>
            )}
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className="text-[14px] font-extrabold text-slate-800">
          {deal.currency === "EUR" ? "€" : deal.currency}{Number(deal.sale_price).toFixed(2)}
        </p>
        {kgSavingPct !== null && kgSavingPct !== 0 && (
          <p className={`text-[10px] font-bold ${kgSavingPct > 0 ? "text-[#16a34a]" : "text-red-400"}`}>
            {kgSavingPct > 0 ? `-${kgSavingPct}%` : `+${Math.abs(kgSavingPct)}%`}
          </p>
        )}
      </div>
    </a>
  );
}

function deriveDealRow(r) {
  const weight_raw = r.weight_value != null && r.weight_unit
    ? `${r.weight_value}${r.weight_unit}`
    : null;
  const ppkg = (() => {
    if (r.sale_price == null || !r.weight_value || !r.weight_unit) return null;
    const u = String(r.weight_unit).toLowerCase();
    if (u === "kg") return r.sale_price / r.weight_value;
    if (u === "g")  return r.weight_value > 0 ? r.sale_price / (r.weight_value / 1000) : null;
    if (u === "l")  return r.sale_price / r.weight_value;
    if (u === "ml") return r.weight_value > 0 ? r.sale_price / (r.weight_value / 1000) : null;
    return null;
  })();
  return {
    id: r.id ?? r.deal_id,
    product_name: r.product_name,
    sale_price: r.sale_price,
    effective_price: r.effective_price ?? r.sale_price,
    packs_needed: r.packs_needed || 1,
    currency: r.currency,
    weight_value: r.weight_value,
    weight_unit: r.weight_unit,
    weight_raw,
    price_per_kg: ppkg,
    product_url: r.product_url,
    image_url: r.image_url,
  };
}

function toGrams(value, unit) {
  const u = String(unit || "").toLowerCase();
  if (u === "kg" || u === "l") return Number(value) * 1000;
  return Number(value); // g, ml
}

// Returns false (exact single pack), "factor" (clean multiple), or "mismatch" (red).
// Uses raw pack size only — independent of packs_needed so all same-size packs
// get consistent badge colour regardless of which result path they came from.
function weightEmphasis(srcValue, srcUnit, r) {
  if (!srcValue || !srcUnit || !r.weight_value || !r.weight_unit) return false;
  const srcG = toGrams(srcValue, srcUnit);
  const repG = toGrams(r.weight_value, r.weight_unit);
  if (Math.abs(repG - srcG) < 0.01) return false;
  if (repG < srcG && srcG % repG < 0.01) return "factor"; // buy N packs to reach source exactly
  return "mismatch"; // rep > src (can't split) or non-divisor
}

function strictEmptyMessage(reason) {
  switch (reason) {
    case "empty_query": return "This item has no name to search.";
    case "quantity_required": return "Add a quantity (e.g. 500 g) to this list item to find alternatives.";
    case "invalid_quantity": return "The quantity on this item couldn't be parsed.";
    case "base_product_not_resolved": return "We couldn't recognise this product to find alternatives at this store.";
    case "request_failed": return "Couldn't load replacements right now. Try again.";
    default: return "No alternatives found at this store.";
  }
}

export function ReplacementsModal({ sourceDeal, tiers, strict, loading, otherStores, isAdmin, onClose, onConfirm }) {
  const [categoryExpanded, setCategoryExpanded] = React.useState(false);
  const [selectedResult, setSelectedResult] = React.useState(null);
  const hasOtherStores = isAdmin && otherStores?.length > 0;
  const useStrict = !!strict;
  const strictResults = strict?.results || [];
  const otherBrandResults = strictResults.filter((r) => r.brand_status === "changed");
  const exactBrandResults = strictResults.filter((r) => r.brand_status !== "changed");
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-slate-400">Other options at this store</p>
            <p className="text-[13px] font-bold text-slate-800 mt-0.5 line-clamp-1">{sourceDeal.product_name}</p>
            {(sourceDeal.weight_raw || sourceDeal.price_per_kg != null) && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {sourceDeal.weight_raw && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">
                    {sourceDeal.weight_raw}
                  </span>
                )}
                {sourceDeal.price_per_kg != null && (
                  <span className="text-[10px] text-slate-400">{formatPricePerKg(sourceDeal.price_per_kg, sourceDeal.weight_unit)}</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors ml-3"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-6 h-6 border-2 border-[#16a34a] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : useStrict ? (
            <>
              {strictResults.length === 0 ? (
                <p className="text-center text-slate-400 text-[13px] py-6">{strictEmptyMessage(strict?.reason)}</p>
              ) : (
                <>
                  {otherBrandResults.length > 0 && (
                    <div className="mb-5">
                      <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-slate-400 mb-2">
                        Other brands at this store
                      </p>
                      <div className="flex flex-col gap-2">
                        {otherBrandResults.map((r) => (
                          <div
                            key={r.id ?? r.deal_id}
                            className="rounded-xl transition-all"
                            style={{
                              border: selectedResult === r ? "2px solid #3b82f6" : "2px solid transparent",
                              background: selectedResult === r ? "#eff6ff" : "transparent",
                              padding: "2px",
                            }}
                          >
                            <ReplacementDealRow
                              deal={deriveDealRow(r)}
                              sourceName={sourceDeal.product_name}
                              sourcePricePerKg={null}
                              emphasisSize={weightEmphasis(sourceDeal.weight_value, sourceDeal.weight_unit, r)}
                              onSelect={() => setSelectedResult(r)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {exactBrandResults.length > 0 && (
                    <div className="mb-5 last:mb-0">
                      <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-slate-400 mb-2">
                        {strict?.requested_brand ? "Matching brand" : "Other options at this store"}
                      </p>
                      <div className="flex flex-col gap-2">
                        {exactBrandResults.map((r) => (
                          <div
                            key={r.id ?? r.deal_id}
                            className="rounded-xl transition-all"
                            style={{
                              border: selectedResult === r ? "2px solid #3b82f6" : "2px solid transparent",
                              background: selectedResult === r ? "#eff6ff" : "transparent",
                              padding: "2px",
                            }}
                          >
                            <ReplacementDealRow
                              deal={deriveDealRow(r)}
                              sourceName={sourceDeal.product_name}
                              sourcePricePerKg={null}
                              emphasisSize={weightEmphasis(sourceDeal.weight_value, sourceDeal.weight_unit, r)}
                              onSelect={() => setSelectedResult(r)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedResult && onConfirm && (() => {
                    const sel = deriveDealRow(selectedResult);
                    // extraResults have packs_needed=1; derive actual count from source weight
                    const srcG = sourceDeal.weight_value && sourceDeal.weight_unit
                      ? toGrams(sourceDeal.weight_value, sourceDeal.weight_unit) : null;
                    const repG = sel.weight_value && sel.weight_unit
                      ? toGrams(sel.weight_value, sel.weight_unit) : null;
                    const computedPacks = (srcG && repG && repG > 0)
                      ? Math.ceil(srcG / repG) : sel.packs_needed;
                    const packs = computedPacks || 1;
                    const totalPrice = packs !== sel.packs_needed
                      ? Number((packs * (selectedResult.sale_price || 0)).toFixed(2))
                      : sel.effective_price;
                    const totalWeightRaw = packs > 1 && sel.weight_value && sel.weight_unit
                      ? `${packs}×${sel.weight_raw}`
                      : sel.weight_raw;
                    return (
                      <div className="sticky bottom-0 bg-white pt-3 pb-1 mt-2" style={{ borderTop: "2px solid #e0f2fe" }}>
                        <button
                          type="button"
                          onClick={() => { onConfirm({ ...selectedResult, packs_needed: packs, effective_price: totalPrice }); onClose(); }}
                          className="w-full rounded-xl text-white transition-colors flex flex-col items-center justify-center"
                          style={{ background: "#3b82f6", minHeight: packs > 1 ? 52 : 44, padding: "8px 16px" }}
                        >
                          <span className="text-[14px] font-bold leading-tight">Confirm replacement</span>
                          {packs > 1 && (
                            <span className="text-[11px] font-medium mt-0.5" style={{ opacity: 0.88 }}>
                              {packs}× {sel.product_name} · €{Number(totalPrice).toFixed(2)} total
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })()}
                </>
              )}
            </>
          ) : (
            <>
              {!tiers?.length ? (
                <p className="text-center text-slate-400 text-[13px] py-6">No alternatives found at this store.</p>
              ) : (
                tiers.filter((t) => t.type !== "same_category").map((tier) => (
                  <div key={tier.type} className="mb-5 last:mb-0">
                    <button
                      type="button"
                      className="flex items-center gap-1 mb-2 w-full text-left cursor-default"
                    >
                      <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-slate-400">
                        {TIER_LABELS[tier.type] ?? tier.type}
                      </p>
                    </button>
                    <div className="flex flex-col gap-2">
                      {tier.deals.map((d) => (
                        <ReplacementDealRow
                          key={d.id}
                          deal={d}
                          sourceName={sourceDeal.product_name}
                          sourcePricePerKg={sourceDeal.price_per_kg}
                          emphasisSize={
                            d.weight_value != null && sourceDeal.weight_value != null
                              ? d.weight_value !== sourceDeal.weight_value
                              : d.weight_raw !== sourceDeal.weight_raw
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}

              {/* Admin-only: same product at other stores */}
              {hasOtherStores && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-slate-400 mb-3">
                    Same Product, Other Stores
                  </p>
                  <div className="flex flex-col gap-4">
                    {otherStores.map((store) => (
                      <div key={store.store_id}>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">{store.store_name}</p>
                        <div className="flex flex-col gap-2">
                          {store.deals.map((d) => (
                            <ReplacementDealRow
                              key={d.id}
                              deal={{ ...d, store: { name: store.store_name, url: store.store_url } }}
                              sourceName={sourceDeal.product_name}
                              sourcePricePerKg={sourceDeal.price_per_kg}
                              emphasisSize={
                                d.weight_value != null && sourceDeal.weight_value != null
                                  ? d.weight_value !== sourceDeal.weight_value
                                  : d.weight_raw !== sourceDeal.weight_raw
                              }
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {tiers?.find((t) => t.type === "same_category") && (() => {
                const tier = tiers.find((t) => t.type === "same_category");
                return (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {!categoryExpanded ? (
                      <button
                        type="button"
                        onClick={() => setCategoryExpanded(true)}
                        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors group"
                      >
                        <span className="text-[12px] font-semibold text-slate-400 group-hover:text-slate-500">
                          {tier.deals.length} more from this category
                        </span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-slate-300 group-hover:text-slate-400 transition-colors">
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setCategoryExpanded(false)}
                          className="flex items-center gap-1 mb-2 w-full text-left cursor-pointer"
                        >
                          <p className="text-[10px] font-extrabold uppercase tracking-[1.5px] text-slate-400">
                            {TIER_LABELS[tier.type] ?? tier.type}
                          </p>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-slate-400 rotate-180">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        <div className="flex flex-col gap-2">
                          {tier.deals.map((d) => (
                            <ReplacementDealRow
                              key={d.id}
                              deal={d}
                              sourceName={sourceDeal.product_name}
                              sourcePricePerKg={null}
                              emphasisSize={
                                d.weight_value != null && sourceDeal.weight_value != null
                                  ? d.weight_value !== sourceDeal.weight_value
                                  : d.weight_raw !== sourceDeal.weight_raw
                              }
                            />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ReplacementsModal;
