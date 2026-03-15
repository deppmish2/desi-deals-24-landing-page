"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const db = require("../server/db");
db.ready.then(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.prepare(
    "SELECT e.slot_index, e.product_name_snapshot, d.availability, d.id FROM daily_deal_pool_entries e LEFT JOIN deals d ON d.id = e.deal_id WHERE e.pool_date = ? ORDER BY e.slot_index"
  ).all(today);
  const notInStock = rows.filter(r => (r.availability || "").toLowerCase() !== "in_stock");
  console.log("Not in_stock:", JSON.stringify(notInStock, null, 2));
  console.log("Total pool:", rows.length, "| Not in_stock:", notInStock.length);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
