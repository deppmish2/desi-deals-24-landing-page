#!/usr/bin/env node
"use strict";
/**
 * run-automapper-all-deals.js
 *
 * Loads all active deals and all is_match_priority=1 canonicals, then runs
 * autoMapDeals to create deal_mappings using the slot-based matcher.
 *
 * Usage:
 *   node scripts/run-automapper-all-deals.js
 *   node scripts/run-automapper-all-deals.js --dry-run
 *   node scripts/run-automapper-all-deals.js --reset   (wipe all mappings first, then re-map)
 *
 * --reset: deletes all existing deal_mappings and clears deals.canonical_id,
 *   then re-maps every active deal through the slot-based system. Use this to
 *   purge legacy name_substring matches and start clean.
 */

require("dotenv").config();
const db = require("../server/db");
const { loadPriorityCanonicals, autoMapDeals } = require("../crawler/utils/auto-mapper");

const DRY_RUN = process.argv.includes("--dry-run");
const RESET   = process.argv.includes("--reset");

async function main() {
  await db.ready;

  if (RESET) {
    if (DRY_RUN) {
      const count = await db.execute("SELECT COUNT(*) as n FROM deal_mappings");
      console.log(`[run-automapper] DRY RUN --reset: would delete ${count.rows[0].n} deal_mappings and clear deals.canonical_id`);
    } else {
      console.log("[run-automapper] --reset: deleting all deal_mappings…");
      const del = await db.execute("DELETE FROM deal_mappings");
      console.log(`[run-automapper] Deleted all deal_mappings`);
      await db.execute("UPDATE deals SET canonical_id = NULL WHERE is_active = 1");
      console.log("[run-automapper] Cleared deals.canonical_id for all active deals");
    }
  }

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
        // null = no slots → skip (no legacy fallback)
      }
    }
    console.log(`[run-automapper] Would create up to ${wouldMap} new mappings`);
    return;
  }

  const mapped = await autoMapDeals(db, deals, canonicals);
  console.log(`[run-automapper] Created ${mapped} new deal_mappings`);

  // Sync deals.canonical_id from the new mappings (first mapping per deal wins)
  await db.execute(`
    UPDATE deals
    SET canonical_id = (
      SELECT canonical_id FROM deal_mappings
      WHERE deal_id = deals.id
      LIMIT 1
    )
    WHERE is_active = 1
  `);
  console.log("[run-automapper] Synced deals.canonical_id from new mappings");
}

main().catch((e) => {
  console.error("[run-automapper] Fatal:", e);
  process.exit(1);
});
