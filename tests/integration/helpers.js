"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function createTestDb() {
  const db = new DatabaseSync(":memory:");
  const schemaPath = path.join(__dirname, "../../server/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  createTestDb,
  nowIso,
};
