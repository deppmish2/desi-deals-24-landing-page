# EPIC-03: Entity Resolution and Canonical Catalogue

## Objective

Map raw store products into a high-accuracy canonical catalogue for recommendation and alerts.

## Scope

- Build `crawler/entity-resolution` service: normaliser, fuzzy matcher, AI resolver, orchestrator.
- Maintain `synonyms.json` lifecycle and write-back policy.
- Persist `product_mappings` with confidence/method metadata.
- Create admin manual-review queue and resolve endpoint integration.
- Add top-200 product QA fixture tests.

## Key Deliverables

1. `normaliser.js`, `fuzzy-matcher.js`, `ai-resolver.js`, `index.js`.
2. `synonyms.json` seeded and versioned safely.
3. Accuracy test harness against `top200.fixture.json`.
4. Manual review queue API support hooks.

## Dependencies

- EPIC-01 schema.
- EPIC-02 stable product ingest shape.

## Acceptance Criteria

- > =90% top-200 match accuracy before production release.
- Ambiguous resolution flows into AI/manual queue correctly.
- Canonical browse endpoints return variant-level pricing.

## Estimate

- Effort: 2.5-3.0 weeks
- Token budget: 0.9M-1.3M
- Owner agent: `agent-entity-intelligence`
