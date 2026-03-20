"use strict";

const cron = require("node-cron");

const { runCrawl } = require("./index");
const { isCrawlLocked } = require("./utils/snapshot");
const {
  ensureDailyDealsPool,
  getCurrentPoolDate,
} = require("../server/services/daily-deals-pool");
const { BERLIN_TIME_ZONE } = require("../server/services/berlin-time");

function startScheduler(db) {
  cron.schedule(
    "0 6 * * *",
    async () => {
      console.log("[scheduler] Starting 06:00 Europe/Berlin crawl...");
      try {
        await runCrawl(db, { triggerType: "local_scheduler" });
      } catch (error) {
        console.error("[scheduler] Crawl error:", error.message);
      }
    },
    { timezone: BERLIN_TIME_ZONE },
  );

  cron.schedule(
    "0 7 * * *",
    async () => {
      console.log("[scheduler] Preparing 07:00 Europe/Berlin daily pool...");
      try {
        const crawling = await isCrawlLocked(db).catch(() => false);
        if (crawling) {
          console.log("[scheduler] Skipped daily pool refresh because crawl is still running.");
          return;
        }
        await ensureDailyDealsPool(db, {
          poolDate: getCurrentPoolDate(),
        });
      } catch (error) {
        console.error("[scheduler] Daily pool error:", error.message);
      }
    },
    { timezone: BERLIN_TIME_ZONE },
  );

  console.log(
    "[scheduler] Scheduled daily crawl at 06:00 and daily pool at 07:00 Europe/Berlin",
  );

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
