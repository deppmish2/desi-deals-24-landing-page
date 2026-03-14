# Release Checklist

## Backend Core

- [x] DB schema includes users/lists/recommendation/alerts/canonical/admin/event tracking tables.
- [x] Additive migrations are idempotent.
- [x] Backend service starts even when `better-sqlite3` native binding is unavailable (fallback to `node:sqlite` wrapper).
- [x] Core API routes mounted and reachable (`deals`, `stores`, `categories`, `auth`, `me`, `lists`, `recommend`, `alerts`, `canonical`, `search`, `admin`).

## Intelligence and Commerce Flows

- [x] Canonicalization pipeline integrated after crawl.
- [x] Claude-backed list parsing + resolver path integrated with fallback behavior.
- [x] Recommendation endpoint supports delivery preference options.
- [x] Fresh-stock inbound webhook validates HMAC signature.

## Admin and Analytics

- [x] Entity-resolution queue APIs available.
- [x] Delivery option CRUD endpoints available with staleness metadata.
- [x] KPI analytics endpoint available (`/api/v1/admin/analytics/kpis`).
- [x] Release readiness endpoint available (`/api/v1/admin/release/readiness`).

## Tests and Verification

- [x] Integration suite passes (`npm run test:integration`).
- [x] Route-level E2E suite passes (`npm run test:e2e`).
- [x] Backend performance smoke passes PRD targets in local in-process harness (`npm run perf:smoke`).
- [ ] Frontend build/runtime verification in this environment (blocked by dependency fetch/network restrictions).

## Crawler Coverage

- [x] Previously skipped adapters are now wired into crawl orchestration (`indische-lebensmittel-online`, `indianfoodstore`, `spicelands`).
- [ ] Full production crawl validation across all configured stores in a network-enabled runtime.

## Security and Ops

- [x] Admin endpoints are bearer-token protected.
- [x] User-auth endpoints use JWT access + refresh-session persistence.
- [x] Alert and webhook actions are audited.
- [ ] Production secrets rotation and environment audit.
- [ ] Final deployment smoke with real SMTP/Redis/API keys.

## Go/No-Go Summary

- Current status: **Backend-ready with test pass in sandbox; final production go-live is pending frontend runtime verification and network-enabled full crawl validation.**
