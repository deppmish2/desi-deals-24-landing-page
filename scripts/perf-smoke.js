"use strict";

const { performance } = require("perf_hooks");
const {
  createTestDb,
  buildAppWithDb,
  startServer,
  isoNow,
} = require("../tests/e2e/helpers");
const { canonicalizeDeals } = require("../server/services/canonicalizer");

function percentile(values, pct) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function summary(values) {
  const n = values.length;
  const total = values.reduce((acc, item) => acc + item, 0);
  return {
    samples: n,
    avg_ms: n ? total / n : null,
    p50_ms: percentile(values, 50),
    p95_ms: percentile(values, 95),
    min_ms: n ? Math.min(...values) : null,
    max_ms: n ? Math.max(...values) : null,
  };
}

async function timed(name, iterations, fn) {
  const durations = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = performance.now();
    await fn(i);
    const t1 = performance.now();
    durations.push(t1 - t0);
  }
  return [name, summary(durations)];
}

async function main() {
  process.env.JWT_SECRET = "perf-access-secret";
  process.env.JWT_REFRESH_SECRET = "perf-refresh-secret";
  process.env.ADMIN_SECRET = "perf-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();
  db.prepare(
    "INSERT INTO stores (id, name, url, platform, crawl_status) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "perf-shop-1",
    "Perf Shop 1",
    "https://perf-shop-1.example",
    "shopify",
    "active",
  );
  db.prepare(
    "INSERT INTO stores (id, name, url, platform, crawl_status) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "perf-shop-2",
    "Perf Shop 2",
    "https://perf-shop-2.example",
    "custom",
    "active",
  );

  const insertDeal = db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, original_price, discount_percent, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  );

  insertDeal.run(
    "perf-deal-1",
    "perf-run",
    isoNow(),
    "perf-shop-1",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://perf-shop-1.example/p/toor-dal?variant=111",
    2.39,
    2.99,
    20.1,
  );
  insertDeal.run(
    "perf-deal-2",
    "perf-run",
    isoNow(),
    "perf-shop-2",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://perf-shop-2.example/p/toor-dal",
    2.59,
    2.99,
    13.4,
  );

  await canonicalizeDeals(db, { runId: "perf-run" });

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "perf@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });

    if (register.status !== 201 || !register.json?.accessToken) {
      throw new Error("Unable to bootstrap perf user");
    }

    const auth = { Authorization: `Bearer ${register.json.accessToken}` };
    const list = await api.request("/api/v1/lists", {
      method: "POST",
      headers: auth,
      body: {
        name: "Perf List",
        raw_input: "toor dal",
        input_method: "text",
      },
    });
    if (list.status !== 201 || !list.json?.data?.id) {
      throw new Error("Unable to bootstrap perf list");
    }

    const recommendPath = `/api/v1/lists/${list.json.data.id}/recommend`;

    const runs = await Promise.all([
      timed("browse_deals", 80, async () => {
        const res = await api.request(
          "/api/v1/deals?limit=24&sort=discount_desc",
        );
        if (res.status !== 200) throw new Error(`browse status ${res.status}`);
      }),
      timed("search_autocomplete", 80, async () => {
        const res = await api.request("/api/v1/search/autocomplete?q=to");
        if (res.status !== 200) throw new Error(`search status ${res.status}`);
      }),
      timed("recommendation", 40, async () => {
        const res = await api.request(recommendPath, {
          method: "POST",
          headers: auth,
          body: { delivery_preference: "cheapest" },
        });
        if (res.status !== 200)
          throw new Error(`recommend status ${res.status}`);
      }),
    ]);

    const report = {
      generated_at: new Date().toISOString(),
      environment: {
        node: process.version,
        mode: "in-process express + node:sqlite test harness",
      },
      metrics: Object.fromEntries(runs),
      targets: {
        browse_search_under_ms: 200,
        recommendation_under_ms: 5000,
      },
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await api.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
