"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const { v4: uuidv4 } = require("uuid");
const { parseBestBefore } = require("./utils/best-before-parser");
const {
  saveSnapshot,
  acquireCrawlLock,
  releaseCrawlLock,
} = require("./utils/snapshot");
const {
  evaluateAlertsAfterCrawl,
} = require("../server/services/alert-evaluator");
const { canonicalizeDeals } = require("../server/services/canonicalizer");

const DELAY_MIN = parseInt(process.env.REQUEST_DELAY_MIN_MS || "2000");
const DELAY_MAX = parseInt(process.env.REQUEST_DELAY_MAX_MS || "5000");
const SNAPSHOT_EVERY_STORES = Math.max(
  1,
  parseInt(process.env.CRAWL_SNAPSHOT_EVERY_STORES || "3"),
);

const adapters = [
  // Original 5
  require("./stores/jamoona"),
  require("./stores/dookan"),
  require("./stores/grocera"),
  require("./stores/little-india"),
  require("./stores/namma-markt"),
  // Shopify stores
  require("./stores/globalfoodhub"),
  require("./stores/desigros"),
  require("./stores/zora-supermarkt"),
  require("./stores/md-store"),
  require("./stores/indiansupermarkt"),
  require("./stores/indianstorestuttgart"),
  require("./stores/anuhita-groceries"),
  require("./stores/sairas"),
  // WooCommerce stores
  require("./stores/indische-lebensmittel-online"),
  require("./stores/indianfoodstore"),
  require("./stores/swadesh"),
  require("./stores/spicelands"),
  require("./stores/annachi"),
  // Custom HTML stores
  require("./stores/namastedeutschland"),
  require("./stores/india-store"),
  require("./stores/india-express-food"),
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function randomDelay() {
  return sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN));
}

async function runCrawl(db) {
  // Acquire global Redis lock so parallel containers don't double-crawl.
  // Falls back to true (allowed) when Redis is not configured.
  const locked = await acquireCrawlLock();
  if (!locked) {
    console.log("[crawl] Another container is already crawling — skipping.");
    return { skipped: true, reason: "lock" };
  }

  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  console.log(`\n=== Crawl run ${runId} started at ${startedAt} ===`);

  try {
    // Create crawl_run record
    db.prepare(
      `INSERT INTO crawl_runs (id, started_at, status) VALUES (?, ?, 'running')`,
    ).run(runId, startedAt);

    let storesAttempted = 0,
      storesSucceeded = 0,
      dealsFound = 0;
    const errors = [];

    const insertDeal = db.prepare(`
      INSERT OR IGNORE INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
         product_url, image_url, weight_raw, weight_value, weight_unit,
         sale_price, original_price, discount_percent, price_per_kg, price_per_unit,
         currency, availability, bulk_pricing, best_before, is_active)
      VALUES
        (@id, @crawl_run_id, @crawl_timestamp, @store_id, @product_name, @product_category,
         @product_url, @image_url, @weight_raw, @weight_value, @weight_unit,
         @sale_price, @original_price, @discount_percent, @price_per_kg, @price_per_unit,
         @currency, @availability, @bulk_pricing, @best_before, 1)
    `);

    const insertMany = db.transaction((deals) => {
      for (const d of deals) insertDeal.run(d);
    });

    for (const adapter of adapters) {
      storesAttempted++;
      console.log(`\n--- Crawling: ${adapter.storeName} ---`);

      try {
        // Mark previous deals for this store as inactive before inserting new ones
        db.prepare(`UPDATE deals SET is_active = 0 WHERE store_id = ?`).run(
          adapter.storeId,
        );

        const rawDeals = await adapter.scrape();

        // Deduplicate by product_url within this crawl run
        const seen = new Set();
        const deals = rawDeals
          .filter((d) => {
            if (seen.has(d.product_url)) return false;
            seen.add(d.product_url);
            return true;
          })
          .map((d) => ({
            ...d,
            id: uuidv4(),
            crawl_run_id: runId,
            crawl_timestamp: new Date().toISOString(),
            bulk_pricing: d.bulk_pricing
              ? JSON.stringify(d.bulk_pricing)
              : null,
            best_before:
              parseBestBefore(d.product_name) || d.best_before || null,
          }));

        insertMany(deals);

        // Update store last_crawled_at
        db.prepare(
          `UPDATE stores SET last_crawled_at = ?, crawl_status = 'active' WHERE id = ?`,
        ).run(new Date().toISOString(), adapter.storeId);

        dealsFound += deals.length;
        storesSucceeded++;
        console.log(`✓ ${adapter.storeName}: ${deals.length} deals stored`);
      } catch (err) {
        console.error(`✗ ${adapter.storeName}: ${err.message}`);
        errors.push({ store_id: adapter.storeId, error_message: err.message });

        db.prepare(`UPDATE stores SET crawl_status = 'error' WHERE id = ?`).run(
          adapter.storeId,
        );
      }

      if (storesAttempted % SNAPSHOT_EVERY_STORES === 0) {
        await saveSnapshot(db);
      }

      // Polite delay between stores
      if (adapters.indexOf(adapter) < adapters.length - 1) {
        await randomDelay();
      }
    }

    // Finalize crawl run record
    const finishedAt = new Date().toISOString();
    db.prepare(
      `
      UPDATE crawl_runs SET
        finished_at = ?, status = 'completed',
        stores_attempted = ?, stores_succeeded = ?,
        deals_found = ?, errors = ?
      WHERE id = ?
    `,
    ).run(
      finishedAt,
      storesAttempted,
      storesSucceeded,
      dealsFound,
      JSON.stringify(errors),
      runId,
    );

    console.log(
      `\n=== Crawl finished: ${storesSucceeded}/${storesAttempted} stores, ${dealsFound} deals ===`,
    );

    // Persist deals to Redis so cold starts can restore instantly
    await saveSnapshot(db);

    // Canonicalize active deals after crawl write.
    try {
      await canonicalizeDeals(db, { runId });
    } catch (error) {
      console.error("[canonicalize] post-crawl mapping failed:", error.message);
    }

    // Evaluate active alerts after a successful crawl snapshot.
    try {
      await evaluateAlertsAfterCrawl(db, { runId });
    } catch (error) {
      console.error("[alerts] post-crawl evaluation failed:", error.message);
    }

    return { runId, storesAttempted, storesSucceeded, dealsFound, errors };
  } finally {
    await releaseCrawlLock();
  }
}

// Run directly: node crawler/index.js
if (require.main === module) {
  const db = require("../server/db");
  runCrawl(db)
    .then((r) => {
      console.log("Done:", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = {
  runCrawl,
  adapters,
};
