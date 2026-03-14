"use strict";

const fetch = require("node-fetch");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEV_MOCK_CODE = "dd24-dev-google";

function getConfig() {
  return {
    clientId: String(process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    callbackUrl: String(process.env.GOOGLE_CALLBACK_URL || "").trim(),
  };
}

function parseMockProfile() {
  const raw = process.env.GOOGLE_OAUTH_MOCK_PROFILE_JSON;
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

function localDevMockEnabled() {
  if (String(process.env.VERCEL || "").trim()) return false;
  return String(process.env.NODE_ENV || "development").trim() !== "production";
}

function defaultMockProfile() {
  return {
    sub: "dd24-dev-google-user",
    email: "dev.google.user@desideals24.local",
    name: "Dev Google User",
    email_verified: true,
    picture: null,
  };
}

function mockProfileForLocalDev() {
  return normalizeProfile(parseMockProfile() || defaultMockProfile());
}

function normalizeClientOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin.replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function devMockClientUrl(state, clientOriginOverride) {
  const clientOrigin =
    normalizeClientOrigin(clientOriginOverride) ||
    normalizeClientOrigin(
      process.env.CLIENT_APP_URL || process.env.APP_URL || process.env.FRONTEND_URL,
    ) ||
    "http://localhost:3000";
  const url = new URL(`${clientOrigin}/oauth/google/callback`);
  url.searchParams.set("code", DEV_MOCK_CODE);
  if (state) url.searchParams.set("state", String(state));
  return url.toString();
}

function normalizeProfile(input) {
  const googleId = String(input?.sub || input?.id || "").trim();
  const email = String(input?.email || "")
    .trim()
    .toLowerCase();
  const name = String(input?.name || "").trim() || null;
  const picture = String(input?.picture || "").trim() || null;
  const emailVerifiedRaw = input?.email_verified;
  const emailVerified =
    emailVerifiedRaw === true ||
    emailVerifiedRaw === "true" ||
    emailVerifiedRaw === 1;

  if (!googleId) {
    throw Object.assign(new Error("Google profile is missing subject id"), {
      code: "GOOGLE_PROFILE_INVALID",
    });
  }
  if (!email) {
    throw Object.assign(new Error("Google profile is missing email"), {
      code: "GOOGLE_PROFILE_INVALID",
    });
  }
  if (!emailVerified) {
    throw Object.assign(new Error("Google email is not verified"), {
      code: "GOOGLE_EMAIL_UNVERIFIED",
    });
  }

  return {
    google_id: googleId,
    email,
    name,
    picture,
    email_verified: true,
  };
}

function buildAuthUrl(state, options = {}) {
  const cfg = getConfig();
  if (!cfg.clientId || !cfg.callbackUrl) {
    if (localDevMockEnabled()) {
      return devMockClientUrl(state, options.clientOrigin);
    }
    throw Object.assign(new Error("Google OAuth is not configured"), {
      code: "GOOGLE_NOT_CONFIGURED",
    });
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.callbackUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  if (state) url.searchParams.set("state", String(state));

  return url.toString();
}

async function verifyIdToken(idToken) {
  const mock = parseMockProfile();
  if (mock) return normalizeProfile(mock);

  const cfg = getConfig();
  if (!cfg.clientId) {
    throw Object.assign(
      new Error("GOOGLE_CLIENT_ID is required for Google login"),
      { code: "GOOGLE_NOT_CONFIGURED" },
    );
  }
  if (!idToken) {
    throw Object.assign(new Error("id_token is required"), {
      code: "GOOGLE_BAD_INPUT",
    });
  }

  const url = new URL(GOOGLE_TOKENINFO_URL);
  url.searchParams.set("id_token", String(idToken));

  const res = await fetch(url.toString(), {
    method: "GET",
    timeout: 10000,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Google token verification failed (${res.status}): ${text}`),
      {
        code: "GOOGLE_TOKEN_INVALID",
      },
    );
  }

  const profile = await res.json();
  if (String(profile.aud || "") !== cfg.clientId) {
    throw Object.assign(new Error("Google token audience mismatch"), {
      code: "GOOGLE_TOKEN_AUDIENCE_MISMATCH",
    });
  }

  return normalizeProfile(profile);
}

async function exchangeCodeForProfile(code) {
  const mock = parseMockProfile();
  if (mock) return normalizeProfile(mock);
  if (localDevMockEnabled() && String(code || "").trim() === DEV_MOCK_CODE) {
    return mockProfileForLocalDev();
  }

  const cfg = getConfig();
  if (!cfg.clientId || !cfg.clientSecret || !cfg.callbackUrl) {
    throw Object.assign(new Error("Google OAuth is not fully configured"), {
      code: "GOOGLE_NOT_CONFIGURED",
    });
  }
  if (!code) {
    throw Object.assign(new Error("authorization code is required"), {
      code: "GOOGLE_BAD_INPUT",
    });
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(code),
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.callbackUrl,
      grant_type: "authorization_code",
    }).toString(),
    timeout: 10000,
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Google code exchange failed (${tokenRes.status}): ${text}`),
      {
        code: "GOOGLE_CODE_EXCHANGE_FAILED",
      },
    );
  }

  const tokenPayload = await tokenRes.json();

  if (tokenPayload.id_token) {
    return verifyIdToken(tokenPayload.id_token);
  }

  if (!tokenPayload.access_token) {
    throw Object.assign(
      new Error("Google code exchange returned no access token"),
      {
        code: "GOOGLE_CODE_EXCHANGE_FAILED",
      },
    );
  }

  const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
    },
    timeout: 10000,
  });

  if (!userInfoRes.ok) {
    const text = await userInfoRes.text().catch(() => "");
    throw Object.assign(
      new Error(`Google userinfo failed (${userInfoRes.status}): ${text}`),
      {
        code: "GOOGLE_USERINFO_FAILED",
      },
    );
  }

  const userInfo = await userInfoRes.json();
  return normalizeProfile(userInfo);
}

module.exports = {
  buildAuthUrl,
  verifyIdToken,
  exchangeCodeForProfile,
  isConfigured,
  localDevMockEnabled,
};
