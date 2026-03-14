# EPIC-01: Core Data Platform

## Objective

Establish the production-grade backend foundation for PRD v2.4: schema, migrations, crawl modes, and base API contracts.

## Scope

- Upgrade DB schema to include `products`, `prices`, `canonical_products`, `product_mappings`, `users`, `shopping_lists`, `list_items`, `price_alerts`, `delivery_options`, `shipping_tiers`, enhanced `crawl_runs`.
- Add migration runner strategy with rollback-safe migration steps.
- Split crawl into `full` and `price-sync` modes.
- Add/align foundational read endpoints (`/deals`, `/stores`, `/categories`, `/canonical`, `/search/autocomplete`).
- Introduce index and performance baseline instrumentation.

## Key Deliverables

1. Migration files + updated `server/db/schema.sql` and migration docs.
2. Crawl mode orchestration contract in `crawler/index.js` + scheduler wiring.
3. API contract tests for foundational endpoints.
4. Seed loading strategy for stores/shipping/delivery base datasets.

## Dependencies

- Input from EPIC-02 for store adapter data shape.
- Input from EPIC-03 for canonical mapping fields.

## Acceptance Criteria

- Migrations run cleanly from empty DB and current DB.
- `full` and `price-sync` modes execute and log separately.
- `/api/v1/deals`, `/stores`, `/categories` return PRD-aligned fields.
- Query p95 under 200ms on local benchmark dataset.

## Estimate

- Effort: 2.0-2.5 weeks
- Token budget: 0.8M-1.1M
- Owner agent: `agent-data-platform`
