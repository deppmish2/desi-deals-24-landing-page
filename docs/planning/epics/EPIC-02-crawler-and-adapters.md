# EPIC-02: Crawler and Store Adapters

## Objective

Deliver reliable catalogue coverage and daily price freshness across all 27 target stores.

## Scope

- Complete/standardize 27 adapters using a shared adapter contract.
- Implement generic adapter fallback for Shopify/WooCommerce.
- Platform detection (`shopify|woocommerce|custom|unknown`).
- Capture `platform_product_id` (Shopify variant IDs where available).
- Implement resilient retry/backoff, dedup, and partial-failure handling.

## Key Deliverables

1. Adapter completion matrix with crawl pass/fail per store.
2. `generic-adapter.js` + platform detector utility.
3. Crawl run reporting (`stores_attempted/succeeded`, error payloads).
4. Store-level QA fixtures for high-risk sites.

## Dependencies

- EPIC-01 schema and crawl mode interfaces.
- EPIC-08 for performance and reliability SLO validation.

## Acceptance Criteria

- > =80% stores successful per weekly full run (PRD metric).
- > =95% active products refreshed within 24h across price-sync run.
- Failed stores do not abort full run.
- Difficult crawler list reduced with tracked remediation plan.

## Estimate

- Effort: 3.0-4.0 weeks
- Token budget: 1.2M-1.8M
- Owner agent: `agent-crawler-adapters`
