"use strict";

const { verifyJwt } = require("../utils/jwt");
const db = require("../db");

// Always-admin emails — works even before the DB row is updated
// Configurable via ADMIN_EMAILS env var (comma-separated)
const HARDCODED_ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || "itsjustrahul@gmail.com,deppmish2@googlemail.com")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

function resolveAccessSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

module.exports = async function requireAdminAuth(req, res, next) {
  // Bypass auth in non-production environments for local testing
  if (process.env.NODE_ENV !== "production") {
    req.user = { id: "local-admin", email: "local@admin" };
    return next();
  }

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing access token" });
  }

  const result = verifyJwt(token, resolveAccessSecret());
  if (!result.ok || result.payload?.type !== "access") {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }

  const userId = result.payload.sub;
  const email = result.payload.email;

  // Fast path: hardcoded admin list
  if (HARDCODED_ADMIN_EMAILS.has(email)) {
    req.user = { id: userId, email };
    return next();
  }

  // DB check: is_admin flag
  try {
    const user = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(userId);
    if (Number(user?.is_admin) === 1) {
      req.user = { id: userId, email };
      return next();
    }
  } catch (_) {}

  return res.status(403).json({ error: "Admin access required" });
};
