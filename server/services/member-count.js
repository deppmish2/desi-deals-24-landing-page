"use strict";

const db = require("../db");

const SETTING_KEY = "display_member_count";

async function getDisplayMemberCount() {
  const row = await db.prepare(
    "SELECT value FROM app_settings WHERE key = ?",
  ).get(SETTING_KEY);
  return Number(row?.value || 0);
}

async function incrementDisplayMemberCount() {
  const delta = Math.floor(Math.random() * 5) + 3; // 3–7 inclusive
  await db.prepare(`
    UPDATE app_settings
    SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT),
        updated_at = ?
    WHERE key = ?
  `).run(delta, new Date().toISOString(), SETTING_KEY);
}

module.exports = { getDisplayMemberCount, incrementDisplayMemberCount };
