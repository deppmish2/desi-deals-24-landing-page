"use strict";
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const fs = require("fs");
const path = require("path");

const db = require("./db");
const dealsRouter = require("./routes/deals");
const authRouter = require("./routes/auth");
const adminRouter = require("./routes/admin");
const adminDashboardRouter = require("./routes/admin-dashboard");
const contactRouter = require("./routes/contact");
const waitlistRouter = require("./routes/waitlist");
const { productionLikeRuntime, smtpConfigured } = require("./services/email-auth");
const { startScheduler } = require("../crawler/scheduler");
const isServerless = Boolean(process.env.VERCEL);

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

if (productionLikeRuntime() && !smtpConfigured()) {
  console.warn(
    "[warn] SMTP credentials are not configured. Email link auth will be unavailable. " +
    "Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, and SMTP_PASS to enable it.",
  );
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use("/api", async (req, res, next) => {
  try {
    await db.ready;
    next();
  } catch (error) {
    next(error);
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/v1/deals", dealsRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/auth", authRouter); // compatibility for older frontend builds
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/admin-dashboard", adminDashboardRouter);
app.use("/api/v1/contact", contactRouter);
app.use("/api/v1/waitlist", waitlistRouter);

// ── Serve React Frontend (production) ────────────────────────────────────────
const CLIENT_DIST = path.join(__dirname, "../client/dist");
const INDEX_PATH = path.join(CLIENT_DIST, "index.html");

function clientBuildExists() {
  return fs.existsSync(INDEX_PATH);
}

function sendClientApp(res) {
  if (clientBuildExists()) {
    return res.sendFile(INDEX_PATH);
  }

  return res.status(200).json({
    message: "DesiDeals24 API is running.",
    hint: "Build the client with: npm run build:client",
    api: "/api/v1/deals?curated=daily_live_pool",
  });
}

app.use(express.static(CLIENT_DIST, { index: false }));
app.get("/", (req, res) => res.redirect(302, "/waitlist"));
app.get(["/waitlist", "/24deals", "/admin", "/oauth/:provider/callback"], (req, res) =>
  sendClientApp(res),
);
app.get("*", (req, res) => res.redirect(302, "/waitlist"));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nDesiDeals24 server running on http://localhost:${PORT}`);
    console.log(`API: http://localhost:${PORT}/api/v1/deals`);
    if (isServerless) {
      console.log(
        "[scheduler] Skipped local scheduler in serverless mode (Vercel cron handles crawls).",
      );
    } else {
      startScheduler(db);
    }
  });
}

module.exports = app;
