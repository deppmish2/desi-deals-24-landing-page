"use strict";
const express = require("express");
const router = express.Router();

const RECIPIENT = process.env.CONTACT_EMAIL || "itsjustrahul@gmail.com";

// POST /api/v1/contact
router.post("/", async (req, res) => {
  const { name, email, subject, message } = req.body || {};

  if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "All fields are required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  // Graceful degradation: log if SMTP not configured
  if (!process.env.SMTP_HOST) {
    console.log(
      `[contact] No SMTP configured — message from ${name} <${email}>\nSubject: ${subject}\n${message}`,
    );
    return res.json({ ok: true });
  }

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    await transporter.sendMail({
      from: `"DesiDeals24" <${process.env.SMTP_USER}>`,
      to: RECIPIENT,
      replyTo: `"${name}" <${email}>`,
      subject: `[DesiDeals24 Contact] ${subject}`,
      text: `From: ${name} <${email}>\n\n${message}`,
      html: `<p><strong>From:</strong> ${name} &lt;${email}&gt;</p><hr/><p>${message.replace(/\n/g, "<br/>")}</p>`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("[contact] Send failed:", err.message);
    res
      .status(500)
      .json({ error: "Failed to send message. Please try again later." });
  }
});

module.exports = router;
