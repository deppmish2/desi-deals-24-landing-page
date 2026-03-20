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

const { BERLIN_TIME_ZONE, getZonedParts } = require("./berlin-time");

const KV_PREFIX = "pool";

function kvConfigured() {
  return (
    Boolean(process.env.KV_REST_API_URL) &&
    Boolean(process.env.KV_REST_API_TOKEN)
  );
}

/** Lazy-load @vercel/kv to avoid hard dependency when not configured. */
function getKvClient() {
  if (!kvConfigured()) return null;
  try {
    // eslint-disable-next-line global-require
    return require("@vercel/kv");
  } catch {
    return null;
  }
}

/**
 * Returns seconds from now until midnight in Berlin time.
 * This is the TTL we set on KV entries — the key auto-expires at pool rollover.
 */
function secondsUntilBerlinMidnight() {
  const now = new Date();
  const parts = getZonedParts(now, BERLIN_TIME_ZONE);

  // Build midnight UTC for the *next* Berlin day
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayBerlinNoon = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    12,
    0,
    0,
  );
  // Tomorrow midnight Berlin = today noon Berlin + half-day + offset correction.
  // Simpler: just compute 24:00 - currentBerlinTime in seconds.
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
  const kv = getKvClient();
  if (!kv) return null;

  try {
    const value = await kv.get(cacheKey(poolDate));
    if (!value) return null;
    // @vercel/kv auto-parses JSON
    return value;
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
  const kv = getKvClient();
  if (!kv) return;

  try {
    const ttl = secondsUntilBerlinMidnight();
    await kv.set(cacheKey(poolDate), pool, { ex: ttl });
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
  const kv = getKvClient();
  if (!kv) return false;

  try {
    await kv.del(cacheKey(poolDate));
    console.log(`[pool-kv-cache] Invalidated pool:${poolDate}`);
    return true;
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
