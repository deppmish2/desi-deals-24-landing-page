"use strict";
/**
 * Remove dead pool entries (is_active=0) and refill to 24 with active deals.
 * Max 3 per store, prefers stores with fewest current slots.
 *
 * Flags:
 *   --force   Wipe today's pool entirely and rebuild from scratch via ensureDailyDealsPool.
 *             Use after a full crawl to start with a clean slate.
 */
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const crypto = require("crypto");
const db = require("../server/db");
const {
  ensureDailyDealsPool,
  getCurrentPoolDate,
} = require("../server/services/daily-deals-pool");

const MAX_PER_STORE = 3;
const TARGET = 24;
const MIN_DISCOUNT = Number(process.env.DAILY_POOL_MIN_DISCOUNT_PCT || 20);
const FORCE_REBUILD = process.argv.includes("--force");

db.ready
  .then(async () => {
    const poolDate = getCurrentPoolDate();

    // --force: nuke the existing pool and regenerate clean via standard builder
    if (FORCE_REBUILD) {
      console.log(
        `[rebuild-pool] --force: deleting pool for ${poolDate} and rebuilding...`,
      );
      await db
        .prepare(`DELETE FROM daily_deal_pool_entries WHERE pool_date = ?`)
        .run(poolDate);
      const pool = await ensureDailyDealsPool(db, {
        poolDate,
        allowGenerate: true,
      });
      console.log(`[rebuild-pool] Done. Pool size: ${pool.entries.length}`);
      process.exit(0);
    }
    const now = new Date().toISOString();

    // 1. Remove pool entries whose deal is inactive or has no discount
    const allEntries = await db
      .prepare(
        `
    SELECT e.slot_index, e.deal_id, e.store_id, e.product_name_snapshot,
           d.is_active, d.discount_percent, d.original_price, d.sale_price
    FROM daily_deal_pool_entries e
    LEFT JOIN deals d ON d.id = e.deal_id
    WHERE e.pool_date = ?
  `,
      )
      .all(poolDate);

    const deadSlots = allEntries.filter((e) => {
      if (!e.is_active || e.is_active === 0) return true;
      return !(e.discount_percent >= MIN_DISCOUNT);
    });
    console.log("Removing dead/no-discount slots:", deadSlots.length);
    for (const e of deadSlots) {
      await db
        .prepare(
          "DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?",
        )
        .run(poolDate, e.slot_index);
      console.log(`  Removed slot ${e.slot_index}: ${e.product_name_snapshot}`);
    }

    // 2. Check current state — query TODAY's entries directly to avoid stale-pool fallback
    const todayEntries = await db
      .prepare(
        `SELECT e.slot_index, e.deal_id, e.store_id, e.product_signature
     FROM daily_deal_pool_entries e WHERE e.pool_date = ? ORDER BY e.slot_index ASC`,
      )
      .all(poolDate);

    // Materialize: which of today's entries still point to an eligible active deal
    const activeDealIdSet = new Set(
      (
        await db
          .prepare(
            `
      SELECT id FROM deals
      WHERE is_active = 1
        AND lower(coalesce(availability,'')) = 'in_stock'
        AND (best_before IS NULL OR best_before >= strftime('%Y-%m','now'))
        AND discount_percent IS NOT NULL AND discount_percent >= ${MIN_DISCOUNT}
    `,
          )
          .all()
      ).map((r) => String(r.id)),
    );
    const materializedToday = todayEntries.filter((e) =>
      activeDealIdSet.has(String(e.deal_id)),
    );
    console.log(
      "\nPool after cleanup:",
      materializedToday.length,
      "materialized",
    );

    const storeCounts = {};
    for (const e of materializedToday)
      storeCounts[e.store_id] = (storeCounts[e.store_id] || 0) + 1;
    console.log("Store counts:", storeCounts);

    const usedSigs = new Set(todayEntries.map((r) => r.product_signature));
    const usedDealIds = new Set(
      todayEntries.filter((r) => r.deal_id != null).map((r) => r.deal_id),
    );

    // 3. Get all eligible active deals not in pool, ordered by store diversity then last_pool_used_at
    const candidates = await db
      .prepare(
        `
    SELECT d.id, d.store_id, d.product_name, d.product_category, d.product_url, d.sale_price
    FROM deals d
    WHERE d.is_active = 1
      AND lower(coalesce(d.availability,'')) = 'in_stock'
      AND (d.best_before IS NULL OR d.best_before >= strftime('%Y-%m','now'))
      AND d.discount_percent IS NOT NULL AND d.discount_percent >= ${MIN_DISCOUNT}
      AND d.id NOT IN (SELECT deal_id FROM daily_deal_pool_entries WHERE pool_date = ? AND deal_id IS NOT NULL)
    ORDER BY d.last_pool_used_at ASC NULLS FIRST
    LIMIT 3000
  `,
      )
      .all(poolDate);

    console.log("\nCandidates available:", candidates.length);
    console.log("Need to add:", TARGET - materializedToday.length);

    // Use a slot well above any existing ones
    const maxSlotRow = await db
      .prepare(
        "SELECT MAX(slot_index) as m FROM daily_deal_pool_entries WHERE pool_date = ?",
      )
      .get(poolDate);
    let nextSlot = Math.max(1000, (maxSlotRow?.m || 0) + 1);
    let added = 0;
    const needed = TARGET - materializedToday.length;

    for (const deal of candidates) {
      if (added >= needed) break;
      if ((storeCounts[deal.store_id] || 0) >= MAX_PER_STORE) continue;
      const sig = crypto
        .createHash("md5")
        .update(deal.product_url)
        .digest("hex");
      if (usedSigs.has(sig) || usedDealIds.has(deal.id)) continue;

      await db
        .prepare(
          `
      INSERT INTO daily_deal_pool_entries (pool_date, slot_index, deal_id, store_id, base_key, product_signature, category, product_name_snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          poolDate,
          nextSlot,
          deal.id,
          deal.store_id,
          deal.product_url,
          sig,
          deal.product_category,
          deal.product_name,
          now,
        );

      const ok = activeDealIdSet.has(String(deal.id));

      if (!ok) {
        await db
          .prepare(
            "DELETE FROM daily_deal_pool_entries WHERE pool_date = ? AND slot_index = ?",
          )
          .run(poolDate, nextSlot);
        continue;
      }

      await db
        .prepare("UPDATE deals SET last_pool_used_at = ? WHERE id = ?")
        .run(now, deal.id);
      usedSigs.add(sig);
      usedDealIds.add(deal.id);
      storeCounts[deal.store_id] = (storeCounts[deal.store_id] || 0) + 1;
      console.log(
        `  Added [${deal.store_id}] ${deal.product_name} €${deal.sale_price}`,
      );
      nextSlot++;
      added++;
    }

    // 4. Final check — count directly from DB, no stale-fallback risk
    const finalEntries = await db
      .prepare(
        `SELECT e.deal_id, e.store_id FROM daily_deal_pool_entries e WHERE e.pool_date = ? ORDER BY e.slot_index ASC`,
      )
      .all(poolDate);
    const finalMaterialized = finalEntries.filter((e) =>
      activeDealIdSet.has(String(e.deal_id)),
    );
    const finalStoreCounts = {};
    for (const e of finalMaterialized)
      finalStoreCounts[e.store_id] = (finalStoreCounts[e.store_id] || 0) + 1;
    console.log("\nFinal store counts:", finalStoreCounts);
    console.log("Final pool size:", finalMaterialized.length);
    const violations = Object.entries(finalStoreCounts).filter(
      ([, c]) => c > MAX_PER_STORE,
    );
    if (violations.length) console.log("VIOLATIONS:", violations);
    else console.log("All stores within cap. Done.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
