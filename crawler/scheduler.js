"use strict";

const cron = require("node-cron");

const { runCrawl } = require("./index");
const { BERLIN_TIME_ZONE } = require("../server/services/berlin-time");

function startScheduler(db) {
  cron.schedule(
    "0 8 * * *",
    async () => {
      console.log("[scheduler] Starting 08:00 Europe/Berlin crawl...");
      try {
        await runCrawl(db, { triggerType: "local_scheduler" });
      } catch (error) {
        console.error("[scheduler] Crawl error:", error.message);
      }
    },
    { timezone: BERLIN_TIME_ZONE },
  );

  console.log("[scheduler] Scheduled daily crawl at 08:00 Europe/Berlin");

  if (process.env.CRAWL_ON_STARTUP === "true") {
    console.log("[scheduler] Running startup crawl...");
    setTimeout(() => {
      runCrawl(db, { triggerType: "startup" }).catch((error) =>
        console.error("[scheduler] Startup crawl error:", error.message),
      );
    }, 2000);
  }
}

module.exports = { startScheduler };
