We need to redesign the daily deals update system because the current setup is too slow and unreliable.

Problem summary:
- Daily deals updates are not working consistently
- Website loads too slowly after inactivity
- Likely cold start issue causing long first-load times
- Current architecture is not acceptable for users
- If it is failing now, it will fail worse at scale
- We need reliable, timely crawls and fast page loads

Goal:
Build a production-ready deals ingestion and delivery system that is reliable, scalable, and fast from a user perspective.

Requirements:
1. Crawling / ingestion
   - Crawls must run on schedule reliably without manual intervention
   - Daily deals must be fetched on time and stored durably
   - System should support retries, backoff, and failure handling
   - Failed crawls should be visible in logs / monitoring
   - Crawls should be idempotent so reruns do not create duplicates
   - Design should support scaling to many sources later

2. Performance
   - Avoid cold-start-driven slow page loads
   - User-facing pages should load fast even after long inactivity
   - Data should be precomputed / cached where possible
   - Website should not depend on a slow live crawl at request time

3. Reliability
   - No dependence on best-effort or fragile background jobs
   - Clear separation between:
     - crawl/fetch layer
     - processing/normalization layer
     - storage layer
     - API / frontend delivery layer
   - System must continue serving last successful data even if latest crawl fails

4. Data flow
   - Scheduled crawler fetches deals
   - Normalize and validate results
   - Store in persistent database
   - Cache ready-to-serve results for frontend
   - Frontend/API reads from DB/cache only, never from live crawl

5. Monitoring / ops
   - Add logs for each crawl job
   - Track success/failure, duration, item count, last successful run
   - Alert if scheduled crawl fails or produces zero/abnormally low results
   - Add health visibility for API latency and crawl freshness

6. Scale expectations
   - Architecture should work for current traffic and future scale
   - Must support adding more sources without major redesign
   - Should handle concurrent crawls safely
   - Should support queue-based or job-based processing if needed

Deliverables:
- Propose a better architecture than the current one
- Identify root causes of slowness and unreliability
- Recommend concrete infra choices to remove cold start impact
- Define crawler scheduling strategy
- Define storage + caching strategy
- Define monitoring and failure recovery strategy
- Provide implementation plan in phases

Important constraints:
- Prioritize user experience over cheapest possible setup
- Reliable and timely updates are mandatory
- Fast page load is mandatory
- Avoid request-time crawling
- Avoid architectures that become very slow after inactivity

Output format wanted:
1. Root cause analysis of current likely issues
2. Proposed target architecture
3. Recommended stack / infra choices
4. Request flow and crawl flow
5. Failure handling
6. Monitoring and alerts
7. Step-by-step migration plan
8. Nice-to-have optimizations for later