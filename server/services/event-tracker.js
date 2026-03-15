"use strict";

function safeStringify(value) {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "payload_not_serializable" });
  }
}

async function trackEvent(db, eventName, options = {}) {
  const name = String(eventName || "").trim();
  if (!name) return false;

  const source =
    options.source == null ? "api" : String(options.source).trim() || "api";
  const route =
    options.route == null ? null : String(options.route).trim() || null;
  const entityType =
    options.entityType == null
      ? null
      : String(options.entityType).trim() || null;
  const entityId =
    options.entityId == null ? null : String(options.entityId).trim() || null;
  const payload = safeStringify(options.payload || null);
  const userId =
    options.userId == null ? null : String(options.userId).trim() || null;

  try {
    await db.prepare(
      `INSERT INTO events
        (event_name, user_id, source, route, entity_type, entity_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(name, userId, source, route, entityType, entityId, payload);
    return true;
  } catch (error) {
    console.warn("[events] track failed:", error.message);
    return false;
  }
}

module.exports = {
  trackEvent,
};
