"use strict";

const crypto = require("crypto");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function createRefreshSession(
  db,
  { id, userId, tokenHash, expiresAt },
) {
  await db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, userId, tokenHash, expiresAt);
}

async function getRefreshSession(db, tokenHash) {
  const session = await db
    .prepare(
      `SELECT id, user_id, token_hash, expires_at, revoked_at
       FROM refresh_tokens
       WHERE token_hash = ?
       LIMIT 1`,
    )
    .get(tokenHash);

  if (!session || session.revoked_at) return null;
  if (Date.parse(session.expires_at) <= Date.now()) return null;
  return session;
}

async function revokeRefreshSession(db, tokenHash) {
  await db.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = ?
     WHERE token_hash = ?
       AND revoked_at IS NULL`,
  ).run(new Date().toISOString(), tokenHash);
}

async function revokeAllUserSessions(db, userId) {
  await db.prepare(
    `UPDATE refresh_tokens
     SET revoked_at = ?
     WHERE user_id = ?
       AND revoked_at IS NULL`,
  ).run(new Date().toISOString(), userId);
}

function redisEnabled() {
  return false;
}

async function cacheUser() {
  return false;
}

async function getCachedUser() {
  return null;
}

async function getCachedUserByEmail() {
  return null;
}

async function getCachedUserIdByReferralCode() {
  return null;
}

async function getCachedWaitlistInviteeIds() {
  return [];
}

async function cacheJsonValue() {
  return false;
}

async function getCachedJsonValue() {
  return null;
}

async function cacheList() {
  return false;
}

async function getCachedList() {
  return null;
}

async function getCachedUserLists() {
  return [];
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
