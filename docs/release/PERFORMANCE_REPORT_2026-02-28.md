# Performance Report — 2026-02-28

## Scope

- PRD targets:
  - Browse/search under 200ms
  - Recommendation under 5s
- Measurement command:
  - `npm run perf:smoke`
- Harness:
  - in-process Express app
  - in-memory `node:sqlite` test DB
  - no network I/O for crawler/store calls

## Results

- Node runtime: `v24.1.0`
- Generated at: `2026-02-28T20:30:40.171Z`

### Browse (`GET /api/v1/deals`)

- Samples: 80
- Avg: 0.272 ms
- P50: 0.221 ms
- P95: 0.451 ms
- Max: 1.768 ms

### Search (`GET /api/v1/search/autocomplete`)

- Samples: 80
- Avg: 0.209 ms
- P50: 0.194 ms
- P95: 0.396 ms
- Max: 1.515 ms

### Recommendation (`POST /api/v1/lists/:id/recommend`)

- Samples: 40
- Avg: 1.248 ms
- P50: 0.398 ms
- P95: 0.560 ms
- Max: 33.312 ms

## Target Comparison

- Browse/Search `<200ms`: PASS in smoke harness.
- Recommendation `<5000ms`: PASS in smoke harness.

## Caveats

- These are backend in-process smoke metrics, not full production latencies.
- Real-world production values will be higher due to network overhead, larger datasets, and infrastructure variability.
- Frontend runtime/build verification is still blocked in this sandbox due dependency fetch/network constraints.

## Next Steps for Production-Grade Perf Signoff

1. Run the same benchmark in deployment-like environment (same Node version and DB mode as production).
2. Add dataset-scale benchmark (realistic active deals volume from recent crawl snapshots).
3. Capture API p95 under concurrent load and compare with PRD thresholds.
