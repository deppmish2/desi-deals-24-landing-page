"use strict";

const fs = require("fs");
const path = require("path");
const { resolveName } = require("../crawler/entity-resolution");

function percent(value) {
  return Math.round(value * 10000) / 100;
}

async function main() {
  delete process.env.ANTHROPIC_API_KEY;

  const fixturePath = path.join(
    __dirname,
    "../crawler/entity-resolution/fixtures/top200.fixture.json",
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  if (!Array.isArray(fixture) || fixture.length === 0) {
    throw new Error("Fixture is empty");
  }

  const canonicalNames = Array.from(
    new Set(
      fixture
        .map((row) => String(row.expected_normalized || "").trim())
        .filter(Boolean),
    ),
  );
  const methods = {};
  let matched = 0;

  for (const row of fixture) {
    const rawName = String(row.raw_name || "").trim();
    const expected = String(row.expected_normalized || "").trim();
    const resolution = await resolveName(rawName, canonicalNames);

    methods[resolution.method] = (methods[resolution.method] || 0) + 1;
    if (resolution.match === expected) matched += 1;
  }

  const accuracy = matched / fixture.length;
  const minAccuracy = Number(process.env.ER_MIN_ACCURACY || 0.9);
  const payload = {
    generated_at: new Date().toISOString(),
    fixture_rows: fixture.length,
    canonical_names: canonicalNames.length,
    accuracy,
    accuracy_pct: percent(accuracy),
    min_required: minAccuracy,
    min_required_pct: percent(minAccuracy),
    pass: accuracy >= minAccuracy,
    methods,
  };

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (accuracy < minAccuracy) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
