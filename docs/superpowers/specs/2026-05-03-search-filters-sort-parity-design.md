# Search / Filters / Sort Parity — CatalogPage & DealsPage

**Date:** 2026-05-03
**Status:** Approved

## Goal

Make the search bar, filters, and sort UI identical in design and behaviour on both the "All Products" (CatalogPage) and "Deals" (DealsPage) pages. Auto-suggest (already on CatalogPage) is added to DealsPage. Both pages share the same extracted components.

## New Shared Components

### `src/components/SearchWithSuggest.jsx`

New component. Combines DealsPage search bar visual (rounded pill, shadow, `SearchIcon`) with CatalogPage's `SuggestDropdown` dropdown logic.

**Props:**
```ts
{
  value: string,                          // controlled input value
  onChange: (val: string) => void,        // input change (debounced by caller)
  onCommit: (val: string) => void,        // user hits Enter or picks "See all"
  onSelectCategory: (cat: string) => void,
  onSelectStore: (storeName: string, storeId: string) => void,
  placeholder?: string,
}
```

**Behaviour:**
- Renders DealsPage-style pill input (rounded-[24px], border, shadow, SearchIcon)
- Opens `SuggestDropdown` when input ≥ 2 chars (extracted from CatalogPage)
- `SuggestDropdown` calls `fetchCatalogSuggest(q)` internally
- Dropdown closes on outside click or selection
- `onCommit` fires on Enter, on product selection, on "See all results"
- `onSelectCategory` fires on category chip click in dropdown
- `onSelectStore` fires on store selection in dropdown

### `src/components/FiltersModal.jsx`

Extracted verbatim from `src/pages/DealsPage.jsx`. No behaviour changes.

**Props:** `storeNames`, `draft`, `onChange`, `onClear`, `onApply`, `onClose`, `isLoggedIn`, `onSignIn`

`draft` shape: `{ stores: string[], category: string }`

### `src/components/SortDropdown.jsx`

Extracted verbatim from `src/pages/DealsPage.jsx`. `SORT_OPTIONS` constant moves here.

**Props:** `value`, `onChange`, `toolbar?: boolean`

**SORT_OPTIONS** (same for both pages):
```js
[
  { value: "",             label: "Random order",          compactLabel: "Random order" },
  { value: "real_savings", label: "Sort: Real Savings",    compactLabel: "Real Savings" },
  { value: "discount",     label: "Sort: Max Discount",    compactLabel: "Max Discount" },
  { value: "price_per_kg", label: "Sort: Lowest /Kg Price",compactLabel: "Lowest Price / Kg" },
  { value: "price",        label: "Sort: Lowest Price",    compactLabel: "Lowest Price" },
]
```

## DealsPage Changes

**File:** `src/pages/DealsPage.jsx`

- Remove `FiltersModal`, `SortDropdown`, `SORT_OPTIONS` definitions; import from components
- Remove inline `SuggestDropdown` and replace both mobile + desktop search `<input>` elements with `<SearchWithSuggest>`
  - `value` / `onChange` → existing `searchInput` / `setSearchInput`
  - `onCommit` → existing commit/debounce logic
  - `onSelectCategory` → sets category filter via existing state
  - `onSelectStore` → sets store filter via existing state
- No other state or behaviour changes

## CatalogPage Changes

**File:** `src/pages/CatalogPage.jsx`

- Remove inline `SuggestDropdown` definition (moves to `SearchWithSuggest`)
- Replace inline search input with `<SearchWithSuggest>`
- Remove scrollable category chips row — category now lives inside `FiltersModal`
- Add filter button (FilterIcon, badge for active filter count) that opens `FiltersModal`
- Add `<SortDropdown>` next to filter button
- URL params: add `store` and `sort` (alongside existing `q`, `category`)
- Load store names lazily on filter open via `fetchDealStores({ limit: 200 })`
- Pass `sort` to `fetchCatalog({ q, category, store, sort, page })`
- Login gate on filter apply (same as DealsPage — show `LoginModal` if not logged in)

## Backend Catalog Sort

**File:** `server/routes/catalog.js`

Add `sort` query param. Map to `ORDER BY`:

| `sort` value | `ORDER BY` clause |
|---|---|
| `""` / default | `cp.sale_price ASC` (existing behaviour) |
| `"price"` | `cp.sale_price ASC` |
| `"price_per_kg"` | `cp.price_per_kg ASC NULLS LAST` |
| `"discount"` | `cp.discount_pct DESC NULLS LAST` |
| `"real_savings"` | `cp.sale_price ASC` (fallback — catalog has no savings reference data) |

Schema columns confirmed available: `sale_price`, `price_per_kg`. `discount_pct` must be verified in `canonical_products` table; if absent, `"discount"` falls back to `sale_price ASC`.

## File Map

| File | Change |
|---|---|
| `src/components/SearchWithSuggest.jsx` | Create |
| `src/components/FiltersModal.jsx` | Create (extracted from DealsPage) |
| `src/components/SortDropdown.jsx` | Create (extracted from DealsPage) |
| `src/pages/DealsPage.jsx` | Remove 3 component definitions; import from components; wire SearchWithSuggest |
| `src/pages/CatalogPage.jsx` | Major refactor — new search/filter/sort UI |
| `server/routes/catalog.js` | Add `sort` param → ORDER BY |

## Out of Scope

- DealsPage filter behaviour (login gate, store/category filters) — unchanged
- `fetchCatalogSuggest` API — unchanged
- CatalogPage pagination — unchanged
- Mobile bottom nav — unchanged

## Testing

- Both `/deals` and all-products catalog search show suggest dropdown on ≥2 chars
- Selecting category from suggest sets category filter on both pages
- Filter modal opens on both pages, shows store + category chips
- Applying sort on catalog changes product order (verify price ascending vs descending)
- Backend `?sort=price_per_kg` returns different ordering than default
- No regressions on DealsPage filter apply / sort
