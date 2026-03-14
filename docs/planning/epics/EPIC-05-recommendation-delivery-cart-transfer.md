# EPIC-05: Recommendation, Delivery Logic, and Cart Transfer

## Objective

Provide best-store recommendation with delivery-aware scoring and handoff to store carts.

## Scope

- Build `server/services/recommender.js` and `delivery.js`.
- Implement `/lists/:id/recommend` with preference modes: `cheapest|fastest|same_day_if_available`.
- Implement shipping tiers + delivery option eligibility/cutoff logic.
- Implement cart transfer methods: Shopify permalink, WooCommerce chain, tab burst, manual fallback.

## Key Deliverables

1. Recommendation service with deterministic scoring and explainable response payload.
2. Delivery eligibility checks by postcode/day/cutoff.
3. Cart URL builder module and fallback handling.
4. API test cases for edge cases (no same-day, cutoff passed, unknown shipping).

## Dependencies

- EPIC-02 for platform/variant data quality.
- EPIC-04 for list ownership and profile preferences.

## Acceptance Criteria

- Recommendation endpoint returns in <5s for target basket sizes.
- Same-day behavior matches PRD requirements including cutoff messaging.
- Cart transfer method quality flags are returned and accurate.

## Estimate

- Effort: 2.5-3.0 weeks
- Token budget: 0.9M-1.3M
- Owner agent: `agent-user-commerce`
