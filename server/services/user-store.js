"use strict";

const {
  cacheUser,
  getCachedUser,
  getCachedUserByEmail,
  getCachedUserIdByReferralCode,
  getCachedWaitlistInviteeIds,
} = require("./session-store");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeUserType(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === "basic" || normalized === "premium"
    ? normalized
    : null;
}

function upsertWaitlistReferralRow(db, referral) {
  const inviterUserId = normalizeText(referral?.inviter_user_id);
  const invitedUserId = normalizeText(referral?.invited_user_id);
  if (!inviterUserId || !invitedUserId) return null;

  db.prepare(
    `INSERT INTO waitlist_referrals (
      inviter_user_id,
      invited_user_id,
      referral_code,
      invited_email_snapshot,
      claimed_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(invited_user_id) DO UPDATE SET
      inviter_user_id = excluded.inviter_user_id,
      referral_code = COALESCE(waitlist_referrals.referral_code, excluded.referral_code),
      invited_email_snapshot = COALESCE(waitlist_referrals.invited_email_snapshot, excluded.invited_email_snapshot),
      claimed_at = COALESCE(waitlist_referrals.claimed_at, excluded.claimed_at)`,
  ).run(
    inviterUserId,
    invitedUserId,
    normalizeText(referral?.referral_code) || null,
    normalizeText(referral?.invited_email_snapshot) || null,
    referral?.claimed_at || new Date().toISOString(),
  );

  return db
    .prepare(
      `SELECT *
       FROM waitlist_referrals
       WHERE invited_user_id = ?
       LIMIT 1`,
    )
    .get(invitedUserId);
}

function restoreCachedUserToSqlite(db, cached) {
  if (!cached?.id || !cached?.email) return null;

  db.prepare(
    `INSERT INTO users (
      id,
      email,
      name,
      first_name,
      password_hash,
      google_id,
      facebook_id,
      postcode,
      city,
      dietary_prefs,
      preferred_stores,
      blocked_stores,
      preferred_brands,
      delivery_speed_pref,
      email_verified_at,
      user_type,
      waitlist_referral_code,
      waitlist_referrer_user_id,
      waitlist_unlocked_at,
      created_at,
      last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      email = excluded.email,
      name = excluded.name,
      first_name = excluded.first_name,
      password_hash = excluded.password_hash,
      google_id = excluded.google_id,
      facebook_id = excluded.facebook_id,
      postcode = excluded.postcode,
      city = excluded.city,
      dietary_prefs = excluded.dietary_prefs,
      preferred_stores = excluded.preferred_stores,
      blocked_stores = excluded.blocked_stores,
      preferred_brands = excluded.preferred_brands,
      delivery_speed_pref = excluded.delivery_speed_pref,
      email_verified_at = excluded.email_verified_at,
      user_type = excluded.user_type,
      waitlist_referral_code = excluded.waitlist_referral_code,
      waitlist_referrer_user_id = excluded.waitlist_referrer_user_id,
      waitlist_unlocked_at = excluded.waitlist_unlocked_at,
      created_at = excluded.created_at,
      last_login_at = excluded.last_login_at`,
  ).run(
    cached.id,
    cached.email,
    normalizeText(cached.name) || null,
    normalizeText(cached.first_name) || null,
    cached.password_hash || null,
    cached.google_id || null,
    cached.facebook_id || null,
    normalizeText(cached.postcode),
    cached.city || null,
    typeof cached.dietary_prefs === "string"
      ? cached.dietary_prefs
      : JSON.stringify(cached.dietary_prefs || []),
    typeof cached.preferred_stores === "string"
      ? cached.preferred_stores
      : JSON.stringify(cached.preferred_stores || []),
    typeof cached.blocked_stores === "string"
      ? cached.blocked_stores
      : JSON.stringify(cached.blocked_stores || []),
    typeof cached.preferred_brands === "string"
      ? cached.preferred_brands
      : JSON.stringify(cached.preferred_brands || {}),
    cached.delivery_speed_pref || "cheapest",
    cached.email_verified_at || null,
    normalizeUserType(cached.user_type),
    normalizeText(cached.waitlist_referral_code) || null,
    normalizeText(cached.waitlist_referrer_user_id) || null,
    cached.waitlist_unlocked_at || null,
    cached.created_at || new Date().toISOString(),
    cached.last_login_at || null,
  );

  return db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(cached.id);
}

async function findUserByIdOrCache(db, userId) {
  const id = normalizeText(userId);
  if (!id) return null;

  let user = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id);
  if (user) return user;

  const cached = await getCachedUser(id);
  if (!cached) return null;
  return restoreCachedUserToSqlite(db, cached);
}

async function findUserByEmailOrCache(db, email) {
  const normalizedEmail = normalizeText(email).toLowerCase();
  if (!normalizedEmail) return null;

  let user = db
    .prepare("SELECT * FROM users WHERE email = ? LIMIT 1")
    .get(normalizedEmail);
  if (user) return user;

  const cached = await getCachedUserByEmail(normalizedEmail);
  if (!cached) return null;
  return restoreCachedUserToSqlite(db, cached);
}

async function findUserByReferralCodeOrCache(db, referralCode) {
  const normalizedCode = normalizeText(referralCode).toUpperCase();
  if (!normalizedCode) return null;

  let user = db
    .prepare(
      `SELECT *
       FROM users
       WHERE waitlist_referral_code = ?
       LIMIT 1`,
    )
    .get(normalizedCode);
  if (user) return user;

  const cachedUserId = await getCachedUserIdByReferralCode(normalizedCode);
  if (!cachedUserId) return null;
  return findUserByIdOrCache(db, cachedUserId);
}

async function hydrateWaitlistInviteesFromCache(db, inviterUserId) {
  const inviteeIds = await getCachedWaitlistInviteeIds(inviterUserId);
  for (const inviteeId of inviteeIds) {
    // Restores missing invitee rows locally so SQL relationships still work.
    // eslint-disable-next-line no-await-in-loop
    const invitee = await findUserByIdOrCache(db, inviteeId);
    if (!invitee?.waitlist_referrer_user_id) continue;
    // eslint-disable-next-line no-await-in-loop
    const inviter = await findUserByIdOrCache(
      db,
      invitee.waitlist_referrer_user_id,
    );
    upsertWaitlistReferralRow(db, {
      inviter_user_id: invitee.waitlist_referrer_user_id,
      invited_user_id: invitee.id,
      referral_code: inviter?.waitlist_referral_code || null,
      invited_email_snapshot: invitee.email || null,
      claimed_at: invitee.created_at || invitee.last_login_at || null,
    });
  }
  return inviteeIds;
}

async function findWaitlistInviteesByReferrerOrCache(db, inviterUserId) {
  await hydrateWaitlistInviteesFromCache(db, inviterUserId);
  return db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.created_at,
         u.last_login_at,
         wr.claimed_at,
         wr.referral_code
       FROM waitlist_referrals wr
       JOIN users u ON u.id = wr.invited_user_id
       WHERE wr.inviter_user_id = ?
       ORDER BY COALESCE(wr.claimed_at, u.created_at, u.last_login_at) ASC, u.id ASC`,
    )
    .all(inviterUserId);
}

async function findWaitlistReferralByInviteeOrCache(db, invitedUserId) {
  const normalizedInviteeId = normalizeText(invitedUserId);
  if (!normalizedInviteeId) return null;

  let row = db
    .prepare(
      `SELECT *
       FROM waitlist_referrals
       WHERE invited_user_id = ?
       LIMIT 1`,
    )
    .get(normalizedInviteeId);
  if (row) return row;

  const invitee = await findUserByIdOrCache(db, normalizedInviteeId);
  if (!invitee?.waitlist_referrer_user_id) return null;

  const inviter = await findUserByIdOrCache(
    db,
    invitee.waitlist_referrer_user_id,
  );
  return upsertWaitlistReferralRow(db, {
    inviter_user_id: invitee.waitlist_referrer_user_id,
    invited_user_id: invitee.id,
    referral_code: inviter?.waitlist_referral_code || null,
    invited_email_snapshot: invitee.email || null,
    claimed_at: invitee.created_at || invitee.last_login_at || null,
  });
}

async function syncCachedUserById(db, userId, options = {}) {
  const user = db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(userId);
  if (!user) return null;
  await cacheUser(user, options);
  return user;
}

module.exports = {
  upsertWaitlistReferralRow,
  restoreCachedUserToSqlite,
  findUserByIdOrCache,
  findUserByEmailOrCache,
  findUserByReferralCodeOrCache,
  findWaitlistReferralByInviteeOrCache,
  findWaitlistInviteesByReferrerOrCache,
  syncCachedUserById,
};
