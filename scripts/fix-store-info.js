"use strict";
/**
 * fix-store-info.js
 * Applies cleaned / manually-verified store info to the DB.
 * Run: node scripts/fix-store-info.js
 */
require("dotenv").config();
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const db = require("../server/db");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

async function get(url) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      timeout: 12000,
    });
    if (!r.ok) return "";
    return await r.text();
  } catch (_) {
    return "";
  }
}

function tel(html) {
  const $ = cheerio.load(html);
  const found = [];
  $('a[href^="tel:"]').each((_, el) => {
    const raw = decodeURIComponent(
      $(el).attr("href").replace("tel:", ""),
    ).trim();
    if (raw.replace(/\D/g, "").length >= 7) found.push(raw);
  });
  return found[0] || null;
}
function email(html) {
  const $ = cheerio.load(html);
  const found = [];
  $('a[href^="mailto:"]').each((_, el) => {
    const raw = $(el)
      .attr("href")
      .replace("mailto:", "")
      .split("?")[0]
      .toLowerCase()
      .trim();
    if (raw.includes("@") && raw.length < 80) found.push(raw);
  });
  const prio = [
    "info@",
    "kontakt@",
    "contact@",
    "support@",
    "hallo@",
    "hello@",
    "mail@",
    "service@",
  ];
  for (const p of prio) {
    const m = found.find((e) => e.startsWith(p));
    if (m) return m;
  }
  return found[0] || null;
}
function freeShip(texts) {
  const re =
    /(?:kostenlo\S*\s+(?:versand|lieferung)|gratis[\s-](?:versand|lieferung)|free\s+ship(?:ping)?)[^€\n]{0,80}(?:€|EUR)?\s*(\d+[.,]\d+|\d+)/i;
  for (const t of texts) {
    const m = t.match(re);
    if (m) {
      const v = parseFloat(m[1].replace(",", "."));
      if (v > 0 && v < 500) return v;
    }
  }
  const re2 =
    /(?:€|EUR)\s*(\d+[.,]\d+|\d+)[^€\n]{0,60}(?:kostenlo|gratis|free\s+ship)/i;
  for (const t of texts) {
    const m = t.match(re2);
    if (m) {
      const v = parseFloat(m[1].replace(",", "."));
      if (v > 0 && v < 500) return v;
    }
  }
  return null;
}

// ── Verified data from first scrape pass (clean values only) ───────────────
// phone/email/address/freeShip: null = leave existing value; undefined = don't touch
const KNOWN = {
  annachi: {
    email: "contact@annachi.fr",
    phone: "01 84 600 700", // decoded from URL-encoded tel: href
    free_shipping_min: 20,
  },
  "anuhita-groceries": {
    email: "info@anuhita.com",
    phone: null, // garbled — will re-probe
    free_shipping_min: 35.99,
  },
  desigros: {
    phone: null, // garbled
    free_shipping_min: 19.99,
  },
  dookan: {
    email: "support@dookan.com",
    phone: null, // garbled
    free_shipping_min: 28,
  },
  grocera: {
    phone: "+49 176 4173 4257",
    free_shipping_min: 24.99,
  },
  "india-express-food": {
    email: "info@india-express-food.de",
    phone: "+49 176 63625297",
    address: "Billstraße 104, 20539 Hamburg",
  },
  "india-store": {
    email: "info@india-store.de",
    phone: "+49 30 25462826",
    address: "Potsdamer Str. 100, 10785 Berlin",
    free_shipping_min: 69,
  },
  indianfoodstore: {
    email: "info@indianfoodstore.de",
    phone: "+31 6 39318783", // Netherlands number
    free_shipping_min: 49,
  },
  indiansupermarkt: {
    email: "contact@indiansupermarkt.de", // strip "call" HTML artifact
    phone: "+49 176 37200204",
  },
  "indische-lebensmittel-online": {
    email: "info@indische-lebensmittel-online.de",
    phone: null, // garbled
    address: "Kurfürstenstr. 33, 10785 Berlin",
    free_shipping_min: 49,
  },
  jamoona: {
    email: "info@jamoona.com", // strip "email" HTML artifact
    phone: null, // garbled "0 0 100 100"
    free_shipping_min: 39,
  },
  "little-india": {
    free_shipping_min: 39.99,
  },
  namastedeutschland: {
    email: "info@namastedeutschland.de",
    phone: "+49 159 06198880",
    address: "Porschestraße 102, 38440 Wolfsburg",
    free_shipping_min: 49,
  },
  "namma-markt": {
    email: "office@nammamarkt.com",
    phone: "+49 15562 474281",
    address: "Rathausstraße 11, 21073 Hamburg",
    // free_shipping_min: probe to verify (€2 seems wrong)
  },
  sairas: {
    // probe
  },
  spicelands: {
    email: "info@spicelands.de",
    phone: "06980883307",
    address: "Konrad-Adenauer-Allee 1-11, 61118 Bad Vilbel",
    free_shipping_min: 79,
  },
  swadesh: {
    email: "info@swadesh.eu",
    phone: null, // garbled
    free_shipping_min: 35,
  },
};

// ── Stores to re-probe for missing/uncertain data ─────────────────────────
const REPROBE = {
  "anuhita-groceries": [
    "https://www.anuhitagroceries.de",
    "https://www.anuhitagroceries.de/kontakt",
    "https://www.anuhitagroceries.de/impressum",
  ],
  desigros: [
    "https://www.desigros.com",
    "https://www.desigros.com/pages/kontakt",
    "https://www.desigros.com/pages/impressum",
    "https://www.desigros.com/impressum",
  ],
  dookan: [
    "https://eu.dookan.com/pages/about",
    "https://eu.dookan.com/pages/legal",
    "https://eu.dookan.com",
  ],
  jamoona: [
    "https://www.jamoona.com",
    "https://www.jamoona.com/pages/impressum",
  ],
  "little-india": [
    "https://www.littleindia.de",
    "https://www.littleindia.de/about-us",
  ],
  "md-store": [
    "https://www.md-store.de",
    "https://www.md-store.de/contact",
    "https://www.md-store.de/about",
  ],
  "namma-markt": [
    "https://www.nammamarkt.com/pages/shipping-and-delivery",
    "https://www.nammamarkt.com/policies/shipping-policy",
    "https://www.nammamarkt.com",
  ],
  sairas: [
    "https://www.sairas.de",
    "https://www.sairas.de/impressum",
    "https://www.sairas.de/contact",
  ],
  swadesh: [
    "https://www.swadesh.eu",
    "https://www.swadesh.eu/contact",
    "https://www.swadesh.eu/index.php/kontakt",
  ],
  "zora-supermarkt": [
    "https://www.zorastore.eu",
    "https://www.zorastore.eu/contact",
    "https://www.zorastore.eu/impressum",
  ],
  indianstorestuttgart: [
    "https://www.indianstorestuttgart.com",
    "https://www.indianstorestuttgart.com/pages/contact",
  ],
  grocera: ["https://www.grocera.de"],
  indiansupermarkt: ["https://www.indiansupermarkt.de/pages/contact-us"],
};

const upsert = db.prepare(`
  UPDATE stores SET
    contact_email     = CASE WHEN ? IS NOT NULL THEN ? ELSE contact_email END,
    contact_phone     = CASE WHEN ? IS NOT NULL THEN ? ELSE contact_phone END,
    address           = CASE WHEN ? IS NOT NULL THEN ? ELSE address END,
    free_shipping_min = CASE WHEN ? IS NOT NULL THEN ? ELSE free_shipping_min END
  WHERE id = ?
`);

function apply(id, data) {
  const e = data.email !== undefined ? data.email : undefined;
  const p = data.phone !== undefined ? data.phone : undefined;
  const a = data.address !== undefined ? data.address : undefined;
  const f =
    data.free_shipping_min !== undefined ? data.free_shipping_min : undefined;

  // Only update if we have at least one value to set
  if (e === undefined && p === undefined && a === undefined && f === undefined)
    return;

  upsert.run(
    e ?? null,
    e ?? null,
    p ?? null,
    p ?? null,
    a ?? null,
    a ?? null,
    f ?? null,
    f ?? null,
    id,
  );
}

// Clear garbled values first
const clearGarbled = db.prepare(`
  UPDATE stores SET
    contact_phone = CASE
      WHEN contact_phone LIKE '%0.%' THEN NULL
      WHEN contact_phone LIKE '%0 0 %' THEN NULL
      WHEN contact_phone LIKE '%/%' AND length(contact_phone) < 12 THEN NULL
      WHEN contact_phone LIKE '%.%' AND length(contact_phone) < 14 THEN NULL
      ELSE contact_phone
    END,
    contact_email = CASE
      WHEN contact_email LIKE '%email' THEN rtrim(contact_email, 'email')
      WHEN contact_email LIKE '%.decall' THEN replace(contact_email, '.decall', '.de')
      ELSE contact_email
    END,
    address = CASE
      WHEN address LIKE '% Unsere %' THEN substr(address, 1, instr(address, ' Unsere ') - 1)
      WHEN address LIKE '% Deutschland Tel%' THEN substr(address, 1, instr(address, ' Deutschland Tel') - 1)
      WHEN address LIKE '% Telefon%' THEN substr(address, 1, instr(address, ' Telefon') - 1)
      WHEN address LIKE 'Berlin%' THEN replace(address, 'Berlin', '')
      ELSE address
    END
`);

(async () => {
  console.log("Clearing garbled values...");
  clearGarbled.run();

  console.log("Applying known-good data...");
  for (const [id, data] of Object.entries(KNOWN)) {
    apply(id, data);
    console.log(`  ${id}: applied`);
  }

  console.log("\nRe-probing for missing data...");
  for (const [id, urls] of Object.entries(REPROBE)) {
    const current = db.prepare("SELECT * FROM stores WHERE id = ?").get(id);
    const needPhone = !current.contact_phone;
    const needEmail = !current.contact_email;
    const needShip = current.free_shipping_min == null;
    if (!needPhone && !needEmail && !needShip) {
      console.log(`  ${id}: already complete`);
      continue;
    }

    let foundPhone = null,
      foundEmail = null,
      foundShip = null;
    for (const url of urls) {
      const html = await get(url);
      if (!html || html.length < 200) continue;
      const $ = cheerio.load(html);
      const text = $.text();
      if (needPhone && !foundPhone) foundPhone = tel(html);
      if (needEmail && !foundEmail) foundEmail = email(html);
      if (needShip && !foundShip) foundShip = freeShip([text, html]);
    }

    const patch = {};
    if (needPhone && foundPhone) patch.phone = foundPhone;
    if (needEmail && foundEmail) patch.email = foundEmail;
    if (needShip && foundShip != null) patch.free_shipping_min = foundShip;
    if (Object.keys(patch).length) {
      apply(id, patch);
      console.log(`  ${id}: ${JSON.stringify(patch)}`);
    } else {
      console.log(`  ${id}: nothing new found`);
    }
  }

  console.log("\n=== Final store info ===");
  const rows = db
    .prepare(
      `
    SELECT id, name, contact_email, contact_phone, address, free_shipping_min
    FROM stores ORDER BY name
  `,
    )
    .all();
  let filled = 0;
  for (const r of rows) {
    const any =
      r.contact_email ||
      r.contact_phone ||
      r.address ||
      r.free_shipping_min != null;
    if (any) filled++;
    console.log(`\n${r.name}`);
    console.log(`  email    : ${r.contact_email || "—"}`);
    console.log(`  phone    : ${r.contact_phone || "—"}`);
    console.log(`  address  : ${r.address || "—"}`);
    console.log(
      `  free ship: ${r.free_shipping_min != null ? "€" + r.free_shipping_min : "—"}`,
    );
  }
  console.log(
    `\n${filled}/${rows.length} stores have at least one info field populated.`,
  );
  process.exit(0);
})();
