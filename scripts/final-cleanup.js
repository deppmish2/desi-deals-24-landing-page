"use strict";
require("dotenv").config();
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const db = require("../server/db");

(async () => {
  // 1. Clear remaining garbled phones
  const garbled = [
    "067 4.925 17.396 8", // anuhita — regex false-match
    "0 166 237 / 1.0", // desigros — version number
    "0277/8474/0935", // dookan   — garbled
    "+49711123456", // indianstorestuttgart — placeholder (711 123456 is obviously fake)
  ];
  for (const p of garbled) {
    const r = db
      .prepare("UPDATE stores SET contact_phone = NULL WHERE contact_phone = ?")
      .run(p);
    if (r.changes) console.log("Cleared garbled phone:", p);
  }

  // 2. Verify namma-markt free shipping (€2 is suspicious)
  const nammaUrls = [
    "https://www.nammamarkt.com/policies/shipping-policy",
    "https://www.nammamarkt.com/pages/versand-und-lieferung",
    "https://www.nammamarkt.com/pages/versand",
    "https://www.nammamarkt.com",
  ];
  for (const url of nammaUrls) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 10000,
      });
      if (!res.ok) continue;
      const text = cheerio
        .load(await res.text())
        .text()
        .replace(/\s+/g, " ");
      const m = text.match(/.{0,80}(?:kostenlo|gratis|free\s*ship).{0,120}/gi);
      if (m) {
        console.log("Namma shipping context:", m.slice(0, 3).join(" | "));
        // Extract the actual threshold
        const threshM = text.match(
          /(?:kostenlo\S*\s+(?:versand|lieferung)|free\s+ship)[^€\d]{0,40}(?:€|EUR|ab)?\s*(\d+[.,]\d+|\d+)/i,
        );
        if (threshM) {
          const v = parseFloat(threshM[1].replace(",", "."));
          console.log("Namma free shipping threshold found:", v);
          if (v > 2) {
            db.prepare(
              "UPDATE stores SET free_shipping_min = ? WHERE id = ?",
            ).run(v, "namma-markt");
            console.log("Updated namma-markt free_shipping_min to", v);
          }
        }
        break;
      }
    } catch (err) {
      console.log("fetch error", url, err.message);
    }
  }

  // 3. Try one more time for MD Store, SAIRAS, Zora
  const lastChance = [
    [
      "md-store",
      [
        "https://www.md-store.de",
        "https://md-store.de/ueber-uns-und-kontakt",
        "https://www.md-store.de/ueber-uns-kontakt",
      ],
    ],
    [
      "sairas",
      [
        "https://www.sairas.de",
        "https://sairas.de/impressum",
        "https://sairas.de/ueber-uns",
      ],
    ],
    [
      "zora-supermarkt",
      [
        "https://www.zorastore.eu",
        "https://zorastore.eu/about",
        "https://zorastore.eu/uber-uns",
      ],
    ],
  ];
  for (const [id, urls] of lastChance) {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000,
        });
        if (!res.ok) continue;
        const html = await res.text();
        const $ = cheerio.load(html);
        const tels = [];
        $('a[href^="tel:"]').each((_, el) =>
          tels.push(
            decodeURIComponent($(el).attr("href").replace("tel:", "")).trim(),
          ),
        );
        const emails = [];
        $('a[href^="mailto:"]').each((_, el) =>
          emails.push(
            $(el).attr("href").replace("mailto:", "").split("?")[0].trim(),
          ),
        );
        const text = $.text().replace(/\s+/g, " ");
        const shipM = text.match(
          /(?:kostenlo\S*\s+(?:versand|lieferung)|free\s+ship)[^€\d]{0,40}(\d+[.,]\d+|\d+)/i,
        );
        if (tels.length || emails.length || shipM) {
          console.log(id, "found at", url);
          if (tels[0]) {
            db.prepare("UPDATE stores SET contact_phone = ? WHERE id = ?").run(
              tels[0],
              id,
            );
            console.log("  phone:", tels[0]);
          }
          if (emails[0]) {
            db.prepare("UPDATE stores SET contact_email = ? WHERE id = ?").run(
              emails[0],
              id,
            );
            console.log("  email:", emails[0]);
          }
          if (shipM) {
            const v = parseFloat(shipM[1].replace(",", "."));
            if (v > 0 && v < 500) {
              db.prepare(
                "UPDATE stores SET free_shipping_min = ? WHERE id = ?",
              ).run(v, id);
              console.log("  ship: €" + v);
            }
          }
          break;
        }
      } catch (_) {}
    }
  }

  // 4. Final summary
  console.log("\n=== Final store info ===");
  const rows = db
    .prepare(
      "SELECT id, name, contact_email, contact_phone, address, free_shipping_min FROM stores ORDER BY name",
    )
    .all();
  for (const r of rows) {
    console.log(
      `${r.name}: email=${r.contact_email || "—"} | phone=${r.contact_phone || "—"} | addr=${r.address || "—"} | ship=${r.free_shipping_min != null ? "€" + r.free_shipping_min : "—"}`,
    );
  }
  const filled = rows.filter(
    (r) =>
      r.contact_email ||
      r.contact_phone ||
      r.address ||
      r.free_shipping_min != null,
  ).length;
  console.log(`\n${filled}/${rows.length} stores have at least one field.`);
  process.exit(0);
})();
