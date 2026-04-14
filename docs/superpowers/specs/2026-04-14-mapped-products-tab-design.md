# Mapped Products Tab — Design Spec

**Date:** 2026-04-14  
**Status:** Approved

## Overview

Add a "Mapped" sub-tab inside the Canonical Stats admin section, next to the existing "Unmapped" sub-tab. Shows all canonical products that have at least one deal mapping, with expandable rows revealing per-store product details.

---

## API

### `GET /api/v1/admin-dashboard/mapped-products`

Protected by `requireAdminAuth`.

**Response:**
```json
[
  {
    "canonical_id": "aachi-chettinadu-biryani-kit",
    "canonical_name": "Aachi Chettinadu Biryani Kit 360g",
    "has_active_deal": true,
    "store_count": 3,
    "deals": [
      {
        "store_name": "Jamoona",
        "product_name": "AACHI CHETTINADU BASMATI BIRYANI KIT – 360g",
        "product_url": "https://...",
        "is_active": 1
      }
    ]
  }
]
```

**Implementation:**
- Single SQL query joining `canonical_products → deal_mappings → deals → stores`
- `MAX(d.is_active)` per canonical → `has_active_deal` boolean
- `COUNT(DISTINCT d.store_id)` → `store_count`
- Flat rows assembled into nested structure in JS after query (group by `canonical_id`)
- Only canonicals with at least one deal mapping are returned
- No pagination — full list returned (1,500 rows max in current DB)
- Lives in `server/routes/admin-dashboard.js`

---

## Frontend

### Changes to `client/src/landing/AdminPage.jsx`

**New state:**
```js
const [mappedSubTab, setMappedSubTab] = useState("unmapped"); // "unmapped" | "mapped"
const [mappedProducts, setMappedProducts] = useState(null);
const [mappedLoading, setMappedLoading] = useState(false);
const [mappedError, setMappedError] = useState(null);
```

**Sub-tab switcher** — replaces the current "Unmapped products" heading inside `CanonicalStatsTab`:
```
[ Unmapped  2428 ]  [ Mapped  1493 ]
```
- Styled to match existing UI: small caps, green active indicator, count badge
- "Unmapped" is default active tab (no behaviour change on load)
- Switching to "Mapped" triggers lazy-load of `/mapped-products` if not yet fetched

**Mapped tab content:**
- Search input — client-side filter on `canonical_name` (case-insensitive `includes`)
- Row count label: "Showing N of M"
- Table columns: Canonical name · Status badge · Stores · Expand arrow
  - Status: green "Active" badge if `has_active_deal`, grey "Inactive" otherwise
  - Stores: "{N} store" / "{N} stores"
  - Expand arrow: `▶` collapsed, `▼` expanded; click anywhere on row to toggle
- Expanded row: inner table with columns Store · Product name on store · View ↗
  - "View ↗" links to `deal.product_url`, opens in new tab

**New API util** — `fetchMappedProducts()` in `client/src/utils/api.js`:
```js
export function fetchMappedProducts() {
  return apiFetch("/api/v1/admin-dashboard/mapped-products");
}
```

---

## Behaviour

| Scenario | Behaviour |
|---|---|
| First switch to Mapped tab | Fetch `/mapped-products`, show spinner |
| Fetch error | Show inline error message with retry |
| Empty result | "No mapped products yet" message |
| Search input | Client-side filter, updates row count label |
| Row click | Toggle expand; only one row can be open at a time? No — multiple rows can stay open |
| Switching back to Unmapped | No re-fetch; state preserved |

---

## Out of Scope

- Pagination (not needed at current data scale)
- Sorting (name A–Z is sufficient for now)
- Editing/unlinking a canonical from this view
- Per-deal price display in expanded rows
