"use strict";
/**
 * Remove dead pool entries (is_active=0) and refill to 24 with active deals.
 * Max 3 per store, prefers stores with fewest current slots.
 */
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const crypto = require("crypto");
const db = require("../server/db");
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

const MAX_PER_STORE = 3;
const TARGET = 24;
const MIN_DISCOUNT = Number(process.env.DAILY_POOL_MIN_DISCOUNT_PCT || 20);

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const now = new Date().toISOString();

  // 1. Remove pool entries whose deal is inactive or has no discount
  const allEntries = await db.prepare(`
    SELECT e.slot_index, e.deal_id, e.store_id, e.product_name_snapshot,
           d.is_active, d.discount_percent, d.original_price, d.sale_price
    FROM daily_deal_pool_entries e
    LEFT JOIN deals d ON d.id = e.deal_id
    WHERE e.pool_date = ?
  `).all(poolDate);

  const deadSlots = allEntries.filter(e => {
    if (!e.is_active || e.is_active === 0) return true;
    return !(e.discount_percent >= MIN_DISCOUNT);
  });
  console.log("Removing dead/no-discount slots:", deadSlots.length);
  for (const e of deadSlots) {
    await db.prepare("DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?").run(poolDate, e.slot_index);
    console.log(`  Removed slot ${e.slot_index}: ${e.product_name_snapshot}`);
  }

  // 2. Check current state
  let pool = await getDailyDealsPool(db, { poolDate, limit: 50, allowGenerate: false });
  console.log("\nPool after cleanup:", pool.rows.length, "materialized");

  const storeCounts = {};
  for (const r of pool.rows) storeCounts[r.store_id] = (storeCounts[r.store_id] || 0) + 1;
  console.log("Store counts:", storeCounts);

  const usedSigs = new Set(
    (await db.prepare("SELECT product_signature FROM daily_deal_pool_entries WHERE pool_date = ?").all(poolDate))
      .map(r => r.product_signature)
  );
  const usedDealIds = new Set(
    (await db.prepare("SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL").all(poolDate))
      .map(r => r.deal_id)
  );

  // 3. Get all eligible active deals not in pool, ordered by store diversity then last_pool_used_at
  const candidates = await db.prepare(`
    SELECT d.id, d.store_id, d.product_name, d.product_category, d.product_url, d.sale_price
    FROM deals d
    WHERE d.is_active = 1
      AND lower(coalesce(d.availability,'')) = 'in_stock'
      AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m','now'))
      AND d.discount_percent IS NOT NULL AND d.discount_percent >= ${MIN_DISCOUNT}
      AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
    ORDER BY d.last_pool_used_at ASC NULLS FIRST
    LIMIT 3000
  `).all(poolDate);

  console.log("\nCandidates available:", candidates.length);
  console.log("Need to add:", TARGET - pool.rows.length);

  // Use a slot well above any existing ones
  const maxSlotRow = await db.prepare("SELECT MAX(slot_index) as m FROM daily_deal_pool_entries WHERE pool_date = ?").get(poolDate);
  let nextSlot = Math.max(1000, (maxSlotRow?.m || 0) + 1);
  let added = 0;
  const needed = TARGET - pool.rows.length;

  for (const deal of candidates) {
    if (added >= needed) break;
    if ((storeCounts[deal.store_id] || 0) >= MAX_PER_STORE) continue;
    const sig = crypto.createHash("md5").update(deal.product_url).digest("hex");
    if (usedSigs.has(sig) || usedDealIds.has(deal.id)) continue;

    await db.prepare(`
      INSERT INTO daily_deal_pool_entries (pool_date, slot_index, deal_id, store_id, base_key, product_signature, category, product_name_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(poolDate, nextSlot, deal.id, deal.store_id, deal.product_url, sig, deal.product_category, deal.product_name, now);

    const check = await getDailyDealsPool(db, { poolDate, limit: 50, allowGenerate: false });
    const ok = check.rows.find(r => r.id === deal.id);

    if (!ok) {
      await db.prepare("DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?").run(poolDate, nextSlot);
      continue;
    }

    await db.prepare("UPDATE deals SET last_pool_used_at = ? WHERE id = ?").run(now, deal.id);
    usedSigs.add(sig);
    usedDealIds.add(deal.id);
    storeCounts[deal.store_id] = (storeCounts[deal.store_id] || 0) + 1;
    console.log(`  Added [${deal.store_id}] ${deal.product_name} €${deal.sale_price}`);
    nextSlot++;
    added++;
  }

  // 4. Final check
  const final = await getDailyDealsPool(db, { poolDate, limit: 24, allowGenerate: false });
  const finalStoreCounts = {};
  for (const r of final.rows) finalStoreCounts[r.store_id] = (finalStoreCounts[r.store_id] || 0) + 1;
  console.log("\nFinal store counts:", finalStoreCounts);
  console.log("Final pool size:", final.rows.length);
  const violations = Object.entries(finalStoreCounts).filter(([, c]) => c > MAX_PER_STORE);
  if (violations.length) console.log("VIOLATIONS:", violations);
  else console.log("All stores within cap. Done.");
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
