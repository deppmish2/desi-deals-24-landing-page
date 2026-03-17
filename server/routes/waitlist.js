"use strict";

const crypto = require("crypto");
const express = require("express");

const db = require("../db");
const requireUserAuth = require("../middleware/user-auth");
const { trackEvent } = require("../services/event-tracker");
const {
  findUserByIdOrCache,
  findUserByReferralCodeOrCache,
  findWaitlistReferralByInviteeOrCache,
  findWaitlistInviteesByReferrerOrCache,
  upsertWaitlistReferralRow,
  syncCachedUserById,
} = require("../services/user-store");

const router = express.Router();
const INVITES_NEEDED = 1;

function getCurrentUser(userId) {
  return findUserByIdOrCache(db, userId);
}

function normalizeReferralCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function normalizeUserType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "basic" || normalized === "premium"
    ? normalized
    : null;
}

function buildReferralCodeCandidate(userId, offset = 0) {
  const digest = crypto
    .createHash("sha256")
    .update(`${String(userId || "")}:${offset}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `DD24-${digest}`;
}

async function ensureReferralCode(userId) {
  let user = await getCurrentUser(userId);
  if (!user) return null;
  if (user.waitlist_referral_code) {
    await syncCachedUserById(db, userId);
    return user;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = buildReferralCodeCandidate(userId, attempt);
    try {
      await db.prepare(
        `UPDATE users
         SET waitlist_referral_code = ?
         WHERE id = ?
           AND (waitlist_referral_code IS NULL OR trim(waitlist_referral_code) = '')`,
      ).run(candidate, userId);
      user = await syncCachedUserById(db, userId, { strict: true });
      if (user?.waitlist_referral_code) return user;
    } catch {
      // try next candidate if a rare unique collision occurs
    }
  }

  return getCurrentUser(userId);
}

function formatDisplayNameFromEmail(email) {
  const localPart = String(email || "")
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();
  if (!localPart) return "Friend";
  return localPart.replace(/\b\w/g, (char) => char.toUpperCase());
}

function maskEmail(email) {
  const value = String(email || "").trim();
  const atIndex = value.indexOf("@");
  if (atIndex <= 0) return value;

  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  const visibleStart = local.slice(0, 1);
  const visibleEnd = local.length > 2 ? local.slice(-1) : "";
  return `${visibleStart}***${visibleEnd}@${domain}`;
}

async function getConfirmedInvitees(userId) {
  return findWaitlistInviteesByReferrerOrCache(db, userId);
}

async function countConfirmedReferrals(userId) {
  return Number(
    (await db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM waitlist_referrals
         WHERE inviter_user_id = ?`,
      )
      .get(userId))?.n || 0,
  );
}

async function syncUnlockState(userId, confirmedCountInput = null) {
  const confirmedCount =
    Number.isFinite(confirmedCountInput) && confirmedCountInput >= 0
      ? confirmedCountInput
      : await countConfirmedReferrals(userId);

  if (confirmedCount < INVITES_NEEDED) {
    return confirmedCount;
  }

  await db.prepare(
    `UPDATE users
     SET waitlist_unlocked_at = COALESCE(waitlist_unlocked_at, ?),
         user_type = CASE
           WHEN user_type IS NULL OR trim(user_type) = '' THEN 'basic'
           ELSE user_type
         END
     WHERE id = ?`,
  ).run(new Date().toISOString(), userId);
  await syncCachedUserById(db, userId, { strict: true });

  return confirmedCount;
}

function buildInviteUrl(referralCode) {
  return `/waitlist?ref=${encodeURIComponent(referralCode)}`;
}

async function serializeWaitlistStatus(userId) {
  let user = await ensureReferralCode(userId);
  if (!user) return null;

  const inviteesRows = await getConfirmedInvitees(userId);
  const confirmedCount = inviteesRows.length;
  await syncUnlockState(userId, confirmedCount);
  user = await getCurrentUser(userId);
  const invitees = inviteesRows.map((row) => ({
    id: row.id,
    display_name: formatDisplayNameFromEmail(row.email),
    contact_label: maskEmail(row.email),
    joined_at: row.claimed_at || row.created_at || row.last_login_at || null,
  }));

  const unlocked =
    Boolean(user?.waitlist_unlocked_at) || confirmedCount >= INVITES_NEEDED;

  return {
    referral_code: user.waitlist_referral_code,
    invite_url: buildInviteUrl(user.waitlist_referral_code),
    confirmed_count: confirmedCount,
    invites_needed: INVITES_NEEDED,
    remaining_count: Math.max(0, INVITES_NEEDED - confirmedCount),
    unlocked,
    unlocked_at: user.waitlist_unlocked_at || null,
    user_type: normalizeUserType(user.user_type),
    invitees,
    referred_by_user_id: user.waitlist_referrer_user_id || null,
  };
}

router.use(requireUserAuth);

router.get("/me", async (req, res) => {
  const user = await getCurrentUser(req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const data = await serializeWaitlistStatus(req.user.id);
  res.json({ data });
});

router.post("/claim-referral", async (req, res) => {
  const currentUser = await ensureReferralCode(req.user.id);
  if (!currentUser) {
    return res.status(404).json({ error: "User not found" });
  }

  const referralCode = normalizeReferralCode(req.body?.referral_code);
  if (!referralCode) {
    return res.status(400).json({ error: "referral_code is required" });
  }

  const existingClaim = await findWaitlistReferralByInviteeOrCache(
    db,
    req.user.id,
  );
  if (existingClaim || currentUser.waitlist_referrer_user_id) {
    return res.json({
      ok: true,
      applied: false,
      reason: "already_claimed",
      data: await serializeWaitlistStatus(req.user.id),
    });
  }

  const inviter = await findUserByReferralCodeOrCache(db, referralCode);

  if (!inviter) {
    return res.status(404).json({ error: "Referral code not found" });
  }

  if (inviter.id === currentUser.id) {
    return res.json({
      ok: true,
      applied: false,
      reason: "self_referral_not_allowed",
      data: await serializeWaitlistStatus(req.user.id),
    });
  }

  // Do not count referrals from users who were already on the platform.
  // A genuine new signup has created_at within the last 48 hours.
  const PREEXISTING_THRESHOLD_MS = 48 * 60 * 60 * 1000;
  const inviteeCreatedAt = Date.parse(currentUser.created_at || "");
  if (
    Number.isFinite(inviteeCreatedAt) &&
    Date.now() - inviteeCreatedAt > PREEXISTING_THRESHOLD_MS
  ) {
    return res.json({
      ok: true,
      applied: false,
      reason: "invitee_already_registered",
      data: await serializeWaitlistStatus(req.user.id),
    });
  }

  const payload = {
    inviter_user_id: inviter.id,
    invited_user_id: currentUser.id,
    referral_code: inviter.waitlist_referral_code || referralCode,
    invited_email_snapshot: currentUser.email || null,
    claimed_at: new Date().toISOString(),
  };

  const existingReferral = await db
    .prepare(
      `SELECT inviter_user_id
       FROM waitlist_referrals
       WHERE invited_user_id = ?
       LIMIT 1`,
    )
    .get(payload.invited_user_id);
  if (existingReferral?.inviter_user_id) {
    return res.json({
      ok: true,
      applied: false,
      reason: "already_claimed",
      data: await serializeWaitlistStatus(req.user.id),
    });
  }

  await db.prepare(
    `UPDATE users
     SET waitlist_referrer_user_id = COALESCE(waitlist_referrer_user_id, ?)
     WHERE id = ?`,
  ).run(payload.inviter_user_id, payload.invited_user_id);

  const updatedInvitee = await db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .get(payload.invited_user_id);
  if (!updatedInvitee) {
    throw new Error("Invitee user not found after referral claim");
  }
  if (updatedInvitee.waitlist_referrer_user_id !== payload.inviter_user_id) {
    return res.json({
      ok: true,
      applied: false,
      reason: "already_claimed",
      data: await serializeWaitlistStatus(req.user.id),
    });
  }

  await upsertWaitlistReferralRow(db, payload);
  const claimResult = { applied: true, reason: null };

  const updatedUser = await syncCachedUserById(db, req.user.id, {
    strict: true,
  });
  const applied =
    Boolean(claimResult?.applied) &&
    updatedUser?.waitlist_referrer_user_id === inviter.id;
  await syncUnlockState(inviter.id);
  await syncCachedUserById(db, inviter.id, { strict: true });

  if (applied) {
    trackEvent(db, "waitlist.referral_claimed", {
      userId: req.user.id,
      route: req.originalUrl,
      entityType: "user",
      entityId: req.user.id,
      payload: {
        inviter_user_id: inviter.id,
        referral_code: referralCode,
      },
    });
  }

  res.json({
    ok: true,
    applied,
    reason: applied ? null : claimResult?.reason || "already_claimed",
    data: await serializeWaitlistStatus(req.user.id),
  });
});

module.exports = router;
