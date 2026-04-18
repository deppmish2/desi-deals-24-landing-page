"use strict";

const DEFAULT_ADMIN_EMAILS = "itsjustrahul@gmail.com,deppmish2@googlemail.com";

function normalizeAdminEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function getAdminEmailSet() {
  return new Set(
    String(process.env.ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS)
      .split(",")
      .map(normalizeAdminEmail)
      .filter(Boolean),
  );
}

function isAdminEmail(email) {
  return getAdminEmailSet().has(normalizeAdminEmail(email));
}

module.exports = {
  DEFAULT_ADMIN_EMAILS,
  normalizeAdminEmail,
  getAdminEmailSet,
  isAdminEmail,
};
