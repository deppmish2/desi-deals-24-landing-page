import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOrders, confirmOrder, cancelOrder, rateOrder } from "../utils/api";
import { CartContext } from "../hooks/CartContext";

// ── Formatters ──────────────────────────────────────────────────────────────

const fmt = (n) =>
  n != null ? `${Number(n).toFixed(2).replace(".", ",")} €` : "—";

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

function timeAgo(iso) {
  if (!iso) return "";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr${h !== 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d !== 1 ? "s" : ""} ago`;
}

// ── StoreLogo ───────────────────────────────────────────────────────────────

const STORE_PALETTE = [
  { color: "#16a34a", tint: "#f0fdf4" },
  { color: "#f97316", tint: "#fff7ed" },
  { color: "#8b5cf6", tint: "#f5f3ff" },
  { color: "#3b82f6", tint: "#eff6ff" },
  { color: "#ec4899", tint: "#fdf2f8" },
  { color: "#f59e0b", tint: "#fffbeb" },
];

function hashColor(str = "") {
  let h = 0;
  for (const c of str) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return STORE_PALETTE[Math.abs(h) % STORE_PALETTE.length];
}

function StoreLogo({ storeId = "", storeName = "", size = 36 }) {
  const { color, tint } = hashColor(storeId);
  const initials = (storeName || storeId)
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: tint,
        border: `1.5px solid ${color}33`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontSize: size * 0.4,
          fontWeight: 800,
          color,
          letterSpacing: "-0.3px",
        }}
      >
        {initials}
      </span>
    </div>
  );
}

// ── StatusPill ──────────────────────────────────────────────────────────────

const STATUS_META = {
  pending:   { label: "Confirm?",  color: "#475569", bg: "#f8fafc", border: "#e2e8f0" },
  placed:    { label: "Placed",    color: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
  shipped:   { label: "Shipped",   color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
  delivered: { label: "Delivered", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  issue:     { label: "Issue",     color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
};

function StatusPill({ status, size = "md" }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: m.bg,
        border: `1px solid ${m.border}`,
        borderRadius: 999,
        padding: size === "sm" ? "2px 7px" : "3px 9px",
        fontSize: size === "sm" ? 9 : 10,
        fontWeight: 700,
        color: m.color,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: m.color,
          flexShrink: 0,
        }}
      />
      {m.label}
    </span>
  );
}

// ── Stars ───────────────────────────────────────────────────────────────────

function Stars({ rating = 0, size = 11, onRate }) {
  return (
    <span style={{ display: "inline-flex", gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{
            fontSize: size,
            color: n <= rating ? "#FFD700" : "#e2e8f0",
            cursor: onRate ? "pointer" : "default",
            lineHeight: 1,
          }}
          onClick={onRate ? () => onRate(n) : undefined}
        >
          ★
        </span>
      ))}
    </span>
  );
}

// ── SavingsSparkline ────────────────────────────────────────────────────────

function SavingsSparkline({ data = [], width = 140, height = 42, color = "#16a34a" }) {
  if (!data.length || data.every((v) => !v)) return null;
  const max = Math.max(...data, 0.01);
  const pts = data.map((v, i) => ({
    x: (i / Math.max(data.length - 1, 1)) * (width - 8) + 4,
    y: height - 4 - ((v / max) * (height - 8)),
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const last = pts[pts.length - 1];
  const area =
    `M${pts[0].x},${pts[0].y} ` +
    pts.slice(1).map((p) => `L${p.x},${p.y}`).join(" ") +
    ` L${last.x},${height} L${pts[0].x},${height} Z`;
  return (
    <svg width={width} height={height} style={{ overflow: "visible", display: "block" }}>
      <path d={area} fill={color} fillOpacity={0.1} />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={i === pts.length - 1 ? 3 : 1.8}
          fill={i === pts.length - 1 ? color : "#fff"}
          stroke={color}
          strokeWidth={1.5}
        />
      ))}
    </svg>
  );
}

// ── Placeholder components (replaced in later tasks) ────────────────────────

function EmptyState({ onStartList }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 24px",
        textAlign: "center",
        minHeight: "100vh",
        background: "#f8fafc",
        fontFamily: "'DM Sans', system-ui, sans-serif",
      }}
    >
      {/* Receipt illustration */}
      <div style={{ position: "relative", width: 140, height: 140, marginBottom: 24 }}>
        <div style={{ position: "absolute", left: 14, top: 30, width: 90, height: 100, borderRadius: 8, background: "#fff", border: "1.5px dashed #e2e8f0", transform: "rotate(-7deg)" }} />
        <div style={{ position: "absolute", right: 14, top: 18, width: 90, height: 100, borderRadius: 8, background: "#fff", border: "1.5px dashed #e2e8f0", transform: "rotate(8deg)" }} />
        <div style={{ position: "absolute", left: 25, top: 8, width: 90, height: 104, borderRadius: 8, background: "#fff", border: "1.5px solid #bbf7d0", boxShadow: "0 8px 24px rgba(22,163,74,0.18)", padding: "12px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ height: 6, width: "70%", background: "#16a34a", borderRadius: 3 }} />
          <div style={{ height: 4, width: "100%", background: "#f1f5f9", borderRadius: 2 }} />
          <div style={{ height: 4, width: "85%", background: "#f1f5f9", borderRadius: 2 }} />
          <div style={{ height: 4, width: "60%", background: "#f1f5f9", borderRadius: 2 }} />
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ height: 4, width: 24, background: "#e2e8f0", borderRadius: 2 }} />
            <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 11, fontWeight: 800, color: "#16a34a" }}>−€</span>
          </div>
        </div>
      </div>

      <h2 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.3px", margin: "0 0 12px" }}>
        No orders yet
      </h2>
      <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, maxWidth: 280, margin: "0 0 24px" }}>
        When you order from a store via DesiDeals24, it'll show up here with your savings. We'll also remind you to confirm and rate.
      </p>

      <button
        onClick={onStartList}
        style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 12, padding: "12px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        Start a shopping list
      </button>

      <p style={{ marginTop: 18, fontSize: 12, color: "#64748b" }}>
        Already shopped?{" "}
        <span style={{ color: "#16a34a", fontWeight: 600, cursor: "pointer" }}>
          Log a past order →
        </span>
      </p>

      <div style={{ marginTop: 36, maxWidth: 320, width: "100%", textAlign: "left" }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", margin: "0 0 10px" }}>
          What you'll see here
        </p>
        {[
          { icon: "✓", color: "#16a34a", text: "Status of every order — placed, shipped, delivered" },
          { icon: "%", color: "#f97316", text: "Savings vs other stores at the time you bought" },
          { icon: "↻", color: "#3b82f6", text: "One-tap re-order of any past basket" },
        ].map(({ icon, color, text }) => (
          <div key={icon} style={{ display: "flex", gap: 10, padding: "9px 0", alignItems: "flex-start" }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color }}>{icon}</span>
            </div>
            <span style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Dir2({ orders, handlers }) {
  return <div style={{ padding: 16 }}>Mobile timeline (Task 6)</div>;
}

function Dir4({ orders, handlers }) {
  return <div style={{ padding: 24 }}>Desktop two-pane (Task 7)</div>;
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const navigate = useNavigate();
  const { addItem } = useContext(CartContext);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    fetchOrders()
      .then((r) => setOrders(r.data || []))
      .catch((e) => setError(e.message));
  }, []);

  function handleConfirm(orderId) {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, order_status: "placed" } : o))
    );
    confirmOrder(orderId).catch(console.error);
  }

  function handleCancel(orderId) {
    setOrders((prev) => prev.filter((o) => o.id !== orderId));
    cancelOrder(orderId).catch(console.error);
  }

  function handleRate(orderId, rating) {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, rating } : o))
    );
    rateOrder(orderId, rating).catch(console.error);
  }

  function handleReorder(order) {
    (order.items || []).forEach((item) =>
      addItem({ raw_item_text: item.raw_item_text, item_count: item.item_count || 1 })
    );
    navigate("/cart");
  }

  function handleTrack(trackingUrl) {
    window.open(trackingUrl, "_blank", "noopener");
  }

  const handlers = { handleConfirm, handleCancel, handleRate, handleReorder, handleTrack };

  if (orders === null) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#94a3b8" }}>
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ padding: 24, color: "#dc2626", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        Error: {error}
      </div>
    );
  }
  if (orders.length === 0) {
    return <EmptyState onStartList={() => navigate("/list")} />;
  }

  return windowWidth < 768
    ? <Dir2 orders={orders} handlers={handlers} />
    : <Dir4 orders={orders} handlers={handlers} />;
}
