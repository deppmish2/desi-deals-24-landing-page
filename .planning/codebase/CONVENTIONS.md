# Coding Conventions

**Analysis Date:** 2026-05-04

## Module System

**Backend (server/, crawler/):**
- CommonJS only: `require()` / `module.exports`. No `import`/`export`.
- All files begin with `"use strict";` as the first line.
- `node-fetch` must be v2: `require('node-fetch')`. v3 is ESM-only.

**Frontend (client/src/):**
- ESM: `import`/`export`. Vite handles bundling.
- `.mjs` extension for files shared between frontend and Node test runner (e.g., `client/src/utils/dealsViewState.mjs`, `client/src/utils/defaultDealsCache.mjs`).
- `.js` for plain client utilities (e.g., `client/src/utils/api.js`, `client/src/utils/formatters.js`).
- `.jsx` for React components.

## Naming Patterns

**Files (backend):**
- `kebab-case.js` for all server and crawler files.
- Route files match their URL prefix: `store-products.js` → `/api/v1/store-products`.
- Service files named after the domain noun: `canonicalizer.js`, `cart-comparator.js`, `item-matcher.js`.
- Crawler store adapters: `kebab-case` matching the store domain: `jamoona.js`, `grocera.js`, `little-india.js`.

**Files (frontend):**
- `PascalCase.jsx` for React components: `ProductCard.jsx`, `FiltersModal.jsx`, `DealsPage.jsx`.
- `camelCase.js` / `camelCase.mjs` for utilities: `api.js`, `formatters.js`, `dealsViewState.mjs`.

**Functions:**
- `camelCase` throughout: `canonicalizeDeals`, `parseWeight`, `mapCategory`, `buildDealsSearchParams`.
- Private/internal helpers (not exported) declared with `function` keyword at top of file before use.
- Async functions named after their action: `loadCanonicalRows`, `upsertDealMapping`, `enqueueManualReview`.

**Variables:**
- `camelCase` for local vars and parameters.
- `SCREAMING_SNAKE_CASE` for module-level constants: `STORE_ID`, `STORE_NAME`, `STORE_URL`, `CANONICAL_LINK_THRESHOLD`, `CRAWL_POLL_INTERVAL`.

**Types / DB fields:**
- `snake_case` for all database column names and JSON API response fields: `canonical_id`, `store_id`, `product_url`, `is_active`, `price_per_kg`, `crawl_run_id`.
- React component props use `camelCase`.

## Crawler Store Adapter Contract

Every store adapter must export exactly:
```js
module.exports = {
  storeId: STORE_ID,      // string, matches stores.id in DB
  storeName: STORE_NAME,  // string, human-readable
  storeUrl: STORE_URL,    // string, base URL
  scrape,                 // async function () → deal[]
};
```

Constants defined at module top: `const STORE_ID = "jamoona"`. See `crawler/stores/jamoona.js` and `crawler/stores/grocera.js`.

Internal mapping helper named `buildDeal(doc)` or `mapProduct(p)` — converts raw API/HTML data to deal shape.

## Route Handler Pattern

**Standard async route:**
```js
router.METHOD("/path", middlewareFn, async (req, res, next) => {
  try {
    // validate inputs with early returns
    if (!condition) return res.status(400).json({ error: "message" });
    // do async work
    const result = await service(db, params);
    res.json(result);
  } catch (err) {
    next(err);  // always delegate to Express error handler
  }
});
```

**Validation pattern:** Early `return res.status(4xx).json({ error: "..." })` before business logic. All error messages use the key `error`.

**Exception:** `server/routes/admin.js` uses `res.status(500).json({ error: e.message })` inline in some older handlers (lines 152, 864) rather than `next(err)`. New routes must use `next(err)`.

**Router factory (orders):** `server/routes/orders.js` exports `function createOrdersRouter(db)` and returns a configured router — used when `db` is passed explicitly in tests.

**Most routes:** `module.exports = router` (plain router, imports `db` directly from `../db`).

## Import Organization

**Backend:**
1. Node built-ins (`const crypto = require("crypto")`)
2. Third-party packages (`const express = require("express")`, `const fetch = require("node-fetch")`)
3. Internal middleware (`const requireUserAuth = require("../middleware/user-auth")`)
4. Internal services (`const { canonicalizeDeals } = require("../services/canonicalizer")`)
5. DB (`const db = require("../db")`)

**Frontend:**
1. React and hooks (`import React, { useState, useEffect } from "react"`)
2. React Router (`import { useSearchParams, useNavigate } from "react-router-dom"`)
3. Internal hooks (`import useDeals from "../hooks/useStoreProducts"`)
4. Utilities (`import { formatPrice } from "../utils/formatters"`)
5. Components (`import CartButton from "../components/CartButton"`)

No barrel/index files. All imports are direct file references.

## Error Handling

**Backend route errors:** `try/catch` in every async handler; caught errors passed to `next(err)`. Global Express error handler in `server/index.js` logs `err.stack` and sends `500`.

**Validation errors:** Early `return res.status(400).json({ error: "..." })` (never thrown, always returned directly).

**DB fallback pattern (admin-stats.js):** `safeGet`/`safeAll` wrappers catch `isMissingSchemaError` (column missing during migrations) and return fallback values, re-throwing other errors.

**Frontend API errors:** `client/src/utils/api.js` throws `new Error(await parseError(res))` for non-ok responses. `parseError` extracts `.error` from JSON body. Components catch in `useEffect` and set local `error` state.

**Auth token refresh:** `authRequest` in `api.js` retries once on 401 by calling `refreshSession`, then recurses with `retry = false`.

## Logging

No logger library. All logging via `console`:
- `console.log(...)` — startup info, crawl completion.
- `console.warn("[scope] message")` — non-fatal issues, degraded paths. Prefixed with `[module-name]` in square brackets.
- `console.error(...)` — unrecoverable errors, unhandled exceptions.

Pattern: `console.warn("[lists] Failed to ensure user row:", e.message)` — error message only, not stack, for expected failures.

## DB Calls

All DB calls are async with `await`. The libsql/Turso client returns Promises from `db.prepare().get()`, `.all()`, `.run()`. Route handlers and services must be `async` with `try/catch/next(err)`.

Test DB shim (`node:sqlite` `DatabaseSync`) is wrapped to return Promises so the same service code runs in both environments.

## Comments

Inline comments explain "why", not "what". Section dividers use `// ── Label ────` style in larger files.

JSDoc not used. Inline comments for complex logic only.

## Function Design

- Helper functions declared with `function` keyword (hoisted), exported functions may be `async function` declarations.
- Single responsibility: each function does one thing.
- Services export named functions only: `module.exports = { canonicalizeDeals, resolveQueryToCanonicalId }`.

## Frontend Component Design

- Functional components only. No class components.
- `export default function ComponentName(props)` at bottom of file for main component.
- Named exports for sub-components and constants in the same file (e.g., `export const SORT_OPTIONS` alongside `export default SortDropdown`).
- Tailwind utility classes inline. No CSS modules.
- URL state managed via `useSearchParams` + helper functions from `client/src/utils/dealsViewState.mjs`.

---

*Convention analysis: 2026-05-04*
