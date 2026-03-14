# UX Session Fixes — Spec

This document describes all frontend (and one backend) changes made during the UX fix session. Use this to reapply changes if files get reverted or conflicts reintroduce old code.

---

## 1. FiltersModal — Toggle Selected State Fix

**File:** `client/src/components/FiltersModal.jsx`

The toggle thumb span must have `left-0` so `translateX` works from a known baseline. Use inline `transition` instead of the Tailwind `transition-transform` class.

```jsx
function Toggle({ active, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="relative shrink-0 w-11 h-6 rounded-full transition-colors"
      style={{ backgroundColor: active ? "#16a34a" : "#e2e8f0" }}
    >
      <span
        className="absolute top-0.5 left-0 w-5 h-5 bg-white rounded-full shadow-sm"
        style={{
          transform: active ? "translateX(22px)" : "translateX(2px)",
          transition: "transform 0.15s ease",
          border: "1px solid #d1d5db",
        }}
      />
    </button>
  );
}
```

---

## 2. FiltersModal — Dual-Handle Price Range Slider

**File:** `client/src/components/FiltersModal.jsx`

Replace the static slider track with a `PriceRangeSlider` component. Add `min_price` to the draft state. Place this constant and component near the top of the file (after `DISCOUNT_PRESETS`).

```jsx
const PRICE_MAX = 100;

function PriceRangeSlider({ minPrice, maxPrice, onMinChange, onMaxChange }) {
  const min = Number(minPrice) || 0;
  const max = Number(maxPrice) || PRICE_MAX;
  const minPct = (min / PRICE_MAX) * 100;
  const maxPct = (max / PRICE_MAX) * 100;

  return (
    <div className="relative" style={{ height: 32, marginTop: 4 }}>
      <style>{`
        .dd24-range { -webkit-appearance: none; appearance: none; background: transparent; }
        .dd24-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px; height: 20px;
          border-radius: 50%;
          background: white;
          border: 2px solid #141414;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          position: relative; z-index: 2;
        }
        .dd24-range::-moz-range-thumb {
          width: 20px; height: 20px;
          border-radius: 50%;
          background: white;
          border: 2px solid #141414;
          cursor: pointer;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
        }
        .dd24-range::-webkit-slider-runnable-track { background: transparent; height: 6px; }
        .dd24-range::-moz-range-track { background: transparent; height: 6px; }
        .dd24-range:focus { outline: none; }
      `}</style>
      {/* Track background */}
      <div
        className="absolute left-0 right-0 h-1.5 bg-[#e2e8f0] rounded-full"
        style={{ top: "50%", transform: "translateY(-50%)" }}
      />
      {/* Active portion */}
      <div
        className="absolute h-1.5 bg-[#141414] rounded-full pointer-events-none"
        style={{
          top: "50%",
          transform: "translateY(-50%)",
          left: `${minPct}%`,
          right: `${100 - maxPct}%`,
        }}
      />
      {/* Min input */}
      <input
        type="range"
        min={0}
        max={PRICE_MAX}
        value={min}
        onChange={(e) => {
          const v = Math.min(Number(e.target.value), max - 1);
          onMinChange(v === 0 ? "" : String(v));
        }}
        className="dd24-range absolute inset-0 w-full h-full"
        style={{ zIndex: min >= max - 5 ? 5 : 3 }}
      />
      {/* Max input */}
      <input
        type="range"
        min={0}
        max={PRICE_MAX}
        value={max}
        onChange={(e) => {
          const v = Math.max(Number(e.target.value), min + 1);
          onMaxChange(v === PRICE_MAX ? "" : String(v));
        }}
        className="dd24-range absolute inset-0 w-full h-full"
        style={{ zIndex: 4 }}
      />
    </div>
  );
}
```

**Draft state** must include `min_price`:

```js
const [draft, setDraft] = useState({
  store: filters.store || "",
  category: filters.category || "",
  min_discount: filters.min_discount || "",
  min_price: filters.min_price || "",
  max_price: filters.max_price || "",
  availability: filters.availability || "in_stock",
  near_expiry: filters.near_expiry || "",
});
```

**clearAll** must reset `min_price`:

```js
function clearAll() {
  setDraft({
    store: "",
    category: "",
    min_discount: "",
    min_price: "",
    max_price: "",
    availability: "in_stock",
    near_expiry: "",
  });
}
```

**Price Range section** replaces the old static slider:

```jsx
{
  /* Price Range */
}
<div className="flex flex-col gap-3">
  <h3 className="text-[14px] font-bold text-[#64748b] uppercase tracking-[0.7px]">
    Price Range (€)
  </h3>
  <div className="flex gap-4 items-center">
    <div className="relative flex-1">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#94a3b8]">
        €
      </span>
      <input
        type="number"
        placeholder="Min"
        value={draft.min_price}
        onChange={(e) => set({ min_price: e.target.value })}
        className="w-full border border-[#e2e8f0] rounded-[8px] pl-8 pr-3 py-[9px] text-[14px] text-[#0f172a] focus:outline-none focus:border-[#141414] placeholder:text-[#6b7280]"
      />
    </div>
    <div className="w-4 h-px bg-[#cbd5e1] shrink-0" />
    <div className="relative flex-1">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-[#94a3b8]">
        €
      </span>
      <input
        type="number"
        placeholder="Max"
        value={draft.max_price}
        onChange={(e) => set({ max_price: e.target.value })}
        className="w-full border border-[#e2e8f0] rounded-[8px] pl-8 pr-3 py-[9px] text-[14px] text-[#0f172a] focus:outline-none focus:border-[#141414] placeholder:text-[#6b7280]"
      />
    </div>
  </div>
  <PriceRangeSlider
    minPrice={draft.min_price}
    maxPrice={draft.max_price}
    onMinChange={(v) => set({ min_price: v })}
    onMaxChange={(v) => set({ max_price: v })}
  />
</div>;
```

---

## 3. FiltersModal — Rename "Expiring Soon" to "Hide expired products"

**File:** `client/src/components/FiltersModal.jsx`

In the Options section, change:

```jsx
// OLD
<p className="text-[14px] font-bold text-[#334155]">Expiring Soon</p>
<p className="hidden lg:block text-[12px] text-[#64748b] mt-0.5">Show products expiring in the next 30 days</p>

// NEW
<p className="text-[14px] font-bold text-[#334155]">Hide expired products</p>
<p className="hidden lg:block text-[12px] text-[#64748b] mt-0.5">Remove products past their best before date</p>
```

---

## 4. DealCard — Align Badge Vertical Positions

**File:** `client/src/components/DealCard.jsx` — `DesktopDealCard` component

Both discount (top-left) and best-before (top-right) badges must use the same `top` value:

```jsx
{/* Discount badge — was top-5, change to top-[15px] */}
<span className="absolute top-[15px] left-5 text-white font-extrabold rounded-[16px] px-3 py-1.5" ...>

{/* Best before badge — keep top-[15px] */}
<span className="absolute top-[15px] right-5 text-white font-extrabold rounded-[16px] px-3 py-[4.5px]" ...>
```

---

## 5. DealsPage — Desktop Filter Chips for All Active Filters

**File:** `client/src/pages/DealsPage.jsx`

In the desktop filter bar's "Active filter chips" section, only show chips when a filter is active (conditional rendering). Add chips for **store**, **category**, and **near_expiry** alongside the existing ones. Each chip shows an ✕ icon and clears that filter on click.

```jsx
{
  /* Discount chip — only show when active */
}
{
  filters.min_discount && (
    <button
      onClick={() => updateFilters({ min_discount: "", page: 1 })}
      className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border"
      style={{
        backgroundColor: "rgba(22,163,74,0.1)",
        borderColor: "rgba(22,163,74,0.2)",
        color: "#16a34a",
      }}
    >
      {filters.min_discount}%+ Discount
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path
          d="M1 1l6 6M7 1L1 7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

{
  /* Max price chip — only show when active */
}
{
  filters.max_price && (
    <button
      onClick={() => updateFilters({ max_price: "", page: 1 })}
      className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border"
      style={{
        backgroundColor: "rgba(22,163,74,0.1)",
        borderColor: "rgba(22,163,74,0.2)",
        color: "#16a34a",
      }}
    >
      Under €{filters.max_price}
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path
          d="M1 1l6 6M7 1L1 7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

{
  /* Store chip */
}
{
  filters.store && (
    <button
      onClick={() => updateFilters({ store: "", page: 1 })}
      className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border"
      style={{
        backgroundColor: "rgba(22,163,74,0.1)",
        borderColor: "rgba(22,163,74,0.2)",
        color: "#16a34a",
      }}
    >
      {(() => {
        const ids = filters.store.split(",").filter(Boolean);
        if (ids.length === 1) {
          const s = stores.find((st) => String(st.id) === ids[0]);
          return s ? s.name : "1 Store";
        }
        return `${ids.length} Stores`;
      })()}
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path
          d="M1 1l6 6M7 1L1 7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

{
  /* Category chip */
}
{
  filters.category && (
    <button
      onClick={() => updateFilters({ category: "", page: 1 })}
      className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border"
      style={{
        backgroundColor: "rgba(22,163,74,0.1)",
        borderColor: "rgba(22,163,74,0.2)",
        color: "#16a34a",
      }}
    >
      {(() => {
        const cats = filters.category.split(",").filter(Boolean);
        return cats.length === 1 ? cats[0] : `${cats.length} Categories`;
      })()}
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path
          d="M1 1l6 6M7 1L1 7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

{
  /* Near expiry chip */
}
{
  filters.near_expiry === "1" && (
    <button
      onClick={() => updateFilters({ near_expiry: "", page: 1 })}
      className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border"
      style={{
        backgroundColor: "rgba(22,163,74,0.1)",
        borderColor: "rgba(22,163,74,0.2)",
        color: "#16a34a",
      }}
    >
      Hide Expired
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
        <path
          d="M1 1l6 6M7 1L1 7"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
```

---

## 6. DealsPage + Mobile — Sort Options

**File:** `client/src/pages/DealsPage.jsx`

Both the desktop sort `<select>` and the mobile sort chip `<select>` should use these 3 options only:

```jsx
<option value="discount_desc">Max Discount</option>
<option value="price_asc">Lowest Price</option>
<option value="price_per_kg_asc">Lowest /kg</option>
```

---

## 7. Backend — Add price_per_kg_asc Sort

**File:** `server/routes/deals.js`

In the `sortMap` object:

```js
const sortMap = {
  discount_desc: "COALESCE(d.discount_percent, 0) DESC",
  price_asc: "d.sale_price ASC",
  price_per_kg_asc: "COALESCE(d.price_per_kg, 99999) ASC",
  newest: "d.crawl_timestamp DESC",
};
```

---

## 8. RegisterPage — Desktop + Mobile Figma Design

**File:** `client/src/pages/RegisterPage.jsx`

Full rewrite with:

- Desktop: blur-blob background, white card max-w-[480px], email + password + confirm password + postcode + remember me checkbox + "Create Account" button
- Mobile: back arrow, "Create Account" heading, email with EnvelopeIcon, password + eye toggle, confirm + eye toggle, postcode, remember me, green CTA with shadow
- Validates passwords match before submitting
- Calls `registerUser({ email, password, postcode })`

Key inline SVG components needed: `EyeIcon({ open })`, `EnvelopeIcon()`

---

## 9. ShippingAddressesPage — API-Connected Version

**File:** `client/src/pages/ShippingAddressesPage.jsx`

Uses `fetchMe` from `../utils/api` to load the logged-in user's postcode/city. Redirects to `/login` if unauthenticated. Shows a single `AddressCard` with the user's address. "Add/Update Delivery Address" button navigates to `/addresses/new`.

Key imports:

```js
import { fetchMe } from "../utils/api";
```

---

## 10. EditAddressPage — API-Connected Version

**File:** `client/src/pages/EditAddressPage.jsx`

Uses `fetchMe` + `updateMe` from `../utils/api`. Pre-fills postcode and city from the user profile. Saves via `updateMe({ postcode, city })`. Mobile-only layout with sticky header and fixed footer save button.

Key imports:

```js
import { fetchMe, updateMe } from "../utils/api";
```
