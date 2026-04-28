'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_FILE = process.env.DB_FILE || 'data/desiDeals24.db';
const db = new Database(path.resolve(DB_FILE));

function tableExists(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!row;
}

db.pragma('foreign_keys = OFF');

const migration = db.transaction(() => {
  // Phase A — Table renames
  if (tableExists('deals') && !tableExists('store_products')) {
    db.prepare('ALTER TABLE deals RENAME TO store_products').run();
    console.log('Renamed deals → store_products');
  } else {
    console.log('Skip: deals→store_products (already done or source absent)');
  }

  if (tableExists('deal_price_history') && !tableExists('price_history')) {
    db.prepare('ALTER TABLE deal_price_history RENAME TO price_history').run();
    console.log('Renamed deal_price_history → price_history');
  } else {
    console.log('Skip: deal_price_history→price_history (already done or source absent)');
  }

  if (tableExists('deal_mappings') && !tableExists('store_product_mappings')) {
    db.prepare('ALTER TABLE deal_mappings RENAME TO store_product_mappings').run();
    console.log('Renamed deal_mappings → store_product_mappings');
  } else {
    console.log('Skip: deal_mappings→store_product_mappings (already done or source absent)');
  }

  // Phase B — Drop old indexes (IF EXISTS — safe no-ops if already gone)
  const oldIndexes = [
    'idx_deals_display_date_order',
    'idx_deals_active_display',
    'idx_deals_store_id',
    'idx_deals_name',
    'idx_deals_category',
    'idx_deals_is_active',
    'idx_deals_sale_price',
    'idx_deals_discount',
    'idx_deals_crawl_run',
    'idx_deals_canonical',
    'idx_deal_price_history_crawl_date',
    'idx_deal_price_history_store_date',
    'idx_deal_price_history_product_url',
    'idx_map_canonical',
  ];
  for (const idx of oldIndexes) {
    db.prepare(`DROP INDEX IF EXISTS ${idx}`).run();
  }
  console.log('Dropped old indexes (no-op if absent)');

  // Phase C — Recreate indexes on renamed tables (IF NOT EXISTS — idempotent)

  // store_products indexes
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_display_date_order ON store_products(display_date, display_order)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_active_display ON store_products(is_active, display_date, display_order)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_store_id ON store_products(store_id)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_name ON store_products(product_name)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_category ON store_products(product_category)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_is_active ON store_products(is_active)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_sale_price ON store_products(sale_price)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_discount ON store_products(discount_percent)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_crawl_run ON store_products(crawl_run_id)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_store_products_canonical ON store_products(canonical_id)'
  ).run();

  // price_history indexes
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_price_history_crawl_date ON price_history(crawl_date)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_price_history_store_date ON price_history(store_id, crawl_date)'
  ).run();
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_price_history_product_url ON price_history(product_url)'
  ).run();

  // store_product_mappings indexes
  db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_map_canonical ON store_product_mappings(canonical_id)'
  ).run();

  console.log('Recreated new indexes (no-op if already present)');
});

migration();

db.pragma('foreign_keys = ON');
db.close();

console.log('Migration complete.');
