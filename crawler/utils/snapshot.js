"use strict";

const crypto = require("crypto");

const DEFAULT_LOCK_KEY = "deals-full-crawl";
const DEFAULT_LOCK_TTL_MINUTES = Math.max(
  30,
  parseInt(process.env.CRAWL_LOCK_TTL_MINUTES || "180", 10),
);

function nowIso() {
  return new Date().toISOString();
}

function futureIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

async function acquireCrawlLock(db, options = {}) {
  const lockKey = String(options.lockKey || DEFAULT_LOCK_KEY);
  const ownerId = String(options.ownerId || crypto.randomUUID());
  const acquiredAt = nowIso();
  const expiresAt = futureIso(
    Math.max(1, Number(options.ttlMinutes || DEFAULT_LOCK_TTL_MINUTES)),
  );

  const result = await db.prepare(
    `INSERT INTO crawl_locks (lock_key, owner_id, acquired_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(lock_key) DO UPDATE SET
       owner_id = excluded.owner_id,
       acquired_at = excluded.acquired_at,
       expires_at = excluded.expires_at
     WHERE crawl_locks.expires_at <= ?
        OR crawl_locks.owner_id = ?`,
  ).run(lockKey, ownerId, acquiredAt, expiresAt, acquiredAt, ownerId);

  return {
    acquired: Number(result?.changes || 0) > 0,
    lockKey,
    ownerId,
    expiresAt,
  };
}

async function releaseCrawlLock(db, options = {}) {
  const lockKey = String(options.lockKey || DEFAULT_LOCK_KEY);
  const ownerId = String(options.ownerId || "");
  if (!ownerId) return false;

  const result = await db.prepare(
    `DELETE FROM crawl_locks
     WHERE lock_key = ?
       AND owner_id = ?`,
  ).run(lockKey, ownerId);

  return Number(result?.changes || 0) > 0;
}

async function isCrawlLocked(db, options = {}) {
  const lockKey = String(options.lockKey || DEFAULT_LOCK_KEY);
  const now = nowIso();
  const row = await db.prepare(
    `SELECT owner_id, expires_at
     FROM crawl_locks
     WHERE lock_key = ?
     LIMIT 1`,
  ).get(lockKey);

  if (!row) return false;
  if (String(row.expires_at || "") <= now) {
    await db.prepare(
      `DELETE FROM crawl_locks
       WHERE lock_key = ?
         AND expires_at <= ?`,
    ).run(lockKey, now);
    return false;
  }

  return true;
}

module.exports = {
  acquireCrawlLock,
  releaseCrawlLock,
  isCrawlLocked,
};
