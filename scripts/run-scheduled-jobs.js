"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { runCrawl } = require("../crawler");
const { isCrawlLocked } = require("../crawler/utils/snapshot");
const {
  ensureDailyDealsPool,
  getCurrentPoolDate,
} = require("../server/services/daily-deals-pool");
const { getBerlinHour, formatBerlinDateKey } = require("../server/services/berlin-time");
const { verifyPoolQuality } = require("./verify-pool");

function forcedJob() {
  return String(process.env.FORCE_JOB || "")
    .trim()
    .toLowerCase();
}

function shouldRunCrawl(berlinHour) {
  const force = forcedJob();
  return force === "all" || force === "crawl" || berlinHour === 6;
}

function shouldRunPool(berlinHour) {
  const force = forcedJob();
  return (
    force === "all" ||
    force === "pool" ||
    force === "verify" ||
    berlinHour >= 7
  );
}

async function main() {
  await db.ready;

  const berlinHour = getBerlinHour(new Date());
  const berlinDate = formatBerlinDateKey(new Date());
  const actions = [];

  console.log(
    `[schedule] Berlin date ${berlinDate}, hour ${berlinHour}, force=${forcedJob() || "none"}`,
  );

  if (shouldRunCrawl(berlinHour)) {
    console.log("[schedule] Running scheduled crawl...");
    const crawlResult = await runCrawl(db, {
      triggerType: "github_actions_cron",
    });
    actions.push({ job: "crawl", result: crawlResult });
  } else {
    actions.push({ job: "crawl", skipped: true, reason: "outside_window" });
  }

  if (shouldRunPool(berlinHour)) {
    const crawling = await isCrawlLocked(db).catch(() => false);
    if (crawling) {
      actions.push({ job: "pool", skipped: true, reason: "crawl_running" });
      console.log("[schedule] Skipping pool refresh because crawl is still running.");
    } else {
      const pool = await ensureDailyDealsPool(db, {
        poolDate: getCurrentPoolDate(),
      });
      const verifyResult = await verifyPoolQuality({
        triggerType: "github_actions_cron",
        poolDate: pool.poolDate,
      });
      actions.push({
        job: "pool",
        poolDate: pool.poolDate,
        entries: pool.entries.length,
        verify: verifyResult,
      });
      if (!verifyResult.ok) {
        throw new Error(
          `Pool verification failed for ${verifyResult.poolDate} (${verifyResult.poolSize} entries).`,
        );
      }
    }
  } else {
    actions.push({ job: "pool", skipped: true, reason: "outside_window" });
  }

  console.log("[schedule] Complete:", JSON.stringify(actions, null, 2));
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("[schedule] Failed:", error.message);
      process.exit(1);
    });
}

module.exports = {
  main,
};
