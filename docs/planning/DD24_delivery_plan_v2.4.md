# DD24 Delivery Plan and Cost Model (Based on DD24_PRD_v2.4.md)

## 1) Baseline and Assumptions

- Source scope: `DD24_PRD_v2.4.md` dated 2026-02-28.
- Current repo status: working deals crawler + browse UI exists, but major PRD v2.4 modules are still pending (auth, full catalogue model, entity-resolution service, shopping lists, recommender, alerts, inbound webhook, expanded frontend flows).
- PRD size: ~7,366 words (~10k-12k tokens).

Assumptions used for estimates:

- Team mode: 5 focused sub-agents + 1 integration/release owner.
- Delivery quality: production-ready with tests, observability, migration safety, and UAT.
- Token split for cost model: 70% input, 30% output.
- Pricing is estimated using model-rate scenarios (not official billing quotes).

## 2) Delivery Strategy

Recommended: phase-aligned execution with parallel sub-agents and strict interface contracts.

- Track A (Data Platform): schema migration, crawl modes, adapters, scheduler.
- Track B (Intelligence): entity resolution + list parser + recommender.
- Track C (User Platform): auth, profile, lists, alerts, webhook.
- Track D (Frontend): list flow, recommendation, profile/alerts UX.
- Track E (Ops/QA): perf, analytics, admin tools, release hardening.

Integration cadence:

- Weekly integration branch merge.
- Mid-sprint contract tests between API and frontend.
- End-of-phase regression + crawl replay checks.

## 3) Timeline Estimate

### Overall estimate (from current repo to PRD v2.4 delivery)

- Aggressive: 10-12 weeks (higher execution risk).
- Recommended: 13-16 weeks.
- Conservative: 18-20 weeks.

### Recommended phase plan (13-16 weeks)

1. Weeks 1-3: Core infra + schema + crawl mode split + generic adapter hardening.
2. Weeks 3-6: 27-store adapter completion + entity resolution service + admin queue basics.
3. Weeks 6-9: auth/profile/lists + NLP parser + recommender + cart transfer.
4. Weeks 8-11: alerts engine + notifier + inbound fresh-stock webhook.
5. Weeks 9-13: frontend expansion (list/reco/profile/alerts) + UX QA.
6. Weeks 13-16: analytics, admin polish, performance tuning, release/UAT.

## 4) Context Size and Token Budget

### Context size guidance

- Per sub-agent working context target: 25k-55k tokens.
- Hard cap target: keep each run under 80k context to reduce drift and cost.
- Integration agent context target: 40k-90k tokens (cross-epic review/testing).

### Project token estimate (end-to-end)

1. Monolithic single-agent delivery:

- Total tokens: ~12M-16M
- Typical context per run: 80k-140k
- Cost risk: highest (frequent large-context rereads)

2. Optimal sub-agent split (recommended):

- Total tokens: ~7.5M-10M
- Typical context per run: 25k-55k
- Savings vs monolith: ~30%-40%

3. Aggressive cost-optimized split (more rigid interfaces):

- Total tokens: ~6M-8M
- Typical context per run: 20k-45k
- Savings vs monolith: ~45%-55%
- Tradeoff: higher integration overhead/risk if specs are weak

## 5) Estimated Cost (Scenario Pricing)

Formula:

- Cost = (InputTokens / 1,000,000 _ InputRate) + (OutputTokens / 1,000,000 _ OutputRate)

Scenario rates used for planning only:

- High-capability model: input $5/M, output $15/M
- Mid-tier model: input $1.5/M, output $6/M
- Budget model: input $0.3/M, output $1.2/M

### Recommended sub-agent split (~8.5M total tokens)

- Input: 5.95M
- Output: 2.55M

Estimated cost:

- High-capability: ~$68
- Mid-tier: ~$24.2
- Budget: ~$4.8

### Monolithic baseline (~14M total tokens)

Estimated cost:

- High-capability: ~$112
- Mid-tier: ~$39.9
- Budget: ~$7.9

### Practical interpretation

- Sub-agent execution at the same quality target is materially cheaper than monolithic execution.
- Biggest savings come from context isolation, smaller prompts, and reduced repeated repo rereads.

## 6) Optimal Sub-Agent Structure

Recommended 6-agent setup:

1. `agent-data-platform`

- Owns schema, migrations, crawl orchestration, scheduler, adapter contracts.

2. `agent-crawler-adapters`

- Owns 27 store adapters, platform detection, variant ID capture, crawl QA fixtures.

3. `agent-entity-intelligence`

- Owns normaliser/fuzzy/AI resolver, synonyms lifecycle, list parsing, canonical mapping quality.

4. `agent-user-commerce`

- Owns auth, profile, lists API, recommender, delivery scoring, cart-transfer services.

5. `agent-alerts-integrations`

- Owns alert tables/endpoints/evaluator/notifier + inbound webhook and HMAC verification.

6. `agent-frontend-experience`

- Owns new pages/components, delivery toggle, recommendation UX, profile/alerts UX, mobile QA.

Plus one rotating `integration-owner` role (can be shared weekly) for merge gates and contract tests.

## 7) Cost Controls Without Performance Loss

1. Lock each agent to one epic at a time with fixed input artifact bundle.
2. Use stable interface docs (API schema + SQL migration notes) to minimize re-explaining context.
3. Enforce "diff-only" prompts after first pass (no full PRD resend each run).
4. Batch reviews: one integrated review pass per milestone instead of per-commit full reviews.
5. Keep PRD excerpts small and section-specific per agent.

## 8) Detailed Sub-Epic Files

Detailed epics have been created in:

- `docs/planning/epics/EPIC-01-core-data-platform.md`
- `docs/planning/epics/EPIC-02-crawler-and-adapters.md`
- `docs/planning/epics/EPIC-03-entity-resolution-and-canonical.md`
- `docs/planning/epics/EPIC-04-auth-profile-and-lists.md`
- `docs/planning/epics/EPIC-05-recommendation-delivery-cart-transfer.md`
- `docs/planning/epics/EPIC-06-alerts-and-inbound-webhooks.md`
- `docs/planning/epics/EPIC-07-frontend-experience-and-flows.md`
- `docs/planning/epics/EPIC-08-admin-analytics-performance-release.md`

## 9) Delivery Recommendation

Use the recommended split (6 agents + integration owner) and commit to the 13-16 week plan.

This gives the best balance of:

- feature completeness against PRD v2.4,
- predictable integration quality,
- 30%-40% token-cost reduction versus monolithic execution.
