"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const db = require("../server/db");
const { getDailyDealsPool, getCurrentPoolDate } = require("../server/services/daily-deals-pool");

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();
  const pool = await getDailyDealsPool(db, { poolDate, limit: 24, allowGenerate: false });
  console.log("Pool entries (DB):", pool.entries.length);
  console.log("Materialized rows (API):", pool.rows.length);

  const entryIds = new Set(pool.entries.map(e => String(e.deal_id || "")));
  const rowIds = new Set(pool.rows.map(r => String(r.id || "")));

  const dropped = pool.entries.filter(e => e.deal_id && !rowIds.has(String(e.deal_id)));
  console.log("\nDropped (in DB pool but not materialized):");
  dropped.forEach(e => console.log(" slot", e.slot_index, e.product_name_snapshot, "deal_id:", e.deal_id));
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
