"use strict";

function envEnabled(value) {
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function isFullCatalogEnabled() {
  const scope = String(process.env.CRAWL_SCOPE || "")
    .trim()
    .toLowerCase();

  if (["all", "full", "full-catalog", "catalog"].includes(scope)) {
    return true;
  }

  return envEnabled(process.env.CRAWL_FULL_CATALOG);
}

function getMaxPages(defaultPages) {
  const parsed = parseInt(String(process.env.CRAWL_MAX_PAGES || ""), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  const fallback =
    Number.isFinite(defaultPages) && defaultPages > 0 ? defaultPages : 5;

  return isFullCatalogEnabled() ? Math.max(30, fallback) : fallback;
}

module.exports = {
  isFullCatalogEnabled,
  getMaxPages,
};
