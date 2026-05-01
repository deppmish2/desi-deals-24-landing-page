"use strict";
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_FILE = "data/prod_local.db";
const db = require("../../server/db");

describe("fts-rebuild", () => {
  before(async () => { await new Promise(r => setTimeout(r, 1500)); });

  it("rebuildFtsIndex populates fts_canonicals", async () => {
    const { rebuildFtsIndex } = require("../../crawler/fts-rebuild");
    await rebuildFtsIndex();
    const row = await db.prepare("SELECT COUNT(*) AS n FROM fts_canonicals").get();
    assert.ok(row.n > 0, `fts_canonicals should have rows, got ${row.n}`);
  });

  it("generateSuggestIndex returns products/brands/categories", async () => {
    const { generateSuggestIndex } = require("../../crawler/fts-rebuild");
    const idx = await generateSuggestIndex();
    assert.ok(Array.isArray(idx.products), "products array");
    assert.ok(Array.isArray(idx.brands), "brands array");
    assert.ok(Array.isArray(idx.categories), "categories array");
    assert.ok(idx.products.length > 0, "has products");
  });
});
