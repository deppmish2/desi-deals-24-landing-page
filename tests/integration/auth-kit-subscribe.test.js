"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Readable, Duplex } = require("stream");

const { createTestDb } = require("./helpers");

function createSqliteWrapper(db) {
  return {
    exec(sql) {
      return db.exec(sql);
    },
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        run(...args) {
          const result = stmt.run(...args);
          return {
            changes: result.changes,
            lastInsertRowid: result.lastInsertRowid,
          };
        },
        get(...args) {
          return stmt.get(...args);
        },
        all(...args) {
          return stmt.all(...args);
        },
      };
    },
    transaction(fn) {
      return (...args) => {
        db.exec("BEGIN");
        try {
          const out = fn(...args);
          db.exec("COMMIT");
          return out;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      };
    },
  };
}

function purgeModule(modulePath) {
  if (require.cache[modulePath]) {
    delete require.cache[modulePath];
  }
}

function buildAuthApp({ dbMock, kitService, googleOAuthService }) {
  const dbModulePath = require.resolve("../../server/db");
  const kitModulePath = require.resolve("../../server/services/kit");
  const googleOAuthModulePath = require.resolve(
    "../../server/services/google-oauth",
  );
  const authRoutePath = require.resolve("../../server/routes/auth");

  const dependentModules = [
    "../../server/routes/auth",
    "../../server/services/session-store",
    "../../server/services/user-store",
  ];

  for (const rel of dependentModules) {
    purgeModule(require.resolve(rel));
  }

  const previousDb = require.cache[dbModulePath];
  const previousKit = require.cache[kitModulePath];
  const previousGoogleOAuth = require.cache[googleOAuthModulePath];

  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: dbMock,
  };
  require.cache[kitModulePath] = {
    id: kitModulePath,
    filename: kitModulePath,
    loaded: true,
    exports: kitService,
  };
  if (googleOAuthService) {
    require.cache[googleOAuthModulePath] = {
      id: googleOAuthModulePath,
      filename: googleOAuthModulePath,
      loaded: true,
      exports: googleOAuthService,
    };
  }

  try {
    const authRouter = require(authRoutePath);
    const app = express();
    app.use(express.json());
    app.use("/api/v1/auth", authRouter);
    return app;
  } finally {
    purgeModule(authRoutePath);
    if (previousDb) {
      require.cache[dbModulePath] = previousDb;
    } else {
      delete require.cache[dbModulePath];
    }
    if (previousKit) {
      require.cache[kitModulePath] = previousKit;
    } else {
      delete require.cache[kitModulePath];
    }
    if (previousGoogleOAuth) {
      require.cache[googleOAuthModulePath] = previousGoogleOAuth;
    } else {
      delete require.cache[googleOAuthModulePath];
    }
  }
}

async function startInMemoryApi(app) {
  class MockSocket extends Duplex {
    constructor() {
      super();
      this.remoteAddress = "127.0.0.1";
      this.encrypted = false;
    }
    _read() {}
    _write(_chunk, _encoding, callback) {
      callback();
    }
    setTimeout() {}
    setNoDelay() {}
    setKeepAlive() {}
  }

  function createMockReq(pathname, method, headers, body) {
    const payload = body == null ? null : JSON.stringify(body);
    let sent = false;

    const req = new Readable({
      read() {
        if (sent) {
          this.push(null);
          return;
        }
        sent = true;
        if (payload != null) this.push(Buffer.from(payload));
        this.push(null);
      },
    });

    req.url = pathname;
    req.method = method;
    req.headers = headers;
    req.httpVersion = "1.1";
    const socket = new MockSocket();
    req.connection = socket;
    req.socket = socket;
    return req;
  }

  function createMockRes(req) {
    const chunks = [];
    const res = new Readable({ read() {} });
    res.statusCode = 200;
    res.headers = {};
    res.locals = {};
    res.req = req;

    res.setHeader = (name, value) => {
      res.headers[String(name).toLowerCase()] = value;
    };
    res.getHeader = (name) => res.headers[String(name).toLowerCase()];
    res.getHeaders = () => ({ ...res.headers });
    res.removeHeader = (name) => {
      delete res.headers[String(name).toLowerCase()];
    };
    res.write = (chunk) => {
      if (chunk != null) {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
      }
      return true;
    };
    res.end = (chunk) => {
      if (chunk != null) res.write(chunk);
      res.body = Buffer.concat(chunks).toString("utf8");
      res.finished = true;
      res.emit("finish");
    };

    return res;
  }

  async function request(pathname, { method = "GET", headers = {}, body } = {}) {
    const reqHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) {
      reqHeaders[String(key).toLowerCase()] = value;
    }
    if (body != null && !reqHeaders["content-type"]) {
      reqHeaders["content-type"] = "application/json";
    }
    if (body != null && !reqHeaders["content-length"]) {
      reqHeaders["content-length"] = String(
        Buffer.byteLength(JSON.stringify(body)),
      );
    }

    const req = createMockReq(pathname, method, reqHeaders, body);
    const res = createMockRes(req);

    await new Promise((resolve, reject) => {
      res.on("finish", resolve);
      app.handle(req, res, reject);
    });

    let json = null;
    if (res.body) {
      json = JSON.parse(res.body);
    }

    return {
      status: res.statusCode,
      json,
      headers: res.getHeaders(),
    };
  }

  return { request };
}

test("Kit subscription happens after email-link confirmation, not at signup start", async () => {
  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.EMAIL_AUTH_RATE_LIMIT_SECONDS = "0";

  const rawDb = createTestDb();
  const db = createSqliteWrapper(rawDb);
  const subscribeCalls = [];

  const app = buildAuthApp({
    dbMock: db,
    kitService: {
      subscribeToNewsletter(email, firstName) {
        subscribeCalls.push({ email, firstName });
        return Promise.resolve({ ok: true });
      },
    },
  });
  const api = await startInMemoryApi(app);

  const start = await api.request("/api/v1/auth/email-link/start", {
    method: "POST",
    headers: {
      origin: "http://localhost:5173",
    },
    body: { email: "kit.user@example.com" },
  });

  assert.equal(start.status, 202);
  assert.equal(subscribeCalls.length, 0);
  assert.ok(start.json.preview_url);

  const previewUrl = new URL(start.json.preview_url);
  const token = previewUrl.searchParams.get("email_auth_token");

  assert.ok(token);

  const complete = await api.request("/api/v1/auth/email-link/complete", {
    method: "POST",
    body: { token },
  });

  assert.equal(complete.status, 200);
  assert.equal(subscribeCalls.length, 1);
  assert.deepEqual(subscribeCalls[0], {
    email: "kit.user@example.com",
    firstName: "Kit",
  });
});

test("Google callback stays pending confirmation by default when SMTP is missing", async () => {
  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  delete process.env.GOOGLE_AUTH_DEV_AUTO_VERIFY;

  const rawDb = createTestDb();
  const db = createSqliteWrapper(rawDb);
  const subscribeCalls = [];

  const app = buildAuthApp({
    dbMock: db,
    kitService: {
      subscribeToNewsletter(email, firstName) {
        subscribeCalls.push({ email, firstName });
        return Promise.resolve({ ok: true });
      },
    },
    googleOAuthService: {
      buildAuthUrl() {
        return "https://accounts.google.com/o/oauth2/auth";
      },
      verifyIdToken() {
        throw new Error("not used");
      },
      async exchangeCodeForProfile() {
        return {
          google_id: "google-user-1",
          email: "google.pending@example.com",
          name: "Google Pending",
        };
      },
      isConfigured() {
        return true;
      },
      localDevMockEnabled() {
        return false;
      },
    },
  });
  const api = await startInMemoryApi(app);

  const response = await api.request("/api/v1/auth/google/callback?code=test", {
    method: "GET",
    headers: {
      origin: "http://localhost:5173",
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.pending_email_confirmation, true);
  assert.ok(response.json.masked_email);
  assert.equal(response.json.accessToken, undefined);
  assert.equal(subscribeCalls.length, 0);
});

test("Google callback auto-verifies only when the explicit dev override is enabled", async () => {
  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.GOOGLE_AUTH_DEV_AUTO_VERIFY = "true";

  const rawDb = createTestDb();
  const db = createSqliteWrapper(rawDb);
  const subscribeCalls = [];

  try {
    const app = buildAuthApp({
      dbMock: db,
      kitService: {
        subscribeToNewsletter(email, firstName) {
          subscribeCalls.push({ email, firstName });
          return Promise.resolve({ ok: true });
        },
      },
      googleOAuthService: {
        buildAuthUrl() {
          return "https://accounts.google.com/o/oauth2/auth";
        },
        verifyIdToken() {
          throw new Error("not used");
        },
        async exchangeCodeForProfile() {
          return {
            google_id: "google-user-2",
            email: "google.override@example.com",
            name: "Google Override",
          };
        },
        isConfigured() {
          return true;
        },
        localDevMockEnabled() {
          return false;
        },
      },
    });
    const api = await startInMemoryApi(app);

    const response = await api.request(
      "/api/v1/auth/google/callback?code=test",
      {
        method: "GET",
      },
    );

    assert.equal(response.status, 200);
    assert.ok(response.json.accessToken);
    assert.equal(response.json.user.email, "google.override@example.com");
    assert.equal(subscribeCalls.length, 1);
    assert.deepEqual(subscribeCalls[0], {
      email: "google.override@example.com",
      firstName: "Google",
    });
  } finally {
    delete process.env.GOOGLE_AUTH_DEV_AUTO_VERIFY;
  }
});

test("Google signup subscribes to Kit after email confirmation completes", async () => {
  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = "test-access-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.ADMIN_SECRET = "test-admin-secret";
  process.env.EMAIL_AUTH_RATE_LIMIT_SECONDS = "0";
  delete process.env.GOOGLE_AUTH_DEV_AUTO_VERIFY;

  const rawDb = createTestDb();
  const db = createSqliteWrapper(rawDb);
  const subscribeCalls = [];

  const app = buildAuthApp({
    dbMock: db,
    kitService: {
      subscribeToNewsletter(email, firstName) {
        subscribeCalls.push({ email, firstName });
        return Promise.resolve({ ok: true });
      },
    },
    googleOAuthService: {
      buildAuthUrl() {
        return "https://accounts.google.com/o/oauth2/auth";
      },
      verifyIdToken() {
        throw new Error("not used");
      },
      async exchangeCodeForProfile() {
        return {
          google_id: "google-user-confirm-1",
          email: "google.confirm@example.com",
          name: "Google Confirm",
        };
      },
      isConfigured() {
        return true;
      },
      localDevMockEnabled() {
        return false;
      },
    },
  });
  const api = await startInMemoryApi(app);

  const googleStart = await api.request("/api/v1/auth/google/callback?code=test", {
    method: "GET",
    headers: {
      origin: "http://localhost:5173",
    },
  });

  assert.equal(googleStart.status, 200);
  assert.equal(googleStart.json.pending_email_confirmation, true);
  assert.equal(subscribeCalls.length, 0);

  const tokenRow = rawDb
    .prepare(
      "SELECT token_hash, expires_at, consumed_at FROM email_auth_tokens WHERE email = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get("google.confirm@example.com");

  assert.ok(tokenRow);
  assert.equal(tokenRow.consumed_at, null);

  const previewStart = await api.request("/api/v1/auth/email-link/start", {
    method: "POST",
    headers: {
      origin: "http://localhost:5173",
    },
    body: { email: "google.confirm@example.com" },
  });

  assert.equal(previewStart.status, 202);
  const previewUrl = new URL(previewStart.json.preview_url);
  const token = previewUrl.searchParams.get("email_auth_token");

  assert.ok(token);

  const complete = await api.request("/api/v1/auth/email-link/complete", {
    method: "POST",
    body: { token },
  });

  assert.equal(complete.status, 200);
  assert.equal(subscribeCalls.length, 1);
  assert.deepEqual(subscribeCalls[0], {
    email: "google.confirm@example.com",
    firstName: "Google",
  });
});
