"use strict";
const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/prod_local.db");
const db = new Database(DB_PATH);

const { changes } = db
  .prepare(`UPDATE canonical_products SET base_key = NULL WHERE category = 'Fresh Produce' AND base_key IS NOT NULL`)
  .run();

console.log(`Cleared base_key on ${changes} Fresh Produce canonicals`);
db.close();
