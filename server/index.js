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
const storesRouter = require("./routes/stores");
const categoriesRouter = require("./routes/categories");
const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const listsRouter = require("./routes/lists");
const recommendRouter = require("./routes/recommend");
const canonicalRouter = require("./routes/canonical");
const searchRouter = require("./routes/search");
const inboundRouter = require("./routes/inbound");
const adminRouter = require("./routes/admin");
const contactRouter = require("./routes/contact");
const waitlistRouter = require("./routes/waitlist");
const { productionLikeRuntime, smtpConfigured } = require("./services/email-auth");
const { startScheduler } = require("../crawler/scheduler");
const isServerless = Boolean(process.env.VERCEL);

const app = express();
const PORT = parseInt(process.env.PORT || "3000");

if (productionLikeRuntime() && !smtpConfigured()) {
  throw new Error(
    "SMTP credentials are required in production for double opt-in email auth. Configure SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, and SMTP_PASS in the deployment environment.",
  );
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

// ── API Routes ────────────────────────────────────────────────────────────────
app.use("/api/v1/deals", dealsRouter);
app.use("/api/v1/stores", storesRouter);
app.use("/api/v1/categories", categoriesRouter);
app.use("/api/v1/canonical", canonicalRouter);
app.use("/api/v1/search", searchRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/auth", authRouter); // compatibility for older frontend builds
app.use("/api/v1/me", profileRouter);
app.use("/api/v1/lists", listsRouter);
app.use("/api/v1/lists", recommendRouter);
app.use("/api/v1/inbound", inboundRouter);
app.use("/api/v1/admin", adminRouter);
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
    api: "/api/v1/deals | /api/v1/stores | /api/v1/categories",
  });
}

app.use(express.static(CLIENT_DIST, { index: false }));
app.get("/", (req, res) => res.redirect(302, "/waitlist"));
app.get(["/waitlist", "/24deals", "/oauth/:provider/callback"], (req, res) =>
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
