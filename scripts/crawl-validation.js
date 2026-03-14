"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { adapters } = require("../crawler");

function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => {
      clearTimeout(timer);
      reject(
        Object.assign(new Error(`Adapter timeout after ${ms}ms`), {
          code: "ADAPTER_TIMEOUT",
        }),
      );
    }, ms);
  });
}

async function runAdapter(adapter, timeoutMs) {
  const started = Date.now();
  try {
    const deals = await Promise.race([
      Promise.resolve(adapter.scrape()),
      timeoutPromise(timeoutMs),
    ]);
    const count = Array.isArray(deals) ? deals.length : 0;
    const status = count > 0 ? "ok" : "empty";
    const durationMs = Date.now() - started;
    return {
      store_id: adapter.storeId,
      store_name: adapter.storeName,
      status,
      deals_count: count,
      duration_ms: durationMs,
      error: null,
    };
  } catch (error) {
    const durationMs = Date.now() - started;
    return {
      store_id: adapter.storeId,
      store_name: adapter.storeName,
      status: "error",
      deals_count: 0,
      duration_ms: durationMs,
      error: error.message || "unknown error",
    };
  }
}

function pickAdapters() {
  const requested = String(process.env.CRAWL_VALIDATE_STORES || "").trim();
  if (!requested) return adapters;

  const set = new Set(
    requested
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return adapters.filter((adapter) => set.has(adapter.storeId));
}

async function main() {
  const timeoutMs = Math.max(
    10000,
    parseInt(process.env.CRAWL_VALIDATE_TIMEOUT_MS || "45000", 10),
  );
  const limit = Math.max(
    0,
    parseInt(process.env.CRAWL_VALIDATE_LIMIT || "0", 10),
  );
  const selected = pickAdapters();
  const target = limit > 0 ? selected.slice(0, limit) : selected;

  const rows = [];
  for (const adapter of target) {
    const result = await runAdapter(adapter, timeoutMs);
    rows.push(result);
  }

  const ok = rows.filter((row) => row.status === "ok").length;
  const empty = rows.filter((row) => row.status === "empty").length;
  const err = rows.filter((row) => row.status === "error").length;
  const successRate = rows.length > 0 ? ok / rows.length : 0;
  const totalDeals = rows.reduce(
    (acc, row) => acc + Number(row.deals_count || 0),
    0,
  );

  const payload = {
    generated_at: new Date().toISOString(),
    timeout_ms: timeoutMs,
    stores_attempted: rows.length,
    stores_succeeded: ok,
    stores_empty: empty,
    stores_failed: err,
    success_rate: successRate,
    success_rate_pct: Math.round(successRate * 10000) / 100,
    total_deals: totalDeals,
    rows,
  };

  const outPath = String(process.env.CRAWL_VALIDATE_OUTPUT || "").trim();
  if (outPath) {
    const abs = path.isAbsolute(outPath)
      ? outPath
      : path.join(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(payload, null, 2));
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  const minSuccess = Number(process.env.CRAWL_VALIDATE_MIN_SUCCESS || 0);
  if (minSuccess > 0 && successRate < minSuccess) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
