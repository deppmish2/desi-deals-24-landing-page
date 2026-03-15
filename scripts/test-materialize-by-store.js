"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const crypto = require("crypto");
const db = require("../server/db");
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const now = new Date().toISOString();

  // Stores not yet at cap in pool
  const STORES_TO_TEST = ["namma-markt", "md-store", "indianstorestuttgart", "sairas", "zora-supermarkt", "globalfoodhub", "annachi", "desigros", "grocera", "swadesh", "little-india", "indiansupermarkt"];

  for (const storeId of STORES_TO_TEST) {
    const deals = await db.prepare(`
      SELECT d.id, d.product_name, d.product_url, d.sale_price
      FROM deals d
      WHERE d.store_id = ? AND d.is_active = 1
        AND lower(coalesce(d.availability,'')) = 'in_stock'
        AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m','now'))
        AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
      LIMIT 10
    `).all(storeId, poolDate);

    if (deals.length === 0) { console.log(`[${storeId}] no eligible deals`); continue; }

    // Test first eligible deal
    const deal = deals[0];
    const sig = crypto.createHash("md5").update(deal.product_url).digest("hex");
    const testSlot = 900 + STORES_TO_TEST.indexOf(storeId);

    // Remove any old test entry
    await db.prepare("DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?").run(poolDate, testSlot);

    await db.prepare(`
      INSERT INTO daily_deal_pool_entries (pool_date, slot_index, deal_id, store_id, base_key, product_signature, category, product_name_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(poolDate, testSlot, deal.id, storeId, deal.product_url, sig, "Other", deal.product_name, now);

    const check = await getDailyDealsPool(db, { poolDate, limit: 50, allowGenerate: false });
    const ok = check.rows.find(r => r.id === deal.id);

    // Clean up test
    await db.prepare("DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?").run(poolDate, testSlot);

    console.log(`[${storeId}] ${ok ? "MATERIALIZES" : "FAILS"} — ${deal.product_name}`);
  }
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
