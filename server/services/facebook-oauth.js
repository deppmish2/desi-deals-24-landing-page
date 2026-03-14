"use strict";

const fetch = require("node-fetch");

const FACEBOOK_OAUTH_URL = "https://www.facebook.com/v20.0/dialog/oauth";
const FACEBOOK_TOKEN_URL =
  "https://graph.facebook.com/v20.0/oauth/access_token";
const FACEBOOK_ME_URL = "https://graph.facebook.com/me";

function getConfig() {
  return {
    clientId: String(process.env.FACEBOOK_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.FACEBOOK_CLIENT_SECRET || "").trim(),
    callbackUrl: String(process.env.FACEBOOK_CALLBACK_URL || "").trim(),
  };
}

function parseMockProfile() {
  const raw = process.env.FACEBOOK_OAUTH_MOCK_PROFILE_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isConfigured() {
  const cfg = getConfig();
  return Boolean(cfg.clientId && cfg.clientSecret && cfg.callbackUrl);
}

function normalizePicture(input) {
  if (!input) return null;
  if (typeof input === "string") return input;
  const nested = input?.data?.url;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return null;
}

function normalizeProfile(input) {
  const facebookId = String(input?.id || input?.sub || "").trim();
  const email = String(input?.email || "")
    .trim()
    .toLowerCase();
  const name = String(input?.name || "").trim() || null;
  const picture = normalizePicture(input?.picture);

  if (!facebookId) {
    throw Object.assign(new Error("Facebook profile is missing id"), {
      code: "FACEBOOK_PROFILE_INVALID",
    });
  }
  if (!email) {
    throw Object.assign(new Error("Facebook profile is missing email"), {
      code: "FACEBOOK_PROFILE_INVALID",
    });
  }

  return {
    facebook_id: facebookId,
    email,
    name,
    picture,
    email_verified: true,
  };
}

function buildAuthUrl(state) {
  const cfg = getConfig();
  if (!cfg.clientId || !cfg.callbackUrl) {
    throw Object.assign(new Error("Facebook OAuth is not configured"), {
      code: "FACEBOOK_NOT_CONFIGURED",
    });
  }

  const url = new URL(FACEBOOK_OAUTH_URL);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "email,public_profile");
  if (state) url.searchParams.set("state", String(state));

  return url.toString();
}

async function exchangeCodeForProfile(code) {
  const mock = parseMockProfile();
  if (mock) return normalizeProfile(mock);

  const cfg = getConfig();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.callbackUrl) {
    throw Object.assign(new Error("Facebook OAuth is not fully configured"), {
      code: "FACEBOOK_NOT_CONFIGURED",
    });
  }
  if (!code) {
    throw Object.assign(new Error("authorization code is required"), {
      code: "FACEBOOK_BAD_INPUT",
    });
  }

  const tokenUrl = new URL(FACEBOOK_TOKEN_URL);
  tokenUrl.searchParams.set("client_id", cfg.clientId);
  tokenUrl.searchParams.set("client_secret", cfg.clientSecret);
  tokenUrl.searchParams.set("redirect_uri", cfg.callbackUrl);
  tokenUrl.searchParams.set("code", String(code));

  const tokenRes = await fetch(tokenUrl.toString(), {
    method: "GET",
    timeout: 10000,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Facebook code exchange failed (${tokenRes.status}): ${text}`),
      {
        code: "FACEBOOK_CODE_EXCHANGE_FAILED",
      },
    );
  }

  const tokenPayload = await tokenRes.json();
  if (!tokenPayload.access_token) {
    throw Object.assign(
      new Error("Facebook code exchange returned no access token"),
      {
        code: "FACEBOOK_CODE_EXCHANGE_FAILED",
      },
    );
  }

  const profileUrl = new URL(FACEBOOK_ME_URL);
  profileUrl.searchParams.set("fields", "id,name,email,picture");
  profileUrl.searchParams.set("access_token", tokenPayload.access_token);

  const profileRes = await fetch(profileUrl.toString(), {
    method: "GET",
    timeout: 10000,
  });

  if (!profileRes.ok) {
    const text = await profileRes.text().catch(() => "");
    throw Object.assign(
      new Error(
        `Facebook profile fetch failed (${profileRes.status}): ${text}`,
      ),
      {
        code: "FACEBOOK_PROFILE_FETCH_FAILED",
      },
    );
  }

  const profile = await profileRes.json();
  return normalizeProfile(profile);
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForProfile,
  isConfigured,
};
