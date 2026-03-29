"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, Duplex } = require("stream");

const { createTestDb, nowIso } = require("./helpers");

function createSqliteWrapper(db) {
  return {
    ready: Promise.resolve(),
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

function buildServerApp(dbMock) {
  const dbModulePath = require.resolve("../../server/db");
  const serverIndexPath = require.resolve("../../server/index");
  const dependentModules = [
    "../../server/index",
    "../../server/routes/deals",
    "../../server/routes/auth",
    "../../server/routes/admin",
    "../../server/routes/admin-dashboard",
    "../../server/routes/contact",
    "../../server/routes/waitlist",
    "../../server/routes/health",
    "../../server/routes/bookmarks",
    "../../server/services/member-count",
  ];

  for (const rel of dependentModules) {
    purgeModule(require.resolve(rel));
  }

  const previousDb = require.cache[dbModulePath];
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: dbMock,
  };

  try {
    return require(serverIndexPath);
  } finally {
    purgeModule(serverIndexPath);
    if (previousDb) {
      require.cache[dbModulePath] = previousDb;
    } else {
      delete require.cache[dbModulePath];
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

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.type = (value) => {
      res.setHeader("content-type", value);
      return res;
    };
    res.json = (value) => {
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(value));
      return res;
    };
    res.send = (value) => {
      res.end(value);
      return res;
    };
    res.sendFile = (filePath) => {
      const fs = require("fs");
      res.end(fs.readFileSync(filePath));
      return res;
    };
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

    return res;
  }

  return request;
}

function seedShareableDeal(db, { id, imageUrl }) {
  db.prepare("INSERT INTO stores (id, name, url) VALUES (?, ?, ?)")
    .run("store-1", "Test Store", "https://shop.example.com");

  db.prepare(
    `INSERT INTO deals (
      id, crawl_run_id, crawl_timestamp, store_id, product_name,
      product_category, product_url, image_url, sale_price,
      original_price, discount_percent, currency, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    id,
    "run-1",
    nowIso(),
    "store-1",
    "Fresh Atta",
    "Flours & Baking",
    "/products/fresh-atta",
    imageUrl || null,
    3.99,
    5.49,
    27,
    "EUR",
  );
}

function withPublicAppUrl(fn) {
  const previousClientAppUrl = process.env.CLIENT_APP_URL;
  const previousAppUrl = process.env.APP_URL;
  const previousFrontendUrl = process.env.FRONTEND_URL;

  process.env.CLIENT_APP_URL = "https://desideals24.com";
  process.env.APP_URL = "https://desideals24.com";
  process.env.FRONTEND_URL = "https://desideals24.com";

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previousClientAppUrl == null) delete process.env.CLIENT_APP_URL;
      else process.env.CLIENT_APP_URL = previousClientAppUrl;

      if (previousAppUrl == null) delete process.env.APP_URL;
      else process.env.APP_URL = previousAppUrl;

      if (previousFrontendUrl == null) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = previousFrontendUrl;
    });
}

test("share route uses an absolute product image URL for OG metadata when a deal image exists", async () => {
  const db = createTestDb();
  seedShareableDeal(db, {
    id: "deal-with-image",
    imageUrl: "/images/fresh-atta.jpg",
  });

  const app = buildServerApp(createSqliteWrapper(db));
  const request = await startInMemoryApi(app);

  await withPublicAppUrl(async () => {
    const res = await request("/share/deal/deal-with-image", {
      headers: {
        host: "desideals24.com",
        "x-forwarded-proto": "https",
      },
    });

    assert.equal(res.statusCode, 200);
    assert.match(
      res.body,
      /<meta property="og:image" content="https:\/\/shop\.example\.com\/images\/fresh-atta\.jpg" \/>/,
    );
    assert.match(
      res.body,
      /<img class="hero" src="https:\/\/shop\.example\.com\/images\/fresh-atta\.jpg"/,
    );
  });
});

test("share route falls back to the site OG card when a deal image is missing", async () => {
  const db = createTestDb();
  seedShareableDeal(db, {
    id: "deal-without-image",
    imageUrl: null,
  });

  const app = buildServerApp(createSqliteWrapper(db));
  const request = await startInMemoryApi(app);

  await withPublicAppUrl(async () => {
    const res = await request("/share/deal/deal-without-image", {
      headers: {
        host: "desideals24.com",
        "x-forwarded-proto": "https",
      },
    });

    assert.equal(res.statusCode, 200);
    assert.match(
      res.body,
      /<meta property="og:image" content="https:\/\/desideals24\.com\/og-card\.png" \/>/,
    );
    assert.match(
      res.body,
      /<img class="hero" src="https:\/\/desideals24\.com\/og-card\.png"/,
    );
  });
});
