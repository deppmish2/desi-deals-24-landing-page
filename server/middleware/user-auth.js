"use strict";

const { verifyJwt } = require("../utils/jwt");

function resolveAccessSecret() {
  return (
    process.env.JWT_SECRET ||
    process.env.ADMIN_SECRET ||
    "changeme-in-production"
  );
}

module.exports = function requireUserAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Missing access token" });
  }

  const result = verifyJwt(token, resolveAccessSecret());
  if (!result.ok || result.payload?.type !== "access") {
    return res.status(401).json({ error: "Invalid or expired access token" });
  }

  req.user = {
    id: result.payload.sub,
    email: result.payload.email,
  };

  next();
};
