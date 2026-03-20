"use strict";

const crypto = require("crypto");

function safeStringify(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "details_not_serializable" });
  }
}

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function startJobRun(db, options = {}) {
  const id = crypto.randomUUID();
  const startedAt = options.startedAt || new Date().toISOString();
  const jobName = String(options.jobName || "").trim();
  const triggerType = String(options.triggerType || "").trim() || null;

  if (!jobName) {
    throw new Error("jobName is required");
  }

  await db.prepare(
    `INSERT INTO job_runs
      (id, job_name, trigger_type, status, started_at, details)
     VALUES (?, ?, ?, 'running', ?, ?)`,
  ).run(id, jobName, triggerType, startedAt, safeStringify(options.details));

  return { id, jobName, triggerType, startedAt };
}

async function finishJobRun(db, run, options = {}) {
  if (!run?.id) return null;

  const finishedAt = options.finishedAt || new Date().toISOString();
  const startedAtMs = Date.parse(run.startedAt || finishedAt);
  const finishedAtMs = Date.parse(finishedAt);
  const durationMs =
    Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
      ? Math.max(0, finishedAtMs - startedAtMs)
      : null;
  const warnings = Array.isArray(options.warnings) ? options.warnings : [];
  const warningCount = Number.isFinite(Number(options.warningCount))
    ? Number(options.warningCount)
    : warnings.length;

  await db.prepare(
    `UPDATE job_runs
     SET status = ?,
         finished_at = ?,
         duration_ms = ?,
         item_count = ?,
         warning_count = ?,
         details = ?,
         error_message = ?
     WHERE id = ?`,
  ).run(
    String(options.status || "completed"),
    finishedAt,
    durationMs,
    options.itemCount == null ? null : Number(options.itemCount),
    warningCount,
    safeStringify(options.details),
    options.errorMessage ? String(options.errorMessage) : null,
    run.id,
  );

  return {
    ...run,
    status: String(options.status || "completed"),
    finishedAt,
    durationMs,
    itemCount: options.itemCount == null ? null : Number(options.itemCount),
    warningCount,
    details: options.details || null,
    errorMessage: options.errorMessage ? String(options.errorMessage) : null,
  };
}

async function latestJobRun(db, jobName) {
  const name = String(jobName || "").trim();
  if (!name) return null;

  const row = await db.prepare(
    `SELECT *
     FROM job_runs
     WHERE job_name = ?
     ORDER BY started_at DESC
     LIMIT 1`,
  ).get(name);

  if (!row) return null;
  return {
    ...row,
    item_count: row.item_count == null ? null : Number(row.item_count),
    warning_count: row.warning_count == null ? 0 : Number(row.warning_count),
    details: parseJson(row.details, null),
  };
}

async function recentJobRuns(db, jobName, limit = 10) {
  const params = [];
  let where = "";
  const name = String(jobName || "").trim();
  if (name) {
    where = "WHERE job_name = ?";
    params.push(name);
  }

  const rows = await db.prepare(
    `SELECT *
     FROM job_runs
     ${where}
     ORDER BY started_at DESC
     LIMIT ?`,
  ).all(...params, Math.max(1, Number(limit || 10)));

  return rows.map((row) => ({
    ...row,
    item_count: row.item_count == null ? null : Number(row.item_count),
    warning_count: row.warning_count == null ? 0 : Number(row.warning_count),
    details: parseJson(row.details, null),
  }));
}

module.exports = {
  finishJobRun,
  latestJobRun,
  recentJobRuns,
  startJobRun,
};
