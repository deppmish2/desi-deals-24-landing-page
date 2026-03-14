# EPIC-07: Frontend Experience and User Flows

## Objective

Ship the PRD v2.4 UI journey across browsing, list creation, recommendation, profile, and alerts.

## Scope

- Add routes/pages: login/register, shopping list, saved list, recommendation, profile.
- Implement components: parsed items list, recommendation card, delivery speed toggle, alert subscribe sheet, cart transfer modal.
- Integrate autocomplete, voice input wrapper, and alert entry points on deal cards.
- Implement responsive behavior and last-updated banner status handling.

## Key Deliverables

1. Route expansion in `client/src/App.jsx`.
2. New page/component modules aligned with PRD section 13.
3. API integration hooks for auth/list/recommend/alerts.
4. Mobile and desktop UX QA checklist completion.

## Dependencies

- EPIC-04/05/06 API completion.
- EPIC-08 for final performance QA and analytics hooks.

## Acceptance Criteria

- End-to-end flow works: input list -> recommendation -> transfer -> post-transfer prompt.
- Delivery preference toggle updates recommendations correctly.
- Alert subscribe UX available in required entry points and gated by auth.

## Estimate

- Effort: 3.0-3.5 weeks
- Token budget: 1.0M-1.4M
- Owner agent: `agent-frontend-experience`
