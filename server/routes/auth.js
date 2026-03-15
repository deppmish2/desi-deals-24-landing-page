"use strict";

const crypto = require("crypto");
const express = require("express");

const db = require("../db");
const { hashPassword, verifyPassword } = require("../utils/password");
const { signJwt, verifyJwt } = require("../utils/jwt");
const {
  hashToken,
  createRefreshSession,
  getRefreshSession,
  revokeRefreshSession,
  revokeAllUserSessions,
} = require("../services/session-store");
const { trackEvent } = require("../services/event-tracker");
const {
  findUserByIdOrCache,
  findUserByEmailOrCache,
  findUserByReferralCodeOrCache,
  findWaitlistReferralByInviteeOrCache,
  upsertWaitlistReferralRow,
  syncCachedUserById,
} = require("../services/user-store");
const {
  sendEmailAuthLink,
  smtpConfigured,
} = require("../services/email-auth");
const {
  buildAuthUrl: buildGoogleAuthUrl,
  verifyIdToken: verifyGoogleIdToken,
  exchangeCodeForProfile: exchangeGoogleCodeForProfile,
  isConfigured: googleOAuthConfigured,
  localDevMockEnabled: googleOAuthLocalDevMockEnabled,
} = require("../services/google-oauth");
const {
  buildAuthUrl: buildFacebookAuthUrl,
  exchangeCodeForProfile: exchangeFacebookCodeForProfile,
  isConfigured: facebookOAuthConfigured,
} = require("../services/facebook-oauth");

const router = express.Router();

function googleOAuthAvailable() {
  return (
    googleOAuthConfigured() ||
    googleOAuthLocalDevMockEnabled() ||
    Boolean(process.env.GOOGLE_OAUTH_MOCK_PROFILE_JSON)
  );
}

const ACCESS_TTL_SECONDS = Math.max(
  60,
  parseInt(process.env.JWT_ACCESS_TTL_SECONDS || "900", 10),
);
const REFRESH_TTL_SECONDS = Math.max(
  3600,
  parseInt(
    process.env.JWT_REFRESH_TTL_SECONDS || String(30 * 24 * 60 * 60),
    10,
  ),
);
const EMAIL_AUTH_TTL_MINUTES = Math.max(
  5,
  parseInt(process.env.EMAIL_AUTH_TTL_MINUTES || "30", 10),
);
const EMAIL_AUTH_RATE_LIMIT_SECONDS = Math.max(
  0,
  parseInt(process.env.EMAIL_AUTH_RATE_LIMIT_SECONDS || "60", 10),
);

function accessSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

function refreshSecret() {
  return (
    process.env.JWT_REFRESH_SECRET ||
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeProfileName(name) {
  const value = String(name || "").trim();
  return value || null;
}

function extractFirstName(name, email) {
  const fullName = normalizeProfileName(name);
  if (fullName) {
    const firstWord = fullName.split(/\s+/).find(Boolean);
    if (firstWord) return firstWord;
  }

  const localPart = normalizeEmail(email).split("@")[0] || "";
  const cleaned = localPart.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return null;
  const firstWord = cleaned.split(/\s+/).find(Boolean);
  if (!firstWord) return null;
  return firstWord.replace(/\b\w/g, (char) => char.toUpperCase());
}

function resolveClientOrigin(req) {
  const explicitOrigin = String(req.get("origin") || "").trim();
  if (explicitOrigin) return explicitOrigin;

  const referer = String(req.get("referer") || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore malformed referers and fall back to the current host.
    }
  }

  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const forwardedHost = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req.get("host") || "").trim();
  const protocol = forwardedProto || req.protocol || "http";

  return host ? `${protocol}://${host}` : undefined;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeReferralCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function maskEmail(email) {
  const value = normalizeEmail(email);
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  const start = local.slice(0, 1);
  const end = local.length > 2 ? local.slice(-1) : "";
  return `${start}***${end}@${domain}`;
}

function isEmailVerified(user) {
  return Boolean(user?.email_verified_at || user?.google_id || user?.facebook_id);
}

function clientAppOrigin(req) {
  return (
    resolveClientOrigin(req) ||
    process.env.CLIENT_APP_URL ||
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    "http://localhost:3000"
  );
}

function buildWaitlistUrl(origin, params = {}) {
  const url = new URL("/waitlist", origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeUserType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "basic" || normalized === "premium"
    ? normalized
    : null;
}

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || null,
    first_name: row.first_name || null,
    postcode: row.postcode,
    city: row.city,
    dietary_prefs: parseJson(row.dietary_prefs, []),
    preferred_stores: parseJson(row.preferred_stores, []),
    blocked_stores: parseJson(row.blocked_stores, []),
    preferred_brands: parseJson(row.preferred_brands, {}),
    delivery_speed_pref: row.delivery_speed_pref || "cheapest",
    email_verified_at: row.email_verified_at || null,
    email_verified: isEmailVerified(row),
    user_type: normalizeUserType(row.user_type),
    created_at: row.created_at,
    last_login_at: row.last_login_at,
  };
}

function asPostcode(value) {
  if (value == null) return "";
  return String(value).trim();
}

function issueAccessToken(user) {
  return signJwt(
    {
      sub: user.id,
      email: user.email,
      type: "access",
    },
    accessSecret(),
    ACCESS_TTL_SECONDS,
  );
}

async function issueRefreshToken(userId) {
  const refreshToken = signJwt(
    {
      sub: userId,
      type: "refresh",
      jti: crypto.randomUUID(),
    },
    refreshSecret(),
    REFRESH_TTL_SECONDS,
  );

  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(
    Date.now() + REFRESH_TTL_SECONDS * 1000,
  ).toISOString();

  await createRefreshSession(db, {
    id: crypto.randomUUID(),
    userId,
    tokenHash,
    expiresAt,
    ttlSeconds: REFRESH_TTL_SECONDS,
  });

  return refreshToken;
}

async function buildAuthResponse(user) {
  const accessToken = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);
  return {
    accessToken,
    refreshToken,
    tokenType: "Bearer",
    expiresIn: ACCESS_TTL_SECONDS,
    sessionStore: "sqlite",
    user: serializeUser(user),
  };
}

async function resolveUserByEmail(email) {
  return findUserByEmailOrCache(db, email);
}

async function findUserByGoogleId(googleId) {
  return await db
    .prepare("SELECT * FROM users WHERE google_id = ? LIMIT 1")
    .get(googleId);
}

async function findUserByFacebookId(facebookId) {
  return await db
    .prepare("SELECT * FROM users WHERE facebook_id = ? LIMIT 1")
    .get(facebookId);
}

async function insertGoogleUser({ profile, postcode }) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const fullName = normalizeProfileName(profile.name);
  const firstName = extractFirstName(profile.name, profile.email);

  await db.prepare(
    `INSERT INTO users
      (id, email, name, first_name, password_hash, google_id, postcode, city, dietary_prefs, preferred_stores, blocked_stores,
       preferred_brands, delivery_speed_pref, email_verified_at, created_at, last_login_at)
     VALUES
      (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, 'cheapest', NULL, ?, ?)`,
  ).run(
    id,
    profile.email,
    fullName,
    firstName,
    profile.google_id,
    asPostcode(postcode),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({}),
    now,
    now,
  );

  return await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id);
}

async function sendGoogleSignupConfirmation(user, req) {
  const rawToken = createRawEmailAuthToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = emailAuthTokenExpiry();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO email_auth_tokens
      (id, email, token_hash, purpose, referral_code, requested_ip, requested_user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    user.email,
    tokenHash,
    "signup",
    null,
    String(req.ip || "").trim() || null,
    String(req.get("user-agent") || "").trim() || null,
    expiresAt,
  );

  const linkUrl = buildWaitlistUrl(clientAppOrigin(req), {
    email_auth_token: rawToken,
  });

  await sendEmailAuthLink({
    email: user.email,
    purpose: "signup",
    linkUrl,
    expiresMinutes: EMAIL_AUTH_TTL_MINUTES,
  });
}

async function upsertGoogleUser(profile, postcodeInput) {
  const now = new Date().toISOString();
  let user = await findUserByGoogleId(profile.google_id);
  const postcode = asPostcode(postcodeInput);
  const fullName = normalizeProfileName(profile.name);
  const firstName = extractFirstName(profile.name, profile.email);

  if (user) {
    await db.prepare(
      `UPDATE users
       SET email = ?,
           name = COALESCE(?, name),
           first_name = COALESCE(?, first_name),
           email_verified_at = COALESCE(email_verified_at, ?),
           last_login_at = ?
       WHERE id = ?`,
    ).run(profile.email, fullName, firstName, now, now, user.id);
    return await syncCachedUserById(db, user.id);
  }

  let byEmail = await resolveUserByEmail(profile.email);
  if (!byEmail) {
    return await insertGoogleUser({ profile, postcode });
  }

  if (byEmail.google_id && byEmail.google_id !== profile.google_id) {
    throw Object.assign(
      new Error("Email already linked to a different Google account"),
      {
        code: "GOOGLE_ACCOUNT_CONFLICT",
      },
    );
  }

  const effectivePostcode = byEmail.postcode || postcode || "";
  await db.prepare(
    `UPDATE users
     SET google_id = ?,
         postcode = ?,
         name = COALESCE(?, name),
         first_name = COALESCE(?, first_name),
         email_verified_at = COALESCE(email_verified_at, ?),
         last_login_at = ?
     WHERE id = ?`,
  ).run(
    profile.google_id,
    effectivePostcode,
    fullName,
    firstName,
    now,
    now,
    byEmail.id,
  );

  return await syncCachedUserById(db, byEmail.id);
}

async function insertFacebookUser({ profile, postcode }) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const fullName = normalizeProfileName(profile.name);
  const firstName = extractFirstName(profile.name, profile.email);

  await db.prepare(
    `INSERT INTO users
      (id, email, name, first_name, password_hash, facebook_id, postcode, city, dietary_prefs, preferred_stores, blocked_stores,
       preferred_brands, delivery_speed_pref, email_verified_at, created_at, last_login_at)
     VALUES
      (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, 'cheapest', ?, ?, ?)`,
  ).run(
    id,
    profile.email,
    fullName,
    firstName,
    profile.facebook_id,
    asPostcode(postcode),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({}),
    now,
    now,
    now,
  );

  return await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id);
}

async function upsertFacebookUser(profile, postcodeInput) {
  const now = new Date().toISOString();
  let user = await findUserByFacebookId(profile.facebook_id);
  const postcode = asPostcode(postcodeInput);
  const fullName = normalizeProfileName(profile.name);
  const firstName = extractFirstName(profile.name, profile.email);

  if (user) {
    await db.prepare(
      `UPDATE users
       SET email = ?,
           name = COALESCE(?, name),
           first_name = COALESCE(?, first_name),
           email_verified_at = COALESCE(email_verified_at, ?),
           last_login_at = ?
       WHERE id = ?`,
    ).run(profile.email, fullName, firstName, now, now, user.id);
    return await syncCachedUserById(db, user.id);
  }

  let byEmail = await resolveUserByEmail(profile.email);
  if (!byEmail) {
    return await insertFacebookUser({ profile, postcode });
  }

  if (byEmail.facebook_id && byEmail.facebook_id !== profile.facebook_id) {
    throw Object.assign(
      new Error("Email already linked to a different Facebook account"),
      {
        code: "FACEBOOK_ACCOUNT_CONFLICT",
      },
    );
  }

  const effectivePostcode = byEmail.postcode || postcode || "";
  await db.prepare(
    `UPDATE users
     SET facebook_id = ?,
         postcode = ?,
         name = COALESCE(?, name),
         first_name = COALESCE(?, first_name),
         email_verified_at = COALESCE(email_verified_at, ?),
         last_login_at = ?
     WHERE id = ?`,
  ).run(
    profile.facebook_id,
    effectivePostcode,
    fullName,
    firstName,
    now,
    now,
    byEmail.id,
  );

  return await syncCachedUserById(db, byEmail.id);
}

function emailAuthTokenExpiry() {
  return new Date(Date.now() + EMAIL_AUTH_TTL_MINUTES * 60 * 1000).toISOString();
}

function createRawEmailAuthToken() {
  return `${crypto.randomUUID()}${crypto.randomBytes(24).toString("hex")}`;
}

async function consumeEmailAuthToken(tokenHash, consumedAt) {
  const row = await db
    .prepare(
      `SELECT *
       FROM email_auth_tokens
       WHERE token_hash = ?
         AND consumed_at IS NULL
       LIMIT 1`,
    )
    .get(tokenHash);

  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    return { ...row, expired: true };
  }

  await db.prepare(
    `UPDATE email_auth_tokens
     SET consumed_at = ?
     WHERE token_hash = ?
       AND consumed_at IS NULL`,
  ).run(consumedAt, tokenHash);

  return { ...row, expired: false, consumed_at: consumedAt };
}

async function latestEmailAuthRequest(email) {
  return await db
    .prepare(
      `SELECT created_at
       FROM email_auth_tokens
       WHERE email = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(email);
}

async function syncUnlockStateIfEligible(userId) {
  const confirmedCount = Number(
    (await db
      .prepare(
        `SELECT COUNT(*) AS n
         FROM waitlist_referrals
         WHERE inviter_user_id = ?`,
      )
      .get(userId))?.n || 0,
  );

  if (confirmedCount < 2) return confirmedCount;

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

async function applyReferralCodeToUser(userId, referralCode, claimedAt) {
  const normalizedCode = normalizeReferralCode(referralCode);
  if (!normalizedCode) {
    return { applied: false, reason: "missing_referral_code" };
  }

  const currentUser = await findUserByIdOrCache(db, userId);
  if (!currentUser) {
    return { applied: false, reason: "user_not_found" };
  }

  const existingClaim = await findWaitlistReferralByInviteeOrCache(db, userId);
  if (existingClaim || currentUser.waitlist_referrer_user_id) {
    return { applied: false, reason: "already_claimed" };
  }

  const inviter = await findUserByReferralCodeOrCache(db, normalizedCode);
  if (!inviter) {
    return { applied: false, reason: "invalid_referral_code" };
  }
  if (inviter.id === currentUser.id) {
    return { applied: false, reason: "self_referral_not_allowed" };
  }

  const payload = {
    inviter_user_id: inviter.id,
    invited_user_id: currentUser.id,
    referral_code: inviter.waitlist_referral_code || normalizedCode,
    invited_email_snapshot: currentUser.email || null,
    claimed_at: claimedAt || new Date().toISOString(),
  };

  const alreadyLinked = await db
    .prepare(
      `SELECT inviter_user_id
       FROM waitlist_referrals
       WHERE invited_user_id = ?
       LIMIT 1`,
    )
    .get(payload.invited_user_id);
  if (alreadyLinked?.inviter_user_id) {
    return { applied: false, reason: "already_claimed" };
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
    return { applied: false, reason: "already_claimed" };
  }

  await upsertWaitlistReferralRow(db, payload);
  const outcome = {
    applied: true,
    reason: null,
    inviter_user_id: payload.inviter_user_id,
  };

  await syncCachedUserById(db, currentUser.id, { strict: true });
  await syncCachedUserById(db, inviter.id, { strict: true });
  await syncUnlockStateIfEligible(inviter.id);

  return outcome;
}

async function insertEmailLinkUser(email, verifiedAt) {
  const id = crypto.randomUUID();
  const now = verifiedAt || new Date().toISOString();

  await db.prepare(
    `INSERT INTO users
      (id, email, password_hash, postcode, city, dietary_prefs, preferred_stores, blocked_stores,
       preferred_brands, delivery_speed_pref, email_verified_at, created_at, last_login_at)
     VALUES
      (?, ?, NULL, '', NULL, ?, ?, ?, ?, 'cheapest', ?, ?, ?)`,
  ).run(
    id,
    email,
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({}),
    now,
    now,
    now,
  );

  return await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(id);
}

async function handleEmailStatus(req, res) {
  const email = normalizeEmail(req.body?.email || req.query?.email);
  if (!isValidEmail(email)) {
    res.status(400).json({ error: "Valid email is required" });
    return;
  }

  const user = await resolveUserByEmail(email);
  if (!user) {
    res.json({
      exists: false,
      email,
      hasPassword: false,
      emailVerified: false,
      providers: { google: false, facebook: false },
    });
    return;
  }

  res.json({
    exists: true,
    email,
    hasPassword: Boolean(user.password_hash),
    emailVerified: isEmailVerified(user),
    providers: {
      google: Boolean(user.google_id),
      facebook: Boolean(user.facebook_id),
    },
  });
}

// POST /api/v1/auth/email-status
router.post("/email-status", handleEmailStatus);
// GET /api/v1/auth/email-status?email=...
router.get("/email-status", handleEmailStatus);
// Backward-compatible aliases
router.post("/check-email", handleEmailStatus);
router.get("/check-email", handleEmailStatus);

router.post("/email-link/start", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const referralCode = normalizeReferralCode(req.body?.referral_code);

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  if (EMAIL_AUTH_RATE_LIMIT_SECONDS > 0) {
    const latest = await latestEmailAuthRequest(email);
    if (
      latest?.created_at &&
      Date.parse(latest.created_at) > Date.now() - EMAIL_AUTH_RATE_LIMIT_SECONDS * 1000
    ) {
      return res.status(429).json({
        error: `Please wait ${EMAIL_AUTH_RATE_LIMIT_SECONDS} seconds before requesting another link.`,
      });
    }
  }

  const existingUser = await resolveUserByEmail(email);
  const purpose = existingUser ? "login" : "signup";
  const rawToken = createRawEmailAuthToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = emailAuthTokenExpiry();
  const requestedAt = new Date().toISOString();

  await db.prepare(
    `UPDATE email_auth_tokens
     SET consumed_at = COALESCE(consumed_at, ?)
     WHERE email = ?
       AND consumed_at IS NULL`,
  ).run(requestedAt, email);

  await db.prepare(
    `INSERT INTO email_auth_tokens (
      id,
      email,
      token_hash,
      purpose,
      referral_code,
      requested_ip,
      requested_user_agent,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    email,
    tokenHash,
    purpose,
    referralCode || null,
    String(req.ip || "").trim() || null,
    String(req.get("user-agent") || "").trim() || null,
    expiresAt,
  );

  const linkUrl = buildWaitlistUrl(clientAppOrigin(req), {
    email_auth_token: rawToken,
  });

  let delivery;
  try {
    delivery = await sendEmailAuthLink({
      email,
      purpose,
      linkUrl,
      expiresMinutes: EMAIL_AUTH_TTL_MINUTES,
    });
  } catch (error) {
    if (error?.code === "EMAIL_AUTH_NOT_CONFIGURED") {
      return res.status(503).json({
        error:
          "Email confirmation is not configured on this deployment yet. Please contact support.",
      });
    }
    throw error;
  }

  trackEvent(db, "auth.email_link_requested", {
    userId: existingUser?.id || null,
    route: req.originalUrl,
    entityType: "user",
    entityId: existingUser?.id || null,
    payload: {
      purpose,
      email,
      has_referral_code: Boolean(referralCode),
      transport: delivery.transport,
    },
  });

  const response = {
    ok: true,
    purpose,
    message:
      purpose === "login"
        ? "Check your email for a secure sign-in link."
        : "Check your email to confirm your signup.",
    masked_email: maskEmail(email),
    expires_in_minutes: EMAIL_AUTH_TTL_MINUTES,
  };

  if (delivery.previewUrl && process.env.NODE_ENV !== "production") {
    response.preview_url = delivery.previewUrl;
  }

  res.status(202).json(response);
});

router.post("/email-link/complete", async (req, res) => {
  const rawToken = String(req.body?.token || "").trim();
  if (!rawToken) {
    return res.status(400).json({ error: "token is required" });
  }

  const now = new Date().toISOString();
  const tokenHash = hashToken(rawToken);
  const tokenRow = await consumeEmailAuthToken(tokenHash, now);

  if (!tokenRow) {
    return res.status(400).json({ error: "This email link is invalid or already used." });
  }
  if (tokenRow.expired) {
    return res.status(410).json({ error: "This email link has expired. Please request a new one." });
  }

  let user = await resolveUserByEmail(tokenRow.email);
  if (!user) {
    user = await insertEmailLinkUser(tokenRow.email, now);
  } else {
    await db.prepare(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, ?),
           last_login_at = ?
       WHERE id = ?`,
    ).run(now, now, user.id);
    user = await syncCachedUserById(db, user.id, { strict: true });
  }

  const referralOutcome = await applyReferralCodeToUser(
    user.id,
    tokenRow.referral_code,
    now,
  );
  user = await syncCachedUserById(db, user.id, { strict: true });

  trackEvent(db, "auth.email_link_completed", {
    userId: user.id,
    route: req.originalUrl,
    entityType: "user",
    entityId: user.id,
    payload: {
      purpose: tokenRow.purpose,
      referral_applied: Boolean(referralOutcome?.applied),
    },
  });

  res.json(await buildAuthResponse(user));
});

router.post("/register", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const postcode = String(req.body?.postcode || "").trim();

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Valid email is required" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }
  if (!postcode) {
    return res.status(400).json({ error: "Postcode is required" });
  }

  const existing = await resolveUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    email,
    password_hash: await hashPassword(password),
    postcode,
    city: null,
    dietary_prefs: JSON.stringify([]),
    preferred_stores: JSON.stringify([]),
    blocked_stores: JSON.stringify([]),
    preferred_brands: JSON.stringify({}),
    delivery_speed_pref: "cheapest",
    created_at: now,
    last_login_at: now,
  };

  await db.prepare(
    `INSERT INTO users
      (id, email, password_hash, postcode, city, dietary_prefs, preferred_stores, blocked_stores,
       preferred_brands, delivery_speed_pref, created_at, last_login_at)
     VALUES
      (@id, @email, @password_hash, @postcode, @city, @dietary_prefs, @preferred_stores, @blocked_stores,
       @preferred_brands, @delivery_speed_pref, @created_at, @last_login_at)`,
  ).run(user);

  const stored = await db.prepare("SELECT * FROM users WHERE id = ?").get(
    user.id,
  );
  trackEvent(db, "auth.register", {
    userId: stored.id,
    route: req.originalUrl,
    entityType: "user",
    entityId: stored.id,
    payload: {
      method: "password",
      has_postcode: Boolean(stored.postcode),
    },
  });
  res.status(201).json(await buildAuthResponse(stored));
});

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await resolveUserByEmail(email);
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const now = new Date().toISOString();
  await db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(
    now,
    user.id,
  );
  const updated = await db.prepare("SELECT * FROM users WHERE id = ?").get(
    user.id,
  );
  trackEvent(db, "auth.login", {
    userId: updated.id,
    route: req.originalUrl,
    entityType: "user",
    entityId: updated.id,
    payload: {
      method: "password",
    },
  });

  res.json(await buildAuthResponse(updated));
});

router.post("/refresh", async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || "");
  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  const decoded = verifyJwt(refreshToken, refreshSecret());
  if (
    !decoded.ok ||
    decoded.payload?.type !== "refresh" ||
    !decoded.payload?.sub
  ) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  const tokenHash = hashToken(refreshToken);
  const session = await getRefreshSession(db, tokenHash);
  if (!session || session.user_id !== decoded.payload.sub) {
    return res.status(401).json({ error: "Refresh session not found" });
  }

  let user = await findUserByIdOrCache(db, session.user_id);
  if (!user) {
    await revokeRefreshSession(db, tokenHash);
    return res.status(401).json({ error: "User not found" });
  }

  await revokeRefreshSession(db, tokenHash);
  trackEvent(db, "auth.refresh", {
    userId: user.id,
    route: req.originalUrl,
    entityType: "user",
    entityId: user.id,
  });

  res.json(await buildAuthResponse(user));
});

router.post("/logout", async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || "");
  let userId = null;
  if (refreshToken) {
    const decoded = verifyJwt(refreshToken, refreshSecret());
    if (
      decoded.ok &&
      decoded.payload?.type === "refresh" &&
      decoded.payload?.sub
    ) {
      userId = decoded.payload.sub;
    }
  }
  if (refreshToken) {
    await revokeRefreshSession(db, hashToken(refreshToken));
  }
  trackEvent(db, "auth.logout", {
    userId,
    route: req.originalUrl,
    entityType: "user",
    entityId: userId,
  });
  res.json({ ok: true });
});

router.post("/logout-all", async (req, res) => {
  const refreshToken = String(req.body?.refreshToken || "");
  if (!refreshToken) {
    return res.status(400).json({ error: "refreshToken is required" });
  }

  const decoded = verifyJwt(refreshToken, refreshSecret());
  if (
    !decoded.ok ||
    decoded.payload?.type !== "refresh" ||
    !decoded.payload?.sub
  ) {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  await revokeAllUserSessions(db, decoded.payload.sub);
  trackEvent(db, "auth.logout_all", {
    userId: decoded.payload.sub,
    route: req.originalUrl,
    entityType: "user",
    entityId: decoded.payload.sub,
  });
  res.json({ ok: true });
});

router.post("/google", async (req, res) => {
  const idToken = String(req.body?.idToken || req.body?.id_token || "").trim();
  const code = String(
    req.body?.code || req.body?.authorization_code || "",
  ).trim();
  const postcode = req.body?.postcode;

  if (!idToken && !code) {
    return res
      .status(400)
      .json({ error: "Provide idToken/id_token or code/authorization_code" });
  }

  if (!googleOAuthAvailable()) {
    return res.status(501).json({ error: "Google OAuth is not configured" });
  }

  try {
    const profile = idToken
      ? await verifyGoogleIdToken(idToken)
      : await exchangeGoogleCodeForProfile(code);
    const user = await upsertGoogleUser(profile, postcode);

    // New user — send email confirmation before issuing tokens
    if (!user.email_verified_at) {
      try {
        await sendGoogleSignupConfirmation(user, req);
      } catch (emailError) {
        if (emailError?.code === "EMAIL_AUTH_NOT_CONFIGURED") {
          // SMTP not set up — verify inline and issue tokens
          await db.prepare(
            "UPDATE users SET email_verified_at = ? WHERE id = ?",
          ).run(new Date().toISOString(), user.id);
          const verifiedUser = await syncCachedUserById(db, user.id, { strict: true });
          trackEvent(db, "auth.google_register", {
            userId: verifiedUser.id,
            route: req.originalUrl,
            entityType: "user",
            entityId: verifiedUser.id,
            payload: { email: verifiedUser.email },
          });
          return res.json(await buildAuthResponse(verifiedUser));
        }
        throw emailError;
      }
      trackEvent(db, "auth.google_register", {
        userId: user.id,
        route: req.originalUrl,
        entityType: "user",
        entityId: user.id,
        payload: { email: user.email, pending_confirmation: true },
      });
      return res.json({
        pending_email_confirmation: true,
        masked_email: maskEmail(user.email),
      });
    }

    trackEvent(db, "auth.google_login", {
      userId: user.id,
      route: req.originalUrl,
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email },
    });
    res.json(await buildAuthResponse(user));
  } catch (error) {
    const status =
      error.code && String(error.code).startsWith("GOOGLE_") ? 401 : 500;
    res.status(status).json({ error: error.message || "Google login failed" });
  }
});

// GET /api/v1/auth/google/url
router.get("/google/url", (req, res) => {
  if (!googleOAuthAvailable()) {
    return res.status(501).json({ error: "Google OAuth is not configured" });
  }
  const state = req.query.state ? String(req.query.state) : undefined;
  res.json({
    authUrl: buildGoogleAuthUrl(state, {
      clientOrigin: resolveClientOrigin(req),
    }),
  });
});

// GET /api/v1/auth/google/callback?code=...
router.get("/google/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const postcode = req.query.postcode;

  if (!code) {
    return res.status(400).json({ error: "code query parameter is required" });
  }

  if (!googleOAuthAvailable()) {
    return res.status(501).json({ error: "Google OAuth is not configured" });
  }

  try {
    const profile = await exchangeGoogleCodeForProfile(code);
    const user = await upsertGoogleUser(profile, postcode);

    if (!user.email_verified_at) {
      try {
        await sendGoogleSignupConfirmation(user, req);
      } catch (emailError) {
        if (emailError?.code === "EMAIL_AUTH_NOT_CONFIGURED") {
          await db.prepare(
            "UPDATE users SET email_verified_at = ? WHERE id = ?",
          ).run(new Date().toISOString(), user.id);
          const verifiedUser = await syncCachedUserById(db, user.id, { strict: true });
          trackEvent(db, "auth.google_register", {
            userId: verifiedUser.id,
            route: req.originalUrl,
            entityType: "user",
            entityId: verifiedUser.id,
            payload: { email: verifiedUser.email },
          });
          return res.json(await buildAuthResponse(verifiedUser));
        }
        throw emailError;
      }
      trackEvent(db, "auth.google_register", {
        userId: user.id,
        route: req.originalUrl,
        entityType: "user",
        entityId: user.id,
        payload: { email: user.email, pending_confirmation: true },
      });
      return res.json({
        pending_email_confirmation: true,
        masked_email: maskEmail(user.email),
      });
    }

    trackEvent(db, "auth.google_login", {
      userId: user.id,
      route: req.originalUrl,
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email },
    });
    res.json(await buildAuthResponse(user));
  } catch (error) {
    const status =
      error.code && String(error.code).startsWith("GOOGLE_") ? 401 : 500;
    res
      .status(status)
      .json({ error: error.message || "Google callback failed" });
  }
});

router.post("/facebook", async (req, res) => {
  const code = String(
    req.body?.code || req.body?.authorization_code || "",
  ).trim();
  const postcode = req.body?.postcode;

  if (!code) {
    return res.status(400).json({ error: "Provide code/authorization_code" });
  }

  if (
    !facebookOAuthConfigured() &&
    !process.env.FACEBOOK_OAUTH_MOCK_PROFILE_JSON
  ) {
    return res.status(501).json({ error: "Facebook OAuth is not configured" });
  }

  try {
    const profile = await exchangeFacebookCodeForProfile(code);
    const user = await upsertFacebookUser(profile, postcode);
    const eventName =
      user.created_at === user.last_login_at
        ? "auth.facebook_register"
        : "auth.facebook_login";
    trackEvent(db, eventName, {
      userId: user.id,
      route: req.originalUrl,
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email },
    });
    res.json(await buildAuthResponse(user));
  } catch (error) {
    const status =
      error.code && String(error.code).startsWith("FACEBOOK_") ? 401 : 500;
    res
      .status(status)
      .json({ error: error.message || "Facebook login failed" });
  }
});

// GET /api/v1/auth/facebook/url
router.get("/facebook/url", (req, res) => {
  if (!facebookOAuthConfigured()) {
    return res.status(501).json({ error: "Facebook OAuth is not configured" });
  }
  const state = req.query.state ? String(req.query.state) : undefined;
  res.json({ authUrl: buildFacebookAuthUrl(state) });
});

// GET /api/v1/auth/facebook/callback?code=...
router.get("/facebook/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const postcode = req.query.postcode;

  if (!code) {
    return res.status(400).json({ error: "code query parameter is required" });
  }

  if (
    !facebookOAuthConfigured() &&
    !process.env.FACEBOOK_OAUTH_MOCK_PROFILE_JSON
  ) {
    return res.status(501).json({ error: "Facebook OAuth is not configured" });
  }

  try {
    const profile = await exchangeFacebookCodeForProfile(code);
    const user = await upsertFacebookUser(profile, postcode);
    const eventName =
      user.created_at === user.last_login_at
        ? "auth.facebook_register"
        : "auth.facebook_login";
    trackEvent(db, eventName, {
      userId: user.id,
      route: req.originalUrl,
      entityType: "user",
      entityId: user.id,
      payload: { email: user.email },
    });
    res.json(await buildAuthResponse(user));
  } catch (error) {
    const status =
      error.code && String(error.code).startsWith("FACEBOOK_") ? 401 : 500;
    res
      .status(status)
      .json({ error: error.message || "Facebook callback failed" });
  }
});

module.exports = router;
