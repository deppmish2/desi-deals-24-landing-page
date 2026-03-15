"use strict";
/**
 * Enforce max 3 deals per store in today's pool.
 * Removes excess entries and replaces them with eligible deals from under-represented stores.
 */
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const crypto = require("crypto");
const db = require("../server/db");
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

const MAX_PER_STORE = 3;

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const now = new Date().toISOString();

  // 1. Get current pool entries with store info
  let entries = await db.prepare(`
    SELECT e.slot_index, e.deal_id, e.store_id, e.product_name_snapshot, e.product_signature
    FROM daily_deal_pool_entries e
    WHERE e.pool_date = ?
    ORDER BY e.slot_index
  `).all(poolDate);

  // 2. Find stores exceeding the cap
  const storeCounts = {};
  const toRemove = [];
  for (const e of entries) {
    storeCounts[e.store_id] = (storeCounts[e.store_id] || 0) + 1;
    if (storeCounts[e.store_id] > MAX_PER_STORE) {
      toRemove.push(e);
    }
  }

  console.log("Store counts:", storeCounts);
  console.log("Slots to remove:", toRemove.map(e => `slot ${e.slot_index} [${e.store_id}] ${e.product_name_snapshot}`));

  if (toRemove.length === 0) {
    console.log("Pool already complies with max 3 per store.");
    process.exit(0);
  }

  // 3. Remove excess slots
  for (const e of toRemove) {
    await db.prepare(
      "DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?"
    ).run(poolDate, e.slot_index);
    console.log(`Removed slot ${e.slot_index}: [${e.store_id}] ${e.product_name_snapshot}`);
  }

  // 4. Get existing pool signatures to avoid dupes
  const remaining = await db.prepare(
    "SELECT store_id, product_signature, deal_id FROM daily_deal_pool_entries WHERE pool_date = ?"
  ).all(poolDate);
  const usedSigs = new Set(remaining.map(r => r.product_signature));
  const usedDealIds = new Set(remaining.map(r => r.deal_id));
  const remainingStoreCounts = {};
  for (const r of remaining) {
    remainingStoreCounts[r.store_id] = (remainingStoreCounts[r.store_id] || 0) + 1;
  }

  // 5. Find replacement deals from stores with < 3 (prefer stores with fewest deals)
  const replacements = await db.prepare(`
    SELECT d.id, d.store_id, d.product_name, d.product_category, d.product_url, d.sale_price
    FROM deals d
    WHERE d.is_active = 1
      AND lower(coalesce(d.availability, '')) = 'in_stock'
      AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m', 'now'))
      AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
    ORDER BY d.last_pool_used_at ASC NULLS FIRST
    LIMIT 100
  `).all(poolDate);

  // Use high slot numbers to avoid any collision with remaining entries
  let nextSlot = 100;
  let added = 0;

  for (const deal of replacements) {
    if (added >= toRemove.length) break;
    // Skip stores already at cap
    if ((remainingStoreCounts[deal.store_id] || 0) >= MAX_PER_STORE) continue;
    const sig = crypto.createHash("md5").update(deal.product_url).digest("hex");
    if (usedSigs.has(sig)) continue;

    // Test materialization by inserting and checking
    await db.prepare(`
      INSERT INTO daily_deal_pool_entries (pool_date, slot_index, deal_id, store_id, base_key, product_signature, category, product_name_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(poolDate, nextSlot, deal.id, deal.store_id, deal.product_url, sig, deal.product_category, deal.product_name, now);

    const pool = await getDailyDealsPool(db, { poolDate, limit: 24, allowGenerate: false });
    const materialized = pool.rows.find(r => r.id === deal.id);

    if (!materialized) {
      console.log(`  Skipping (won't materialize): [${deal.store_id}] ${deal.product_name}`);
      await db.prepare("DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?").run(poolDate, nextSlot);
      continue;
    }

    await db.prepare("UPDATE deals SET last_pool_used_at = ? WHERE id = ?").run(now, deal.id);
    usedSigs.add(sig);
    usedDealIds.add(deal.id);
    remainingStoreCounts[deal.store_id] = (remainingStoreCounts[deal.store_id] || 0) + 1;
    console.log(`  Added slot ${nextSlot}: [${deal.store_id}] ${deal.product_name} €${deal.sale_price}`);
    nextSlot++;
    added++;
  }

  // 6. Final verification
  const final = await getDailyDealsPool(db, { poolDate, limit: 24, allowGenerate: false });
  const finalStoreCounts = {};
  for (const r of final.rows) finalStoreCounts[r.store_id] = (finalStoreCounts[r.store_id] || 0) + 1;
  console.log("\nFinal store counts:", finalStoreCounts);
  console.log("Final pool size:", final.rows.length);
  const violations = Object.entries(finalStoreCounts).filter(([, c]) => c > MAX_PER_STORE);
  if (violations.length) console.log("STILL VIOLATING:", violations);
  else console.log("All stores within cap of", MAX_PER_STORE);

  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
