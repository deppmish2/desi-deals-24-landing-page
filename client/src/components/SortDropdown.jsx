import React, { useState, useRef, useEffect } from "react";

export const SORT_OPTIONS = [
  { value: "",             label: "Random order",           compactLabel: "Random order" },
  { value: "real_savings", label: "Sort: Real Savings",     compactLabel: "Real Savings" },
  { value: "discount",     label: "Sort: Max Discount",     compactLabel: "Max Discount" },
  { value: "price_per_kg", label: "Sort: Lowest /Kg Price", compactLabel: "Lowest Price / Kg" },
  { value: "price",        label: "Sort: Lowest Price",     compactLabel: "Lowest Price" },
];

function ChevronDownIcon({ size = 16, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function SortDropdown({ value, onChange, toolbar = false }) {
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

  function handleSelect(nextValue) {
    onChange(nextValue);
    setOpen(false);
  }

  return (
    <div className="relative w-auto max-w-full" ref={ref}>
      {toolbar ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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
          onClick={() => setOpen((v) => !v)}
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
                  isSelected ? "bg-[#edf7ef] text-[#0f172a]" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {isSelected ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#17874a" strokeWidth="2.5" strokeLinecap="round">
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
