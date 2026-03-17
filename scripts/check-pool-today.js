"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const db = require("../server/db");
const { getCurrentPoolDate } = require("../server/services/daily-deals-pool");

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const rows = await db.prepare(`
    SELECT e.slot_index, e.store_id, e.product_name_snapshot, e.deal_id,
           d.is_active, d.discount_percent, d.availability
    FROM daily_deal_pool_entries e
    LEFT JOIN deals d ON d.id = e.deal_id
    WHERE e.pool_date = ?
    ORDER BY e.slot_index
  `).all(poolDate);

  console.log("Pool date:", poolDate, "| Entries:", rows.length);
  rows.forEach((r) => {
    const flags = [];
    if (r.is_active !== 1) flags.push("INACTIVE");
    if (r.availability !== "in_stock") flags.push("NOT-IN-STOCK");
    if (!(r.discount_percent > 0)) flags.push("NO-DISCOUNT");
    const label = flags.length ? " <<< " + flags.join(", ") : "";
    console.log(`[${r.slot_index}] [${r.store_id}] ${(r.product_name_snapshot || "").slice(0, 50)}${label}`);
  });
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
