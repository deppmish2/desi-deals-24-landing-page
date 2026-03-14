"use strict";
const cron = require("node-cron");
const { runCrawl } = require("./index");

function startScheduler(db) {
  const hours = parseInt(process.env.CRAWL_INTERVAL_HOURS || "24");
  // Run at 6am daily (or every N hours via cron expression)
  const cronExpr = hours === 24 ? "0 6 * * *" : `0 */${hours} * * *`;

  cron.schedule(cronExpr, async () => {
    console.log("[scheduler] Starting scheduled crawl...");
    try {
      await runCrawl(db);
    } catch (e) {
      console.error("[scheduler] Crawl error:", e.message);
    }
  });

  console.log(`[scheduler] Crawl scheduled: ${cronExpr}`);

  // Optionally run immediately on startup
  if (process.env.CRAWL_ON_STARTUP === "true") {
    console.log("[scheduler] Running startup crawl...");
    setTimeout(
      () =>
        runCrawl(db).catch((e) =>
          console.error("[scheduler] Startup crawl error:", e),
        ),
      2000,
    );
  }
}

module.exports = { startScheduler };
