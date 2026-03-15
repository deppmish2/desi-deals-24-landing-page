"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const crypto = require("crypto");
const db = require("../server/db");
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

const MAX_PER_STORE = 3;
const TARGET = 24;

// Stores confirmed to materialize, ordered by preference (fewest in pool first)
const PRIORITY_STORES = ["namma-markt", "indianstorestuttgart", "sairas", "annachi", "desigros", "little-india", "dookan", "jamoona"];

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const now = new Date().toISOString();

  let pool = await getDailyDealsPool(db, { poolDate, limit: 50, allowGenerate: false });
  console.log("Starting pool size:", pool.rows.length);

  const storeCounts = {};
  for (const r of pool.rows) storeCounts[r.store_id] = (storeCounts[r.store_id] || 0) + 1;

  const usedSigs = new Set(
    (await db.prepare("SELECT product_signature FROM daily_deal_pool_entries WHERE pool_date = ?").all(poolDate))
      .map(r => r.product_signature)
  );
  const usedDealIds = new Set(
    (await db.prepare("SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL").all(poolDate))
      .map(r => r.deal_id)
  );

  let nextSlot = 300;
  let added = 0;
  const needed = TARGET - pool.rows.length;
  console.log("Need to add:", needed);

  for (const storeId of PRIORITY_STORES) {
    if (added >= needed) break;
    const canAdd = MAX_PER_STORE - (storeCounts[storeId] || 0);
    if (canAdd <= 0) continue;

    const deals = await db.prepare(`
      SELECT d.id, d.store_id, d.product_name, d.product_category, d.product_url, d.sale_price
      FROM deals d
      WHERE d.store_id = ? AND d.is_active = 1
        AND lower(coalesce(d.availability,'')) = 'in_stock'
        AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m','now'))
        AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
      ORDER BY d.last_pool_used_at ASC NULLS FIRST
      LIMIT 20
    `).all(storeId, poolDate);

    let addedFromStore = 0;
    for (const deal of deals) {
      if (added >= needed || addedFromStore >= canAdd) break;
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
      console.log(`  Added slot ${nextSlot}: [${deal.store_id}] ${deal.product_name} €${deal.sale_price}`);
      nextSlot++;
      added++;
      addedFromStore++;
    }
  }

  const final = await getDailyDealsPool(db, { poolDate, limit: 24, allowGenerate: false });
  const finalStoreCounts = {};
  for (const r of final.rows) finalStoreCounts[r.store_id] = (finalStoreCounts[r.store_id] || 0) + 1;
  console.log("\nFinal store counts:", finalStoreCounts);
  console.log("Final pool size:", final.rows.length);
  const violations = Object.entries(finalStoreCounts).filter(([, c]) => c > MAX_PER_STORE);
  if (violations.length) console.log("VIOLATIONS:", violations);
  else console.log("All stores within cap of", MAX_PER_STORE);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
