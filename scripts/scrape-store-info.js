"use strict";
/**
 * scrape-store-info.js
 * Crawls each store's contact/impressum/shipping pages and extracts:
 *   - contact_email
 *   - contact_phone
 *   - address
 *   - free_shipping_min
 * Then writes results to the database.
 *
 * Run: node scripts/scrape-store-info.js
 */
require("dotenv").config();
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const db = require("../server/db");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT = 15000;

// ── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      timeout: TIMEOUT,
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (_) {
    return null;
  }
}

/** Try multiple candidate paths, return first that returns a page with content */
async function fetchPages(base, paths) {
  const results = [];
  for (const p of paths) {
    const html = await fetchText(base.replace(/\/$/, "") + p);
    if (html && html.length > 200) results.push(html);
  }
  return results;
}

// ── Extractors ─────────────────────────────────────────────────────────────

function extractEmails(texts) {
  const found = new Set();
  const re = /\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b/g;
  for (const t of texts) {
    let m;
    while ((m = re.exec(t)) !== null) {
      const e = m[1].toLowerCase();
      // Skip images / scripts / known non-contact domains
      if (/\.(png|jpg|gif|svg|webp|js|css|woff)$/i.test(e)) continue;
      if (e.includes("sentry") || e.includes("example") || e.includes("pixel"))
        continue;
      found.add(e);
    }
  }
  // Prefer info@, kontakt@, contact@, support@, hallo@, hello@
  const priority = [
    "info@",
    "kontakt@",
    "contact@",
    "support@",
    "hallo@",
    "hello@",
    "mail@",
    "service@",
  ];
  for (const p of priority) {
    const match = [...found].find((e) => e.startsWith(p));
    if (match) return match;
  }
  return [...found][0] || null;
}

function extractPhones(html) {
  // Prefer tel: hrefs
  const $ = cheerio.load(html);
  const telHrefs = [];
  $('a[href^="tel:"]').each((_, el) => {
    const raw = $(el).attr("href").replace("tel:", "").trim();
    if (raw.length >= 6) telHrefs.push(raw);
  });
  if (telHrefs.length) return telHrefs[0];

  // Regex fallback — German/international phone numbers
  const re = /(?:\+49|0049|\b0)[\s\-./]?\d[\d\s\-./]{6,16}\d/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const p = m[0].replace(/\s+/g, " ").trim();
    if (p.replace(/\D/g, "").length >= 7) return p;
  }
  return null;
}

function extractAddress(htmls) {
  // Look for itemprop="address" or schema.org markup first
  for (const html of htmls) {
    const $ = cheerio.load(html);
    const schemaAddr =
      $('[itemprop="streetAddress"]').first().text().trim() ||
      $('[itemprop="address"]').first().text().trim();
    if (schemaAddr && schemaAddr.length > 5) {
      // Also try to grab city/postal
      const city = $('[itemprop="addressLocality"]').first().text().trim();
      const postal = $('[itemprop="postalCode"]').first().text().trim();
      return [schemaAddr, postal, city].filter(Boolean).join(", ");
    }
  }

  // Regex: German street + house number + optional floor, postal code + city
  // e.g. "Musterstraße 12, 10115 Berlin"
  const streetRe =
    /([A-ZÄÖÜ][a-zäöüß\-]+(?:str(?:aße|\.)?|gasse|weg|allee|platz|ring|damm|chaussee|straße)\s+\d+[\w\-]*[,\s]+\d{5}\s+[A-ZÄÖÜ][a-zäöüß\s\-]+)/gi;
  for (const html of htmls) {
    // Strip HTML tags for text matching
    const text = cheerio.load(html).text();
    const m = text.match(streetRe);
    if (m && m[0].length > 10) return m[0].replace(/\s+/g, " ").trim();
  }
  return null;
}

function extractFreeShipping(texts) {
  // Patterns (German + English):
  // "kostenloser Versand ab 50€", "Gratis-Versand ab 39 Euro"
  // "free shipping over £50", "free delivery from €49"
  const re =
    /(?:kostenlo(?:s(?:er?)?)\s+(?:versand|lieferung)|gratis[\s-](?:versand|lieferung)|frei\s+haus|free\s+(?:shipping|delivery|postage)|versandkostenfrei)[^\d€$£]{0,40}(?:ab\s+|from\s+|over\s+|über\s+|from\s+|von\s+)?(?:€|EUR|eur\s+)?\s*(\d+[.,]?\d*)\s*(?:€|EUR|Euro)?/gi;
  for (const t of texts) {
    let m;
    while ((m = re.exec(t)) !== null) {
      const val = parseFloat(m[1].replace(",", "."));
      if (val > 0 && val < 500) return val;
    }
  }
  // Also try reverse order: "ab €50 kostenloser Versand"
  const re2 =
    /(?:ab\s+|from\s+|over\s+|über\s+)?(?:€|EUR)?\s*(\d+[.,]?\d*)\s*(?:€|EUR|Euro)?[^\n]{0,60}(?:kostenlo|gratis|free\s+ship|versandkostenfrei)/gi;
  for (const t of texts) {
    let m;
    while ((m = re2.exec(t)) !== null) {
      const val = parseFloat(m[1].replace(",", "."));
      if (val > 0 && val < 500) return val;
    }
  }
  return null;
}

// ── Pages to probe per store type ─────────────────────────────────────────

const CONTACT_PATHS = [
  "/pages/contact",
  "/pages/kontakt",
  "/pages/contact-us",
  "/contact",
  "/kontakt",
  "/contact-us",
  "/impressum",
  "/pages/impressum",
  "/ueber-uns",
  "/about",
  "/pages/about",
  "/pages/ueber-uns",
];

const SHIPPING_PATHS = [
  "/pages/shipping",
  "/pages/versand",
  "/pages/shipping-policy",
  "/policies/shipping-policy", // Shopify standard
  "/shipping",
  "/versand",
  "/pages/lieferung",
  "/lieferung",
  "/faq",
  "/pages/faq",
];

// ── Per-store overrides (manual data for hard-to-scrape stores) ────────────
// Fill these in when auto-scraping returns nothing useful.
const MANUAL_OVERRIDES = {
  // Example:
  // 'store-id': { contact_email: 'x@y.com', contact_phone: '+49 ...', address: '...', free_shipping_min: 49 },
};

// ── Main ───────────────────────────────────────────────────────────────────

const updateStore = db.prepare(`
  UPDATE stores SET
    contact_email     = COALESCE(?, contact_email),
    contact_phone     = COALESCE(?, contact_phone),
    address           = COALESCE(?, address),
    free_shipping_min = COALESCE(?, free_shipping_min)
  WHERE id = ?
`);

async function scrapeStoreInfo(store) {
  const { id, name, url } = store;
  console.log(`\n[${name}] ${url}`);

  const contactHtmls = await fetchPages(url, CONTACT_PATHS);
  const shippingHtmls = await fetchPages(url, SHIPPING_PATHS);
  const homeHtml = (await fetchText(url)) || "";

  const allHtmls = [homeHtml, ...contactHtmls, ...shippingHtmls];
  const allTexts = allHtmls.map((h) => cheerio.load(h).text());

  const email = extractEmails(allTexts);
  const phone = contactHtmls.length
    ? extractPhones(contactHtmls.join("\n") + homeHtml)
    : extractPhones(homeHtml);
  const address = extractAddress([homeHtml, ...contactHtmls]);
  const freeShip = extractFreeShipping([...allTexts, ...allHtmls]);

  const manual = MANUAL_OVERRIDES[id] || {};
  const result = {
    contact_email: manual.contact_email || email || null,
    contact_phone: manual.contact_phone || phone || null,
    address: manual.address || address || null,
    free_shipping_min: manual.free_shipping_min ?? freeShip ?? null,
  };

  console.log("  email    :", result.contact_email || "—");
  console.log("  phone    :", result.contact_phone || "—");
  console.log("  address  :", result.address || "—");
  console.log("  free ship: €" + (result.free_shipping_min ?? "—"));

  updateStore.run(
    result.contact_email,
    result.contact_phone,
    result.address,
    result.free_shipping_min,
    id,
  );

  return result;
}

(async () => {
  const stores = db
    .prepare("SELECT id, name, url FROM stores ORDER BY name")
    .all();
  console.log(`Scraping store info for ${stores.length} stores...\n`);

  for (const store of stores) {
    try {
      await scrapeStoreInfo(store);
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
    await sleep(1500 + Math.random() * 1000);
  }

  console.log("\n\n=== Final store data ===");
  const results = db
    .prepare(
      `
    SELECT id, name, contact_email, contact_phone, address, free_shipping_min
    FROM stores ORDER BY name
  `,
    )
    .all();
  for (const r of results) {
    console.log(`\n${r.name} (${r.id})`);
    console.log(`  email    : ${r.contact_email || "—"}`);
    console.log(`  phone    : ${r.contact_phone || "—"}`);
    console.log(`  address  : ${r.address || "—"}`);
    console.log(
      `  free ship: ${r.free_shipping_min != null ? "€" + r.free_shipping_min : "—"}`,
    );
  }

  process.exit(0);
})();
