"use strict";

/**
 * Sends an ops failure notification.
 * Called from GitHub Actions `Notify on failure` step.
 * Reads context from environment variables injected by the workflow.
 *
 * Usage:
 *   FAILED_STEP=crawl RUN_URL=https://... node scripts/ops-notify.js
 */

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const { notifyCrawlFailure } = require("../server/services/ops-notifier");

async function main() {
  const failedStep = process.env.FAILED_STEP || "unknown";
  const runUrl = process.env.RUN_URL || "";
  const errorMessage = process.env.FAILED_STEP_ERROR || "";

  console.log(`[ops-notify] Sending failure notification for step: ${failedStep}`);

  await notifyCrawlFailure({ failedStep, runUrl, errorMessage });

  console.log("[ops-notify] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[ops-notify] Failed to send notification:", err.message);
  // Exit 0 — notification failure must never block the workflow
  process.exit(0);
});
