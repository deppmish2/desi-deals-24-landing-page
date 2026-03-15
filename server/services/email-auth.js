"use strict";

const nodemailer = require("nodemailer");

function productionLikeRuntime() {
  return (
    String(process.env.NODE_ENV || "").trim() === "production" ||
    Boolean(process.env.VERCEL)
  );
}

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS,
  );
}

function transportOptions() {
  return {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
}

function senderAddress() {
  const fallback = process.env.SMTP_USER || "no-reply@desideals24.local";
  return `"DesiDeals24" <${fallback}>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailCopy({ purpose, name, linkUrl, expiresMinutes }) {
  const subject =
    purpose === "login"
      ? "Your DesiDeals24 sign-in link"
      : "Confirm your DesiDeals24 signup";

  if (purpose !== "login") {
    const greeting = name ? `Hey ${name},` : "Hey,";
    const intro = "Tap below to confirm your email. Once confirmed, you'll get access to the daily deals section. We'll also send you super grocery deals from time to time, straight to your inbox.";
    const footer = "DesiDeals24 · desideals24.com\nIf that wasn't you, ignore this email.";

    const text = [
      greeting,
      "",
      intro,
      "",
      linkUrl,
      "",
      footer,
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;background:#f7faf7;padding:32px;color:#0f172a">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce8dc;border-radius:20px;padding:32px">
          <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#0f172a;font-weight:600">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.7;color:#475569">${escapeHtml(intro)}</p>
          <a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:12px;font-size:16px">Confirm my email</a>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0" />
          <p style="margin:0;font-size:13px;line-height:1.7;color:#94a3b8">DesiDeals24 · desideals24.com<br/>If that wasn't you, ignore this email.</p>
        </div>
      </div>
    `;

    return { subject, text, html };
  }

  const heading = "Finish signing in";
  const intro = "Use this secure link to sign in to DesiDeals24.";

  const text = [
    heading,
    "",
    intro,
    "",
    linkUrl,
    "",
    `This link expires in ${expiresMinutes} minutes.`,
    "If you did not request this email, you can ignore it.",
  ].join("\n");

  const html = `
    <div style="font-family:Arial,sans-serif;background:#f7faf7;padding:32px;color:#0f172a">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #dce8dc;border-radius:20px;padding:32px">
        <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#dcfce7;border:1px solid #bbf7d0;color:#15803d;font-size:12px;font-weight:700;letter-spacing:0.02em;margin-bottom:16px">DesiDeals24</div>
        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.1">${escapeHtml(heading)}</h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#475569">${escapeHtml(intro)}</p>
        <a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px">Continue to DesiDeals24</a>
        <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#64748b">This link expires in ${escapeHtml(expiresMinutes)} minutes. If you did not request this email, you can ignore it.</p>
      </div>
    </div>
  `;

  return { subject, text, html };
}

async function sendEmailAuthLink({ email, name, purpose, linkUrl, expiresMinutes }) {
  const copy = buildEmailCopy({ purpose, name, linkUrl, expiresMinutes });

  if (!smtpConfigured()) {
    if (productionLikeRuntime()) {
      const error = new Error(
        "Email auth is not configured on this deployment. Missing SMTP credentials.",
      );
      error.code = "EMAIL_AUTH_NOT_CONFIGURED";
      throw error;
    }

    console.log(
      `[email-auth] SMTP not configured. ${purpose} link for ${email}: ${linkUrl}`,
    );
    return {
      delivered: false,
      transport: "log",
      previewUrl: linkUrl,
    };
  }

  const transporter = nodemailer.createTransport(transportOptions());
  await transporter.sendMail({
    from: senderAddress(),
    to: email,
    subject: copy.subject,
    text: copy.text,
    html: copy.html,
  });

  return {
    delivered: true,
    transport: "smtp",
    previewUrl: null,
  };
}

module.exports = {
  productionLikeRuntime,
  sendEmailAuthLink,
  smtpConfigured,
};
