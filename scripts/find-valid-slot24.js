"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const db = require("../server/db");
const { buildEligibleCandidates } = require("../server/services/daily-deals-pool");
// buildEligibleCandidates is not exported, so we'll simulate by calling getDailyDealsPool
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const today = poolDate;

  // Get IDs already in the pool
  const poolEntries = await db.prepare(
    "SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ?"
  ).all(today);
  const inPool = new Set(poolEntries.map(e => String(e.deal_id || "")));

  // Get candidates that ARE eligible (will materialize)
  // We do this by temporarily fetching all active deals and testing them
  const { fetchActiveDealRows } = (() => {
    try { return require("../server/services/daily-deals-pool"); } catch(e) { return {}; }
  })();

  if (!fetchActiveDealRows) {
    console.log("fetchActiveDealRows not exported, using raw query");
  }

  // Get all active in_stock deals not in pool
  const candidates = await db.prepare(`
    SELECT d.id, d.product_name, d.store_id, d.product_category, d.product_url, d.sale_price, d.availability
    FROM deals d
    WHERE d.is_active = 1
      AND lower(coalesce(d.availability, '')) = 'in_stock'
      AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m', 'now'))
      AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
    ORDER BY d.last_pool_used_at ASC NULLS FIRST
    LIMIT 50
  `).all(today);

  console.log("Checking", candidates.length, "candidates...\n");

  // Test each via a temp pool insertion
  const { resolveBaseProduct } = (() => {
    try { return require("../server/services/daily-deals-pool"); } catch(e) { return {}; }
  })();

  if (!resolveBaseProduct) {
    // Just print all — we'll pick manually
    candidates.forEach(c => console.log(`[${c.store_id}] ${c.product_name} | €${c.sale_price}`));
  } else {
    const valid = candidates.filter(c => {
      const r = resolveBaseProduct(c.product_name);
      return r && r.base_key;
    });
    console.log("Valid candidates:", valid.length);
    valid.slice(0, 10).forEach(c => console.log(`[${c.store_id}] [${c.product_category}] ${c.product_name} | €${c.sale_price} | ${c.product_url}`));
  }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
