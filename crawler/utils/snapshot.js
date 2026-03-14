"use strict";
const fetch = require("node-fetch");

function normalizeEnvValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const wrappedInDoubleQuotes = text.startsWith('"') && text.endsWith('"');
  const wrappedInSingleQuotes = text.startsWith("'") && text.endsWith("'");
  if ((wrappedInDoubleQuotes || wrappedInSingleQuotes) && text.length >= 2) {
    return text.slice(1, -1).trim();
  }
  return text;
}

const REDIS_URL = normalizeEnvValue(process.env.UPSTASH_REDIS_REST_URL);
const REDIS_TOKEN = normalizeEnvValue(process.env.UPSTASH_REDIS_REST_TOKEN);

const SNAPSHOT_KEY =
  normalizeEnvValue(process.env.REDIS_SNAPSHOT_KEY) || "stores-crawl";
const LEGACY_SNAPSHOT_KEY = "desiDeals24:snapshot";
const LOCK_KEY = "desiDeals24:crawl:lock";
const SNAPSHOT_TTL = 48 * 60 * 60; // 48 hours
const LOCK_TTL = 20 * 60; // 20 min safety net (crawl should finish well before this)
const REDIS_HTTP_TIMEOUT_MS = Math.max(
  500,
  parseInt(process.env.REDIS_HTTP_TIMEOUT_MS || "3000", 10),
);
const SNAPSHOT_CHUNK_FORMAT = "chunked-json-b64-v1";
const SNAPSHOT_DIRECT_MAX_BYTES = Math.max(
  1_000_000,
  parseInt(process.env.REDIS_SNAPSHOT_DIRECT_MAX_BYTES || "8000000", 10),
);
const SNAPSHOT_CHUNK_BYTES = Math.max(
  500_000,
  parseInt(process.env.REDIS_SNAPSHOT_CHUNK_BYTES || "6500000", 10),
);

function normalizeRedisUrl(url) {
  if (!url || typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    return url.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const REDIS_BASE_URL = normalizeRedisUrl(REDIS_URL);

function redisEnabled() {
  return Boolean(REDIS_BASE_URL && REDIS_TOKEN);
}

function redisDisabledReason() {
  if (!REDIS_URL) return "UPSTASH_REDIS_REST_URL missing";
  if (!REDIS_BASE_URL)
    return "UPSTASH_REDIS_REST_URL invalid (must be absolute http/https URL)";
  if (!REDIS_TOKEN) return "UPSTASH_REDIS_REST_TOKEN missing";
  return null;
}

// ── internal helper ───────────────────────────────────────────────────────────

async function redisCmd(args) {
  if (!redisEnabled()) return { ok: false, reason: "disabled" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REDIS_HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${REDIS_BASE_URL}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify([args]),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: "http", status: res.status, body };
    }
    const json = await res.json();
    return { ok: true, result: json?.[0]?.result ?? null };
  } catch (e) {
    return { ok: false, reason: "network", error: e };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeSnapshotValue(key, serialized) {
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= SNAPSHOT_DIRECT_MAX_BYTES) {
    const cmd = await redisCmd([
      "SET",
      key,
      serialized,
      "EX",
      String(SNAPSHOT_TTL),
    ]);
    return { ok: cmd.ok, mode: "direct", bytes, ...cmd };
  }

  const prefix = `${key}:part:`;
  const source = Buffer.from(serialized, "utf8");
  const chunkCount = Math.ceil(source.length / SNAPSHOT_CHUNK_BYTES);

  for (let i = 0; i < chunkCount; i++) {
    const chunk = source
      .subarray(i * SNAPSHOT_CHUNK_BYTES, (i + 1) * SNAPSHOT_CHUNK_BYTES)
      .toString("base64");
    const partCmd = await redisCmd([
      "SET",
      `${prefix}${i}`,
      chunk,
      "EX",
      String(SNAPSHOT_TTL),
    ]);
    if (!partCmd.ok) {
      return { ok: false, mode: "chunked", step: "part", part: i, ...partCmd };
    }
  }

  const manifest = {
    format: SNAPSHOT_CHUNK_FORMAT,
    encoding: "base64",
    chunk_prefix: prefix,
    chunk_count: chunkCount,
    byte_length: source.length,
    saved_at: new Date().toISOString(),
  };
  const manifestCmd = await redisCmd([
    "SET",
    key,
    JSON.stringify(manifest),
    "EX",
    String(SNAPSHOT_TTL),
  ]);
  return {
    ok: manifestCmd.ok,
    mode: "chunked",
    bytes: source.length,
    chunkCount,
    ...manifestCmd,
  };
}

async function readSnapshotValue(key) {
  const cmd = await redisCmd(["GET", key]);
  if (!cmd.ok || !cmd.result) return { ok: false, reason: "missing" };

  let parsed;
  try {
    parsed = JSON.parse(cmd.result);
  } catch {
    return { ok: true, serialized: cmd.result, source: key, mode: "direct" };
  }

  if (parsed?.format !== SNAPSHOT_CHUNK_FORMAT) {
    return { ok: true, serialized: cmd.result, source: key, mode: "direct" };
  }

  const chunkCount = Number(parsed.chunk_count || 0);
  const prefix = String(parsed.chunk_prefix || "");
  if (!chunkCount || !prefix) {
    return { ok: false, reason: "invalid_manifest" };
  }

  const buffers = [];
  for (let i = 0; i < chunkCount; i++) {
    const partCmd = await redisCmd(["GET", `${prefix}${i}`]);
    if (!partCmd.ok || !partCmd.result) {
      return { ok: false, reason: "missing_chunk", part: i };
    }
    buffers.push(Buffer.from(partCmd.result, "base64"));
  }

  return {
    ok: true,
    serialized: Buffer.concat(buffers).toString("utf8"),
    source: key,
    mode: "chunked",
  };
}

// ── Crawl lock (global across all Vercel containers) ─────────────────────────

/**
 * Try to set the global crawl lock. Returns true if we acquired it
 * (no other container is crawling), false if the lock was already held.
 * Uses Redis SET NX EX so it's atomic.
 */
async function acquireCrawlLock() {
  if (!redisEnabled()) {
    const reason = redisDisabledReason();
    if (reason)
      console.warn(`[snapshot] Redis disabled for crawl lock: ${reason}`);
    return true; // no Redis → always allow (fallback)
  }
  const cmd = await redisCmd([
    "SET",
    LOCK_KEY,
    "1",
    "NX",
    "EX",
    String(LOCK_TTL),
  ]);
  if (!cmd.ok) {
    console.warn(
      `[snapshot] Redis lock unavailable (${cmd.reason}${cmd.status ? ` ${cmd.status}` : ""}); allowing crawl fallback.`,
    );
    return true;
  }
  return cmd.result === "OK"; // null means lock already held
}

/**
 * Release the global crawl lock. Called when a crawl finishes.
 */
async function releaseCrawlLock() {
  if (!redisEnabled()) return;
  await redisCmd(["DEL", LOCK_KEY]);
}

/**
 * Check if any container is currently crawling.
 * Falls back to false (not crawling) if Redis is not configured.
 */
async function isCrawlLocked() {
  if (!redisEnabled()) return false;
  const cmd = await redisCmd(["EXISTS", LOCK_KEY]);
  if (!cmd.ok) return false;
  return cmd.result === 1;
}

// ── Deal snapshot ─────────────────────────────────────────────────────────────

/**
 * Saves all active deals from SQLite to Upstash Redis.
 * Called after each successful crawl run.
 * No-ops silently if Redis env vars are not configured.
 */
async function saveSnapshot(db) {
  if (!redisEnabled()) {
    const reason = redisDisabledReason();
    if (reason) console.warn(`[snapshot] Save skipped: ${reason}`);
    return false;
  }
  try {
    const deals = db.prepare("SELECT * FROM deals WHERE is_active = 1").all();
    if (deals.length === 0) return;
    const stores = db.prepare("SELECT * FROM stores").all();
    const latestRun =
      db
        .prepare(
          `
            SELECT id, started_at, finished_at, status,
                   stores_attempted, stores_succeeded, deals_found, errors
            FROM crawl_runs
            ORDER BY started_at DESC
            LIMIT 1
          `,
        )
        .get() || null;

    const payload = {
      version: 2,
      saved_at: new Date().toISOString(),
      stores,
      deals,
      crawl_run: latestRun,
    };

    const serialized = JSON.stringify(payload);
    const writePrimary = await writeSnapshotValue(SNAPSHOT_KEY, serialized);
    if (!writePrimary.ok) {
      console.error(
        `[snapshot] Save failed (${writePrimary.reason}${writePrimary.status ? ` ${writePrimary.status}` : ""})${writePrimary.body ? `: ${writePrimary.body}` : ""}`,
      );
      return false;
    }

    // Keep writing legacy key for backwards compatibility with older deployments.
    if (SNAPSHOT_KEY !== LEGACY_SNAPSHOT_KEY) {
      const legacyCmd = await writeSnapshotValue(
        LEGACY_SNAPSHOT_KEY,
        JSON.stringify(deals),
      );
      if (!legacyCmd.ok) {
        console.warn(
          `[snapshot] Legacy key save failed (${legacyCmd.reason}${legacyCmd.status ? ` ${legacyCmd.status}` : ""})`,
        );
      }
    }

    console.log(
      `[snapshot] Saved ${deals.length} deals / ${stores.length} stores to Redis key '${SNAPSHOT_KEY}' (${writePrimary.mode}${writePrimary.chunkCount ? `, ${writePrimary.chunkCount} chunks` : ""}, TTL: 48h)`,
    );
    return true;
  } catch (e) {
    console.error("[snapshot] Save failed:", e.message);
    return false;
  }
}

/**
 * Restores deals from Upstash Redis snapshot into SQLite.
 * Called on cold start when the DB is empty.
 * Returns true if deals were restored, false otherwise.
 */
async function restoreFromSnapshot(db) {
  if (!redisEnabled()) return false;
  try {
    const readKeys = Array.from(new Set([SNAPSHOT_KEY, LEGACY_SNAPSHOT_KEY]));
    let snapshotRaw = null;
    let sourceKey = null;
    let sourceMode = "direct";

    for (const key of readKeys) {
      const restored = await readSnapshotValue(key);
      if (!restored.ok) continue;
      snapshotRaw = restored.serialized;
      sourceKey = restored.source;
      sourceMode = restored.mode || "direct";
      break;
    }
    if (!snapshotRaw) return false;

    const parsed = JSON.parse(snapshotRaw);
    const stores = Array.isArray(parsed?.stores) ? parsed.stores : [];
    const deals = Array.isArray(parsed) ? parsed : parsed?.deals;
    const crawlRun = parsed?.crawl_run || null;
    if (!Array.isArray(deals) || deals.length === 0) return false;

    const insertStore = db.prepare(`
      INSERT OR REPLACE INTO stores
        (id, name, url, platform, logo_url, last_crawled_at, crawl_status,
         free_shipping_min, address, contact_phone, contact_email, webhook_secret)
      VALUES
        (@id, @name, @url, @platform, @logo_url, @last_crawled_at, @crawl_status,
         @free_shipping_min, @address, @contact_phone, @contact_email, @webhook_secret)
    `);

    const insertRun = db.prepare(`
      INSERT OR IGNORE INTO crawl_runs
        (id, started_at, finished_at, status, stores_attempted, stores_succeeded, deals_found, errors)
      VALUES
        (@id, @started_at, @finished_at, @status, @stores_attempted, @stores_succeeded, @deals_found, @errors)
    `);

    const insert = db.prepare(`
      INSERT OR REPLACE INTO deals
        (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
         product_url, image_url, weight_raw, weight_value, weight_unit,
         sale_price, original_price, discount_percent, price_per_kg, price_per_unit,
         currency, availability, bulk_pricing, best_before, is_active, created_at)
      VALUES
        (@id, @crawl_run_id, @crawl_timestamp, @store_id, @product_name, @product_category,
         @product_url, @image_url, @weight_raw, @weight_value, @weight_unit,
         @sale_price, @original_price, @discount_percent, @price_per_kg, @price_per_unit,
         @currency, @availability, @bulk_pricing, @best_before, @is_active, @created_at)
    `);

    db.transaction((snapshotStores, snapshotDeals, snapshotRun) => {
      for (const store of snapshotStores) insertStore.run(store);
      if (snapshotRun && snapshotRun.id) insertRun.run(snapshotRun);
      for (const d of snapshotDeals) insert.run(d);
    })(stores, deals, crawlRun);

    console.log(
      `[snapshot] Restored ${deals.length} deals / ${stores.length} stores from Redis key '${sourceKey}' (${sourceMode})`,
    );
    return true;
  } catch (e) {
    console.error("[snapshot] Restore failed:", e.message);
    return false;
  }
}

module.exports = {
  saveSnapshot,
  restoreFromSnapshot,
  acquireCrawlLock,
  releaseCrawlLock,
  isCrawlLocked,
};
