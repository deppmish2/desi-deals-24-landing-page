# EPIC-08: Admin, Analytics, Performance, and Release

## Objective

Harden the platform for production operation, governance, and KPI visibility.

## Scope

- Admin routes/UI support: crawl trigger/status, ER queue review, delivery option CRUD, alert activity visibility.
- Analytics event table and event instrumentation across core user actions.
- Performance optimization: SQL/index tuning, payload trimming, lazy loading strategy.
- Release readiness: regression suite, data freshness checks, runbooks, incident playbook.

## Key Deliverables

1. Admin APIs and staleness highlighting logic for delivery options (>45 days).
2. `events` schema and tracking implementation for PRD metrics.
3. Performance report versus PRD targets (<200ms browse/search, <5s recommend).
4. Release checklist + rollback/restore procedures.

## Dependencies

- All prior epics integrated.

## Acceptance Criteria

- Core KPI dashboards/query scripts available.
- Performance targets met or documented with explicit exception list.
- Release checklist passed and sign-off captured.

## Estimate

- Effort: 2.0-2.5 weeks
- Token budget: 0.6M-0.9M
- Owner agent: `integration-owner` + supporting agents
