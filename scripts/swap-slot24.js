"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const db = require("../server/db");
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

const CANDIDATES = [
  "https://www.jamoona.com/products/daawat-2kg-original-basmati-rice",
  "https://www.jamoona.com/products/rubicon-1l-guava-juice",
  "https://www.jamoona.com/products/schani-1kg-brown-chickpeas-kala-chana",
  "https://www.jamoona.com/products/pg-tips-300-pyramid-teabags",
  "https://www.jamoona.com/products/daawat-10kg-chakki-atta-whole-wheat-flour",
];

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const now = new Date().toISOString();

  // Remove Rooh Afza (slot 23)
  await db.prepare(
    "DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = 23"
  ).run(poolDate);
  console.log("Removed slot 23 (Rooh Afza)");

  for (const url of CANDIDATES) {
    const deal = await db.prepare(
      "SELECT * FROM deals WHERE product_url = ? AND is_active = 1 LIMIT 1"
    ).get(url);
    if (!deal) { console.log("Not found:", url); continue; }

    const sig = require("crypto").createHash("md5").update(deal.product_url).digest("hex");
    // Check signature not already in pool
    const exists = await db.prepare(
      "SELECT 1 FROM daily_deal_pool_entries WHERE pool_date = ? AND product_signature = ?"
    ).get(poolDate, sig);
    if (exists) { console.log("Already in pool:", deal.product_name); continue; }

    await db.prepare(`
      INSERT INTO daily_deal_pool_entries (pool_date, slot_index, deal_id, store_id, base_key, product_signature, category, product_name_snapshot, created_at)
      VALUES (?, 23, ?, ?, ?, ?, ?, ?, ?)
    `).run(poolDate, deal.id, deal.store_id, deal.product_url, sig, deal.product_category, deal.product_name, now);

    await db.prepare("UPDATE deals SET last_pool_used_at = ? WHERE id = ?").run(now, deal.id);
    console.log("Inserted slot 23:", deal.product_name);

    // Verify materialization
    const pool = await getDailyDealsPool(db, { poolDate, limit: 24, allowGenerate: false });
    console.log("Materialized rows:", pool.rows.length);

    if (pool.rows.length === 24) {
      console.log("SUCCESS — pool is now 24");
      process.exit(0);
    } else {
      console.log("Still dropping — trying next candidate");
      await db.prepare(
        "DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = 23"
      ).run(poolDate);
    }
  }

  console.log("No valid candidate found from list");
  process.exit(1);
}).catch(e => { console.error(e); process.exit(1); });
