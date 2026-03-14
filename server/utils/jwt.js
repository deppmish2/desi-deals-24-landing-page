"use strict";

const crypto = require("crypto");

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64url(value) {
  const pad = (4 - (value.length % 4)) % 4;
  const normalized = (value + "=".repeat(pad))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function signJwt(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const unsigned = `${encodedHeader}.${encodedBody}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsigned}.${signature}`;
}

function verifyJwt(token, secret) {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "missing" };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return { ok: false, reason: "format" };
  }

  const [encodedHeader, encodedBody, signature] = parts;
  const unsigned = `${encodedHeader}.${encodedBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const signatureBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (
    signatureBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    return { ok: false, reason: "signature" };
  }

  try {
    const payload = JSON.parse(fromBase64url(encodedBody));
    if (
      typeof payload.exp !== "number" ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "payload" };
  }
}

module.exports = {
  signJwt,
  verifyJwt,
};
