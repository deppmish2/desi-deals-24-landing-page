#!/usr/bin/env node
"use strict";
/**
 * Local-only setup for Real Savings feature testing.
 *
 * Adds columns, seeds dummy canonical products with is_priority = 1,
 * and inserts fake price-history rows so getRealSavings() returns
 * non-null data during local development.
 *
 * SAFETY GATE: Refuses to run if TURSO_DATABASE_URL is set.
 *
 * Usage:
 *   node scripts/setup-real-savings-local.js
 */
require("dotenv").config();
const path = require("path");
const { createClient } = require("@libsql/client");
const { randomUUID } = require("crypto");

const tursoUrl =
  process.env.TURSO_DATABASE_URL ||
  process.env.DESI_DEALS_DB_TURSO_DATABASE_URL;

if (tursoUrl) {
  console.error(
    "\n❌  TURSO_DATABASE_URL is set — refusing to run against the production DB.\n" +
    "    Unset the variable or run without it to target the local SQLite file.\n",
  );
  process.exit(1);
}

const client = createClient({
  url: `file:${path.resolve("./data/desiDeals24.db")}`,
});

async function exec(sql, args = []) {
  return client.execute({ sql, args });
}

// ─── 1. Schema migrations (additive only — no renames) ────────────────────────

async function runMigrations() {
  console.log("\n[1/3] Running schema migrations…");
  const migrations = [
    "ALTER TABLE canonical_products ADD COLUMN is_priority INTEGER DEFAULT 0",
    "ALTER TABLE deals ADD COLUMN is_deal INTEGER DEFAULT 0",
    "ALTER TABLE deal_price_history ADD COLUMN is_deal INTEGER DEFAULT 0",
  ];

  for (const sql of migrations) {
    try {
      await exec(sql);
      const col = sql.match(/ADD COLUMN (\S+)/)?.[1] ?? "?";
      console.log(`  ✓  Added column: ${col}`);
    } catch (e) {
      if (/duplicate column/i.test(e.message)) {
        const col = sql.match(/ADD COLUMN (\S+)/)?.[1] ?? "?";
        console.log(`  —  Already exists: ${col}`);
      } else {
        console.warn(`  !  ${e.message}`);
      }
    }
  }
}

// ─── 2. Seed priority canonical products ──────────────────────────────────────

const PRIORITY_PRODUCTS = [
  { id: "cp-aashirvaad-atta-5kg",    name: "Aashirvaad Atta 5kg",    category: "Flours & Baking"   },
  { id: "cp-tata-salt-1kg",          name: "Tata Salt 1kg",          category: "Canned & Packaged" },
  { id: "cp-chana-dal-1kg",          name: "Chana Dal 1kg",          category: "Lentils & Pulses"  },
  { id: "cp-basmati-rice-5kg",       name: "Basmati Rice 5kg",       category: "Rice & Grains"     },
  { id: "cp-mdh-garam-masala-100g",  name: "MDH Garam Masala 100g",  category: "Spices & Masalas"  },
  { id: "cp-amul-butter-500g",       name: "Amul Butter 500g",       category: "Dairy & Paneer"    },
  { id: "cp-maggi-noodles-12pk",     name: "Maggi Noodles 12 Pack",  category: "Noodles & Pasta"   },
  { id: "cp-mustard-oil-1l",         name: "Mustard Oil 1L",         category: "Oils & Ghee"       },
];

async function seedCanonicalProducts() {
  console.log("\n[2/3] Seeding priority canonical products…");

  for (const p of PRIORITY_PRODUCTS) {
    await exec(
      `INSERT OR IGNORE INTO canonical_products (id, canonical_name, category, is_priority, verified)
       VALUES (?, ?, ?, 1, 1)`,
      [p.id, p.name, p.category],
    );
    // Ensure is_priority=1 even if the row already existed
    await exec(
      `UPDATE canonical_products SET is_priority = 1 WHERE id = ?`,
      [p.id],
    );
  }
  console.log(`  ✓  ${PRIORITY_PRODUCTS.length} canonical products marked is_priority = 1`);
}

// ─── 3. Seed dummy price-history rows ─────────────────────────────────────────
//
// Pulls the first 10 active deals from the local DB and inserts fake
// deal_price_history rows at slightly higher prices over the past 90 days.
// This lets getRealSavings() return non-null ratings immediately.

async function seedPriceHistory() {
  console.log("\n[3/3] Seeding dummy price history…");

  // Fetch a sample of real deals to use as anchors
  let deals;
  try {
    const res = await exec(`
      SELECT d.id, d.product_url, d.product_name, d.product_category,
             d.sale_price, d.original_price, d.store_id
      FROM deals d
      WHERE d.is_active = 1 AND d.sale_price IS NOT NULL
      ORDER BY d.display_order ASC
      LIMIT 10
    `);
    deals = res.rows ?? [];
  } catch (e) {
    console.warn(`  !  Could not read deals table: ${e.message}`);
    console.warn("     Reset the DB and re-crawl, then re-run this script:");
    console.warn("     rm data/desiDeals24.db data/desiDeals24.db-shm data/desiDeals24.db-wal");
    console.warn("     node -e \"require('./server/db')\" && npm run crawl");
    return;
  }

  if (deals.length === 0) {
    console.log("  —  No active deals found — run npm run crawl first, then re-run this script.");
    return;
  }

  // Fetch one store for the history rows
  const { rows: stores } = await exec(`SELECT id FROM stores LIMIT 3`);
  const storeIds = stores.map((r) => r.id);

  let inserted = 0;

  for (const deal of deals) {
    const salePrice = Number(deal.sale_price);
    if (!salePrice) continue;

    // Generate 6 history snapshots: 3 deal-priced, 3 non-deal (higher price)
    const snapshots = [
      { daysAgo: 85, price: salePrice * 1.30, isDeal: 0 },
      { daysAgo: 70, price: salePrice * 1.28, isDeal: 0 },
      { daysAgo: 55, price: salePrice * 1.25, isDeal: 1 },
      { daysAgo: 40, price: salePrice * 1.27, isDeal: 0 },
      { daysAgo: 20, price: salePrice * 1.00, isDeal: 1 },
      { daysAgo: 5,  price: salePrice * 1.25, isDeal: 0 },
    ];

    for (const snap of snapshots) {
      const crawlDate = new Date(Date.now() - snap.daysAgo * 86400_000)
        .toISOString()
        .slice(0, 10);
      const storeId = storeIds[Math.floor(Math.random() * storeIds.length)] || deal.store_id;

      try {
        await exec(
          `INSERT OR IGNORE INTO deal_price_history
             (id, crawl_date, crawl_run_id, crawl_timestamp, store_id,
              product_name, product_category, product_url,
              sale_price, is_deal, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR')`,
          [
            randomUUID(),
            crawlDate,
            `dummy-run-${crawlDate}`,
            new Date(Date.now() - snap.daysAgo * 86400_000).toISOString(),
            storeId,
            deal.product_name,
            deal.product_category,
            deal.product_url,
            Math.round(snap.price * 100) / 100,
            snap.isDeal,
          ],
        );
        inserted++;
      } catch (_) {
        // UNIQUE constraint on (crawl_date, store_id, product_url) — skip
      }
    }
  }

  console.log(`  ✓  Inserted ${inserted} dummy price-history rows for ${deals.length} deals`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Real Savings local test setup ===");
  await runMigrations();
  await seedCanonicalProducts();
  await seedPriceHistory();
  console.log("\n✅  Done. Restart the API server and test GET /api/deals — each deal now includes real_savings.\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
