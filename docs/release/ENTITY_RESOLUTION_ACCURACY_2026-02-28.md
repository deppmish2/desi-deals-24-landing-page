# Entity Resolution Accuracy Report — 2026-02-28

## Scope

- Harness command: `npm run test:er-accuracy`
- Fixture: `crawler/entity-resolution/fixtures/top200.fixture.json`
- Fixture size: 200 rows
- Canonical set size: 40

## Result

- Accuracy: `95.00%`
- Minimum required: `90.00%`
- Status: `PASS`

## Method Distribution

- `exact`: 118
- `manual_review`: 72
- `new`: 10

## Notes

- Ambiguous rows are currently represented by `manual_review` when AI resolver returns `UNSURE`.
- The harness still counts them as correct if predicted canonical match equals expected canonical target.
