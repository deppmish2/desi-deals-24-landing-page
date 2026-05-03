import React from "react";

export const CATEGORIES = [
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

function LockIcon({ size = 16, color = "white" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export default function FiltersModal({
  storeNames,
  draft,
  onChange,
  onClear,
  onApply,
  onClose,
  isLoggedIn,
  onSignIn,
  showExtendedFilters = true,
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="8" y1="12" x2="20" y2="12" />
              <line x1="12" y1="18" x2="20" y2="18" />
            </svg>
            <span className="text-[18px] font-extrabold text-[#0f172a]">Filters</span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-6">
          {/* Store */}
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Store</p>
            <div className="flex flex-wrap gap-2">
              {["All stores", ...storeNames].map((name) => {
                const val = name === "All stores" ? "" : name;
                const active = val === "" ? stores.length === 0 : stores.includes(val);
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => {
                      if (val === "") { onChange({ ...draft, stores: [] }); return; }
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
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Category</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              <label className="flex items-center gap-3 cursor-pointer col-span-2" onClick={() => onChange({ ...draft, category: "" })}>
                <span className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${category === "" ? "bg-[#0f172a] border-[#0f172a]" : "border-slate-300 bg-white"}`}>
                  {category === "" && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </span>
                <span className="text-[14px] text-[#0f172a] font-medium">All categories</span>
              </label>
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-3 cursor-pointer" onClick={() => onChange({ ...draft, category: category === cat ? "" : cat })}>
                  <span className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors shrink-0 ${category === cat ? "bg-[#0f172a] border-[#0f172a]" : "border-slate-300 bg-white"}`}>
                    {category === cat && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
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
          {showExtendedFilters && (
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
          )}

          {/* Price Range */}
          {showExtendedFilters && (
          <div>
            <p className="text-[11px] font-extrabold tracking-[1.5px] uppercase text-slate-400 mb-3">Price Range (€)</p>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-[#0f172a] transition-colors">
                <span className="text-slate-400 text-[14px]">€</span>
                <input type="number" min="0" placeholder="Min" value={draft.priceMin} onChange={(e) => onChange({ ...draft, priceMin: e.target.value })} className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0" />
              </div>
              <span className="text-slate-300 text-[18px]">—</span>
              <div className="flex-1 flex items-center gap-2 border-2 border-slate-200 rounded-xl px-3 py-2.5 focus-within:border-[#0f172a] transition-colors">
                <span className="text-slate-400 text-[14px]">€</span>
                <input type="number" min="0" placeholder="Max" value={draft.priceMax} onChange={(e) => onChange({ ...draft, priceMax: e.target.value })} className="flex-1 outline-none text-[14px] text-[#0f172a] bg-transparent w-0" />
              </div>
            </div>
            <input
              type="range" min="0" max="200"
              value={draft.priceMax || 200}
              onChange={(e) => onChange({ ...draft, priceMax: e.target.value === "200" ? "" : e.target.value })}
              className="w-full accent-[#0f172a] h-1 cursor-pointer"
            />
          </div>
          )}

          {/* Toggles */}
          {showExtendedFilters && (
          <div className="flex flex-col gap-4">
            {[{ key: "hideExpired", label: "Hide expired products", sub: "Remove products past best before date" }].map(({ key, label, sub }) => (
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
          )}

          {/* Lock card for non-logged-in */}
          {!isLoggedIn && (
            <div className="rounded-xl overflow-hidden" style={{ background: "#16a34a" }}>
              <div className="px-5 py-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
                  <LockIcon size={20} />
                </div>
                <div>
                  <p className="text-[15px] font-extrabold text-white">Filter by store and category</p>
                  <p className="text-[13px] mt-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>Sign in to narrow down deals exactly how you want.</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button type="button" onClick={onClear} className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-[14px] font-bold text-[#0f172a] hover:bg-slate-50 transition-colors">
            Clear All
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="flex-[2] py-3 rounded-xl text-white text-[14px] font-bold transition-colors flex items-center justify-center gap-2 bg-[#16a34a] hover:bg-[#15803d]"
          >
            {!isLoggedIn && <LockIcon size={15} />}
            Apply Filters
          </button>
        </div>
      </div>
    </div>
  );
}
