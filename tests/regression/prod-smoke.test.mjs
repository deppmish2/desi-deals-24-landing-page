import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function getDbFilePath() {
  const envLocalPath = path.join(__dirname, "../../.env.local");
  if (!fs.existsSync(envLocalPath)) return null;
  const envContent = fs.readFileSync(envLocalPath, "utf8");
  // Try dotenv package first, fall back to regex
  try {
    const { parse } = require("dotenv");
    const env = parse(envContent);
    return env.DB_FILE || null;
  } catch {
    const match = envContent.match(/^DB_FILE\s*=\s*(.+)$/m);
    return match ? match[1].trim() : null;
  }
}

const dbFilePath = getDbFilePath();
const dbAvailable = !!(dbFilePath && fs.existsSync(path.join(__dirname, "../../", dbFilePath)));

const Database = dbAvailable ? require("better-sqlite3") : null;
const db = dbAvailable
  ? new Database(path.join(__dirname, "../../", dbFilePath), { readonly: true })
  : null;

const dbTest = dbAvailable ? test : test.skip;

// Tests 1 & 2: pure function smoke checks — run unconditionally (no DB needed)

test("prod DB: resolveBaseProduct correctly separates paneer masala from paneer", () => {
  const { resolveBaseProduct } = require("../../server/services/base-product-catalog.js");

  const masala = resolveBaseProduct("MDH Karahi Paneer Masala");
  assert.ok(masala !== null, "row 1007 may be missing from CSV");
  assert.equal(masala.base_key, "paneer masala", "paneer masala collision not fixed in CSV");

  const paneer = resolveBaseProduct("Amul Paneer 500g");
  assert.ok(paneer !== null);
  assert.notEqual(paneer.base_key, "paneer masala", "paneer must not resolve to paneer masala");
});

test("prod DB: parseItemIntent correctly classifies paneer masala as masala", () => {
  const { parseItemIntent } = require("../../server/services/item-matcher.js");
  const r = parseItemIntent("MDH Karahi Paneer Masala", null, null);
  assert.equal(r.itemType, "masala", "ITEM_TYPE_KEYWORDS ordering may have changed");
});

// Tests 3 & 4: require live DB — skip gracefully if unavailable

dbTest("prod DB: canonical_products has Dairy & Paneer entries", () => {
  const row = db
    .prepare("SELECT COUNT(*) AS cnt FROM canonical_products WHERE category = 'Dairy & Paneer'")
    .get();
  assert.ok(row.cnt > 0, "no Dairy & Paneer canonicals found in prod DB");
});

dbTest(
  "prod DB: no Spices & Masalas canonical linked to store_products containing 'paneer' in name for Dairy & Paneer items",
  () => {
    const contaminated = db
      .prepare(
        `SELECT sp.product_name, cp.category, cp.canonical_name
       FROM store_products sp
       JOIN canonical_products cp ON cp.id = sp.canonical_id
       WHERE sp.is_active = 1
         AND LOWER(sp.product_name) LIKE '%paneer%'
         AND LOWER(sp.product_name) NOT LIKE '%masala%'
         AND LOWER(sp.product_name) NOT LIKE '%tikka%'
         AND LOWER(sp.product_name) NOT LIKE '%curry%'
         AND LOWER(sp.product_name) NOT LIKE '%sauce%'
         AND LOWER(sp.product_name) NOT LIKE '%chilli%'
         AND LOWER(sp.product_name) NOT LIKE '%chili%'
         AND LOWER(sp.product_name) NOT LIKE '%mix%'
         AND cp.category = 'Spices & Masalas'
       LIMIT 5`
      )
      .all();
    assert.equal(
      contaminated.length,
      0,
      `Found ${contaminated.length} paneer products linked to Spices & Masalas: ${JSON.stringify(contaminated.map((r) => r.product_name))}`
    );
  }
);

dbTest(
  "prod DB: 0 active ready-to-eat products mapped to wrong canonical category",
  () => {
    const contaminated = db
      .prepare(
        `SELECT sp.product_name, cp.category, cp.canonical_name
         FROM store_products sp
         JOIN canonical_products cp ON cp.id = sp.canonical_id
         WHERE sp.is_active = 1
           AND cp.category != 'Ready Meals & Mixes'
           AND (
             LOWER(sp.product_name) LIKE '%ready to eat%'
             OR LOWER(sp.product_name) LIKE '%ready-to-eat%'
             OR LOWER(sp.product_name) LIKE '%ready meal%'
             OR (
               (LOWER(sp.product_name) LIKE '% quick %' OR LOWER(sp.product_name) LIKE 'quick %')
               AND (
                 LOWER(sp.product_name) LIKE '%poha%'
                 OR LOWER(sp.product_name) LIKE '%upma%'
                 OR LOWER(sp.product_name) LIKE '%khichdi%'
                 OR LOWER(sp.product_name) LIKE '%biryani%'
                 OR LOWER(sp.product_name) LIKE '%pulao%'
                 OR LOWER(sp.product_name) LIKE '%dosa%'
                 OR LOWER(sp.product_name) LIKE '%idli%'
                 OR LOWER(sp.product_name) LIKE '%rava%'
                 OR LOWER(sp.product_name) LIKE '%semolina%'
               )
             )
             OR (
               LOWER(sp.product_name) LIKE '% instant %'
               AND (
                 LOWER(sp.product_name) LIKE '%poha%'
                 OR LOWER(sp.product_name) LIKE '%upma%'
                 OR LOWER(sp.product_name) LIKE '%khichdi%'
                 OR LOWER(sp.product_name) LIKE '%biryani%'
                 OR LOWER(sp.product_name) LIKE '%pulao%'
                 OR LOWER(sp.product_name) LIKE '%dosa%'
                 OR LOWER(sp.product_name) LIKE '%idli%'
                 OR LOWER(sp.product_name) LIKE '%rava%'
                 OR LOWER(sp.product_name) LIKE '%semolina%'
               )
             )
           )
         LIMIT 5`
      )
      .all();
    assert.equal(
      contaminated.length,
      0,
      `Found ${contaminated.length} RTE products in wrong canonical category: ${JSON.stringify(contaminated.map((r) => r.product_name))}`
    );
  }
);
