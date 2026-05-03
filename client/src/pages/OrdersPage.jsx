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
    <div style={{ padding: 32, textAlign: "center", color: "#64748b" }}>
      <p>No orders yet.</p>
      <button onClick={onStartList}>Start a shopping list</button>
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
