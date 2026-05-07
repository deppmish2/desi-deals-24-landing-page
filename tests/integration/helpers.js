"use strict";

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

function createTestDb() {
  const db = new DatabaseSync(":memory:");
  const schemaPath = path.join(__dirname, "../../server/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  // node:sqlite does not support fts5; strip the virtual table before exec
  const stripped = schema.replace(
    /CREATE VIRTUAL TABLE[\s\S]*?USING fts5[\s\S]*?;/g,
    ""
  );
  db.exec(stripped);
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  createTestDb,
  nowIso,
};
