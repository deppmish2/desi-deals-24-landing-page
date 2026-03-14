# V1 Integration Notes

## Branches

- Target integration branch: `codex/feature-v1` (created from `main`)
- Functional baseline source: `feature/all-crawl-refined-matches`
- Design source used for UI overlay: `origin/feature/ux-implementation`
  - The branch named `design/all-crawl-refined-matches` was not present in this local repo clone.

## Integration approach

1. Merged functional baseline into `codex/feature-v1` to retain business logic, APIs, state, and crawler/search behavior.
2. Overlaid design-oriented client UI files from `origin/feature/ux-implementation`.
3. Replaced placeholder-only flows with real API-backed behavior where possible.

## Placeholder removals and functional wiring

- `client/src/pages/OrderHistoryPage.jsx`
  - Removed sample orders.
  - Connected to `fetchLists()` for real list history data.
  - Wired actions to real routes (`/list`, `/list/:id/result`).

- `client/src/pages/ShippingAddressesPage.jsx`
  - Removed sample addresses.
  - Connected to `fetchMe()` profile data for delivery location display.
  - Wired edit/update flows to address edit route.

- `client/src/pages/EditAddressPage.jsx`
  - Removed fake save (`setTimeout`) and TODO placeholder.
  - Connected save to `updateMe()` with real persisted fields (`postcode`, `city`).

- `client/src/components/AlertModal.jsx`
  - Fixed alert payloads to backend-supported fields:
    - `restock_any` / `restock_store` for stock alerts.
    - `target_store_id` for store-scoped stock alerts.
  - Added product query input so alert creation works even without a preselected deal.
  - Added validation for required query and valid target price.

- `client/src/pages/AlertsPage.jsx`
  - Removed no-op Edit behavior by wiring the button to an actionable toggle state change.

- `client/src/pages/ProfilePage.jsx`
  - Updated dead/placeholder navigation links to real existing routes.

## Validation run

- Client build:
  - `npm run build:client` passed.
- Runtime smoke checks (outside sandbox due port restrictions):
  - `GET /` -> `200`
  - `GET /orders` -> `200`
  - `GET /api/v1/stores` -> `200`
