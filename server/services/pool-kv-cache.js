"use strict";

/**
 * Vercel KV cache for the daily deal pool.
 *
 * The daily pool is fixed once per day — it's the perfect candidate for an
 * edge cache: computed once at 06:00 Berlin, read thousands of times until
 * midnight. Every KV hit saves a Turso TCP round-trip and eliminates cold-start
 * sensitivity on the hot path.
 *
 * Design decisions:
 *  - Falls back silently when KV env vars are missing (local dev / non-Vercel).
 *  - TTL is set to seconds-until-Berlin-midnight so the key auto-expires.
 *  - Writes are fire-and-forget from the request handler (non-blocking).
 *  - The invalidation script (scripts/invalidate-kv-cache.js) deletes the key
 *    immediately after each crawl so the next request reads fresh DB data.
 */

const fetch = require("node-fetch");

const { BERLIN_TIME_ZONE, getZonedParts } = require("./berlin-time");

const KV_PREFIX = "pool";

function kvConfigured() {
  return (
    Boolean(process.env.KV_REST_API_URL) &&
    Boolean(process.env.KV_REST_API_TOKEN)
  );
}

async function runKvPipeline(commands) {
  if (!kvConfigured()) return null;

  const res = await fetch(`${process.env.KV_REST_API_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    timeout: 10000,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`KV REST failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Returns seconds from now until midnight in Berlin time.
 * This is the TTL we set on KV entries — the key auto-expires at pool rollover.
 */
function secondsUntilBerlinMidnight() {
  const now = new Date();
  const parts = getZonedParts(now, BERLIN_TIME_ZONE);

  const elapsedSecondsToday =
    parts.hour * 3600 + parts.minute * 60 + parts.second;
  const secondsInDay = 24 * 3600;
  const remaining = secondsInDay - elapsedSecondsToday;
  // Add a small buffer so the key doesn't expire exactly at midnight rollover
  return Math.max(60, remaining + 30);
}

function cacheKey(poolDate) {
  return `${KV_PREFIX}:${poolDate}`;
}

/**
 * Read a pool from KV.
 * Returns the parsed pool object, or null on miss / error / unconfigured.
 */
async function getPoolFromKv(poolDate) {
  if (!kvConfigured()) return null;

  try {
    const response = await runKvPipeline([["GET", cacheKey(poolDate)]]);
    const value = response?.[0]?.result;
    if (!value) return null;
    return JSON.parse(value);
  } catch (err) {
    console.warn("[pool-kv-cache] get failed (non-fatal):", err.message);
    return null;
  }
}

/**
 * Write a pool to KV with a TTL that expires at Berlin midnight.
 * Fire-and-forget — callers should not await unless they need confirmation.
 */
async function setPoolInKv(poolDate, pool) {
  if (!kvConfigured()) return;

  try {
    const ttl = secondsUntilBerlinMidnight();
    await runKvPipeline([
      ["SET", cacheKey(poolDate), JSON.stringify(pool), "EX", String(ttl)],
    ]);
    console.log(
      `[pool-kv-cache] Cached pool:${poolDate} (TTL ${ttl}s)`,
    );
  } catch (err) {
    console.warn("[pool-kv-cache] set failed (non-fatal):", err.message);
  }
}

/**
 * Delete a pool entry from KV (called by invalidation script after crawl).
 */
async function deletePoolFromKv(poolDate) {
  if (!kvConfigured()) return false;

  try {
    const response = await runKvPipeline([["DEL", cacheKey(poolDate)]]);
    const deleted = Number(response?.[0]?.result || 0);
    console.log(`[pool-kv-cache] Invalidated pool:${poolDate}`);
    return deleted > 0;
  } catch (err) {
    console.warn("[pool-kv-cache] delete failed:", err.message);
    return false;
  }
}

module.exports = {
  getPoolFromKv,
  setPoolInKv,
  deletePoolFromKv,
  kvConfigured,
};
