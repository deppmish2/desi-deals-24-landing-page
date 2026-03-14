"use strict";

const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveName } = require("../../crawler/entity-resolution");

test("entity resolution reaches >=90% accuracy on top200 fixture", async () => {
  delete process.env.ANTHROPIC_API_KEY;

  const fixturePath = path.join(
    __dirname,
    "../../crawler/entity-resolution/fixtures/top200.fixture.json",
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.ok(Array.isArray(fixture), "fixture must be an array");
  assert.equal(fixture.length, 200, "fixture must contain 200 rows");

  const canonicalNames = Array.from(
    new Set(
      fixture
        .map((row) => String(row.expected_normalized || "").trim())
        .filter(Boolean),
    ),
  );
  assert.ok(canonicalNames.length > 0, "canonical set must not be empty");

  let matched = 0;
  for (const row of fixture) {
    const rawName = String(row.raw_name || "").trim();
    const expected = String(row.expected_normalized || "").trim();
    const result = await resolveName(rawName, canonicalNames);
    if (result.match === expected) matched += 1;
  }

  const accuracy = matched / fixture.length;
  assert.ok(
    accuracy >= 0.9,
    `expected >=90% accuracy, got ${(accuracy * 100).toFixed(2)}% (${matched}/${fixture.length})`,
  );
});
