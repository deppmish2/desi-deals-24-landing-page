# EPIC-06: Alerts and Inbound Webhooks

## Objective

Implement full v1 alerting (price/deal/restock/fresh-arrived) and store webhook ingestion.

## Scope

- `/me/alerts` CRUD with validation by alert type.
- Post-crawl alert evaluator service for price/deal/restock triggers.
- Notification dispatcher with dedup windows and idempotency controls.
- `POST /api/v1/inbound/fresh-stock` HMAC-authenticated route with asynchronous dispatch.

## Key Deliverables

1. Alert route handlers and service layer.
2. `alert-evaluator.js` wired into post price-sync workflow.
3. `alert-notifier.js` with provider abstraction and templates.
4. Fresh-stock webhook endpoint with signature verification.

## Dependencies

- EPIC-03 canonical mappings.
- EPIC-04 user/profile foundation.
- EPIC-08 for operational monitoring.

## Acceptance Criteria

- All four alert classes behave according to PRD rules.
- Duplicate notifications prevented within configured crawl window.
- Inbound webhook returns fast 200 and processes notifications asynchronously.

## Estimate

- Effort: 2.0-2.5 weeks
- Token budget: 0.7M-1.0M
- Owner agent: `agent-alerts-integrations`
