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
const adminStatsRouter = require("./routes/admin-stats");
const adminReviewQueueRouter = require("./routes/admin-review-queue");
const contactRouter = require("./routes/contact");
const waitlistRouter = require("./routes/waitlist");
const healthRouter = require("./routes/health");
const bookmarksRouter = require("./routes/bookmarks");
const {
  productionLikeRuntime,
  smtpConfigured,
} = require("./services/email-auth");
const { getDisplayMemberCount } = require("./services/member-count");
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
app.use("/api/v1/admin-dashboard", adminStatsRouter);
app.use("/api/v1/admin-dashboard", adminReviewQueueRouter);
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
const DISPLAYABLE_SHARE_DISCOUNT_SQL = `
  (
    coalesce(d.discount_percent, 0) > 0
    OR (
      d.original_price IS NOT NULL
      AND d.sale_price IS NOT NULL
      AND d.original_price > d.sale_price
      AND d.original_price > 0
    )
  )
`;

function clientBuildExists() {
  return fs.existsSync(INDEX_PATH);
}

function escapeHtml(value) {
  return String(value || "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
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
  next = replaceMetaContent(
    next,
    "property",
    "og:description",
    meta.description,
  );
  next = replaceMetaContent(next, "property", "og:url", meta.url);
  next = replaceMetaContent(next, "property", "og:image", meta.image);
  next = replaceMetaContent(
    next,
    "property",
    "og:image:alt",
    meta.imageAlt || meta.title,
  );
  next = replaceMetaContent(
    next,
    "property",
    "og:type",
    meta.type || "website",
  );
  next = replaceMetaContent(next, "name", "twitter:title", meta.title);
  next = replaceMetaContent(
    next,
    "name",
    "twitter:description",
    meta.description,
  );
  next = replaceMetaContent(next, "name", "twitter:image", meta.image);
  next = replaceMetaContent(
    next,
    "name",
    "twitter:image:alt",
    meta.imageAlt || meta.title,
  );
  return next;
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.CLIENT_APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;

  const forwardedProto = String(req.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const forwardedHost = String(req.get("x-forwarded-host") || "")
    .split(",")[0]
    .trim();
  const host = forwardedHost || String(req.get("host") || "").trim();
  const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const protocol = forwardedProto || (localHost ? req.protocol : "https");

  return `${protocol}://${host}`.replace(/\/+$/, "");
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
         d.product_url,
         s.url AS store_url,
         s.name AS store_name
       FROM store_products d
       JOIN stores s ON s.id = d.store_id
       WHERE d.id = ?
         AND ${DISPLAYABLE_SHARE_DISCOUNT_SQL}
       LIMIT 1`,
    )
    .get(safeId);
}

function resolveDealProductUrl(deal) {
  const raw = String(deal?.product_url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const storeBase = String(deal?.store_url || "").replace(/\/+$/, "");
  return storeBase
    ? `${storeBase}${raw.startsWith("/") ? "" : "/"}${raw}`
    : raw;
}

function resolveAbsoluteUrl(rawUrl, baseUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, String(baseUrl || "").trim() || undefined).toString();
  } catch {
    return "";
  }
}

function buildDealOgImageUrl(baseUrl, deal) {
  const fallbackUrl = `${baseUrl}/og-card.png`;
  const upstreamImageUrl = resolveAbsoluteUrl(deal?.image_url, deal?.store_url);
  if (!upstreamImageUrl || !/^https?:\/\//i.test(upstreamImageUrl)) {
    return fallbackUrl;
  }
  return upstreamImageUrl;
}

async function buildDealMeta(req, dealId, options = {}) {
  const deal = options.deal || (await getShareableDeal(dealId));
  if (!deal) return null;
  const baseUrl = getPublicBaseUrl(req);
  const sharePath = String(
    options.sharePath || `/deal/${encodeURIComponent(String(deal.id))}`,
  );
  const shareUrl = `${baseUrl}${sharePath.startsWith("/") ? "" : "/"}${sharePath}`;
  const imageUrl = buildDealOgImageUrl(baseUrl, deal);
  const salePrice = formatMoney(deal.sale_price, deal.currency) || "Live now";
  const originalPrice = formatMoney(deal.original_price, deal.currency);
  const discount = Number(deal.discount_percent || 0);
  const title = `${deal.product_name} — ${salePrice} at ${deal.store_name} | DesiDeals24`;
  const descriptionParts = [];

  if (discount > 0) {
    descriptionParts.push(
      `Save ${Math.round(discount)}% on ${deal.product_name}.`,
    );
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

function sendDealShareRedirect(res, meta, redirectUrl) {
  const safeRedirectUrl = String(redirectUrl || "").trim();
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:url" content="${escapeHtml(meta.url)}" />
    <meta property="og:image" content="${escapeHtml(meta.image)}" />
    <meta property="og:image:alt" content="${escapeHtml(meta.imageAlt || meta.title)}" />
    <meta property="og:type" content="${escapeHtml(meta.type || "website")}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <meta name="twitter:image" content="${escapeHtml(meta.image)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(meta.imageAlt || meta.title)}" />
    ${safeRedirectUrl ? `<meta http-equiv="refresh" content="0; url=${escapeHtml(safeRedirectUrl)}" />` : ""}
    ${safeRedirectUrl ? `<script>window.location.replace(${JSON.stringify(safeRedirectUrl)});</script>` : ""}
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #0f1711;
        color: #f8fafc;
        font-family: Inter, system-ui, sans-serif;
      }
      .card {
        width: min(560px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 24px;
        background: linear-gradient(135deg, #102016, #173f27);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }
      .hero {
        width: 100%;
        margin-bottom: 18px;
        border-radius: 18px;
        display: block;
      }
      .eyebrow {
        color: #86efac;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 28px;
        line-height: 1.1;
      }
      p {
        margin: 0 0 10px;
        color: #dbe7df;
        line-height: 1.5;
      }
      a {
        color: #22c55e;
        font-weight: 700;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <img class="hero" src="${escapeHtml(meta.image)}" alt="${escapeHtml(meta.imageAlt || meta.title)}" />
      <div class="brand">
        <div>
          <div class="eyebrow">DesiDeals24</div>
          <strong>Opening on DesiDeals24</strong>
        </div>
      </div>
      <h1>${escapeHtml(meta.title)}</h1>
      <p>${escapeHtml(meta.description)}</p>
      ${
        safeRedirectUrl
          ? `<p>If you are not redirected automatically, <a href="${escapeHtml(safeRedirectUrl)}">open this deal on DesiDeals24</a>.</p>`
          : `<p><a href="${escapeHtml(meta.url)}">Open this deal on DesiDeals24</a>.</p>`
      }
    </div>
  </body>
</html>`;

  return res.status(200).type("html").send(html);
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

// Hashed assets get a 1-year immutable cache — no revalidation round-trips
app.use(
  "/assets",
  express.static(path.join(CLIENT_DIST, "assets"), {
    maxAge: "1y",
    immutable: true,
    index: false,
  }),
);
app.use(express.static(CLIENT_DIST, { index: false }));
app.get("/share/deal/:dealId", async (req, res, next) => {
  try {
    const deal = await getShareableDeal(req.params.dealId);
    if (!deal) {
      return sendClientApp(res);
    }
    const meta = await buildDealMeta(req, req.params.dealId, {
      deal,
      sharePath: `/share/deal/${encodeURIComponent(String(deal.id))}`,
    });
    return sendClientApp(res, { meta });
  } catch (error) {
    return next(error);
  }
});
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
app.get(["/saved", "/admin", "/oauth/:provider/callback"], (req, res) =>
  sendClientApp(res),
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

    // Pre-warm SQLite page cache so the first real request is fast
    db.ready
      .then(() =>
        db.prepare("SELECT COUNT(*) FROM store_products WHERE is_active = 1").get(),
      )
      .catch(() => {});

    if (isServerless) {
      console.log(
        "[scheduler] Skipped local scheduler in serverless mode (GitHub Actions handles the 08:00 Europe/Berlin crawl).",
      );
    } else {
      const { startScheduler } = require("../crawler/scheduler");
      startScheduler(db);
    }
  });
}

module.exports = app;
