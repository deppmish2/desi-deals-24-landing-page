"use strict";
/**
 * build-seed.js — runs during Vercel build and writes active deals to
 * server/deals-seed.json. It prefers already-active DB data and falls back to
 * a crawl only when the dataset is empty.
 */
const path = require("path");
const fs = require("fs");

const SEED_PATH = path.join(__dirname, "../server/deals-seed.json");

async function readActiveDeals(db) {
  return await db.prepare("SELECT * FROM deals WHERE is_active = 1").all();
}

async function main() {
  console.log("\n[build-seed] Preparing deployment seed data...\n");

  const db = require("../server/db");
  const { runCrawl } = require("../crawler");

  try {
    let source = "database";
    let deals = await readActiveDeals(db);

    if (deals.length === 0) {
      source = "crawl";
      console.log(
        "[build-seed] No active deals found in DB. Falling back to pre-build crawl...",
      );
      const result = await runCrawl(db).catch(() => null);
      deals = await readActiveDeals(db);
      if (result?.skipped) {
        console.log(`[build-seed] Crawl summary: skipped (${result.reason})`);
      } else if (result) {
        console.log(
          `[build-seed] Crawl summary: ${result.storesSucceeded ?? 0}/${result.storesAttempted ?? 0} stores succeeded`,
        );
      }
    }

    if (deals.length > 0) {
      fs.writeFileSync(SEED_PATH, JSON.stringify(deals));
      console.log(
        `\n[build-seed] ✓ Saved ${deals.length} deals to server/deals-seed.json (source: ${source})`,
      );
    } else {
      const existingSeed = fs.existsSync(SEED_PATH)
        ? String(fs.readFileSync(SEED_PATH, "utf8")).trim()
        : "";
      const existingEmpty = !existingSeed || existingSeed === "[]";
      console.warn(
        "\n[build-seed] ⚠ No active deals found from database/crawl — keeping existing seed file.",
      );
      if (existingEmpty) {
        console.warn(
          "[build-seed] ⚠ Existing seed file is empty. Deployment may start without price data.",
        );
      }
    }
  } catch (e) {
    console.error(
      "\n[build-seed] Seed preparation failed (non-fatal):",
      e.message,
    );
    console.log("[build-seed] Continuing build with existing seed file.");
  }
}

main().catch((e) => {
  console.error("[build-seed] Unexpected error:", e.message);
  process.exit(0); // never block the build
});
