"use strict";

/**
 * Kit (formerly ConvertKit) newsletter integration.
 *
 * Subscribes new users to the Monday weekly digest list.
 * Set KIT_API_KEY and optionally KIT_FORM_ID in environment.
 * If KIT_API_KEY is not set, all calls are silently skipped.
 */

const fetch = require("node-fetch");

function kitApiBase() {
  return String(process.env.KIT_API_BASE || "https://api.kit.com/v4").trim();
}

function kitApiKey() {
  return String(process.env.KIT_API_KEY || "").trim();
}

function kitHeaders() {
  return {
    "Content-Type": "application/json",
    "X-Kit-Api-Key": kitApiKey(),
  };
}

function defaultReferrer() {
  return (
    String(process.env.CLIENT_APP_URL || "").trim() ||
    String(process.env.APP_URL || "").trim() ||
    String(process.env.FRONTEND_URL || "").trim() ||
    "http://localhost:3000"
  );
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function subscribeToNewsletter(email, firstName) {
  const apiKey = kitApiKey();
  if (!apiKey || !email) return { skipped: true };

  try {
    const apiBase = kitApiBase().replace(/\/+$/, "");
    const formId = String(process.env.KIT_FORM_ID || "").trim();
    const createBody = {
      email_address: email,
      state: "active",
    };
    if (firstName) createBody.first_name = firstName;

    const createRes = await fetch(`${apiBase}/subscribers`, {
      method: "POST",
      headers: kitHeaders(),
      body: JSON.stringify(createBody),
    });

    if (!createRes.ok) {
      const text = await createRes.text().catch(() => "");
      console.warn(
        `[kit] Subscriber upsert failed for ${email}: ${createRes.status} ${text.slice(0, 200)}`,
      );
      return { error: `HTTP ${createRes.status}` };
    }

    const createdPayload = await parseJsonSafe(createRes);
    const subscriber = createdPayload?.subscriber || null;

    if (formId) {
      const formRes = await fetch(`${apiBase}/forms/${formId}/subscribers`, {
        method: "POST",
        headers: kitHeaders(),
        body: JSON.stringify({
          email_address: email,
          referrer: defaultReferrer(),
        }),
      });

      if (!formRes.ok) {
        const text = await formRes.text().catch(() => "");
        console.warn(
          `[kit] Form subscribe failed for ${email}: ${formRes.status} ${text.slice(0, 200)}`,
        );
        return { error: `HTTP ${formRes.status}` };
      }
    }

    console.log(`[kit] Subscribed ${email} to newsletter`);
    return {
      ok: true,
      subscriberId: subscriber?.id || null,
      state: subscriber?.state || null,
    };
  } catch (err) {
    console.warn(`[kit] Subscribe error for ${email}:`, err.message);
    return { error: err.message };
  }
}

module.exports = { subscribeToNewsletter };
