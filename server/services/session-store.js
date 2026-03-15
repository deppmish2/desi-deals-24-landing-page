"use strict";

const crypto = require("crypto");
const fetch = require("node-fetch");

function normalizeEnvValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const wrappedInDoubleQuotes = text.startsWith('"') && text.endsWith('"');
  const wrappedInSingleQuotes = text.startsWith("'") && text.endsWith("'");
  if ((wrappedInDoubleQuotes || wrappedInSingleQuotes) && text.length >= 2) {
    return text.slice(1, -1).trim();
  }
  return text;
}

const REDIS_URL = normalizeEnvValue(process.env.UPSTASH_REDIS_REST_URL);
const REDIS_TOKEN = normalizeEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN);
const REDIS_HTTP_TIMEOUT_MS = Math.max(
  500,
  parseInt(process.env.REDIS_HTTP_TIMEOUT_MS || "3000", 10),
);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeRedisUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return url.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const REDIS_BASE_URL = normalizeRedisUrl(REDIS_URL);

function redisEnabled() {
  return Boolean(REDIS_BASE_URL && REDIS_TOKEN);
}

async function redisCmd(args) {
  if (!redisEnabled()) return { ok: false, reason: "disabled" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDIS_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${REDIS_BASE_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify([args]),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: "http", status: res.status, body };
    }

    const json = await res.json();
    return { ok: true, result: json?.[0]?.result ?? null };
  } catch (error) {
    return { ok: false, reason: "network", error };
  } finally {
    clearTimeout(timeout);
  }
}

function redisKey(tokenHash) {
  return `desiDeals24:auth:refresh:${tokenHash}`;
}

async function cacheSession(tokenHash, userId, ttlSeconds) {
  if (!redisEnabled()) return;
  await redisCmd([
    "SET",
    redisKey(tokenHash),
    userId,
    "EX",
    String(Math.max(1, ttlSeconds)),
  ]);
}

async function deleteCachedSession(tokenHash) {
  if (!redisEnabled()) return;
  await redisCmd(["DEL", redisKey(tokenHash)]);
}

async function upsertSession(db, { id, userId, tokenHash, expiresAt }) {
  await db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, userId, tokenHash, expiresAt);
}

async function lookupSessionFromDb(db, tokenHash) {
  return await db
    .prepare(
      `SELECT id, user_id, token_hash, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    )
    .get(tokenHash);
}

async function createRefreshSession(
  db,
  { id, userId, tokenHash, expiresAt, ttlSeconds },
) {
  await upsertSession(db, { id, userId, tokenHash, expiresAt });
  await cacheSession(tokenHash, userId, ttlSeconds);
}

async function getRefreshSession(db, tokenHash) {
  const cached = await redisCmd(["GET", redisKey(tokenHash)]);
  if (cached.ok && cached.result) {
    return { user_id: cached.result, token_hash: tokenHash, source: "redis" };
  }

  const session = await lookupSessionFromDb(db, tokenHash);
  if (!session || session.revoked_at) return null;

  if (Date.parse(session.expires_at) <= Date.now()) {
    return null;
  }

  const ttlSeconds = Math.floor(
    (Date.parse(session.expires_at) - Date.now()) / 1000,
  );
  if (ttlSeconds > 0) {
    await cacheSession(tokenHash, session.user_id, ttlSeconds);
  }

  return session;
}

async function revokeRefreshSession(db, tokenHash) {
  await db.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = ?
     WHERE token_hash = ? AND revoked_at IS NULL`,
  ).run(new Date().toISOString(), tokenHash);

  await deleteCachedSession(tokenHash);
}

async function revokeAllUserSessions(db, userId) {
  const rows = await db
    .prepare(
      `SELECT token_hash FROM refresh_tokens
     WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .all(userId);

  await db.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = ?
     WHERE user_id = ? AND revoked_at IS NULL`,
  ).run(new Date().toISOString(), userId);

  for (const row of rows) {
    await deleteCachedSession(row.token_hash);
  }
}

// ── User cache ────────────────────────────────────────────────────────────────

const USER_CACHE_TTL = 0; // persist user records in Redis without expiry
const LIST_CACHE_TTL = 30 * 24 * 60 * 60; // 30 days

function userCacheKey(userId) {
  return `desiDeals24:user:${userId}`;
}
function userEmailIndexKey(email) {
  return `desiDeals24:email:${email}`;
}
function userListIdsKey(userId) {
  return `desiDeals24:user:listIds:${userId}`;
}
function listCacheKey(listId) {
  return `desiDeals24:list:${listId}`;
}
function waitlistReferralCodeKey(referralCode) {
  return `desiDeals24:waitlist:code:${String(referralCode || "").trim().toUpperCase()}`;
}
function waitlistInviteesKey(userId) {
  return `desiDeals24:waitlist:invitees:${userId}`;
}

function buildSetArgs(key, value, ttlSeconds) {
  const args = ["SET", key, value];
  if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
    args.push("EX", String(ttlSeconds));
  }
  return args;
}

function describeRedisFailure(result) {
  if (!result) return "unknown redis failure";
  if (result.reason === "disabled") return "redis disabled";
  if (result.reason === "http") {
    return `redis http ${result.status || "error"} ${result.body || ""}`.trim();
  }
  if (result.reason === "network") {
    return `redis network ${result.error?.message || "error"}`.trim();
  }
  return result.reason || "redis write failed";
}

function assertRedisWrite(result, label, strict) {
  if (result?.ok) return;
  const message = `[session-store] ${label} failed: ${describeRedisFailure(result)}`;
  console.warn(message);
  if (strict) {
    throw new Error(message);
  }
}

async function cacheUser(user, options = {}) {
  if (!redisEnabled()) return;
  const strict = Boolean(options?.strict);
  const userResult = await redisCmd(
    buildSetArgs(userCacheKey(user.id), JSON.stringify(user), USER_CACHE_TTL),
  );
  assertRedisWrite(userResult, "cacheUser", strict);
  // Also cache email → id index so login can look users up by email on cold starts
  if (user.email) {
    const emailResult = await redisCmd(
      buildSetArgs(userEmailIndexKey(user.email), user.id, USER_CACHE_TTL),
    );
    assertRedisWrite(emailResult, "cacheUserEmail", strict);
  }
  if (user.waitlist_referral_code) {
    const codeResult = await redisCmd(
      buildSetArgs(
        waitlistReferralCodeKey(user.waitlist_referral_code),
        user.id,
        USER_CACHE_TTL,
      ),
    );
    assertRedisWrite(codeResult, "cacheReferralCode", strict);
  }
  if (user.waitlist_referrer_user_id && user.id) {
    const inviteeResult = await redisCmd([
      "SADD",
      waitlistInviteesKey(user.waitlist_referrer_user_id),
      user.id,
    ]);
    assertRedisWrite(inviteeResult, "cacheWaitlistInvitee", strict);
  }
}

async function getCachedUser(userId) {
  if (!redisEnabled()) return null;
  const cmd = await redisCmd(["GET", userCacheKey(userId)]);
  if (!cmd.ok || !cmd.result) return null;
  try {
    return JSON.parse(cmd.result);
  } catch {
    return null;
  }
}

async function getCachedUserByEmail(email) {
  if (!redisEnabled()) return null;
  const idCmd = await redisCmd(["GET", userEmailIndexKey(email)]);
  if (!idCmd.ok || !idCmd.result) return null;
  return getCachedUser(idCmd.result);
}

async function getCachedUserIdByReferralCode(referralCode) {
  if (!redisEnabled()) return null;
  const cmd = await redisCmd(["GET", waitlistReferralCodeKey(referralCode)]);
  if (!cmd.ok || !cmd.result) return null;
  return String(cmd.result);
}

async function getCachedWaitlistInviteeIds(userId) {
  if (!redisEnabled()) return [];
  const cmd = await redisCmd(["SMEMBERS", waitlistInviteesKey(userId)]);
  if (!cmd.ok || !Array.isArray(cmd.result)) return [];
  return cmd.result.map((value) => String(value || "").trim()).filter(Boolean);
}

async function cacheJsonValue(key, value, ttlSeconds = 0, options = {}) {
  if (!redisEnabled()) return false;
  const strict = Boolean(options?.strict);
  const result = await redisCmd(
    buildSetArgs(key, JSON.stringify(value), ttlSeconds),
  );
  assertRedisWrite(result, `cacheJsonValue:${key}`, strict);
  return Boolean(result?.ok);
}

async function getCachedJsonValue(key) {
  if (!redisEnabled()) return null;
  const cmd = await redisCmd(["GET", key]);
  if (!cmd.ok || !cmd.result) return null;
  try {
    return JSON.parse(cmd.result);
  } catch {
    return null;
  }
}

// ── List cache ────────────────────────────────────────────────────────────────

async function cacheList(userId, list, items) {
  if (!redisEnabled()) return;
  try {
    await redisCmd([
      "SET",
      listCacheKey(list.id),
      JSON.stringify({ list, items }),
      "EX",
      String(LIST_CACHE_TTL),
    ]);
    const idsCmd = await redisCmd(["GET", userListIdsKey(userId)]);
    let ids = [];
    if (idsCmd.ok && idsCmd.result) {
      try {
        ids = JSON.parse(idsCmd.result);
      } catch {}
    }
    if (!ids.includes(list.id)) ids.unshift(list.id);
    await redisCmd([
      "SET",
      userListIdsKey(userId),
      JSON.stringify(ids),
      "EX",
      String(LIST_CACHE_TTL),
    ]);
  } catch (e) {
    console.warn("[session-store] cacheList failed:", e.message);
  }
}

async function getCachedList(listId) {
  if (!redisEnabled()) return null;
  const cmd = await redisCmd(["GET", listCacheKey(listId)]);
  if (!cmd.ok || !cmd.result) return null;
  try {
    return JSON.parse(cmd.result);
  } catch {
    return null;
  }
}

async function getCachedUserLists(userId) {
  if (!redisEnabled()) return [];
  const idsCmd = await redisCmd(["GET", userListIdsKey(userId)]);
  if (!idsCmd.ok || !idsCmd.result) return [];
  let ids;
  try {
    ids = JSON.parse(idsCmd.result);
  } catch {
    return [];
  }
  if (!Array.isArray(ids) || ids.length === 0) return [];
  const results = [];
  for (const id of ids) {
    const cmd = await redisCmd(["GET", listCacheKey(id)]);
    if (cmd.ok && cmd.result) {
      try {
        const cached = JSON.parse(cmd.result);
        if (cached?.list) results.push(cached);
      } catch {}
    }
  }
  return results;
}

module.exports = {
  hashToken,
  createRefreshSession,
  getRefreshSession,
  revokeRefreshSession,
  revokeAllUserSessions,
  redisEnabled,
  cacheUser,
  getCachedUser,
  getCachedUserByEmail,
  getCachedUserIdByReferralCode,
  getCachedWaitlistInviteeIds,
  cacheJsonValue,
  getCachedJsonValue,
  cacheList,
  getCachedList,
  getCachedUserLists,
};
