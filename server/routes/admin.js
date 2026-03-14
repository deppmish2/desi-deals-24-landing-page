"use strict";
const express = require("express");
const router = express.Router();
const fetch = require("node-fetch");
const requireAuth = require("../middleware/auth");
const db = require("../db");
const { runCrawl } = require("../../crawler");
const {
  restoreFromSnapshot,
  isCrawlLocked,
} = require("../../crawler/utils/snapshot");
const { restoreDealsFromSeed } = require("../services/deals-seed-loader");
const { trackEvent } = require("../services/event-tracker");

const STALE_DELIVERY_DAYS = 45;
const DAY_MS = 24 * 60 * 60 * 1000;

function toIsoDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function asNullableText(value) {
  if (value == null) return null;
  const v = String(value).trim();
  return v ? v : null;
}

function asNullableNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return NaN;
  return num;
}

function normalizeMaybeArray(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  const text = String(value).trim();
  return text ? text : null;
}

function serializeDeliveryOption(row) {
  const updatedAt = row?.updated_at ? Date.parse(row.updated_at) : NaN;
  const ageDays = Number.isFinite(updatedAt)
    ? Math.max(0, Math.floor((Date.now() - updatedAt) / DAY_MS))
    : null;

  return {
    id: row.id,
    store_id: row.store_id,
    store_name: row.store_name,
    delivery_type: row.delivery_type,
    label: row.label,
    surcharge: row.surcharge,
    cutoff_time: row.cutoff_time,
    cutoff_timezone: row.cutoff_timezone,
    eligible_postcodes: parseJson(
      row.eligible_postcodes,
      row.eligible_postcodes,
    ),
    eligible_cities: parseJson(row.eligible_cities, row.eligible_cities),
    min_basket: row.min_basket,
    available_days: parseJson(row.available_days, row.available_days),
    estimated_hours: row.estimated_hours,
    estimated_days: row.estimated_days,
    is_active: Boolean(row.is_active),
    updated_at: row.updated_at,
    stale: ageDays == null ? false : ageDays > STALE_DELIVERY_DAYS,
    age_days: ageDays,
  };
}

function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function hoursSince(isoTs) {
  if (!isoTs) return null;
  const ts = Date.parse(isoTs);
  if (!Number.isFinite(ts)) return null;
  return (Date.now() - ts) / (60 * 60 * 1000);
}

// GET /api/v1/admin/crawl/warmup (public — safe: idempotent, will not double-crawl)
// Called by the frontend on page load to ensure deals are available.
router.get("/crawl/warmup", async (req, res) => {
  const dealCount = db
    .prepare(`SELECT COUNT(*) as cnt FROM deals WHERE is_active = 1`)
    .get().cnt;

  // Deals already available — just report crawl status and return.
  if (dealCount > 0) {
    const globalCrawling = await isCrawlLocked().catch(() => false);
    const localCrawling =
      db
        .prepare(
          `SELECT COUNT(*) as cnt FROM crawl_runs WHERE status = 'running'`,
        )
        .get().cnt > 0;
    return res.json({
      deal_count: dealCount,
      crawling: globalCrawling || localCrawling,
    });
  }

  // No deals — check global Redis lock first to avoid double-crawling across containers.
  const globalCrawling = await isCrawlLocked().catch(() => false);
  if (globalCrawling) {
    return res.json({ deal_count: 0, crawling: true });
  }

  // No global lock — try snapshot restore first (fast, ~1s).
  const restored = await restoreFromSnapshot(db).catch(() => false);
  if (restored) {
    const newCount = db
      .prepare(`SELECT COUNT(*) as cnt FROM deals WHERE is_active = 1`)
      .get().cnt;
    return res.json({ deal_count: newCount, crawling: false });
  }

  // If Redis snapshot is unavailable, fall back to build-time seed bundled
  // with the deployment so serverless cold starts still have usable data.
  const seeded = restoreDealsFromSeed(db);
  if (seeded.ok) {
    const newCount = db
      .prepare(`SELECT COUNT(*) as cnt FROM deals WHERE is_active = 1`)
      .get().cnt;
    return res.json({ deal_count: newCount, crawling: false });
  }

  // No snapshot in Redis and no deals locally — do NOT auto-crawl.
  // Crawls only run on the 6am UTC cron schedule.
  const localCrawling =
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM crawl_runs WHERE status = 'running'`,
      )
      .get().cnt > 0;

  res.json({ deal_count: 0, crawling: localCrawling });
});

// POST /api/v1/admin/crawl/trigger
router.post("/crawl/trigger", requireAuth, async (req, res) => {
  try {
    await runCrawl(db);
    res.json({ message: "Crawl completed" });
  } catch (e) {
    console.error("[admin] Crawl error:", e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v1/admin/crawl/status
router.get("/crawl/status", (req, res) => {
  const run = db
    .prepare(`SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT 1`)
    .get();
  if (!run) return res.json({ status: "never_run" });
  res.json({
    ...run,
    errors: run.errors ? JSON.parse(run.errors) : [],
  });
});

// GET /api/v1/admin/alerts/activity
router.get("/alerts/activity", requireAuth, (req, res) => {
  const alertsByType = db
    .prepare(
      `SELECT alert_type, COUNT(*) AS count
     FROM price_alerts
     GROUP BY alert_type
     ORDER BY count DESC`,
    )
    .all();

  const notificationStatus = db
    .prepare(
      `SELECT sent_status, COUNT(*) AS count
     FROM alert_notifications
     WHERE created_at > datetime('now', '-7 days')
     GROUP BY sent_status
     ORDER BY count DESC`,
    )
    .all();

  res.json({
    alerts_by_type: alertsByType,
    notifications_7d: notificationStatus,
  });
});

// GET /api/v1/admin/entity-resolution/queue
router.get("/entity-resolution/queue", requireAuth, (req, res) => {
  const status = String(req.query.status || "pending").trim();
  const limit = Math.min(
    200,
    Math.max(1, parseInt(req.query.limit || "100", 10)),
  );

  const rows = db
    .prepare(
      `SELECT q.*, d.product_name, d.product_url, d.store_id, c.canonical_name AS suggested_canonical_name
     FROM entity_resolution_queue q
     JOIN deals d ON d.id = q.deal_id
     LEFT JOIN canonical_products c ON c.id = q.suggested_canonical_id
     WHERE q.status = ?
     ORDER BY q.created_at DESC
     LIMIT ?`,
    )
    .all(status, limit);

  res.json({ data: rows });
});

// POST /api/v1/admin/entity-resolution/resolve
router.post("/entity-resolution/resolve", requireAuth, (req, res) => {
  const body = req.body || {};
  const verdict = String(body.verdict || "").trim();
  const queueId = body.queue_id == null ? null : Number(body.queue_id);
  const dealId = body.deal_id ? String(body.deal_id).trim() : null;
  const canonicalId = body.canonical_id
    ? String(body.canonical_id).trim()
    : null;

  if (!["confirm", "reject"].includes(verdict)) {
    return res.status(400).json({ error: "verdict must be confirm or reject" });
  }

  let queue = null;
  if (queueId != null && Number.isFinite(queueId)) {
    queue = db
      .prepare("SELECT * FROM entity_resolution_queue WHERE id = ? LIMIT 1")
      .get(queueId);
  }

  const resolvedDealId = dealId || queue?.deal_id;
  if (!resolvedDealId) {
    return res.status(400).json({ error: "Provide queue_id or deal_id" });
  }

  if (verdict === "confirm") {
    const resolvedCanonicalId = canonicalId || queue?.suggested_canonical_id;
    if (!resolvedCanonicalId) {
      return res
        .status(400)
        .json({ error: "canonical_id is required for confirm verdict" });
    }

    const canonical = db
      .prepare("SELECT id FROM canonical_products WHERE id = ? LIMIT 1")
      .get(resolvedCanonicalId);
    if (!canonical)
      return res.status(404).json({ error: "Canonical product not found" });

    db.prepare("UPDATE deals SET canonical_id = ? WHERE id = ?").run(
      resolvedCanonicalId,
      resolvedDealId,
    );
    db.prepare(
      `INSERT INTO deal_mappings
        (deal_id, canonical_id, match_method, match_confidence, verified_at)
       VALUES (?, ?, 'manual', 1.0, ?)
       ON CONFLICT(deal_id, canonical_id)
       DO UPDATE SET
         match_method = 'manual',
         match_confidence = 1.0,
         verified_at = excluded.verified_at`,
    ).run(resolvedDealId, resolvedCanonicalId, new Date().toISOString());

    if (queue?.id) {
      db.prepare(
        `UPDATE entity_resolution_queue
         SET status = 'resolved_confirm', suggested_canonical_id = ?
         WHERE id = ?`,
      ).run(resolvedCanonicalId, queue.id);
    }

    return res.json({
      ok: true,
      verdict: "confirm",
      deal_id: resolvedDealId,
      canonical_id: resolvedCanonicalId,
    });
  }

  if (queue?.id) {
    db.prepare(
      `UPDATE entity_resolution_queue
       SET status = 'resolved_reject'
       WHERE id = ?`,
    ).run(queue.id);
  }

  return res.json({ ok: true, verdict: "reject", deal_id: resolvedDealId });
});

// GET /api/v1/admin/delivery-options
router.get("/delivery-options", requireAuth, (req, res) => {
  const storeId = asNullableText(req.query.store_id);
  const includeInactive = String(req.query.include_inactive || "0") === "1";

  let where = "1 = 1";
  const params = [];

  if (storeId) {
    where += " AND d.store_id = ?";
    params.push(storeId);
  }
  if (!includeInactive) {
    where += " AND d.is_active = 1";
  }

  const rows = db
    .prepare(
      `SELECT d.*, s.name AS store_name
     FROM delivery_options d
     JOIN stores s ON s.id = d.store_id
     WHERE ${where}
     ORDER BY d.updated_at DESC, d.id DESC`,
    )
    .all(...params);

  const data = rows.map(serializeDeliveryOption);
  const staleCount = data.filter((item) => item.stale).length;

  res.json({
    data,
    meta: {
      stale_threshold_days: STALE_DELIVERY_DAYS,
      stale_count: staleCount,
    },
  });
});

// POST /api/v1/admin/delivery-options
router.post("/delivery-options", requireAuth, (req, res) => {
  const body = req.body || {};
  const storeId = asNullableText(body.store_id);
  const deliveryType = asNullableText(body.delivery_type);
  const label = asNullableText(body.label);
  const surcharge =
    body.surcharge == null ? 0 : asNullableNumber(body.surcharge);
  const minBasket =
    body.min_basket == null ? 0 : asNullableNumber(body.min_basket);
  const estimatedHours = asNullableNumber(body.estimated_hours);
  const estimatedDays = asNullableNumber(body.estimated_days);

  if (!storeId || !deliveryType || !label) {
    return res
      .status(400)
      .json({ error: "store_id, delivery_type and label are required" });
  }
  if (!Number.isFinite(surcharge) || surcharge < 0) {
    return res
      .status(400)
      .json({ error: "surcharge must be a non-negative number" });
  }
  if (!Number.isFinite(minBasket) || minBasket < 0) {
    return res
      .status(400)
      .json({ error: "min_basket must be a non-negative number" });
  }
  if (
    estimatedHours != null &&
    (!Number.isFinite(estimatedHours) || estimatedHours < 0)
  ) {
    return res
      .status(400)
      .json({ error: "estimated_hours must be null or a non-negative number" });
  }
  if (
    estimatedDays != null &&
    (!Number.isFinite(estimatedDays) || estimatedDays < 0)
  ) {
    return res
      .status(400)
      .json({ error: "estimated_days must be null or a non-negative number" });
  }

  const store = db
    .prepare("SELECT id FROM stores WHERE id = ? LIMIT 1")
    .get(storeId);
  if (!store) return res.status(404).json({ error: "Store not found" });

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO delivery_options
      (store_id, delivery_type, label, surcharge, cutoff_time, cutoff_timezone, eligible_postcodes,
       eligible_cities, min_basket, available_days, estimated_hours, estimated_days, is_active, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      storeId,
      deliveryType,
      label,
      surcharge,
      asNullableText(body.cutoff_time),
      asNullableText(body.cutoff_timezone) || "Europe/Berlin",
      normalizeMaybeArray(body.eligible_postcodes),
      normalizeMaybeArray(body.eligible_cities),
      minBasket,
      normalizeMaybeArray(body.available_days),
      estimatedHours,
      estimatedDays,
      body.is_active === false ? 0 : 1,
      now,
    );

  const created = db
    .prepare(
      `SELECT d.*, s.name AS store_name
     FROM delivery_options d
     JOIN stores s ON s.id = d.store_id
     WHERE d.id = ?`,
    )
    .get(result.lastInsertRowid);

  trackEvent(db, "admin.delivery_option_created", {
    source: "admin",
    route: req.originalUrl,
    entityType: "delivery_option",
    entityId: String(created.id),
    payload: {
      store_id: created.store_id,
      delivery_type: created.delivery_type,
    },
  });

  res.status(201).json({ data: serializeDeliveryOption(created) });
});

// PUT /api/v1/admin/delivery-options/:id
router.put("/delivery-options/:id", requireAuth, (req, res) => {
  const existing = db
    .prepare(
      `SELECT d.*, s.name AS store_name
     FROM delivery_options d
     JOIN stores s ON s.id = d.store_id
     WHERE d.id = ?`,
    )
    .get(req.params.id);

  if (!existing)
    return res.status(404).json({ error: "Delivery option not found" });

  const body = req.body || {};
  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(body, "store_id")) {
    const storeId = asNullableText(body.store_id);
    if (!storeId)
      return res.status(400).json({ error: "store_id cannot be empty" });
    const store = db
      .prepare("SELECT id FROM stores WHERE id = ? LIMIT 1")
      .get(storeId);
    if (!store) return res.status(404).json({ error: "Store not found" });
    updates.push("store_id = ?");
    params.push(storeId);
  }

  if (Object.prototype.hasOwnProperty.call(body, "delivery_type")) {
    const deliveryType = asNullableText(body.delivery_type);
    if (!deliveryType)
      return res.status(400).json({ error: "delivery_type cannot be empty" });
    updates.push("delivery_type = ?");
    params.push(deliveryType);
  }

  if (Object.prototype.hasOwnProperty.call(body, "label")) {
    const label = asNullableText(body.label);
    if (!label) return res.status(400).json({ error: "label cannot be empty" });
    updates.push("label = ?");
    params.push(label);
  }

  if (Object.prototype.hasOwnProperty.call(body, "surcharge")) {
    const value = asNullableNumber(body.surcharge);
    if (!Number.isFinite(value) || value < 0) {
      return res
        .status(400)
        .json({ error: "surcharge must be a non-negative number" });
    }
    updates.push("surcharge = ?");
    params.push(value);
  }

  if (Object.prototype.hasOwnProperty.call(body, "cutoff_time")) {
    updates.push("cutoff_time = ?");
    params.push(asNullableText(body.cutoff_time));
  }

  if (Object.prototype.hasOwnProperty.call(body, "cutoff_timezone")) {
    const value = asNullableText(body.cutoff_timezone);
    updates.push("cutoff_timezone = ?");
    params.push(value || "Europe/Berlin");
  }

  if (Object.prototype.hasOwnProperty.call(body, "eligible_postcodes")) {
    updates.push("eligible_postcodes = ?");
    params.push(normalizeMaybeArray(body.eligible_postcodes));
  }

  if (Object.prototype.hasOwnProperty.call(body, "eligible_cities")) {
    updates.push("eligible_cities = ?");
    params.push(normalizeMaybeArray(body.eligible_cities));
  }

  if (Object.prototype.hasOwnProperty.call(body, "min_basket")) {
    const value = asNullableNumber(body.min_basket);
    if (!Number.isFinite(value) || value < 0) {
      return res
        .status(400)
        .json({ error: "min_basket must be a non-negative number" });
    }
    updates.push("min_basket = ?");
    params.push(value);
  }

  if (Object.prototype.hasOwnProperty.call(body, "available_days")) {
    updates.push("available_days = ?");
    params.push(normalizeMaybeArray(body.available_days));
  }

  if (Object.prototype.hasOwnProperty.call(body, "estimated_hours")) {
    const value = asNullableNumber(body.estimated_hours);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      return res.status(400).json({
        error: "estimated_hours must be null or a non-negative number",
      });
    }
    updates.push("estimated_hours = ?");
    params.push(value);
  }

  if (Object.prototype.hasOwnProperty.call(body, "estimated_days")) {
    const value = asNullableNumber(body.estimated_days);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      return res.status(400).json({
        error: "estimated_days must be null or a non-negative number",
      });
    }
    updates.push("estimated_days = ?");
    params.push(value);
  }

  if (Object.prototype.hasOwnProperty.call(body, "is_active")) {
    updates.push("is_active = ?");
    params.push(body.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.json({ data: serializeDeliveryOption(existing) });
  }

  updates.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(existing.id);
  db.prepare(
    `UPDATE delivery_options SET ${updates.join(", ")} WHERE id = ?`,
  ).run(...params);

  const updated = db
    .prepare(
      `SELECT d.*, s.name AS store_name
     FROM delivery_options d
     JOIN stores s ON s.id = d.store_id
     WHERE d.id = ?`,
    )
    .get(existing.id);

  trackEvent(db, "admin.delivery_option_updated", {
    source: "admin",
    route: req.originalUrl,
    entityType: "delivery_option",
    entityId: String(updated.id),
    payload: {
      store_id: updated.store_id,
      delivery_type: updated.delivery_type,
    },
  });

  res.json({ data: serializeDeliveryOption(updated) });
});

// DELETE /api/v1/admin/delivery-options/:id
router.delete("/delivery-options/:id", requireAuth, (req, res) => {
  const result = db
    .prepare(
      `UPDATE delivery_options
     SET is_active = 0, updated_at = ?
     WHERE id = ?`,
    )
    .run(new Date().toISOString(), req.params.id);

  if (result.changes === 0)
    return res.status(404).json({ error: "Delivery option not found" });

  trackEvent(db, "admin.delivery_option_deactivated", {
    source: "admin",
    route: req.originalUrl,
    entityType: "delivery_option",
    entityId: String(req.params.id),
  });

  res.json({ ok: true });
});

// GET /api/v1/admin/analytics/kpis
router.get("/analytics/kpis", requireAuth, (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days || "7", 10)));
  const fromIso = toIsoDaysAgo(days);
  const dayIso = toIsoDaysAgo(1);
  const staleCutoffIso = toIsoDaysAgo(STALE_DELIVERY_DAYS);

  const rows = db
    .prepare(
      `SELECT event_name, user_id, payload, created_at
     FROM events
     WHERE created_at >= ?`,
    )
    .all(fromIso);

  const byEvent = {};
  const uniqueUsers = new Set();
  const dauUsers = new Set();
  const browseDurations = [];
  const searchDurations = [];
  const recommendDurations = [];

  for (const row of rows) {
    byEvent[row.event_name] = (byEvent[row.event_name] || 0) + 1;
    if (row.user_id) {
      uniqueUsers.add(row.user_id);
      if (row.created_at >= dayIso) dauUsers.add(row.user_id);
    }

    const payload = parseJson(row.payload, null);
    const durationMs = Number(payload?.duration_ms);
    if (!Number.isFinite(durationMs)) continue;
    if (row.event_name === "browse.deals") browseDurations.push(durationMs);
    if (row.event_name === "search.autocomplete")
      searchDurations.push(durationMs);
    if (row.event_name === "recommendation.generated")
      recommendDurations.push(durationMs);
  }

  const staleDeliveryCount = db
    .prepare(
      `SELECT COUNT(*) AS cnt
     FROM delivery_options
     WHERE is_active = 1 AND updated_at < ?`,
    )
    .get(staleCutoffIso).cnt;

  const topEvents = Object.entries(byEvent)
    .map(([event_name, count]) => ({ event_name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  res.json({
    window_days: days,
    totals: {
      events: rows.length,
      unique_users: uniqueUsers.size,
      active_users_24h: dauUsers.size,
    },
    funnel: {
      signups: byEvent["auth.register"] || 0,
      logins: byEvent["auth.login"] || 0,
      lists_created: byEvent["lists.created"] || 0,
      recommendations: byEvent["recommendation.generated"] || 0,
      alerts_created: byEvent["alerts.created"] || 0,
    },
    performance_ms: {
      browse: {
        p50: percentile(browseDurations, 50),
        p95: percentile(browseDurations, 95),
        samples: browseDurations.length,
      },
      search: {
        p50: percentile(searchDurations, 50),
        p95: percentile(searchDurations, 95),
        samples: searchDurations.length,
      },
      recommendation: {
        p50: percentile(recommendDurations, 50),
        p95: percentile(recommendDurations, 95),
        samples: recommendDurations.length,
      },
      targets: {
        browse_search_under_ms: 200,
        recommendation_under_ms: 5000,
      },
    },
    delivery_options: {
      stale_threshold_days: STALE_DELIVERY_DAYS,
      stale_active_count: staleDeliveryCount,
    },
    top_events: topEvents,
  });
});

// GET /api/v1/admin/release/readiness
router.get("/release/readiness", requireAuth, (req, res) => {
  const freshnessHours = Math.min(
    168,
    Math.max(1, parseInt(req.query.freshness_hours || "48", 10)),
  );
  const freshnessCutoff = new Date(
    Date.now() - freshnessHours * 60 * 60 * 1000,
  ).toISOString();

  const storesTotal = db
    .prepare("SELECT COUNT(*) AS cnt FROM stores")
    .get().cnt;
  const storesFresh = db
    .prepare(
      `SELECT COUNT(*) AS cnt
     FROM stores
     WHERE crawl_status = 'active' AND last_crawled_at IS NOT NULL AND last_crawled_at >= ?`,
    )
    .get(freshnessCutoff).cnt;

  const staleStores = db
    .prepare(
      `SELECT id, name, crawl_status, last_crawled_at
     FROM stores
     WHERE last_crawled_at IS NULL OR last_crawled_at < ?
     ORDER BY COALESCE(last_crawled_at, '') ASC`,
    )
    .all(freshnessCutoff)
    .map((row) => ({
      ...row,
      hours_since_crawl: row.last_crawled_at
        ? Math.round((hoursSince(row.last_crawled_at) || 0) * 10) / 10
        : null,
    }));

  const latestRun = db
    .prepare(
      `SELECT *
     FROM crawl_runs
     ORDER BY started_at DESC
     LIMIT 1`,
    )
    .get();

  const pendingQueue = db
    .prepare(
      `SELECT COUNT(*) AS cnt
     FROM entity_resolution_queue
     WHERE status = 'pending'`,
    )
    .get().cnt;

  const activeAlerts = db
    .prepare(
      `SELECT COUNT(*) AS cnt
     FROM price_alerts
     WHERE is_active = 1`,
    )
    .get().cnt;

  const deliveryStale = db
    .prepare(
      `SELECT COUNT(*) AS cnt
     FROM delivery_options
     WHERE is_active = 1 AND updated_at < ?`,
    )
    .get(toIsoDaysAgo(STALE_DELIVERY_DAYS)).cnt;

  const successRate = latestRun?.stores_attempted
    ? latestRun.stores_succeeded / latestRun.stores_attempted
    : null;
  const freshnessRate = storesTotal ? storesFresh / storesTotal : null;

  const checks = [
    {
      id: "crawl_success_rate",
      label: "Last crawl store success >= 80%",
      passed: successRate == null ? false : successRate >= 0.8,
      value: successRate == null ? null : Math.round(successRate * 1000) / 10,
      target: ">=80%",
    },
    {
      id: "store_freshness",
      label: `Stores crawled within ${freshnessHours}h >= 80%`,
      passed: freshnessRate == null ? false : freshnessRate >= 0.8,
      value:
        freshnessRate == null ? null : Math.round(freshnessRate * 1000) / 10,
      target: ">=80%",
    },
    {
      id: "entity_queue",
      label: "Entity queue pending <= 500",
      passed: pendingQueue <= 500,
      value: pendingQueue,
      target: "<=500",
    },
    {
      id: "delivery_staleness",
      label: `Stale active delivery options <= 10 (>${STALE_DELIVERY_DAYS}d)`,
      passed: deliveryStale <= 10,
      value: deliveryStale,
      target: "<=10",
    },
  ];

  res.json({
    generated_at: new Date().toISOString(),
    freshness_hours: freshnessHours,
    summary: {
      stores_total: storesTotal,
      stores_fresh: storesFresh,
      stale_stores_count: staleStores.length,
      pending_entity_resolution: pendingQueue,
      active_alerts: activeAlerts,
      stale_delivery_options: deliveryStale,
      latest_crawl: latestRun
        ? {
            id: latestRun.id,
            started_at: latestRun.started_at,
            finished_at: latestRun.finished_at,
            status: latestRun.status,
            stores_attempted: latestRun.stores_attempted,
            stores_succeeded: latestRun.stores_succeeded,
            deals_found: latestRun.deals_found,
            success_rate_pct:
              successRate == null ? null : Math.round(successRate * 1000) / 10,
          }
        : null,
    },
    checks,
    pass: checks.every((check) => check.passed),
    stale_stores: staleStores,
  });
});

// GET /api/v1/admin/proxy/image?url=<encoded>
router.get("/proxy/image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url param required" });

  try {
    const upstream = await fetch(decodeURIComponent(url), {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 10000,
    });
    if (!upstream.ok) return res.status(upstream.status).end();

    res.set(
      "Content-Type",
      upstream.headers.get("content-type") || "image/jpeg",
    );
    res.set("Cache-Control", "public, max-age=86400");
    upstream.body.pipe(res);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
