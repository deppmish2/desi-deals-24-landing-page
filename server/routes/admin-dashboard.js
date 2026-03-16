"use strict";

const { Router } = require("express");
const db = require("../db");
const requireAdminAuth = require("../middleware/user-admin-auth");

const router = Router();

router.use(requireAdminAuth);

router.get("/stats", async (req, res) => {
  try {
    const [
      totalUsersRow,
      totalInvitesRow,
      unlockedRow,
      signupsByDay,
      invitesByDay,
      topInviters,
      recentSignups,
    ] = await Promise.all([
      db.prepare("SELECT COUNT(*) as count FROM users").get(),
      db.prepare("SELECT COUNT(*) as count FROM waitlist_referrals").get(),
      db.prepare(
        "SELECT COUNT(*) as count FROM users WHERE waitlist_unlocked_at IS NOT NULL",
      ).get(),
      db.prepare(`
        SELECT date(created_at) as day, COUNT(*) as count
        FROM users
        WHERE created_at >= date('now', '-30 days')
        GROUP BY date(created_at)
        ORDER BY day ASC
      `).all(),
      db.prepare(`
        SELECT date(claimed_at) as day, COUNT(*) as count
        FROM waitlist_referrals
        WHERE claimed_at >= date('now', '-30 days')
        GROUP BY date(claimed_at)
        ORDER BY day ASC
      `).all(),
      db.prepare(`
        SELECT u.email, u.first_name, u.name, COUNT(wr.id) as invite_count
        FROM users u
        JOIN waitlist_referrals wr ON wr.inviter_user_id = u.id
        GROUP BY u.id
        ORDER BY invite_count DESC
        LIMIT 10
      `).all(),
      db.prepare(`
        SELECT email, first_name, name, created_at, waitlist_unlocked_at
        FROM users
        ORDER BY created_at DESC
        LIMIT 20
      `).all(),
    ]);

    const totalUsers = Number(totalUsersRow?.count ?? 0);
    const totalInvites = Number(totalInvitesRow?.count ?? 0);
    const unlockedUsers = Number(unlockedRow?.count ?? 0);

    res.json({
      kpis: {
        total_users: totalUsers,
        total_invites: totalInvites,
        unlocked_users: unlockedUsers,
        waiting_users: totalUsers - unlockedUsers,
      },
      signups_by_day: signupsByDay.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
      invites_by_day: invitesByDay.map((r) => ({
        day: r.day,
        count: Number(r.count),
      })),
      top_inviters: topInviters.map((r) => ({
        email: r.email,
        name: r.first_name || r.name || r.email.split("@")[0],
        invite_count: Number(r.invite_count),
      })),
      recent_signups: recentSignups.map((r) => ({
        email: r.email,
        name: r.first_name || r.name || null,
        created_at: r.created_at,
        unlocked: !!r.waitlist_unlocked_at,
      })),
    });
  } catch (err) {
    console.error("[admin-dashboard] stats error:", err);
    res.status(500).json({ error: "Failed to load stats" });
  }
});

module.exports = router;
