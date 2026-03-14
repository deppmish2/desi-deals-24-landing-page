"use strict";
const db = require("../server/db");
const { runCrawl } = require("../crawler");

// Called by Vercel Cron — verified via CRON_SECRET (auto-set by Vercel)
module.exports = async (req, res) => {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  // Scheduled cron should run the normal deals crawl, not full catalog.
  const prevScope = process.env.CRAWL_SCOPE;
  const prevFullCatalog = process.env.CRAWL_FULL_CATALOG;
  process.env.CRAWL_SCOPE = "deals";
  process.env.CRAWL_FULL_CATALOG = "false";

  try {
    await runCrawl(db);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    process.env.CRAWL_SCOPE = prevScope;
    process.env.CRAWL_FULL_CATALOG = prevFullCatalog;
  }
};
