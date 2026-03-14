"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createTestDb, nowIso } = require("./helpers");
const {
  restoreDealsFromSeed,
} = require("../../server/services/deals-seed-loader");

function writeTempSeed(payload) {
  const filename = `dd24-seed-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  const filePath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

test("restoreDealsFromSeed loads active deals from a seed file", () => {
  const db = createTestDb();
  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)").run(
    "s1",
    "Seed Store",
    "https://seed-store.example",
  );

  const seedPath = writeTempSeed([
    {
      id: "seed-deal-1",
      crawl_run_id: "seed-run-1",
      crawl_timestamp: nowIso(),
      store_id: "s1",
      product_name: "Toor Dal 1kg",
      product_category: "Lentils & Pulses",
      product_url: "https://seed-store.example/p/toor-dal",
      image_url: null,
      weight_raw: "1kg",
      weight_value: 1,
      weight_unit: "kg",
      sale_price: 2.49,
      original_price: 2.99,
      discount_percent: 16.7,
      price_per_kg: 2.49,
      price_per_unit: null,
      currency: "EUR",
      availability: "in_stock",
      bulk_pricing: null,
      best_before: null,
      is_active: 1,
      created_at: nowIso(),
    },
  ]);

  try {
    const restored = restoreDealsFromSeed(db, { seedPath });
    assert.equal(restored.ok, true);

    const count = db
      .prepare("SELECT COUNT(*) AS n FROM deals WHERE is_active = 1")
      .get().n;
    assert.equal(count, 1);
  } finally {
    fs.rmSync(seedPath, { force: true });
  }
});

test("restoreDealsFromSeed reports empty_seed when seed has no rows", () => {
  const db = createTestDb();
  const seedPath = writeTempSeed([]);
  try {
    const restored = restoreDealsFromSeed(db, { seedPath });
    assert.equal(restored.ok, false);
    assert.equal(restored.reason, "empty_seed");
  } finally {
    fs.rmSync(seedPath, { force: true });
  }
});
