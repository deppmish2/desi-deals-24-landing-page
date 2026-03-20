"use strict";

/**
 * Ops notifications for infrastructure events — crawl failures, thin pools, etc.
 *
 * Separate from alert-notifier.js which handles user-facing price alerts.
 * Supports two channels:
 *   1. Slack webhook (SLACK_WEBHOOK_URL)
 *   2. Email via SMTP (ALERT_EMAIL_TO + existing SMTP_* env vars)
 *
 * Both channels are optional — if neither is configured the message is
 * logged to stdout so it's visible in GitHub Actions / server logs.
 */

const nodemailer = require("nodemailer");

const fetch = (() => {
  try { return require("node-fetch"); } catch { return null; }
})();

function slackConfigured() {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

async function sendSlack(text) {
  if (!slackConfigured() || !fetch) return;

  try {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      timeout: 10000,
    });
  } catch (err) {
    console.warn("[ops-notifier] Slack webhook failed:", err.message);
  }
}

async function sendEmail(subject, body) {
  if (!smtpConfigured()) return;

  const to = process.env.ALERT_EMAIL_TO;
  if (!to) return;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"DesiDeals24 Ops" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: body,
    });
  } catch (err) {
    console.warn("[ops-notifier] Email send failed:", err.message);
  }
}

/**
 * Notify ops team about a crawl failure.
 * @param {object} options
 * @param {string} options.failedStep - which step failed (crawl | pool_build | pool_verify)
 * @param {string} [options.errorMessage]
 * @param {string} [options.runUrl] - GitHub Actions run URL
 * @param {number} [options.storesSucceeded]
 * @param {number} [options.storesAttempted]
 */
async function notifyCrawlFailure(options = {}) {
  const step = options.failedStep || "unknown";
  const runUrl = options.runUrl || process.env.RUN_URL || "";
  const errorMessage = options.errorMessage || process.env.FAILED_STEP_ERROR || "";
  const storesInfo = (options.storesAttempted != null)
    ? ` (${options.storesSucceeded}/${options.storesAttempted} stores succeeded)`
    : "";

  const subject = `[DesiDeals24] Crawl failure — step: ${step}`;
  const body = [
    `Step failed: ${step}${storesInfo}`,
    errorMessage ? `Error: ${errorMessage}` : "",
    runUrl ? `Run: ${runUrl}` : "",
    `Time: ${new Date().toISOString()}`,
    "",
    "Check GitHub Actions for full logs. Last successful data is still being served.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  console.error(`[ops-notifier] ALERT — ${subject}`);
  console.error(body);

  await Promise.all([
    sendSlack(`🚨 *${subject}*\n\`\`\`${body}\`\`\``),
    sendEmail(subject, body),
  ]);
}

/**
 * Notify ops about a thin or empty daily pool.
 * @param {object} options
 * @param {string} options.poolDate
 * @param {number} options.poolSize
 * @param {number} options.minExpected
 */
async function notifyThinPool(options = {}) {
  const severity = options.poolSize === 0 ? "CRITICAL" : "WARNING";
  const subject = `[DesiDeals24] [${severity}] Thin pool — ${options.poolSize}/${options.minExpected} deals for ${options.poolDate}`;
  const body = [
    `Pool date: ${options.poolDate}`,
    `Pool size: ${options.poolSize} (minimum expected: ${options.minExpected})`,
    `Time: ${new Date().toISOString()}`,
    "",
    "Users may see fewer deals than expected. Check crawl health.",
  ].join("\n");

  console.warn(`[ops-notifier] ${severity} — ${subject}`);
  await Promise.all([
    sendSlack(`${options.poolSize === 0 ? "🔴" : "🟡"} *${subject}*\n\`\`\`${body}\`\`\``),
    sendEmail(subject, body),
  ]);
}

module.exports = {
  notifyCrawlFailure,
  notifyThinPool,
};
