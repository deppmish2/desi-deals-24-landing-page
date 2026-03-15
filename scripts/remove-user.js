"use strict";
/**
 * One-time script: fully remove a user by email from all DB tables.
 * Cascades handle: refresh_tokens, waitlist_referrals, shopping_lists,
 *                  price_alerts, alert_notifications (events nullified).
 * email_auth_tokens is deleted separately (not cascaded).
 *
 * Run: node scripts/remove-user.js itsjustrahul@gmail.com
 */
require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const db = require("../server/db");

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/remove-user.js <email>");
  process.exit(1);
}

(async () => {
  await db.ready;

  const user = await db.prepare("SELECT * FROM users WHERE email = ? LIMIT 1").get(email);
  if (!user) {
    console.log(`No user found with email: ${email}`);
    process.exit(0);
  }

  console.log(`Found user: id=${user.id} email=${user.email} google_id=${user.google_id || "none"}`);

  // Delete email auth tokens (not cascaded)
  const tokensResult = await db.prepare("DELETE FROM email_auth_tokens WHERE email = ?").run(email);
  console.log(`Deleted email_auth_tokens: ${tokensResult.rowsAffected ?? "?"} row(s)`);

  // Delete user — cascades: refresh_tokens, waitlist_referrals, shopping_lists,
  //   price_alerts, alert_notifications; events.user_id set to NULL
  const userResult = await db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  console.log(`Deleted user: ${userResult.rowsAffected ?? "?"} row(s)`);

  console.log(`Done. User ${email} fully removed.`);
  process.exit(0);
})().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
