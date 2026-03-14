"use strict";

// Load .env first, then .env.local overrides (for Redis credentials)
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");
const { saveSnapshot } = require("../crawler/utils/snapshot");

(async () => {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    console.error(
      "Redis is not configured. Add to .env.local:\n" +
        "  UPSTASH_REDIS_REST_URL=https://...\n" +
        "  UPSTASH_REDIS_REST_TOKEN=...",
    );
    process.exit(1);
  }

  const dealCount = db
    .prepare("SELECT COUNT(*) as n FROM deals WHERE is_active = 1")
    .get().n;
  console.log(`Pushing ${dealCount} active deals to Redis...`);

  const ok = await saveSnapshot(db);
  if (ok) {
    console.log("Done.");
  } else {
    console.error("Push failed — check credentials in .env.local");
    process.exit(1);
  }
})();
