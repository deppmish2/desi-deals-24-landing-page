"use strict";

const nodemailer = require("nodemailer");

function buildSubject(alertType) {
  switch (alertType) {
    case "price":
      return "DesiDeals24: Price alert triggered";
    case "deal":
      return "DesiDeals24: New deal available";
    case "restock_any":
      return "DesiDeals24: Item back in stock";
    case "restock_store":
      return "DesiDeals24: Item back in stock at your selected store";
    case "fresh_arrived":
      return "DesiDeals24: Fresh produce arrived";
    default:
      return "DesiDeals24 alert";
  }
}

function buildBody({ alert, matches, context }) {
  const lines = [];
  lines.push(`Alert type: ${alert.alert_type}`);
  lines.push(`Query: ${alert.product_query || alert.canonical_id || "n/a"}`);
  if (alert.target_price != null)
    lines.push(`Target price: EUR ${alert.target_price}`);
  if (alert.min_discount_pct != null)
    lines.push(`Min discount: ${alert.min_discount_pct}%`);
  if (alert.target_store_id)
    lines.push(`Target store: ${alert.target_store_id}`);
  lines.push("");

  if (matches && matches.length > 0) {
    lines.push("Matched products:");
    for (const m of matches.slice(0, 10)) {
      lines.push(
        `- ${m.store_name || m.store_id || "store"} | ${m.product_name || m.query || "item"} | EUR ${m.sale_price ?? "n/a"}`,
      );
      if (m.product_url) lines.push(`  ${m.product_url}`);
    }
  } else {
    lines.push("No concrete product rows attached for this notification.");
  }

  if (context) {
    lines.push("");
    lines.push(`Context: ${context}`);
  }

  return lines.join("\n");
}

async function insertAudit(
  db,
  { alertId, userId, status, sentTo, context, message },
) {
  await db.prepare(
    `INSERT INTO alert_notifications
      (alert_id, user_id, trigger_context, sent_to, sent_status, provider_message)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    alertId,
    userId,
    context || null,
    sentTo || null,
    status,
    message || null,
  );
}

async function sendAlertNotification(db, { alert, user, matches, context }) {
  if (!user?.email) return;

  const subject = buildSubject(alert.alert_type);
  const text = buildBody({ alert, matches, context });

  if (!process.env.SMTP_HOST) {
    console.log(
      `[alerts] SMTP not configured, log-only notification for ${user.email}\n${text}`,
    );
    await insertAudit(db, {
      alertId: alert.id,
      userId: user.id,
      status: "logged",
      sentTo: user.email,
      context,
      message: "SMTP disabled",
    });
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"DesiDeals24 Alerts" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject,
      text,
      html: `<pre style="font-family:ui-monospace, SFMono-Regular, Menlo, monospace; white-space:pre-wrap">${text.replace(/</g, "&lt;")}</pre>`,
    });

    await insertAudit(db, {
      alertId: alert.id,
      userId: user.id,
      status: "sent",
      sentTo: user.email,
      context,
      message: null,
    });
  } catch (error) {
    console.error("[alerts] Email send failed:", error.message);
    await insertAudit(db, {
      alertId: alert.id,
      userId: user.id,
      status: "failed",
      sentTo: user.email,
      context,
      message: error.message,
    });
  }
}

module.exports = {
  sendAlertNotification,
};
