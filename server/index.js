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
const healthRouter = require("./routes/health");
const bookmarksRouter = require("./routes/bookmarks");
const {
  productionLikeRuntime,
  smtpConfigured,
} = require("./services/email-auth");
const { getDisplayMemberCount } = require("./services/member-count");
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
app.use("/api/v1/health", healthRouter);
app.use("/api/v1/bookmarks", bookmarksRouter);

app.get("/api/v1/member-count", async (_req, res) => {
  try {
    const count = await getDisplayMemberCount();
    res.json({ count });
  } catch {
    res.json({ count: 4347 });
  }
});

// ── Serve React Frontend (production) ────────────────────────────────────────
const CLIENT_DIST = path.join(__dirname, "../client/dist");
const INDEX_PATH = path.join(CLIENT_DIST, "index.html");

function clientBuildExists() {
  return fs.existsSync(INDEX_PATH);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceMetaContent(html, attribute, name, content) {
  const replacement = `<meta ${attribute}="${name}" content="${escapeHtml(content)}" />`;
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${escapeRegex(name)}"\\s+content="[^"]*"\\s*/?>`,
    "i",
  );
  return pattern.test(html)
    ? html.replace(pattern, replacement)
    : html.replace("</head>", `  ${replacement}\n  </head>`);
}

function injectClientMeta(html, meta) {
  let next = html;
  next = next.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(meta.title)}</title>`,
  );
  next = replaceMetaContent(next, "name", "description", meta.description);
  next = replaceMetaContent(next, "property", "og:title", meta.title);
  next = replaceMetaContent(next, "property", "og:description", meta.description);
  next = replaceMetaContent(next, "property", "og:url", meta.url);
  next = replaceMetaContent(next, "property", "og:image", meta.image);
  next = replaceMetaContent(next, "property", "og:image:alt", meta.imageAlt || meta.title);
  next = replaceMetaContent(next, "property", "og:type", meta.type || "website");
  next = replaceMetaContent(next, "name", "twitter:title", meta.title);
  next = replaceMetaContent(next, "name", "twitter:description", meta.description);
  next = replaceMetaContent(next, "name", "twitter:image", meta.image);
  next = replaceMetaContent(next, "name", "twitter:image:alt", meta.imageAlt || meta.title);
  return next;
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.CLIENT_APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function formatMoney(value, currency) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  try {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: String(currency || "EUR").toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `€${amount.toFixed(2)}`;
  }
}

async function getShareableDeal(dealId) {
  const safeId = String(dealId || "").trim();
  if (!safeId) return null;

  await db.ready;
  return db
    .prepare(
      `SELECT
         d.id,
         d.product_name,
         d.sale_price,
         d.original_price,
         d.discount_percent,
         d.currency,
         d.image_url,
         s.name AS store_name
       FROM deals d
       JOIN stores s ON s.id = d.store_id
       WHERE d.id = ?
       LIMIT 1`,
    )
    .get(safeId);
}

async function buildDealMeta(req, dealId) {
  const deal = await getShareableDeal(dealId);
  if (!deal) return null;

  const baseUrl = getPublicBaseUrl(req);
  const shareUrl = `${baseUrl}/deal/${encodeURIComponent(String(deal.id))}`;
  const imageUrl = `${baseUrl}/landing/DesiDeals24-Basic-Hero.jpg`;
  const salePrice = formatMoney(deal.sale_price, deal.currency) || "Live now";
  const originalPrice = formatMoney(deal.original_price, deal.currency);
  const discount = Number(deal.discount_percent || 0);
  const title = `${deal.product_name} — ${salePrice} at ${deal.store_name} | DesiDeals24`;
  const descriptionParts = [];

  if (discount > 0) {
    descriptionParts.push(`Save ${Math.round(discount)}% on ${deal.product_name}.`);
  } else {
    descriptionParts.push(`${deal.product_name} is live on DesiDeals24.`);
  }

  descriptionParts.push(`Current price ${salePrice} at ${deal.store_name}.`);
  if (originalPrice) {
    descriptionParts.push(`Was ${originalPrice}.`);
  }
  descriptionParts.push("Open the live deal on DesiDeals24.");

  return {
    title,
    description: descriptionParts.join(" "),
    url: shareUrl,
    image: imageUrl,
    imageAlt: `DesiDeals24 preview for ${deal.product_name}`,
    type: "product",
  };
}

function sendClientApp(res, options = {}) {
  if (clientBuildExists()) {
    if (options.meta) {
      const html = fs.readFileSync(INDEX_PATH, "utf8");
      return res
        .status(200)
        .type("html")
        .send(injectClientMeta(html, options.meta));
    }
    return res.sendFile(INDEX_PATH);
  }

  return res.status(200).json({
    message: "DesiDeals24 API is running.",
    hint: "Build the client with: npm run build:client",
    api: "/api/v1/deals?curated=daily_live_pool",
  });
}

app.use(express.static(CLIENT_DIST, { index: false }));
app.get("/deal/:dealId", async (req, res, next) => {
  try {
    const meta = await buildDealMeta(req, req.params.dealId).catch((error) => {
      console.warn("[share-meta] deal route fallback:", error.message);
      return null;
    });
    return sendClientApp(res, { meta });
  } catch (error) {
    return next(error);
  }
});
app.get("/", async (req, res, next) => {
  try {
    const meta = req.query.deal
      ? await buildDealMeta(req, req.query.deal).catch((error) => {
          console.warn("[share-meta] root route fallback:", error.message);
          return null;
        })
      : null;
    return sendClientApp(res, { meta });
  } catch (error) {
    return next(error);
  }
});
app.get(
  ["/saved", "/admin", "/oauth/:provider/callback"],
  (req, res) => sendClientApp(res),
);
app.get("*", (req, res) => sendClientApp(res));

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
