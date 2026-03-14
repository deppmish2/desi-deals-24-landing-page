"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { Readable, Duplex } = require("stream");
const { DatabaseSync } = require("node:sqlite");

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

function createTestDb() {
  const raw = new DatabaseSync(":memory:");
  const schema = fs.readFileSync(
    path.join(__dirname, "../../server/db/schema.sql"),
    "utf8",
  );
  raw.exec(schema);
  return { raw, db: createSqliteWrapper(raw) };
}

function purgeModule(modulePath) {
  if (require.cache[modulePath]) {
    delete require.cache[modulePath];
  }
}

function buildAppWithDb(dbMock) {
  const dbModulePath = require.resolve("../../server/db");

  const routeModules = [
    "../../server/routes/deals",
    "../../server/routes/stores",
    "../../server/routes/categories",
    "../../server/routes/contact",
    "../../server/routes/auth",
    "../../server/routes/profile",
    "../../server/routes/lists",
    "../../server/routes/recommend",
    "../../server/routes/canonical",
    "../../server/routes/search",
    "../../server/routes/inbound",
    "../../server/routes/admin",
  ];

  const serviceModules = [
    "../../server/services/session-store",
    "../../server/services/canonicalizer",
    "../../server/services/recommender",
    "../../server/services/alert-evaluator",
    "../../server/services/alert-notifier",
    "../../server/services/list-parser",
  ];

  for (const rel of [...routeModules, ...serviceModules]) {
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
    const dealsRouter = require("../../server/routes/deals");
    const storesRouter = require("../../server/routes/stores");
    const categoriesRouter = require("../../server/routes/categories");
    const contactRouter = require("../../server/routes/contact");
    const authRouter = require("../../server/routes/auth");
    const profileRouter = require("../../server/routes/profile");
    const listsRouter = require("../../server/routes/lists");
    const recommendRouter = require("../../server/routes/recommend");
    const canonicalRouter = require("../../server/routes/canonical");
    const searchRouter = require("../../server/routes/search");
    const inboundRouter = require("../../server/routes/inbound");
    const adminRouter = require("../../server/routes/admin");

    const app = express();
    app.use(express.json());
    app.use("/api/v1/deals", dealsRouter);
    app.use("/api/v1/stores", storesRouter);
    app.use("/api/v1/categories", categoriesRouter);
    app.use("/api/v1/contact", contactRouter);
    app.use("/api/v1/auth", authRouter);
    app.use("/api/v1/me", profileRouter);
    app.use("/api/v1/lists", listsRouter);
    app.use("/api/v1/lists", recommendRouter);
    app.use("/api/v1/canonical", canonicalRouter);
    app.use("/api/v1/search", searchRouter);
    app.use("/api/v1/inbound", inboundRouter);
    app.use("/api/v1/admin", adminRouter);
    return app;
  } finally {
    if (previousDb) {
      require.cache[dbModulePath] = previousDb;
    } else {
      delete require.cache[dbModulePath];
    }
  }
}

async function startServer(app) {
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

  async function dispatchRequest(
    pathname,
    { method = "GET", headers = {}, body } = {},
  ) {
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
    const text = String(res.body || "");
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    return {
      status: res.statusCode,
      json,
      headers: res.getHeaders(),
    };
  }

  async function request(
    pathname,
    { method = "GET", headers = {}, body } = {},
  ) {
    return dispatchRequest(pathname, { method, headers, body });
  }

  return {
    baseUrl: "in-memory-express",
    request,
    close: async () => {},
  };
}

function isoNow() {
  return new Date().toISOString();
}

module.exports = {
  createTestDb,
  buildAppWithDb,
  startServer,
  isoNow,
};
