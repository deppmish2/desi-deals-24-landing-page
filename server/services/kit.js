"use strict";

/**
 * Kit (formerly ConvertKit) newsletter integration.
 *
 * Subscribes new users to the Monday weekly digest list.
 * Set KIT_API_KEY and optionally KIT_FORM_ID in environment.
 * If KIT_API_KEY is not set, all calls are silently skipped.
 */

const fetch = require("node-fetch");

const KIT_API_BASE = "https://api.kit.com/v4";

async function subscribeToNewsletter(email, firstName) {
  const apiKey = process.env.KIT_API_KEY;
  if (!apiKey || !email) return { skipped: true };

  try {
    const formId = process.env.KIT_FORM_ID;
    const url = formId
      ? `${KIT_API_BASE}/forms/${formId}/subscribers`
      : `${KIT_API_BASE}/subscribers`;

    const body = { email_address: email };
    if (firstName) body.first_name = firstName;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(
        `[kit] Subscribe failed for ${email}: ${res.status} ${text.slice(0, 200)}`,
      );
      return { error: `HTTP ${res.status}` };
    }

    console.log(`[kit] Subscribed ${email} to newsletter`);
    return { ok: true };
  } catch (err) {
    console.warn(`[kit] Subscribe error for ${email}:`, err.message);
    return { error: err.message };
  }
}

module.exports = { subscribeToNewsletter };
