#!/usr/bin/env node
"use strict";
/**
 * run-automapper-all-deals.js
 *
 * One-time post-migration step: loads all active deals and all
 * is_match_priority=1 canonicals, then runs autoMapDeals to create new
 * deal_mappings for previously unmatched deals.
 *
 * Uses INSERT OR IGNORE — does NOT wipe existing mappings.
 * Rows with verified_at IS NOT NULL are preserved unconditionally.
 *
 * Usage:
 *   node scripts/run-automapper-all-deals.js
 *   node scripts/run-automapper-all-deals.js --dry-run
 */

require("dotenv").config();
const db = require("../server/db");
const { loadPriorityCanonicals, autoMapDeals } = require("../crawler/utils/auto-mapper");

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  await db.ready;

  console.log("[run-automapper] Loading is_match_priority canonicals…");
  const canonicals = await loadPriorityCanonicals(db);
  console.log(`[run-automapper] Loaded ${canonicals.length} canonicals`);

  if (canonicals.length === 0) {
    console.log("[run-automapper] No match-priority canonicals found. Run migrate-canonical-slots.js first.");
    return;
  }

  const res = await db.execute(
    `SELECT id, product_url, product_name, weight_value, weight_unit
     FROM deals
     WHERE is_active = 1`,
  );
  const deals = res.rows ?? [];
  console.log(`[run-automapper] Loaded ${deals.length} active deals`);

  if (DRY_RUN) {
    console.log("[run-automapper] DRY RUN — no writes will be made");
    // Simulate matching without DB writes
    let wouldMap = 0;
    const { matchesCanonical } = require("../crawler/utils/auto-mapper");
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    for (const deal of deals) {
      for (const canon of canonicals) {
        const result = matchesCanonical(
          norm(deal.product_name),
          deal.weight_value,
          deal.weight_unit,
          canon,
        );
        if (result === true) { wouldMap++; break; }
        // Legacy path
        if (result === null) {
          const normed = norm(deal.product_name);
          const brand = canon.normed.split(" ")[0];
          const matched = [canon.normed, ...canon.aliases].filter(Boolean).some((t) => {
            if (t.length < 4 || !normed.includes(t)) return false;
            if (t !== canon.normed && brand && !normed.includes(brand)) return false;
            return true;
          });
          if (matched) { wouldMap++; break; }
        }
      }
    }
    console.log(`[run-automapper] Would create up to ${wouldMap} new mappings`);
    return;
  }

  const mapped = await autoMapDeals(db, deals, canonicals);
  console.log(`[run-automapper] Created ${mapped} new deal_mappings (INSERT OR IGNORE)`);
}

main().catch((e) => {
  console.error("[run-automapper] Fatal:", e);
  process.exit(1);
});
