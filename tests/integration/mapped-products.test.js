"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTestDb } = require("./helpers");

const MAPPED_SQL = `
  SELECT
    cp.id AS canonical_id,
    cp.canonical_name,
    d.is_active,
    s.id AS store_id,
    s.name AS store_name,
    d.product_name,
    d.product_url
  FROM canonical_products cp
  JOIN store_product_mappings dm ON dm.canonical_id = cp.id
  JOIN store_products d ON d.id = dm.deal_id
  JOIN stores s ON s.id = d.store_id
  ORDER BY cp.canonical_name, s.name
`;

function groupMappedRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.canonical_id)) {
      grouped.set(row.canonical_id, {
        canonical_id: row.canonical_id,
        canonical_name: row.canonical_name,
        has_active_deal: false,
        storeIds: new Set(),
        deals: [],
      });
    }
    const entry = grouped.get(row.canonical_id);
    if (row.is_active) entry.has_active_deal = true;
    entry.storeIds.add(row.store_id);
    entry.deals.push({
      store_name: row.store_name,
      product_name: row.product_name,
      product_url: row.product_url,
      is_active: row.is_active,
    });
  }
  return Array.from(grouped.values()).map((entry) => ({
    canonical_id: entry.canonical_id,
    canonical_name: entry.canonical_name,
    has_active_deal: entry.has_active_deal,
    store_count: entry.storeIds.size,
    deals: entry.deals,
  }));
}

test("mapped-products: returns canonical with active deal", () => {
  const db = createTestDb();
  db.exec(`INSERT INTO stores (id, name, url) VALUES ('s1', 'Jamoona', 'https://jamoona.de')`);
  db.exec(`INSERT INTO crawl_runs (id, started_at, crawl_date) VALUES ('r1', '2026-01-01T00:00:00Z', '2026-01-01')`);
  db.exec(`INSERT INTO canonical_products (id, canonical_name, category) VALUES ('cp1', 'Aachi Biryani Kit 360g', 'Spices')`);
  db.exec(`INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url, sale_price, is_active)
           VALUES ('d1', 'r1', '2026-01-01T00:00:00Z', 's1', 'Aachi Biryani Kit', 'Spices', 'https://jamoona.de/p1', 2.99, 1)`);
  db.exec(`INSERT INTO store_product_mappings (deal_id, canonical_id, match_method) VALUES ('d1', 'cp1', 'auto')`);

  const rows = db.prepare(MAPPED_SQL).all();
  const result = groupMappedRows(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].canonical_id, "cp1");
  assert.equal(result[0].canonical_name, "Aachi Biryani Kit 360g");
  assert.equal(result[0].has_active_deal, true);
  assert.equal(result[0].store_count, 1);
  assert.equal(result[0].deals.length, 1);
  assert.equal(result[0].deals[0].store_name, "Jamoona");
  assert.equal(result[0].deals[0].product_name, "Aachi Biryani Kit");
});

test("mapped-products: has_active_deal false when all deals inactive", () => {
  const db = createTestDb();
  db.exec(`INSERT INTO stores (id, name, url) VALUES ('s1', 'Grocera', 'https://grocera.de')`);
  db.exec(`INSERT INTO crawl_runs (id, started_at, crawl_date) VALUES ('r1', '2026-01-01T00:00:00Z', '2026-01-01')`);
  db.exec(`INSERT INTO canonical_products (id, canonical_name, category) VALUES ('cp1', 'Haldirams Bhujia 400g', 'Snacks')`);
  db.exec(`INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url, sale_price, is_active)
           VALUES ('d1', 'r1', '2026-01-01T00:00:00Z', 's1', 'Haldiram Bhujia 400g', 'Snacks', 'https://grocera.de/p1', 3.49, 0)`);
  db.exec(`INSERT INTO store_product_mappings (deal_id, canonical_id, match_method) VALUES ('d1', 'cp1', 'auto')`);

  const rows = db.prepare(MAPPED_SQL).all();
  const result = groupMappedRows(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].has_active_deal, false);
  assert.equal(result[0].store_count, 1);
});

test("mapped-products: store_count counts distinct stores", () => {
  const db = createTestDb();
  db.exec(`INSERT INTO stores (id, name, url) VALUES ('s1', 'Jamoona', 'https://jamoona.de'), ('s2', 'Dookan', 'https://dookan.de')`);
  db.exec(`INSERT INTO crawl_runs (id, started_at, crawl_date) VALUES ('r1', '2026-01-01T00:00:00Z', '2026-01-01')`);
  db.exec(`INSERT INTO canonical_products (id, canonical_name, category) VALUES ('cp1', 'MTR Rava Idli Mix 500g', 'Baking')`);
  db.exec(`INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url, sale_price, is_active)
           VALUES
             ('d1', 'r1', '2026-01-01T00:00:00Z', 's1', 'MTR Rava Idli Mix', 'Baking', 'https://jamoona.de/p1', 3.99, 1),
             ('d2', 'r1', '2026-01-01T00:00:00Z', 's2', 'MTR Rava Idli 500g', 'Baking', 'https://dookan.de/p1', 4.09, 1)`);
  db.exec(`INSERT INTO store_product_mappings (deal_id, canonical_id, match_method) VALUES ('d1', 'cp1', 'auto'), ('d2', 'cp1', 'auto')`);

  const rows = db.prepare(MAPPED_SQL).all();
  const result = groupMappedRows(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].store_count, 2);
  assert.equal(result[0].deals.length, 2);
});

test("mapped-products: excludes unmapped canonicals", () => {
  const db = createTestDb();
  db.exec(`INSERT INTO canonical_products (id, canonical_name, category) VALUES ('cp1', 'Orphan Canonical', 'Other')`);

  const rows = db.prepare(MAPPED_SQL).all();
  const result = groupMappedRows(rows);

  assert.equal(result.length, 0);
});

test("mapped-products: mixed active/inactive deals → has_active_deal true", () => {
  const db = createTestDb();
  db.exec(`INSERT INTO stores (id, name, url) VALUES ('s1', 'Jamoona', 'https://jamoona.de'), ('s2', 'Dookan', 'https://dookan.de')`);
  db.exec(`INSERT INTO crawl_runs (id, started_at, crawl_date) VALUES ('r1', '2026-01-01T00:00:00Z', '2026-01-01')`);
  db.exec(`INSERT INTO canonical_products (id, canonical_name, category) VALUES ('cp1', 'Aashirvaad Atta 5kg', 'Flours')`);
  db.exec(`INSERT INTO store_products (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category, product_url, sale_price, is_active)
           VALUES
             ('d1', 'r1', '2026-01-01T00:00:00Z', 's1', 'Aashirvaad Atta 5 kg', 'Flours', 'https://jamoona.de/p1', 8.99, 0),
             ('d2', 'r1', '2026-01-01T00:00:00Z', 's2', 'Aashirvaad Whole Wheat 5kg', 'Flours', 'https://dookan.de/p1', 9.49, 1)`);
  db.exec(`INSERT INTO store_product_mappings (deal_id, canonical_id, match_method) VALUES ('d1', 'cp1', 'auto'), ('d2', 'cp1', 'auto')`);

  const rows = db.prepare(MAPPED_SQL).all();
  const result = groupMappedRows(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].has_active_deal, true);
  assert.equal(result[0].store_count, 2);
});
