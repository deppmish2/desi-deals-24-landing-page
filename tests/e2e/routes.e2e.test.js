"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const { canonicalizeDeals } = require("../../server/services/canonicalizer");
const {
  createTestDb,
  buildAppWithDb,
  startServer,
  isoNow,
} = require("./helpers");

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

test("auth + profile route e2e", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "alice@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    assert.equal(register.status, 201);
    assert.ok(register.json.accessToken);
    assert.ok(register.json.refreshToken);

    const me = await api.request("/api/v1/me", {
      headers: authHeader(register.json.accessToken),
    });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.email, "alice@example.com");

    const emailStatusKnown = await api.request("/api/v1/auth/email-status", {
      method: "POST",
      body: { email: "alice@example.com" },
    });
    assert.equal(emailStatusKnown.status, 200);
    assert.equal(emailStatusKnown.json.exists, true);
    assert.equal(emailStatusKnown.json.hasPassword, true);

    const emailStatusUnknown = await api.request("/api/v1/auth/email-status", {
      method: "POST",
      body: { email: "new.user@example.com" },
    });
    assert.equal(emailStatusUnknown.status, 200);
    assert.equal(emailStatusUnknown.json.exists, false);

    const meUpdate = await api.request("/api/v1/me", {
      method: "PUT",
      headers: authHeader(register.json.accessToken),
      body: {
        city: "Munich",
        delivery_speed_pref: "fastest",
      },
    });
    assert.equal(meUpdate.status, 200);
    assert.equal(meUpdate.json.data.city, "Munich");
    assert.equal(meUpdate.json.data.delivery_speed_pref, "fastest");

    const refreshed = await api.request("/api/v1/auth/refresh", {
      method: "POST",
      body: { refreshToken: register.json.refreshToken },
    });
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.json.accessToken);

    const logout = await api.request("/api/v1/auth/logout", {
      method: "POST",
      body: { refreshToken: refreshed.json.refreshToken },
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.json.ok, true);
  } finally {
    await api.close();
  }
});

test("google oauth routes e2e (mock profile mode)", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.GOOGLE_OAUTH_MOCK_PROFILE_JSON = JSON.stringify({
    sub: "google-user-123",
    email: "google.user@example.com",
    email_verified: true,
    name: "Google User",
  });
  process.env.GOOGLE_CLIENT_ID = "google-client-id-test";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret-test";
  process.env.GOOGLE_CALLBACK_URL =
    "http://localhost:3000/api/v1/auth/google/callback";

  const { db } = createTestDb();
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const authUrl = await api.request("/api/v1/auth/google/url?state=abc123");
    assert.equal(authUrl.status, 200);
    assert.ok(
      String(authUrl.json.authUrl || "").includes("accounts.google.com"),
    );
    assert.ok(String(authUrl.json.authUrl || "").includes("state=abc123"));

    const loginViaIdToken = await api.request("/api/v1/auth/google", {
      method: "POST",
      body: {
        id_token: "mock-id-token",
        postcode: "80331",
      },
    });
    assert.equal(loginViaIdToken.status, 200);
    assert.ok(loginViaIdToken.json.accessToken);
    assert.equal(loginViaIdToken.json.user.email, "google.user@example.com");
    assert.equal(loginViaIdToken.json.user.postcode, "80331");

    const me = await api.request("/api/v1/me", {
      headers: authHeader(loginViaIdToken.json.accessToken),
    });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.email, "google.user@example.com");

    const loginViaCallback = await api.request(
      "/api/v1/auth/google/callback?code=mock-code",
    );
    assert.equal(loginViaCallback.status, 200);
    assert.ok(loginViaCallback.json.accessToken);
    assert.equal(loginViaCallback.json.user.email, "google.user@example.com");
  } finally {
    delete process.env.GOOGLE_OAUTH_MOCK_PROFILE_JSON;
    await api.close();
  }
});

test("facebook oauth routes e2e (mock profile mode)", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.FACEBOOK_OAUTH_MOCK_PROFILE_JSON = JSON.stringify({
    id: "facebook-user-123",
    email: "facebook.user@example.com",
    name: "Facebook User",
  });
  process.env.FACEBOOK_CLIENT_ID = "facebook-client-id-test";
  process.env.FACEBOOK_CLIENT_SECRET = "facebook-client-secret-test";
  process.env.FACEBOOK_CALLBACK_URL =
    "http://localhost:3000/oauth/facebook/callback";

  const { db } = createTestDb();
  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const authUrl = await api.request("/api/v1/auth/facebook/url?state=abc123");
    assert.equal(authUrl.status, 200);
    assert.ok(String(authUrl.json.authUrl || "").includes("facebook.com"));
    assert.ok(String(authUrl.json.authUrl || "").includes("state=abc123"));

    const loginViaCode = await api.request("/api/v1/auth/facebook", {
      method: "POST",
      body: {
        code: "mock-code",
        postcode: "80331",
      },
    });
    assert.equal(loginViaCode.status, 200);
    assert.ok(loginViaCode.json.accessToken);
    assert.equal(loginViaCode.json.user.email, "facebook.user@example.com");
    assert.equal(loginViaCode.json.user.postcode, "80331");

    const me = await api.request("/api/v1/me", {
      headers: authHeader(loginViaCode.json.accessToken),
    });
    assert.equal(me.status, 200);
    assert.equal(me.json.data.email, "facebook.user@example.com");

    const emailStatus = await api.request("/api/v1/auth/email-status", {
      method: "POST",
      body: { email: "facebook.user@example.com" },
    });
    assert.equal(emailStatus.status, 200);
    assert.equal(emailStatus.json.exists, true);
    assert.equal(emailStatus.json.hasPassword, false);
    assert.equal(emailStatus.json.providers.facebook, true);
  } finally {
    delete process.env.FACEBOOK_OAUTH_MOCK_PROFILE_JSON;
    await api.close();
  }
});

test("lists + recommendation + canonical/search route e2e", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform, crawl_status) VALUES (?, ?, ?, ?, ?)",
  ).run("shop1", "Shop 1", "https://shop1.example", "shopify", "active");
  db.prepare(
    "INSERT INTO stores (id, name, url, platform, crawl_status) VALUES (?, ?, ?, ?, ?)",
  ).run("shop2", "Shop 2", "https://shop2.example", "custom", "active");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    isoNow(),
    "shop1",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://shop1.example/products/toor?variant=1111",
    2.1,
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d2",
    "run-1",
    isoNow(),
    "shop2",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://shop2.example/p/toor-dal",
    2.7,
  );

  await canonicalizeDeals(db, { runId: "run-1" });

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "bob@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    const accessToken = register.json.accessToken;

    const createList = await api.request("/api/v1/lists", {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        name: "Weekly",
        raw_input: "toor dal",
        input_method: "text",
      },
    });
    assert.equal(createList.status, 201);
    assert.ok(createList.json.data.id);
    assert.ok(createList.json.items.length >= 1);

    const listId = createList.json.data.id;

    const recommend = await api.request(`/api/v1/lists/${listId}/recommend`, {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        delivery_preference: "cheapest",
      },
    });
    assert.equal(recommend.status, 200);
    assert.equal(recommend.json.winner.store.id, "shop1");

    const canonicalList = await api.request("/api/v1/canonical");
    assert.equal(canonicalList.status, 200);
    assert.ok(canonicalList.json.data.length >= 1);

    const canonicalId = canonicalList.json.data[0].id;
    const canonicalDetail = await api.request(
      `/api/v1/canonical/${canonicalId}`,
    );
    assert.equal(canonicalDetail.status, 200);
    assert.ok(Array.isArray(canonicalDetail.json.data.variants));

    const autocomplete = await api.request("/api/v1/search/autocomplete?q=to");
    assert.equal(autocomplete.status, 200);
    assert.ok(Array.isArray(autocomplete.json.suggestions));
  } finally {
    await api.close();
  }
});

test("recommendation works after local user row is missing (serverless cold-start style)", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, platform, crawl_status) VALUES (?, ?, ?, ?, ?)",
  ).run("shop1", "Shop 1", "https://shop1.example", "shopify", "active");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "d1",
    "run-1",
    isoNow(),
    "shop1",
    "Toor Dal 1kg",
    "Lentils & Pulses",
    "https://shop1.example/products/toor?variant=1111",
    2.1,
  );

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "coldstart@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    assert.equal(register.status, 201);
    const accessToken = register.json.accessToken;
    const userId = register.json.user.id;

    const listId = crypto.randomUUID();

    // Simulate a fresh serverless instance where users table row is missing.
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    const recommend = await api.request(`/api/v1/lists/${listId}/recommend`, {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        delivery_preference: "cheapest",
        postcode: "80331",
        name: "Cold Start",
        raw_input: "toor dal",
        input_method: "text",
        items: [
          {
            raw_item_text: "toor dal",
            quantity: 1,
            quantity_unit: "kg",
          },
        ],
      },
    });

    assert.equal(recommend.status, 200);
    assert.equal(recommend.json.winner.store.id, "shop1");
  } finally {
    await api.close();
  }
});

test("alerts + inbound webhook + admin activity route e2e", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.SMTP_HOST;
  delete process.env.ANTHROPIC_API_KEY;

  const { db, raw } = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, webhook_secret, crawl_status) VALUES (?, ?, ?, ?, ?)",
  ).run(
    "grocera",
    "Grocera",
    "https://grocera.example",
    "webhook-secret-123",
    "active",
  );

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "deal1",
    "run-a",
    isoNow(),
    "grocera",
    "Fresh Methi",
    "Fresh Produce",
    "https://grocera.example/p/fresh-methi",
    1.99,
  );

  await canonicalizeDeals(db, { runId: "run-a" });

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "carol@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    const accessToken = register.json.accessToken;

    const createAlertRes = await api.request("/api/v1/me/alerts", {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        alert_type: "fresh_arrived",
        product_query: "fresh methi",
      },
    });
    assert.equal(createAlertRes.status, 201);

    const payload = {
      store_id: "grocera",
      items: [
        {
          product_name: "Fresh Methi",
          quantity_kg: 5.0,
          available_from: isoNow(),
        },
      ],
    };

    const signature = crypto
      .createHmac("sha256", "webhook-secret-123")
      .update(JSON.stringify(payload))
      .digest("hex");

    const inbound = await api.request("/api/v1/inbound/fresh-stock", {
      method: "POST",
      headers: { "X-Webhook-Signature": signature },
      body: payload,
    });
    assert.equal(inbound.status, 200);

    await new Promise((r) => setTimeout(r, 30));

    const notif = raw
      .prepare("SELECT COUNT(*) AS cnt FROM alert_notifications")
      .get();
    assert.ok(notif.cnt >= 1);

    const activity = await api.request("/api/v1/admin/alerts/activity", {
      headers: { Authorization: "Bearer test-admin-secret" },
    });
    assert.equal(activity.status, 200);
    assert.ok(Array.isArray(activity.json.notifications_7d));
  } finally {
    await api.close();
  }
});

test("public deals/stores/categories/contact route e2e", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.SMTP_HOST;

  const { db } = createTestDb();

  db.prepare(
    "INSERT INTO stores (id, name, url, crawl_status) VALUES (?, ?, ?, ?)",
  ).run("shop-main", "Main Shop", "https://main-shop.example", "active");

  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, original_price, discount_percent, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "deal-main",
    "run-main",
    isoNow(),
    "shop-main",
    "Jeera Whole 200g",
    "Spices",
    "https://main-shop.example/p/jeera",
    1.99,
    2.49,
    20,
  );

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const deals = await api.request("/api/v1/deals?limit=10");
    assert.equal(deals.status, 200);
    assert.ok(Array.isArray(deals.json.data));
    assert.equal(deals.json.data.length, 1);
    assert.equal(deals.json.data[0].id, "deal-main");

    const suggest = await api.request("/api/v1/deals/suggest?q=jee");
    assert.equal(suggest.status, 200);
    assert.ok(suggest.json.suggestions.some((name) => name.includes("Jeera")));

    const dealDetail = await api.request("/api/v1/deals/deal-main");
    assert.equal(dealDetail.status, 200);
    assert.equal(dealDetail.json.id, "deal-main");
    assert.equal(dealDetail.json.store.id, "shop-main");

    const stores = await api.request("/api/v1/stores");
    assert.equal(stores.status, 200);
    assert.ok(stores.json.data.some((s) => s.id === "shop-main"));

    const store = await api.request("/api/v1/stores/shop-main");
    assert.equal(store.status, 200);
    assert.equal(store.json.id, "shop-main");

    const categories = await api.request("/api/v1/categories");
    assert.equal(categories.status, 200);
    assert.ok(categories.json.data.some((c) => c.category === "Spices"));

    const contactBad = await api.request("/api/v1/contact", {
      method: "POST",
      body: { name: "A", email: "x@example.com", subject: "", message: "" },
    });
    assert.equal(contactBad.status, 400);

    const contactOk = await api.request("/api/v1/contact", {
      method: "POST",
      body: {
        name: "Alice",
        email: "alice@example.com",
        subject: "Hello",
        message: "Need help",
      },
    });
    assert.equal(contactOk.status, 200);
    assert.equal(contactOk.json.ok, true);
  } finally {
    await api.close();
  }
});

test("admin delivery options and analytics KPI route e2e", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();
  db.prepare(
    "INSERT INTO stores (id, name, url, crawl_status) VALUES (?, ?, ?, ?)",
  ).run("kpi-shop", "KPI Shop", "https://kpi-shop.example", "active");
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1)`,
  ).run(
    "kpi-deal-1",
    "kpi-run-1",
    isoNow(),
    "kpi-shop",
    "Besan Flour 1kg",
    "Flours",
    "https://kpi-shop.example/p/besan-1kg",
    3.25,
  );

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "dora@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    assert.equal(register.status, 201);
    const accessToken = register.json.accessToken;

    const createdList = await api.request("/api/v1/lists", {
      method: "POST",
      headers: authHeader(accessToken),
      body: {
        name: "KPI List",
        raw_input: "besan flour",
        input_method: "text",
      },
    });
    assert.equal(createdList.status, 201);

    const recommend = await api.request(
      `/api/v1/lists/${createdList.json.data.id}/recommend`,
      {
        method: "POST",
        headers: authHeader(accessToken),
        body: { delivery_preference: "cheapest" },
      },
    );
    assert.equal(recommend.status, 200);

    const createDeliveryOption = await api.request(
      "/api/v1/admin/delivery-options",
      {
        method: "POST",
        headers: { Authorization: "Bearer test-admin-secret" },
        body: {
          store_id: "kpi-shop",
          delivery_type: "same_day",
          label: "Same Day Delivery",
          surcharge: 4.99,
          estimated_hours: 6,
          available_days: ["Mon", "Tue", "Wed"],
        },
      },
    );
    assert.equal(createDeliveryOption.status, 201);
    const optionId = createDeliveryOption.json.data.id;

    // Simulate stale data for staleness highlight coverage.
    db.prepare("UPDATE delivery_options SET updated_at = ? WHERE id = ?").run(
      new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString(),
      optionId,
    );

    const deliveryList = await api.request("/api/v1/admin/delivery-options", {
      headers: { Authorization: "Bearer test-admin-secret" },
    });
    assert.equal(deliveryList.status, 200);
    assert.ok(deliveryList.json.meta.stale_count >= 1);
    assert.ok(
      deliveryList.json.data.some(
        (item) => item.id === optionId && item.stale === true,
      ),
    );

    const updateDeliveryOption = await api.request(
      `/api/v1/admin/delivery-options/${optionId}`,
      {
        method: "PUT",
        headers: { Authorization: "Bearer test-admin-secret" },
        body: {
          label: "Same Day Prime",
          estimated_hours: 4,
        },
      },
    );
    assert.equal(updateDeliveryOption.status, 200);
    assert.equal(updateDeliveryOption.json.data.label, "Same Day Prime");

    const deactivateDeliveryOption = await api.request(
      `/api/v1/admin/delivery-options/${optionId}`,
      {
        method: "DELETE",
        headers: { Authorization: "Bearer test-admin-secret" },
      },
    );
    assert.equal(deactivateDeliveryOption.status, 200);
    assert.equal(deactivateDeliveryOption.json.ok, true);

    const deliveryInactive = await api.request(
      "/api/v1/admin/delivery-options?include_inactive=1",
      {
        headers: { Authorization: "Bearer test-admin-secret" },
      },
    );
    assert.equal(deliveryInactive.status, 200);
    assert.ok(
      deliveryInactive.json.data.some(
        (item) => item.id === optionId && item.is_active === false,
      ),
    );

    const kpis = await api.request("/api/v1/admin/analytics/kpis?days=30", {
      headers: { Authorization: "Bearer test-admin-secret" },
    });
    assert.equal(kpis.status, 200);
    assert.ok(kpis.json.totals.events > 0);
    assert.ok(kpis.json.funnel.signups >= 1);
    assert.ok(kpis.json.funnel.lists_created >= 1);
    assert.ok(kpis.json.funnel.recommendations >= 1);
    assert.ok(Array.isArray(kpis.json.top_events));

    const readiness = await api.request(
      "/api/v1/admin/release/readiness?freshness_hours=72",
      {
        headers: { Authorization: "Bearer test-admin-secret" },
      },
    );
    assert.equal(readiness.status, 200);
    assert.equal(readiness.json.freshness_hours, 72);
    assert.ok(Array.isArray(readiness.json.checks));
    assert.ok(Object.prototype.hasOwnProperty.call(readiness.json, "pass"));
  } finally {
    await api.close();
  }
});

test("updating a sized list item clears a stale size-mismatched canonical link", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();
  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run("schani-2kg-toor-dal", "Schani - 2kg Toor Dal", "Lentils & Pulses");

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "stale-canonical@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    assert.equal(register.status, 201);

    const userId = register.json.user.id;
    const listId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO shopping_lists (id, user_id, name, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(listId, userId, "Weekly", isoNow(), isoNow());

    const created = db
      .prepare(
        `INSERT INTO list_items
          (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, resolved, unresolvable)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        listId,
        "schani-2kg-toor-dal",
        "Schani Toor Dal",
        null,
        null,
        1,
        1,
        0,
      );

    const update = await api.request(
      `/api/v1/lists/${listId}/items/${created.lastInsertRowid}`,
      {
        method: "PUT",
        headers: authHeader(register.json.accessToken),
        body: {
          quantity: 1,
          quantity_unit: "kg",
        },
      },
    );

    assert.equal(update.status, 200);
    assert.equal(update.json.data.quantity, 1);
    assert.equal(update.json.data.quantity_unit, "kg");
    assert.equal(update.json.data.canonical_id, null);
    assert.equal(update.json.data.resolved, false);
    assert.equal(update.json.data.unresolvable, true);
  } finally {
    await api.close();
  }
});

test("creating a list with structured deal items preserves size and avoids the wrong 2kg recommendation", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();
  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run("schani-2kg-toor-dal", "Schani - 2kg Toor Dal", "Lentils & Pulses");
  db.prepare(
    "INSERT INTO stores (id, name, url, crawl_status) VALUES (?, ?, ?, ?)",
  ).run("zora", "Zora", "https://zora.example", "active");
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "schani-2kg",
    "run-1",
    isoNow(),
    "zora",
    "schani-2kg-toor-dal",
    "Schani - 2kg Toor Dal",
    "Lentils & Pulses",
    "https://zora.example/p/schani-2kg",
    6.49,
    2,
    "kg",
  );
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "schani-500",
    "run-1",
    isoNow(),
    "zora",
    null,
    "Schani Toor Dal 500g",
    "Lentils & Pulses",
    "https://zora.example/p/schani-500",
    1.99,
    500,
    "g",
  );

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "deal-flow@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    assert.equal(register.status, 201);

    const createdList = await api.request("/api/v1/lists", {
      method: "POST",
      headers: authHeader(register.json.accessToken),
      body: {
        name: "Deal Flow",
        raw_input: "Schani Toor Dal",
        input_method: "text",
        items: [
          {
            raw_item_text: "Schani Toor Dal",
            quantity: 1,
            quantity_unit: "kg",
            item_count: 1,
          },
        ],
      },
    });

    assert.equal(createdList.status, 201);
    assert.equal(createdList.json.items.length, 1);
    assert.equal(createdList.json.items[0].raw_item_text, "Schani Toor Dal");
    assert.equal(createdList.json.items[0].quantity, 1);
    assert.equal(createdList.json.items[0].quantity_unit, "kg");
    assert.equal(createdList.json.items[0].canonical_id, null);

    const recommend = await api.request(
      `/api/v1/lists/${createdList.json.data.id}/recommend`,
      {
        method: "POST",
        headers: authHeader(register.json.accessToken),
        body: { delivery_preference: "cheapest" },
      },
    );

    assert.equal(recommend.status, 200);
    assert.equal(recommend.json.winner?.store?.id, "zora");
    const matched = recommend.json.winner?.matched_items?.[0];
    assert.ok(matched);
    assert.equal(matched.effective_price, 3.98);
    assert.equal(matched.packs_needed, 2);
    assert.ok(Array.isArray(matched.combination));
    assert.equal(matched.combination[0].product_name, "Schani Toor Dal 500g");
    assert.equal(matched.combination[0].count, 2);
  } finally {
    await api.close();
  }
});

test("recommendation prefers structured fallback size over stale pcs list rows", async () => {
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.ANTHROPIC_API_KEY;

  const { db } = createTestDb();
  db.prepare(
    "INSERT INTO canonical_products (id, canonical_name, category) VALUES (?, ?, ?)",
  ).run("schani-2kg-toor-dal", "Schani - 2kg Toor Dal", "Lentils & Pulses");
  db.prepare(
    "INSERT INTO stores (id, name, url, crawl_status) VALUES (?, ?, ?, ?)",
  ).run("zora", "Zora", "https://zora.example", "active");
  db.prepare(
    "INSERT INTO stores (id, name, url, crawl_status) VALUES (?, ?, ?, ?)",
  ).run("jamoona", "Jamoona", "https://jamoona.example", "active");
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "zora-schani-500",
    "run-1",
    isoNow(),
    "zora",
    null,
    "Schani Toor Dal 500g",
    "Lentils & Pulses",
    "https://zora.example/p/schani-500",
    1.99,
    500,
    "g",
  );
  db.prepare(
    `INSERT INTO deals
      (id, crawl_run_id, crawl_timestamp, store_id, canonical_id, product_name, product_category,
       product_url, sale_price, currency, availability, is_active, weight_value, weight_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'EUR', 'in_stock', 1, ?, ?)`,
  ).run(
    "jamoona-schani-2kg",
    "run-1",
    isoNow(),
    "jamoona",
    "schani-2kg-toor-dal",
    "Schani - 2kg Toor Dal",
    "Lentils & Pulses",
    "https://jamoona.example/p/schani-2kg",
    6.49,
    2,
    "kg",
  );

  const app = buildAppWithDb(db);
  const api = await startServer(app);

  try {
    const register = await api.request("/api/v1/auth/register", {
      method: "POST",
      body: {
        email: "fallback-size@example.com",
        password: "secret1234",
        postcode: "80331",
      },
    });
    assert.equal(register.status, 201);

    const listId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO shopping_lists
        (id, user_id, name, raw_input, input_method, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      listId,
      register.json.user.id,
      "Fallback Size",
      "Schani Toor Dal",
      "text",
      isoNow(),
      isoNow(),
    );
    db.prepare(
      `INSERT INTO list_items
        (list_id, canonical_id, raw_item_text, quantity, quantity_unit, item_count, resolved, unresolvable)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      listId,
      "schani-2kg-toor-dal",
      "Schani Toor Dal",
      1,
      "pcs",
      1,
      1,
      0,
    );

    const recommend = await api.request(`/api/v1/lists/${listId}/recommend`, {
      method: "POST",
      headers: authHeader(register.json.accessToken),
      body: {
        delivery_preference: "cheapest",
        items: [
          {
            raw_item_text: "Schani Toor Dal",
            quantity: 1,
            quantity_unit: "kg",
            item_count: 1,
          },
        ],
      },
    });

    assert.equal(recommend.status, 200);
    assert.equal(recommend.json.winner?.store?.id, "zora");
    const matched = recommend.json.winner?.matched_items?.[0];
    assert.ok(matched);
    assert.equal(matched.effective_price, 3.98);
    assert.equal(matched.packs_needed, 2);
    assert.equal(matched.combination[0].product_name, "Schani Toor Dal 500g");
    assert.equal(matched.combination[0].count, 2);
    assert.ok(
      !recommend.json.stores.some(
        (store) =>
          store?.store?.id === "jamoona" && Number(store?.items_matched || 0) > 0,
      ),
    );

    const savedItem = db
      .prepare(
        "SELECT canonical_id, quantity, quantity_unit, resolved, unresolvable FROM list_items WHERE list_id = ? LIMIT 1",
      )
      .get(listId);
    assert.equal(savedItem.quantity, 1);
    assert.equal(savedItem.quantity_unit, "kg");
    assert.equal(savedItem.canonical_id, null);
    assert.equal(savedItem.resolved, 0);
    assert.equal(savedItem.unresolvable, 1);
  } finally {
    await api.close();
  }
});
