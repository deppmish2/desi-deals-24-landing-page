import { formatPrice } from "../utils/formatters";
import React, { useState, useEffect } from "react";

const DISCOUNT_PRESETS = [
  { label: "10%+", value: 10 },
  { label: "25%+", value: 25 },
  { label: "50%+", value: 50 },
  { label: "75%+", value: 75 },
];

const MAX_PRICE = 100;

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex shrink-0 rounded-full transition-colors duration-200 focus:outline-none"
      style={{
        width: 44,
        height: 24,
        backgroundColor: checked ? "#16a34a" : "#e2e8f0",
      }}
    >
      <span
        className="inline-block bg-white rounded-full transition-transform duration-200"
        style={{
          width: 20,
          height: 20,
          margin: 2,
          transform: checked ? "translateX(20px)" : "translateX(0px)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function PriceRangeSlider({
  min,
  max,
  minVal,
  maxVal,
  onMinChange,
  onMaxChange,
}) {
  const minPercent = ((minVal - min) / (max - min)) * 100;
  const maxPercent = ((maxVal - min) / (max - min)) * 100;

  return (
    <div className="relative" style={{ height: 20, marginTop: 8 }}>
      {/* Track */}
      <div
        className="absolute w-full rounded-full"
        style={{
          top: "50%",
          transform: "translateY(-50%)",
          height: 4,
          backgroundColor: "#e2e8f0",
        }}
      >
        <div
          className="absolute h-full rounded-full"
          style={{
            left: `${minPercent}%`,
            right: `${100 - maxPercent}%`,
            backgroundColor: "#141414",
          }}
        />
      </div>
      {/* Min range input (transparent, on top) */}
      <input
        type="range"
        min={min}
        max={max}
        value={minVal}
        onChange={(e) =>
          onMinChange(Math.min(Number(e.target.value), maxVal - 1))
        }
        className="absolute w-full opacity-0 cursor-pointer"
        style={{ top: 0, height: "100%", zIndex: minVal >= maxVal - 5 ? 5 : 3 }}
      />
      {/* Max range input (transparent, on top) */}
      <input
        type="range"
        min={min}
        max={max}
        value={maxVal}
        onChange={(e) =>
          onMaxChange(Math.max(Number(e.target.value), minVal + 1))
        }
        className="absolute w-full opacity-0 cursor-pointer"
        style={{ top: 0, height: "100%", zIndex: 4 }}
      />
      {/* Visual min thumb */}
      <div
        className="absolute bg-white rounded-full border-2 border-[#141414] pointer-events-none"
        style={{
          width: 16,
          height: 16,
          top: "50%",
          left: `${minPercent}%`,
          transform: "translateX(-50%) translateY(-50%)",
          boxShadow: "0px 2px 4px rgba(0,0,0,0.1)",
          zIndex: 2,
        }}
      />
      {/* Visual max thumb */}
      <div
        className="absolute bg-white rounded-full border-2 border-[#141414] pointer-events-none"
        style={{
          width: 16,
          height: 16,
          top: "50%",
          left: `${maxPercent}%`,
          transform: "translateX(-50%) translateY(-50%)",
          boxShadow: "0px 2px 4px rgba(0,0,0,0.1)",
          zIndex: 2,
        }}
      />
    </div>
  );
}

export default function FilterPanel({
  filters,
  onChange,
  onClose,
  stores,
  categories,
}) {
  const [localMinPrice, setLocalMinPrice] = useState(
    Number(filters.min_price) || 0,
  );
  const [localMaxPrice, setLocalMaxPrice] = useState(
    Number(filters.max_price) || MAX_PRICE,
  );

  useEffect(() => {
    setLocalMinPrice(Number(filters.min_price) || 0);
    setLocalMaxPrice(Number(filters.max_price) || MAX_PRICE);
  }, [filters.min_price, filters.max_price]);

  function commitPriceRange(minP, maxP) {
    onChange({
      min_price: minP > 0 ? String(minP) : "",
      max_price: maxP < MAX_PRICE ? String(maxP) : "",
      page: 1,
    });
  }

  function toggle(field, value) {
    const current = (filters[field] || "").split(",").filter(Boolean);
    const idx = current.indexOf(String(value));
    if (idx === -1) current.push(String(value));
    else current.splice(idx, 1);
    onChange({ [field]: current.join(","), page: 1 });
  }

  function isChecked(field, value) {
    return (filters[field] || "").split(",").includes(String(value));
  }

  function handleClearAll() {
    setLocalMinPrice(0);
    setLocalMaxPrice(MAX_PRICE);
    onChange({
      store: "",
      category: "",
      min_discount: "",
      min_price: "",
      max_price: "",
      availability: "in_stock",
      near_expiry: "",
      hide_expired: "",
      page: 1,
    });
  }

  return (
    <div
      className="flex flex-col bg-white rounded-[12px] overflow-hidden w-full"
      style={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        maxWidth: 520,
        maxHeight: "90vh",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#f1f5f9] shrink-0">
        <div className="flex items-center gap-3">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M3 5h14M6 10h8M9 15h2"
              stroke="#0f172a"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <h2
            className="text-[20px] font-bold text-[#141414]"
            style={{ letterSpacing: "-0.5px" }}
          >
            Filters
          </h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-[#f1f5f9] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 1l12 12M13 1L1 13"
                stroke="#475569"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
        {/* Store */}
        {stores?.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-[14px] font-bold text-[#64748b] uppercase tracking-[0.7px]">
              Store
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => onChange({ store: "", page: 1 })}
                className="px-[17px] py-[9px] rounded-full text-[14px] font-medium transition-colors"
                style={
                  !filters.store
                    ? {
                        backgroundColor: "#141414",
                        color: "#fff",
                        border: "1px solid #141414",
                      }
                    : {
                        backgroundColor: "#fff",
                        color: "#475569",
                        border: "1px solid #e2e8f0",
                      }
                }
              >
                All stores
              </button>
              {stores.map((s) => (
                <button
                  key={s.id}
                  onClick={() => toggle("store", s.id)}
                  className="px-[17px] py-[9px] rounded-full text-[14px] font-medium transition-colors"
                  style={
                    isChecked("store", s.id)
                      ? {
                          backgroundColor: "#141414",
                          color: "#fff",
                          border: "1px solid #141414",
                        }
                      : {
                          backgroundColor: "#fff",
                          color: "#475569",
                          border: "1px solid #e2e8f0",
                        }
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category */}
        {categories?.length > 0 && (
          <div className="space-y-4">
            <h3 className="text-[14px] font-bold text-[#64748b] uppercase tracking-[0.7px]">
              Category
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {/* All categories */}
              <label
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => onChange({ category: "", page: 1 })}
              >
                <div
                  className="flex items-center justify-center rounded-[4px] shrink-0 transition-colors"
                  style={{
                    width: 22,
                    height: 22,
                    backgroundColor: !filters.category ? "#141414" : "#fff",
                    border: !filters.category
                      ? "1px solid #141414"
                      : "1px solid #cbd5e1",
                  }}
                >
                  {!filters.category && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="#fff"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </div>
                <span className="text-[14px] text-[#334155]">
                  All categories
                </span>
              </label>
              {categories.map((c) => (
                <label
                  key={c.category}
                  className="flex items-center gap-3 cursor-pointer"
                  onClick={() => toggle("category", c.category)}
                >
                  <div
                    className="flex items-center justify-center rounded-[4px] shrink-0 transition-colors"
                    style={{
                      width: 20,
                      height: 20,
                      backgroundColor: isChecked("category", c.category)
                        ? "#141414"
                        : "#fff",
                      border: isChecked("category", c.category)
                        ? "1px solid #141414"
                        : "1px solid #cbd5e1",
                    }}
                  >
                    {isChecked("category", c.category) && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                      >
                        <path
                          d="M1.5 5l2.5 2.5 4.5-4"
                          stroke="#fff"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  <span className="text-[14px] text-[#334155]">
                    {c.category}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Minimum Discount */}
        <div className="space-y-4">
          <h3 className="text-[14px] font-bold text-[#64748b] uppercase tracking-[0.7px]">
            Minimum Discount
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {DISCOUNT_PRESETS.map((p) => {
              const active = Number(filters.min_discount) === p.value;
              return (
                <button
                  key={p.value}
                  onClick={() =>
                    onChange({ min_discount: active ? "" : p.value, page: 1 })
                  }
                  className="py-[9px] rounded-[8px] text-[14px] font-medium text-center transition-colors"
                  style={
                    active
                      ? {
                          backgroundColor: "rgba(20,20,20,0.05)",
                          border: "1px solid #141414",
                          color: "#141414",
                        }
                      : {
                          backgroundColor: "#fff",
                          border: "1px solid #e2e8f0",
                          color: "#0f172a",
                        }
                  }
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Price Range */}
        <div className="space-y-4">
          <h3 className="text-[14px] font-bold text-[#64748b] uppercase tracking-[0.7px]">
            Price Range (€)
          </h3>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <input
                type="number"
                min={0}
                max={localMaxPrice - 1}
                value={localMinPrice > 0 ? localMinPrice : ""}
                placeholder="Min"
                onChange={(e) => setLocalMinPrice(Number(e.target.value) || 0)}
                onBlur={() => commitPriceRange(localMinPrice, localMaxPrice)}
                className="w-full pl-3 pr-7 py-[9px] border border-[#e2e8f0] rounded-[8px] text-[14px] text-[#0f172a] focus:outline-none focus:border-[#94a3b8]"
              />
              <span
                className="absolute right-3 text-[14px] text-[#94a3b8]"
                style={{ top: "50%", transform: "translateY(-50%)" }}
              >
                €
              </span>
            </div>
            <div className="shrink-0 h-px w-4 bg-[#cbd5e1]" />
            <div className="relative flex-1">
              <input
                type="number"
                min={localMinPrice + 1}
                max={MAX_PRICE}
                value={localMaxPrice < MAX_PRICE ? localMaxPrice : ""}
                placeholder="Max"
                onChange={(e) =>
                  setLocalMaxPrice(Number(e.target.value) || MAX_PRICE)
                }
                onBlur={() => commitPriceRange(localMinPrice, localMaxPrice)}
                className="w-full pl-3 pr-7 py-[9px] border border-[#e2e8f0] rounded-[8px] text-[14px] text-[#0f172a] focus:outline-none focus:border-[#94a3b8]"
              />
              <span
                className="absolute right-3 text-[14px] text-[#94a3b8]"
                style={{ top: "50%", transform: "translateY(-50%)" }}
              >
                €
              </span>
            </div>
          </div>
          <PriceRangeSlider
            min={0}
            max={MAX_PRICE}
            minVal={localMinPrice}
            maxVal={localMaxPrice}
            onMinChange={(v) => {
              setLocalMinPrice(v);
              commitPriceRange(v, localMaxPrice);
            }}
            onMaxChange={(v) => {
              setLocalMaxPrice(v);
              commitPriceRange(localMinPrice, v);
            }}
          />
        </div>

        {/* Toggles */}
        <div className="space-y-5 pt-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-bold text-[#334155]">
                Hide out of stock products
              </p>
              <p className="text-[12px] text-[#64748b] mt-0.5">
                Remove products currently unavailable
              </p>
            </div>
            <Toggle
              checked={filters.availability !== "all"}
              onChange={(v) =>
                onChange({ availability: v ? "in_stock" : "all", page: 1 })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[14px] font-bold text-[#334155]">
                Hide expired products
              </p>
              <p className="text-[12px] text-[#64748b] mt-0.5">
                Remove products past best before date
              </p>
            </div>
            <Toggle
              checked={filters.hide_expired === "1"}
              onChange={(v) =>
                onChange({ hide_expired: v ? "1" : "", page: 1 })
              }
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-4 items-center px-6 py-6 border-t border-[#f1f5f9] shrink-0">
        <button
          onClick={handleClearAll}
          className="px-[17px] py-[13px] border border-[#e2e8f0] rounded-[12px] text-[14px] font-bold text-[#0f172a] shrink-0"
          style={{ minWidth: 120 }}
        >
          Clear All
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="flex-1 py-[12px] rounded-[12px] text-[14px] font-bold text-white text-center"
            style={{ backgroundColor: "#16a34a" }}
          >
            Apply Filters
          </button>
        )}
      </div>
    </div>
  );
}
