"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const db = require("../server/db");
const { resolveBaseProduct } = require("../server/services/base-product-catalog");
const { getCurrentPoolDate } = require("../server/services/daily-deals-pool");

db.ready.then(async () => {
  const poolDate = getCurrentPoolDate();

  const allActive = await db.prepare(`
    SELECT d.id, d.store_id, d.product_name, d.product_category, d.sale_price, d.product_url
    FROM deals d
    WHERE d.is_active = 1
      AND lower(coalesce(d.availability,'')) = 'in_stock'
      AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m','now'))
      AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
  `).all(poolDate);

  console.log("Total active not-in-pool:", allActive.length);

  const materializable = allActive.filter(d => {
    const r = resolveBaseProduct(d.product_name);
    return r && r.base_key;
  });

  console.log("Materializable:", materializable.length);

  // Group by store
  const byStore = {};
  for (const d of materializable) {
    byStore[d.store_id] = (byStore[d.store_id] || []);
    byStore[d.store_id].push(d);
  }
  console.log("\nBy store:");
  Object.entries(byStore).sort((a,b) => b[1].length - a[1].length)
    .forEach(([s, ds]) => console.log(`  ${s}: ${ds.length}`));

  console.log("\nSample materializable deals:");
  materializable.slice(0, 20).forEach(d => console.log(`  [${d.store_id}] ${d.product_name} €${d.sale_price}`));

  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
