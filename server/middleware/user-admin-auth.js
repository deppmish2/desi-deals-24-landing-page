"use strict";

const { verifyJwt } = require("../utils/jwt");
const { isAdminEmail, normalizeAdminEmail } = require("../utils/admin-access");
const db = require("../db");

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
  const email = normalizeAdminEmail(result.payload.email);

  if (
    result.payload?.is_admin === true ||
    Number(result.payload?.is_admin) === 1
  ) {
    req.user = { id: userId, email };
    return next();
  }

  // Fast path: always-admin email list
  if (isAdminEmail(email)) {
    req.user = { id: userId, email };
    return next();
  }

  // DB check: is_admin flag or admin email on the stored user row
  try {
    const user = await db
      .prepare("SELECT email, is_admin FROM users WHERE id = ?")
      .get(userId);
    const storedEmail = normalizeAdminEmail(user?.email) || email;
    if (Number(user?.is_admin) === 1 || isAdminEmail(storedEmail)) {
      req.user = { id: userId, email: storedEmail };
      return next();
    }
  } catch (_) {}

  return res.status(403).json({ error: "Admin access required" });
};
