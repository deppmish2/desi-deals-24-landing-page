# Crawl Validation Report — 2026-02-28

## Scope

- Validation command: `npm run crawl:validate`
- Sample run command in this environment:
  - `CRAWL_VALIDATE_LIMIT=3 CRAWL_VALIDATE_TIMEOUT_MS=12000 npm run crawl:validate`
- Target metric from EPIC-02:
  - `>=80%` store success on weekly full run

## Result in This Environment

- Stores attempted: `3`
- Stores succeeded (`status=ok`, deals > 0): `0`
- Stores empty (`status=empty`, deals = 0): `2`
- Stores failed (`status=error`): `1`
- Success rate: `0%`

## Observed Errors

- DNS resolution failures for store hosts (`getaddrinfo ENOTFOUND`), for example:
  - `www.jamoona.com`
  - `eu.dookan.com`
  - `3uovdibf50nlxkrtp-1.a1.typesense.net`

## Interpretation

- This result does **not** represent production crawler quality.
- It reflects current sandbox network restrictions where outbound host resolution is unavailable.

## Next Validation Required for EPIC-02 Closure

1. Run full validation in a network-enabled runtime:
   - `npm run crawl:validate`
2. Capture full-store report with:
   - `CRAWL_VALIDATE_OUTPUT=docs/release/crawl-validation-prod.json npm run crawl:validate`
3. Confirm:
   - success rate `>=80%`
   - remediation list for failed/empty stores
   - weekly rerun trend.
