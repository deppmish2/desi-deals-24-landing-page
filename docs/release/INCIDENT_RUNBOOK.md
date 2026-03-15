# Incident Runbook

## Purpose

Operational playbook for common failures in crawl, API, alerts, and data freshness.

## 1) Crawl Not Updating Deals

### Symptoms

- `GET /api/v1/deals` returns stale or empty dataset.
- `GET /api/v1/admin/crawl/status` shows failed/repeated running runs.

### Checks

1. Check latest crawl status:
   - `GET /api/v1/admin/crawl/status`
2. Check release readiness snapshot:
   - `GET /api/v1/admin/release/readiness`
3. Review store-level freshness:
   - stale stores list from readiness endpoint.

### Actions

1. Trigger manual crawl:
   - `POST /api/v1/admin/crawl/trigger`
2. If repeated store failures, isolate failing adapters from crawl logs and disable problematic stores by setting `stores.crawl_status = 'error'` until fixed.
3. Validate the active data path:
   - confirm Turso connectivity and that the latest completed crawl wrote active deals and the daily pool.

## 2) Canonical Queue Growth / ER Backlog

### Symptoms

- `entity_resolution_queue` pending count increasing.

### Checks

1. Queue review:
   - `GET /api/v1/admin/entity-resolution/queue`
2. KPI/readiness pending count:
   - `/api/v1/admin/analytics/kpis`
   - `/api/v1/admin/release/readiness`

### Actions

1. Resolve high-volume entries with:
   - `POST /api/v1/admin/entity-resolution/resolve`
2. Verify synonyms/normalization quality for repeated misses.
3. Re-run crawl to propagate mappings after large batch resolution.

## 3) Alerts Not Sending

### Symptoms

- Alerts trigger conditions met but users receive no notifications.

### Checks

1. Activity summary:
   - `GET /api/v1/admin/alerts/activity`
2. `alert_notifications.sent_status` distribution.
3. SMTP configuration presence (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).

### Actions

1. If SMTP missing, system falls back to log-only mode; configure SMTP and retry.
2. Confirm alert cooldown is not suppressing repeats (`ALERT_COOLDOWN_MINUTES`).
3. Validate webhook signature issues for inbound freshness events.

## 4) Auth/Login Failures

### Symptoms

- Register/login/refresh failing for all users.

### Checks

1. Validate `JWT_SECRET` and `JWT_REFRESH_SECRET`.
2. Validate DB availability (`server/db` startup logs).
3. Check refresh token table integrity (`refresh_tokens`).

### Actions

1. Rotate JWT secrets only with planned token invalidation window.
2. For emergency invalidation:
   - revoke all sessions by clearing `refresh_tokens`.

## 5) Rollback and Restore

### DB Restore (SQLite)

1. Stop writes (pause crawl/admin triggers).
2. Backup current DB file (`DB_PATH`).
3. Restore previous known-good DB snapshot.
4. Start service and run smoke checks:
   - `/api/v1/deals`
   - `/api/v1/admin/crawl/status`
   - `/api/v1/admin/release/readiness`

### Code Rollback

1. Deploy previous stable git tag/commit.
2. Keep schema backward-compatible (current migrations are additive).
3. Re-run integration + e2e smoke tests.

## 6) Post-Incident Review Template

- Incident start/end time (UTC).
- User impact.
- Root cause.
- Detection gap.
- Corrective action.
- Preventive action with owner and deadline.
