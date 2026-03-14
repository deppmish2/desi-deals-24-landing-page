# EPIC-04: Auth, Profile, and Shopping Lists

## Objective

Implement secure user identity and persistent list management required for personalized recommendations and alerts.

## Scope

- JWT auth (`register/login/refresh/logout`) and Google OAuth callback.
- `users` profile CRUD (`/me`) with postcode, preferences, brand/store preferences.
- Shopping list CRUD (`/lists`, `/lists/:id`, items operations).
- Persist input method (`voice|text`), reminders, and unresolved states.

## Key Deliverables

1. Auth routes + middleware.
2. Profile routes and preference validation.
3. Shopping list routes with item-level update APIs.
4. Integration tests for auth + permissions + data isolation.

## Dependencies

- EPIC-01 schema and middleware scaffolding.
- EPIC-03 for canonical resolution integration on list items.

## Acceptance Criteria

- Secure auth flow works with access/refresh token lifecycle.
- User-specific list access is isolated by user ID.
- List create/update/delete fully functional with resolved/unresolved states.

## Estimate

- Effort: 2.0-2.5 weeks
- Token budget: 0.8M-1.1M
- Owner agent: `agent-user-commerce`
