# Frontend UX QA Checklist — 2026-02-28

## Scope

- Routes/pages:
  - login/register/profile
  - shopping list + saved lists
  - recommendation with delivery preference toggle
- Deal-card alert entry point.
- Cart transfer UX and post-transfer prompt.

## Checklist

- [x] Auth pages wired (`/login`, `/register`) and profile route present (`/profile`).
- [x] Shopping list route supports text and voice capture wrapper (`/list`).
- [x] Saved lists are visible on list page and can trigger recompute flow.
- [x] Recommendation page includes delivery preference toggle and re-fetch behavior.
- [x] Cart transfer details modal exists with transfer links.
- [x] Post-transfer prompt is shown in recommendation flow.
- [x] Deal card has alert subscription entry point (`Set Deal Alert`).
- [x] Last-updated / crawling banners are shown on deals page.

## Known Blockers

- Frontend production build/runtime verification in this sandbox is still blocked by dependency fetch/network restrictions (`vite` dependency chain cannot be restored here).

## Next Step for Final Frontend Signoff

1. Run `npm --prefix client install && npm --prefix client run build` in network-enabled environment.
2. Execute manual mobile+desktop pass on:
   - `/deals`
   - `/list`
   - `/list/:id/result`
   - `/profile`
