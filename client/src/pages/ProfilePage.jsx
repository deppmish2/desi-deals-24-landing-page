import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { fetchMe, updateMe } from "../utils/api";
import { formatPrice } from "../utils/formatters";

function ChevronRight() {
  return (
    <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
      <path
        d="M1 1l6 5-6 5"
        stroke="#94a3b8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Desktop-only components ─────────────────────────────────────────────────

const OVERVIEW_ITEMS = [
  {
    id: "orders",
    label: "Active Orders",
    sub: "2 items in transit",
    to: "/orders",
    highlight: true,
    icon: (hl) => (
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path
          d="M1 5.5h14l-1.5 12.5H2.5L1 5.5z"
          stroke={hl ? "#16a34a" : "#64748b"}
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M5 5.5V4a3 3 0 016 0v1.5"
          stroke={hl ? "#16a34a" : "#64748b"}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "payment",
    label: "Payment Methods",
    sub: "Visa ending in 4242",
    to: "/profile",
    highlight: false,
    icon: () => (
      <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
        <rect
          x="0.75"
          y="0.75"
          width="20.5"
          height="14.5"
          rx="2.25"
          stroke="#64748b"
          strokeWidth="1.3"
        />
        <path d="M0.75 5h20.5" stroke="#64748b" strokeWidth="1.3" />
        <rect x="3" y="8.5" width="5" height="2.5" rx="0.5" fill="#64748b" />
      </svg>
    ),
  },
  {
    id: "rewards",
    label: "Rewards Points",
    sub: "2,450 points available",
    to: "/deals",
    highlight: false,
    icon: () => (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M10 2l2.4 5.2 5.6.5-4 3.8 1.2 5.5L10 14.2 4.8 17l1.2-5.5-4-3.8 5.6-.5L10 2z"
          stroke="#64748b"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

const SETTINGS_CARDS = [
  {
    id: "alerts",
    label: "My Alerts",
    desc: "Manage your personalized price drop alerts and restock notifications.",
    to: "/alerts",
    iconBg: "#eff6ff",
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path
          d="M8 3.5A4 4 0 0114 7v4l1.5 2h-11L6 11V7a4 4 0 012-3.5z"
          stroke="#3b82f6"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M8.5 16a1.5 1.5 0 003 0"
          stroke="#3b82f6"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="14" cy="4" r="2" fill="#ef4444" />
      </svg>
    ),
  },
  {
    id: "orders",
    label: "Orders History",
    desc: "Access receipts, track ongoing shipments, and reorder your favorites.",
    to: "/orders",
    iconBg: "rgba(22,163,74,0.1)",
    icon: (
      <svg width="18" height="20" viewBox="0 0 18 20" fill="none">
        <rect
          x="0.75"
          y="2.75"
          width="16.5"
          height="16.5"
          rx="1.25"
          stroke="#16a34a"
          strokeWidth="1.3"
        />
        <path
          d="M5 0.5v2M13 0.5v2"
          stroke="#16a34a"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path d="M0.75 6.5h16.5" stroke="#16a34a" strokeWidth="1.3" />
        <circle cx="9" cy="13" r="3" stroke="#16a34a" strokeWidth="1.3" />
        <path
          d="M9 11.5V13l1 1"
          stroke="#16a34a"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    id: "addresses",
    label: "Shipping Addresses",
    desc: "Add or edit delivery locations for home, office, and more.",
    to: "/addresses",
    iconBg: "#fff7ed",
    icon: (
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <path
          d="M8 1C4.686 1 2 3.686 2 7c0 4.5 6 12 6 12s6-7.5 6-12c0-3.314-2.686-6-6-6z"
          stroke="#f97316"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <circle cx="8" cy="7" r="2" stroke="#f97316" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    id: "notifications",
    label: "Notifications",
    desc: "Customize how and when you hear from us via email or push.",
    to: "/alerts",
    iconBg: "#faf5ff",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M7 3.5A4 4 0 0113 7v4l1.5 2h-11L5 11V7a4 4 0 012-3.5z"
          stroke="#a855f7"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M7.5 15a1.5 1.5 0 003 0"
          stroke="#a855f7"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    id: "privacy",
    label: "Privacy & Security",
    desc: "Update your password, enable 2FA, and manage data privacy.",
    to: "/profile",
    iconBg: "#f1f5f9",
    icon: (
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <rect
          x="0.75"
          y="8.25"
          width="14.5"
          height="10.5"
          rx="2.25"
          stroke="#475569"
          strokeWidth="1.3"
        />
        <path
          d="M4 8V6a4 4 0 018 0v2"
          stroke="#475569"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="8" cy="13.5" r="1.5" fill="#475569" />
      </svg>
    ),
  },
  {
    id: "help",
    label: "Help & Support",
    desc: "Find answers in our FAQ or start a live chat with our support team.",
    to: "/contact",
    iconBg: "#fff1f2",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="8" stroke="#ef4444" strokeWidth="1.3" />
        <path
          d="M6.5 6.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 3.5"
          stroke="#ef4444"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <circle cx="9" cy="13.5" r="0.75" fill="#ef4444" />
      </svg>
    ),
  },
];

function MenuIcon({ type }) {
  const cls = "text-[#16a34a]";
  switch (type) {
    case "bell":
      return (
        <svg
          width="16"
          height="20"
          viewBox="0 0 16 20"
          fill="none"
          className={cls}
        >
          <path
            d="M8 2a5 5 0 015 5v3l1.5 2.5H1.5L3 10V7a5 5 0 015-5z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M6.5 17a1.5 1.5 0 003 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "orders":
      return (
        <svg
          width="18"
          height="20"
          viewBox="0 0 18 20"
          fill="none"
          className={cls}
        >
          <rect
            x="1"
            y="1"
            width="16"
            height="18"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M5 6h8M5 10h8M5 14h5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "pin":
      return (
        <svg
          width="16"
          height="20"
          viewBox="0 0 16 20"
          fill="none"
          className={cls}
        >
          <path
            d="M8 1a6 6 0 016 6c0 4-6 12-6 12S2 11 2 7a6 6 0 016-6z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="8" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "notifications":
      return (
        <svg
          width="16"
          height="20"
          viewBox="0 0 16 20"
          fill="none"
          className={cls}
        >
          <path
            d="M8 2a5 5 0 015 5v3l1.5 2.5H1.5L3 10V7a5 5 0 015-5z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="3" r="2.5" fill="#16a34a" />
          <path
            d="M6.5 17a1.5 1.5 0 003 0"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case "shield":
      return (
        <svg
          width="16"
          height="20"
          viewBox="0 0 16 20"
          fill="none"
          className={cls}
        >
          <path
            d="M8 1L1 4v7c0 4 7 8 7 8s7-4 7-8V4L8 1z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M5 10l2 2 4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "help":
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          className={cls}
        >
          <circle
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M7.5 7.5a2.5 2.5 0 014.5 1.5c0 2-2.5 2-2.5 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="10" cy="15" r="0.75" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

const MENU_ITEMS = [
  { label: "My Alerts", path: "/alerts", icon: "bell" },
  { label: "Orders History", path: "/orders", icon: "orders" },
  { label: "Shipping Addresses", path: "/addresses", icon: "pin" },
  { label: "Notifications", path: "/alerts", icon: "notifications" },
  { label: "Privacy & Security", path: "/profile", icon: "shield" },
  { label: "Help & Support", path: "/contact", icon: "help" },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({
    postcode: "",
    city: "",
    delivery_speed_pref: "cheapest",
    dietary_prefs_csv: "",
    preferred_stores_csv: "",
    blocked_stores_csv: "",
  });

  useEffect(() => {
    fetchMe()
      .then((res) => {
        const u = res?.data;
        if (!u) {
          navigate("/login");
          return;
        }
        setUser(u);
        setForm({
          postcode: u.postcode || "",
          city: u.city || "",
          delivery_speed_pref: u.delivery_speed_pref || "cheapest",
          dietary_prefs_csv: (u.dietary_prefs || []).join(", "),
          preferred_stores_csv: (u.preferred_stores || []).join(", "),
          blocked_stores_csv: (u.blocked_stores || []).join(", "),
        });
      })
      .catch(() => navigate("/login"))
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      await updateMe({
        postcode: form.postcode,
        city: form.city || null,
        delivery_speed_pref: form.delivery_speed_pref,
        dietary_prefs: form.dietary_prefs_csv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        preferred_stores: form.preferred_stores_csv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        blocked_stores: form.blocked_stores_csv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setNotice("Profile saved.");
      setEditOpen(false);
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f6f8f6] flex items-center justify-center">
        <p className="text-[#64748b]">Loading...</p>
      </div>
    );
  }

  const initials = (user?.email || "").slice(0, 2).toUpperCase();
  const displayName = user?.name || (user?.email || "").split("@")[0] || "User";

  const initials2 = (user?.email || displayName || "U")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="min-h-screen bg-[#f6f8f6]">
      {/* ── Desktop layout (≥ lg) ────────────────────────────────────────── */}
      <div className="hidden lg:block">
        <div className="max-w-[1280px] mx-auto px-6 py-10 flex flex-col gap-10">
          {/* Profile header */}
          <div className="flex items-center justify-between pb-10 border-b border-[#e2e8f0]">
            <div className="flex items-start gap-8">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="w-40 h-40 rounded-full bg-[rgba(22,163,74,0.05)] border-4 border-white shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)] flex items-center justify-center">
                  <span className="text-[48px] font-extrabold text-[#16a34a]">
                    {initials2}
                  </span>
                </div>
                <button className="absolute bottom-2 right-2 w-10 h-10 rounded-full bg-[#16a34a] flex items-center justify-center shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1)]">
                  <svg width="17" height="15" viewBox="0 0 17 15" fill="none">
                    <path
                      d="M6 1h5l1.5 2H15a1 1 0 011 1v9a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1h2.5L6 1z"
                      stroke="white"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="8.5"
                      cy="8"
                      r="2.5"
                      stroke="white"
                      strokeWidth="1.3"
                    />
                  </svg>
                </button>
              </div>

              {/* Info */}
              <div className="flex flex-col pt-2 gap-1">
                <div className="flex items-center gap-3">
                  <h1 className="text-[36px] font-bold text-[#0f172a] tracking-[-0.9px] leading-[40px]">
                    {displayName}
                  </h1>
                  <span className="text-[12px] font-bold uppercase tracking-[0.6px] text-[#16a34a] bg-[rgba(22,163,74,0.1)] px-3 py-1 rounded-full">
                    Premium Member
                  </span>
                </div>
                <p className="text-[18px] text-[#64748b]">{user?.email}</p>
                <div className="flex items-center gap-6 pt-4">
                  <div className="flex items-center gap-2">
                    <svg width="15" height="17" viewBox="0 0 15 17" fill="none">
                      <rect
                        x="0.75"
                        y="1.75"
                        width="13.5"
                        height="13.5"
                        rx="1.25"
                        stroke="#64748b"
                        strokeWidth="1.3"
                      />
                      <path
                        d="M4.5 0.5v2M10.5 0.5v2"
                        stroke="#64748b"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                      <path
                        d="M0.75 5.5h13.5"
                        stroke="#64748b"
                        strokeWidth="1.3"
                      />
                    </svg>
                    <span className="text-[14px] font-medium text-[#475569]">
                      Joined Jan 2023
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <svg width="13" height="17" viewBox="0 0 13 17" fill="none">
                      <path
                        d="M6.5 1L1 3.5v4.5c0 3 2.5 5.5 5.5 6.5C9 13.5 12 11 12 8V3.5L6.5 1z"
                        stroke="#64748b"
                        strokeWidth="1.3"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M4 8.5l2 2 3-3.5"
                        stroke="#64748b"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="text-[14px] font-medium text-[#475569]">
                      Verified Account
                    </span>
                  </div>
                </div>
                <div className="pt-5">
                  <button
                    onClick={() => setEditOpen((v) => !v)}
                    className="border border-[#cbd5e1] rounded-full px-[21px] py-[9px] text-[14px] font-semibold text-[#475569] hover:bg-[#f8fafc] transition-colors"
                  >
                    Edit Profile
                  </button>
                </div>
              </div>
            </div>

            {/* Total Savings card */}
            <div className="relative bg-[#16a34a] rounded-[16px] min-w-[240px] p-5 overflow-hidden shadow-[0px_20px_25px_-5px_rgba(22,163,74,0.2),0px_8px_10px_-6px_rgba(22,163,74,0.2)]">
              <div className="absolute right-[-48px] top-[-48px] w-24 h-24 rounded-full bg-[rgba(255,255,255,0.1)] blur-[20px]" />
              <p className="text-[12px] font-semibold uppercase tracking-[1.2px] text-[rgba(255,255,255,0.8)] mb-1">
                Total Savings
              </p>
              <div className="flex items-baseline text-white">
                <span className="text-[30px] font-bold leading-[36px]">
                  {formatPrice(0)}
                </span>
              </div>
            </div>
          </div>

          {/* Two-column section */}
          <div className="flex gap-8 items-start">
            {/* Account Overview */}
            <div className="flex flex-col gap-4 w-[389px] shrink-0">
              <h2 className="text-[20px] font-bold text-[#0f172a] px-2">
                Account Overview
              </h2>
              <div className="bg-white border border-[#f1f5f9] rounded-[24px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] p-[17px] flex flex-col gap-2">
                {OVERVIEW_ITEMS.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={`flex items-center justify-between p-4 rounded-[16px] transition-colors ${
                      item.highlight
                        ? "bg-[rgba(22,163,74,0.05)] hover:bg-[rgba(22,163,74,0.08)]"
                        : "hover:bg-[#f8fafc]"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                          item.highlight
                            ? "bg-[rgba(22,163,74,0.2)]"
                            : "bg-[#f1f5f9]"
                        }`}
                      >
                        {item.icon(item.highlight)}
                      </div>
                      <div>
                        <p className="text-[14px] font-bold text-[#0f172a]">
                          {item.label}
                        </p>
                        <p className="text-[12px] text-[#64748b]">{item.sub}</p>
                      </div>
                    </div>
                    <ChevronRight />
                  </Link>
                ))}
              </div>
            </div>

            {/* Settings & Preferences */}
            <div className="flex flex-col gap-6 flex-1 min-w-0">
              <h2 className="text-[20px] font-bold text-[#0f172a] px-2">
                Settings & Preferences
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {SETTINGS_CARDS.map((card) => (
                  <Link
                    key={card.id}
                    to={card.to}
                    className="bg-white border border-[#f1f5f9] rounded-[24px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] p-6 flex flex-col hover:shadow-[0px_4px_12px_0px_rgba(0,0,0,0.08)] transition-shadow"
                  >
                    <div
                      className="w-12 h-12 rounded-[16px] flex items-center justify-center mb-6 shrink-0"
                      style={{ backgroundColor: card.iconBg }}
                    >
                      {card.icon}
                    </div>
                    <h3 className="text-[18px] font-bold text-[#0f172a] leading-[28px] mb-1">
                      {card.label}
                    </h3>
                    <p className="text-[14px] text-[#64748b] leading-[22.75px]">
                      {card.desc}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Mobile layout (< lg) ─────────────────────────────────────────── */}
      <div className="lg:hidden pb-28">
        {/* Header */}
        <div className="bg-[#f6f8f6] flex items-center justify-between px-4 pt-4 pb-2">
          <button
            onClick={() => navigate(-1)}
            className="w-12 h-12 flex items-center justify-center rounded-full"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 3L5 8l5 5"
                stroke="#0f172a"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <h1 className="text-[18px] font-bold text-[#0f172a] tracking-[-0.45px]">
            Profile
          </h1>
          <button
            onClick={() => setEditOpen((v) => !v)}
            className="w-12 h-12 flex items-center justify-center rounded-full"
            title="Settings"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M10 1a1.5 1.5 0 011.5 1.5c0 .67.5 1.25 1.18 1.37a1.5 1.5 0 002.07-1.24 1.5 1.5 0 012.6.87 1.5 1.5 0 01-1.24 1.72 1.38 1.38 0 00-1.11 1.18 1.5 1.5 0 001.24 2.07 1.5 1.5 0 010 3 1.5 1.5 0 01-1.72-1.24A1.38 1.38 0 0013.13 9 1.5 1.5 0 0011.5 10.5 1.5 1.5 0 0110 12a1.5 1.5 0 01-1.5-1.5A1.5 1.5 0 007.13 9a1.38 1.38 0 00-1.87.52 1.5 1.5 0 01-1.72 1.24 1.5 1.5 0 010-3 1.5 1.5 0 001.24-2.07A1.38 1.38 0 003.67 4.5 1.5 1.5 0 012.43 2.77a1.5 1.5 0 012.6-.87 1.5 1.5 0 002.07 1.24A1.38 1.38 0 008.5 2.5 1.5 1.5 0 0110 1z"
                stroke="#0f172a"
                strokeWidth="1.3"
                fill="none"
              />
              <circle
                cx="10"
                cy="10"
                r="2.5"
                stroke="#0f172a"
                strokeWidth="1.3"
              />
            </svg>
          </button>
        </div>

        {/* Avatar + info */}
        <div className="flex flex-col items-center pt-6 px-6 gap-4">
          <div className="p-2 rounded-full border-4 border-[rgba(22,163,74,0.2)]">
            <div className="w-32 h-32 rounded-full bg-[#e2e8f0] flex items-center justify-center overflow-hidden">
              <span className="text-3xl font-bold text-[#64748b]">
                {initials}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <p className="text-[24px] font-bold text-[#0f172a] tracking-[-0.6px] text-center">
              {displayName}
            </p>
            <p className="text-[16px] font-medium text-[#64748b] text-center">
              {user?.email}
            </p>
          </div>

          <button
            onClick={() => setEditOpen((v) => !v)}
            className="bg-[#f1f5f9] rounded-full h-11 px-6 text-[14px] font-bold text-[#0f172a] tracking-[0.35px] min-w-[160px] max-w-[280px] w-full"
          >
            Edit Profile
          </button>

          {/* Total Savings */}
          <div className="mt-4 bg-[#16a34a] rounded-full border-4 border-white px-9 py-5 flex flex-col items-center shadow-[0px_20px_25px_-5px_rgba(34,197,94,0.3),0px_8px_10px_-6px_rgba(34,197,94,0.3)]">
            <p className="text-[10px] font-bold text-[rgba(255,255,255,0.9)] uppercase tracking-[2px]">
              Total Savings
            </p>
            <p className="text-[36px] font-bold text-white tracking-[-1.8px] leading-none mt-1">
              {formatPrice(0)}
            </p>
            <p className="text-[10px] font-semibold text-[rgba(255,255,255,0.8)] mt-1">
              All-time
            </p>
          </div>
        </div>

        {/* Edit form */}
        {editOpen && (
          <form
            onSubmit={handleSave}
            className="mx-4 mt-6 bg-white rounded-[16px] p-4 flex flex-col gap-3 border border-[#f1f5f9] shadow-sm"
          >
            <h3 className="text-[14px] font-bold text-[#0f172a]">
              Edit Details
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <input
                value={form.postcode}
                onChange={(e) =>
                  setForm((p) => ({ ...p, postcode: e.target.value }))
                }
                placeholder="Postcode"
                className="border border-[#e2e8f0] rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#16a34a] transition-colors"
              />
              <input
                value={form.city}
                onChange={(e) =>
                  setForm((p) => ({ ...p, city: e.target.value }))
                }
                placeholder="City"
                className="border border-[#e2e8f0] rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#16a34a] transition-colors"
              />
            </div>
            <input
              value={form.dietary_prefs_csv}
              onChange={(e) =>
                setForm((p) => ({ ...p, dietary_prefs_csv: e.target.value }))
              }
              placeholder="Dietary prefs (comma-separated)"
              className="border border-[#e2e8f0] rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#16a34a] transition-colors"
            />
            <input
              value={form.preferred_stores_csv}
              onChange={(e) =>
                setForm((p) => ({ ...p, preferred_stores_csv: e.target.value }))
              }
              placeholder="Preferred stores (comma-separated)"
              className="border border-[#e2e8f0] rounded-[12px] px-4 py-3 text-sm focus:outline-none focus:border-[#16a34a] transition-colors"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {notice && <p className="text-sm text-[#16a34a]">{notice}</p>}
            <button
              type="submit"
              disabled={saving}
              className="bg-[#16a34a] text-white font-bold text-sm py-3 rounded-[12px] hover:bg-[#15803d] transition-colors disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </form>
        )}

        {/* Account Settings */}
        <div className="px-4 pt-6">
          <div className="px-2 mb-2">
            <p className="text-[12px] font-bold text-[#94a3b8] uppercase tracking-[1.2px]">
              Account Settings
            </p>
          </div>
          <div className="flex flex-col gap-1">
            {MENU_ITEMS.map(({ label, path, icon }) => (
              <Link
                key={path}
                to={path}
                className="bg-white flex items-center justify-between min-h-[64px] px-4 py-2.5 rounded-[16px] hover:bg-[#f8fafc] transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-[rgba(22,163,74,0.1)] w-11 h-11 rounded-full flex items-center justify-center shrink-0">
                    <MenuIcon type={icon} />
                  </div>
                  <span className="text-[16px] font-semibold text-[#0f172a]">
                    {label}
                  </span>
                </div>
                <ChevronRight />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
