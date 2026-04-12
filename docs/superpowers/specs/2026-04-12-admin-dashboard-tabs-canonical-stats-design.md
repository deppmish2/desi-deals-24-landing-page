# Admin Dashboard — 3 Tabs + Canonical Stats

**Date:** 2026-04-12  
**Status:** Approved for implementation

---

## Problem

The admin dashboard is a single long scroll mixing crawl data, user data, and canonical health. There is no visibility into canonical mapping quality — specifically, which active deals are unmapped (no canonical match) and therefore cannot benefit from Real Savings Layer 1. Brand detection in the canonical decomposer is broken: it takes the first token of any canonical name as the brand, causing product words like "gulab" or "red" to be misidentified as brands, producing false slot matches.

---

## Solution Overview

Three changes in one spec:

1. **Known brands file** — `crawler/utils/known-brands.js` — a whitelist of recognised brand names and aliases. The decomposer validates against this list instead of blindly using the first token.
2. **Decomposer + auto-mapper hardening** — brand_slots = null when brand not recognised; legacy substring fallback removed from auto-mapper entirely.
3. **Admin dashboard restructure** — 3 tabs (Crawl Stats, User Stats, Canonical Stats); Canonical Stats tab exposes mapping health and a full list of unmapped products with store links.

---

## 1. Known Brands File

**File:** `crawler/utils/known-brands.js`

Exports a single array of brand objects. Each entry has a canonical display name and an array of spelling variants (all lowercase, used for matching):

```js
module.exports = [
  { name: "Aachi",       aliases: ["aachi"] },
  { name: "Aashirvaad",  aliases: ["aashirvaad", "aashirwad", "ashirwad"] },
  { name: "Bambino",     aliases: ["bambino"] },
  { name: "Daawat",      aliases: ["daawat", "dawat"] },
  { name: "Gits",        aliases: ["gits"] },
  { name: "Haldiram's",  aliases: ["haldiram", "haldirams"] },
  { name: "Heer",        aliases: ["heer"] },
  { name: "ITC",         aliases: ["itc"] },
  { name: "Knorr",       aliases: ["knorr"] },
  { name: "LKK",         aliases: ["lkk", "lee kum kee"] },
  { name: "Maggi",       aliases: ["maggi"] },
  { name: "MTR",         aliases: ["mtr"] },
  { name: "Nanak",       aliases: ["nanak"] },
  { name: "Priya",       aliases: ["priya"] },
  { name: "Shan",        aliases: ["shan", "shan foods"] },
  { name: "Swad",        aliases: ["swad"] },
  // … add more as needed
];
```

**Conventions:**
- One entry per brand, not per product.
- `aliases` contains all lowercase normalised variants the brand name appears as in product titles.
- Maintained manually; deploy + re-run migration to take effect.

---

## 2. Decomposer Update

**File:** `crawler/utils/canonical-decomposer.js`

**Change:** Before assigning `brand_slots`, check the first token against the known brands list.

```
decomposeCanonical(canonicalName, commonAliases):
  1. Extract and normalise weight → weightValue, weightUnit
  2. Strip weight, parentheticals, dashes from name
  3. Lowercase and tokenise remaining name
  4. firstToken = tokens[0]
  5. Look up firstToken in known-brands (match against any alias):
       - FOUND  → brand_slots = [[name, ...aliases]]  (all variants as one slot group)
       - NOT FOUND → brand_slots = null
  6. base_product_slots = [[token] for each remaining token]
  7. typeSlots = []  (still populated by seeder only)
  8. productGroupId = remaining tokens joined by "-"
```

When `brand_slots = null`, the canonical exists in the DB but the auto-mapper cannot use it for slot-based matching — the deal stays unmapped until the brand is added to `known-brands.js` and migration is re-run.

---

## 3. Auto-mapper Hardening

**File:** `crawler/utils/auto-mapper.js`

**Remove** the legacy brand-anchored substring fallback from `autoMapDeals()`. The function currently falls back to alias substring matching when `matchesCanonical()` returns `null` (no slots). This path is removed.

New behaviour:
- `matchesCanonical()` returns `null` (no slots) → skip this canonical, try next.
- `matchesCanonical()` returns `false` (slots don't match) → skip.
- `matchesCanonical()` returns `true` → map.
- If no canonical matches → deal stays unmapped. No silent fallback.

The `matchesCanonical` function itself is unchanged.

---

## 4. Backend — New API Endpoint

**File:** `server/routes/admin-dashboard.js`

New route: `GET /admin-dashboard/canonical-stats`  
Protected by `requireAdminAuth` (same as existing routes).  
Loaded lazily — only called when the Canonical Stats tab is clicked.

**Response shape:**
```json
{
  "total_canonicals": 1575,
  "mapped_deals": 1586,
  "total_active_deals": 2850,
  "unbranded_canonicals": 47,
  "unmapped_products": [
    {
      "id": "uuid",
      "product_name": "LKK Sesame Chilli Sauce - 135g",
      "store_name": "Global Food Hub",
      "store_id": "globalfoodhub",
      "product_url": "https://globalfoodhub.com/products/lkk-sesame-chilli-sauce",
      "product_category": "Sauces & Pastes",
      "sale_price": 0.99,
      "currency": "EUR"
    }
  ]
}
```

**Queries:**
- `total_canonicals` — `SELECT COUNT(*) FROM canonical_products`
- `mapped_deals` — `SELECT COUNT(DISTINCT deal_id) FROM deal_mappings`
- `total_active_deals` — `SELECT COUNT(*) FROM deals WHERE is_active = 1`
- `unbranded_canonicals` — `SELECT COUNT(*) FROM canonical_products WHERE brand_slots IS NULL`
- `unmapped_products` — active deals with no row in `deal_mappings`, joined to `stores` for store name, ordered by `store_id, product_name`

---

## 5. Frontend

### 5a. API utility

**File:** `client/src/utils/api.js`

Add:
```js
export function fetchCanonicalStats() {
  return authRequest("/admin-dashboard/canonical-stats");
}
```

### 5b. AdminPage restructure

**File:** `client/src/landing/AdminPage.jsx`

**Tab state:** `const [tab, setTab] = useState("crawl")` — three values: `"crawl"`, `"user"`, `"canonical"`.

**Tab bar** — rendered below the existing top bar, above content:
```
[ Crawl Stats ]  [ User Stats ]  [ Canonical Stats ]
```
Active tab: green underline + green text. Inactive: slate text, no underline.

**Crawl Stats tab** — existing content:
- Latest crawl card (date, status, stores ok/failed, deals found)
- Store crawl report
- Category totals + recent crawl runs

**User Stats tab** — existing content:
- KPI cards (total users, new users 30d, searches today, unique searchers 30d)
- Signups and searches bar charts
- Top search terms table
- Recent searches list
- All users table

**Canonical Stats tab** — new, lazy-loaded:
- On first click: calls `fetchCanonicalStats()`, shows loading state
- Once loaded, renders:

  **KPI row (4 cards):**
  - Total canonicals
  - Deals mapped (count + "X% of N active")
  - Unbranded canonicals (amber, count)
  - Unmapped products (red, count)

  **Mapping health bar:**
  - Slot matched (green bar, % of active deals)
  - Unmapped (red bar, % of active deals)

  **Known brands:**
  - Section label + pill for each brand from `known-brands.js`
  - Note: "Defined in `crawler/utils/known-brands.js` — add brands and redeploy to expand coverage"

  **Unmapped products table:**
  - Columns: Product name | Store | Category | Price | Link
  - Each row: deal product name, store name, category, formatted sale price, "View ↗" anchor linking to `product_url` (opens in new tab)
  - Sorted by store then product name
  - If empty: green success state — "All active products are mapped"

---

## 6. Migration Sequence (post-deploy)

After deploying the code changes:

```bash
# 1. Re-slot all canonicals with brand-aware decomposer
node --env-file=.env.local scripts/migrate-canonical-slots.js

# 2. Reset mappings and re-map with slot-only auto-mapper
node --env-file=.env.local scripts/run-automapper-all-deals.js --reset
```

This will produce a smaller but accurate set of deal_mappings. Unmapped deals appear in the Canonical Stats tab as actionable items.

---

## 7. What Does NOT Change

- `deal_mappings` schema — unchanged
- `canonical_products` schema — unchanged (brand_slots column already exists)
- `is_priority` / Pass 1 fetching — unchanged
- Real Savings computation — unchanged
- All other admin dashboard API endpoints — unchanged
- Existing tests — no breaking changes to public interfaces

---

## 8. Files Changed

| File | Change |
|---|---|
| `crawler/utils/known-brands.js` | New — brand whitelist |
| `crawler/utils/canonical-decomposer.js` | Update — brand validation against known-brands |
| `crawler/utils/auto-mapper.js` | Update — remove legacy substring fallback |
| `server/routes/admin-dashboard.js` | Update — add `/canonical-stats` route |
| `client/src/utils/api.js` | Update — add `fetchCanonicalStats()` |
| `client/src/landing/AdminPage.jsx` | Update — 3-tab layout, Canonical Stats tab |
