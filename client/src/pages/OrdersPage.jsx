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

function D2Footer({ order, onConfirm, onCancel, onRate, onReorder, onTrack }) {
  if (order.order_status === "pending") {
    return (
      <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 10, padding: "9px 11px", marginTop: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <StatusPill status="pending" size="sm" />
          <span style={{ fontSize: 10, color: "#64748b" }}>handed off {timeAgo(order.completed_at)}</span>
        </div>
        <p style={{ fontSize: 11, color: "#475569", lineHeight: 1.45, margin: "0 0 8px" }}>
          Did you complete checkout at {order.completed_store_name || order.completed_store_id}?
        </p>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => onConfirm(order.id)} style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "7px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Yes, I placed it
          </button>
          <button onClick={() => onCancel(order.id)} style={{ background: "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            Didn't order
          </button>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      <StatusPill status={order.order_status} size="sm" />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {order.order_status === "delivered" && !order.rating && (
          <button onClick={() => onRate(order.id)} style={{ background: "#fff", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            Rate
          </button>
        )}
        {order.order_status === "delivered" && order.rating && (
          <Stars rating={order.rating} size={11} />
        )}
        {order.order_status === "shipped" && (
          <button
            onClick={() => order.tracking_url && onTrack(order.tracking_url)}
            style={{ background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe", borderRadius: 8, padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
          >
            Track
          </button>
        )}
        {order.order_status === "placed" && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "#f59e0b" }}>awaiting shipment</span>
        )}
        {order.order_status === "issue" && (
          <span style={{ fontSize: 10, fontWeight: 600, color: "#dc2626" }}>{order.issue_text || "Issue with order"}</span>
        )}
        {order.order_status === "delivered" && (
          <button onClick={() => onReorder(order)} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "5px 11px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            ↻ Reorder
          </button>
        )}
      </div>
    </div>
  );
}

function D2Order({ order, isFirst, isLast, onConfirm, onCancel, onRate, onReorder, onTrack }) {
  const { color: badgeColor } = {
    pending:   { color: "#64748b" },
    placed:    { color: "#f59e0b" },
    shipped:   { color: "#3b82f6" },
    delivered: { color: "#16a34a" },
    issue:     { color: "#dc2626" },
  }[order.order_status] || { color: "#94a3b8" };

  const badgeGlyph = { pending: "?", placed: "•", shipped: "→", delivered: "✓", issue: "!" }[order.order_status] || "?";

  const visibleItems = order.items?.slice(0, 3) || [];
  const extraCount  = (order.items?.length || 0) - 3;
  const itemsSummary = visibleItems.map((i) => i.raw_item_text).join(", ") + (extraCount > 0 ? `, +${extraCount}` : "");

  return (
    <div style={{ display: "flex", gap: 12, paddingBottom: 14 }}>
      {/* Rail */}
      <div style={{ width: 36, position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
        {!isFirst && (
          <div style={{ position: "absolute", top: 0, bottom: "50%", left: "50%", transform: "translateX(-50%)", width: 2, background: "#e2e8f0" }} />
        )}
        {!isLast && (
          <div style={{ position: "absolute", top: "50%", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 2, background: "#e2e8f0" }} />
        )}
        <div style={{ position: "relative", zIndex: 1, marginTop: 8 }}>
          <StoreLogo storeId={order.completed_store_id || ""} storeName={order.completed_store_name || ""} size={36} />
          <div style={{ position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: "50%", background: badgeColor, border: "2.5px solid #fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 7, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{badgeGlyph}</span>
          </div>
        </div>
      </div>

      {/* Card */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", margin: "6px 0 4px" }}>
          {fmtDate(order.completed_at)}
        </div>
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f1f5f9", padding: "12px 13px", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                {order.completed_store_name || order.completed_store_id}
              </div>
              <div style={{ fontSize: 10, color: "#94a3b8" }}>#{order.id.slice(0, 8).toUpperCase()}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              {order.total_eur != null ? (
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(order.total_eur)}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{order.items?.length || 0} items</div>
              )}
              {order.savings_eur > 0 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a" }}>saved {fmt(order.savings_eur)}</div>
              )}
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.5, marginBottom: 8 }}>
            {order.items?.length || 0} items{itemsSummary ? ` · ${itemsSummary}` : ""}
          </div>

          <D2Footer
            order={order}
            onConfirm={onConfirm}
            onCancel={onCancel}
            onRate={onRate}
            onReorder={onReorder}
            onTrack={onTrack}
          />
        </div>
      </div>
    </div>
  );
}

function Dir2({ orders, handlers }) {
  const { handleConfirm, handleCancel, handleRate, handleReorder, handleTrack } = handlers;
  const [grouping, setGrouping] = useState(0); // 0=Recent 1=Month 2=Store
  const [search, setSearch]     = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((o) =>
      !q ||
      (o.completed_store_name || "").toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q) ||
      (o.items || []).some((i) => i.raw_item_text.toLowerCase().includes(q))
    );
  }, [orders, search]);

  const totalSaved  = orders.reduce((s, o) => s + (o.savings_eur || 0), 0);
  const avgSavedPct = orders.length
    ? Math.round(orders.filter(o => o.savings_eur > 0).length / orders.length * 100)
    : 0;

  const grouped = useMemo(() => {
    if (grouping === 0) return [{ key: "Recent", items: filtered }];
    if (grouping === 1) {
      const map = new Map();
      for (const o of filtered) {
        const key = new Date(o.completed_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(o);
      }
      return [...map.entries()].map(([key, items]) => ({ key, items }));
    }
    const map = new Map();
    for (const o of filtered) {
      const key = o.completed_store_name || o.completed_store_id || "Unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    }
    return [...map.entries()].map(([key, items]) => ({ key, items }));
  }, [filtered, grouping]);

  return (
    <div style={{ background: "#f8fafc", minHeight: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "14px 16px" }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 16, fontWeight: 700, color: "#0f172a" }}>Orders</div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>Timeline · {orders.length} orders</div>
      </div>

      {/* Recap strip */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "#f1f5f9" }}>
        {[
          { label: "Saved this year", value: fmt(totalSaved), color: "#16a34a" },
          { label: "Orders",          value: orders.length,   color: "#0f172a" },
          { label: "Avg savings",     value: `${avgSavedPct}%`, color: "#f97316" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: "#fff", padding: "12px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 18, fontWeight: 800, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Grouping pills */}
      <div style={{ display: "flex", gap: 8, padding: "12px 16px", overflowX: "auto", background: "#fff", borderBottom: "1px solid #f1f5f9" }}>
        {["Recent", "By month", "By store"].map((label, i) => (
          <button
            key={label}
            onClick={() => setGrouping(i)}
            style={{
              background: grouping === i ? "#16a34a" : "transparent",
              color: grouping === i ? "#fff" : "#64748b",
              border: grouping === i ? "none" : "1px solid #e2e8f0",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            const q = window.prompt("Search orders…", search);
            if (q !== null) setSearch(q);
          }}
          style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 999, padding: "6px 12px", fontSize: 11, color: "#64748b", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          🔍 Search
        </button>
      </div>

      {/* Timeline */}
      <div style={{ padding: "4px 16px 24px" }}>
        {grouped.map(({ key, items }) => (
          <div key={key}>
            {grouping !== 0 && (
              <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px", padding: "12px 0 4px" }}>
                {key}
              </div>
            )}
            {items.map((order, idx) => (
              <D2Order
                key={order.id}
                order={order}
                isFirst={idx === 0 && key === grouped[0]?.key}
                isLast={idx === items.length - 1 && key === grouped[grouped.length - 1]?.key}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                onRate={(id) => {
                  const r = window.prompt("Rate 1-5");
                  if (r && Number(r) >= 1 && Number(r) <= 5) handleRate(id, Number(r));
                }}
                onReorder={handleReorder}
                onTrack={handleTrack}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function D4Row({ order, selected, onSelect, onConfirm, onCancel }) {
  const isSelected = selected === order.id;
  const isPending  = order.order_status === "pending";
  return (
    <div
      onClick={() => onSelect(order.id)}
      style={{
        display: "grid",
        gridTemplateColumns: "42px 1fr 110px 160px 100px 28px",
        gap: 14,
        padding: "14px 18px",
        borderBottom: "1px solid #f1f5f9",
        borderLeft: isSelected ? "3px solid #16a34a" : "3px solid transparent",
        background: isSelected ? "#f8fafc" : isPending ? "#fafafa" : "#fff",
        cursor: "pointer",
        alignItems: "center",
        transition: "background 0.12s",
      }}
    >
      <StoreLogo storeId={order.completed_store_id || ""} storeName={order.completed_store_name || ""} size={36} />

      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 14, fontWeight: 700, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {order.completed_store_name || order.completed_store_id}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>#{order.id.slice(0, 8).toUpperCase()}</div>
        {isPending ? (
          <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
            handed off {timeAgo(order.completed_at)} — awaiting your confirmation
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {order.items?.length || 0} items —{" "}
            {(order.items || []).slice(0, 3).map((i) => i.raw_item_text).join(", ")}
            {(order.items?.length || 0) > 3 ? ", …" : ""}
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: "#475569", fontVariantNumeric: "tabular-nums" }}>
        {fmtDate(order.completed_at)}
      </div>

      <div>
        {isPending ? (
          <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onConfirm(order.id)} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "5px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              I placed it
            </button>
            <button onClick={() => onCancel(order.id)} style={{ background: "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "5px 10px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>
              Didn't
            </button>
          </div>
        ) : (
          <StatusPill status={order.order_status} />
        )}
      </div>

      <div style={{ textAlign: "right" }}>
        {order.total_eur != null ? (
          <>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 15, fontWeight: 800, color: isPending ? "#94a3b8" : "#0f172a", fontVariantNumeric: "tabular-nums" }}>
              {fmt(order.total_eur)}
            </div>
            {!isPending && order.savings_eur > 0 && (
              <div style={{ fontSize: 10, fontWeight: 700, color: "#16a34a" }}>−{fmt(order.savings_eur)}</div>
            )}
          </>
        ) : (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{order.items?.length || 0} items</div>
        )}
      </div>

      <div style={{ fontSize: 14, color: "#cbd5e1", textAlign: "right" }}>›</div>
    </div>
  );
}

function D4Detail({ order, onConfirm, onCancel, onRate, onReorder, onTrack }) {
  if (!order) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#94a3b8", fontSize: 13 }}>
        Select an order
      </div>
    );
  }

  const TIMELINE_STEPS = ["placed", "shipped", "delivered"];
  const statusIdx = TIMELINE_STEPS.indexOf(order.order_status);

  return (
    <div style={{ padding: 20, overflowY: "auto", height: "100%" }}>
      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f1f5f9", padding: 20 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <StoreLogo storeId={order.completed_store_id || ""} storeName={order.completed_store_name || ""} size={48} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
              {order.completed_store_name || order.completed_store_id}
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              #{order.id.slice(0, 8).toUpperCase()} · {fmtDate(order.completed_at)}
            </div>
          </div>
          <StatusPill status={order.order_status} />
        </div>

        {/* Pending banner */}
        {order.order_status === "pending" && (
          <div style={{ background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Plus Jakarta Sans', sans-serif", color: "#0f172a", marginBottom: 4 }}>
              Did you complete checkout at {order.completed_store_name || order.completed_store_id}?
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              We handed you off to the store {timeAgo(order.completed_at)}. Confirm so we can track delivery and savings.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onConfirm(order.id)} style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                Yes, I placed it
              </button>
              <button onClick={() => onCancel(order.id)} style={{ background: "#fff", color: "#64748b", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer" }}>
                I didn't order
              </button>
            </div>
          </div>
        )}

        {/* Status timeline (hidden when pending) */}
        {order.order_status !== "pending" && (
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", marginBottom: 16, display: "flex", alignItems: "center", gap: 0 }}>
            {TIMELINE_STEPS.map((step, i) => {
              const reached = statusIdx >= i;
              return (
                <React.Fragment key={step}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", background: reached ? "#16a34a" : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 7, fontWeight: 800, color: reached ? "#fff" : "#94a3b8" }}>
                        {reached ? "✓" : i + 1}
                      </span>
                    </div>
                    <span style={{ fontSize: 9, color: reached ? "#16a34a" : "#94a3b8", fontWeight: 600, textTransform: "capitalize" }}>{step}</span>
                  </div>
                  {i < TIMELINE_STEPS.length - 1 && (
                    <div style={{ flex: 1, height: 2, background: statusIdx > i ? "#16a34a" : "#e2e8f0", margin: "0 4px", marginBottom: 14 }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Items */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 0 8px", borderBottom: "1px solid #f1f5f9", marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Items · {order.items?.length || 0}
            </span>
          </div>
          {(order.items || []).map((item) => (
            <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
              <div>
                <div style={{ fontSize: 12, color: "#334155" }}>{item.raw_item_text}</div>
                {(item.quantity || item.item_count > 1) && (
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>
                    {item.item_count > 1 ? `×${item.item_count}` : `${item.quantity}${item.quantity_unit ? " " + item.quantity_unit : ""}`}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Totals card */}
        {(order.total_eur != null || order.savings_eur != null) && (
          <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            {order.savings_eur > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#16a34a", fontWeight: 600, marginBottom: 6 }}>
                <span>You saved</span>
                <span>−{fmt(order.savings_eur)}</span>
              </div>
            )}
            <div style={{ height: 1, background: "#e2e8f0", margin: "8px 0" }} />
            {order.total_eur != null && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Total paid</span>
                <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(order.total_eur)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Rating card (delivered only) */}
        {order.order_status === "delivered" && (
          <div style={{ border: "1px solid #f1f5f9", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
              How was {order.completed_store_name || order.completed_store_id}?
            </div>
            {order.rating ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Stars rating={order.rating} size={16} />
                <span style={{ fontSize: 11, color: "#64748b" }}>You rated this order</span>
              </div>
            ) : (
              <Stars rating={0} size={22} onRate={(r) => onRate(order.id, r)} />
            )}
          </div>
        )}

        {/* Actions */}
        {order.order_status !== "pending" && (
          <div style={{ display: "flex", gap: 8 }}>
            {order.order_status === "shipped" && order.tracking_url && (
              <button
                onClick={() => onTrack(order.tracking_url)}
                style={{ background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                Track
              </button>
            )}
            {order.order_status === "delivered" && !order.rating && (
              <button
                onClick={() => {
                  const r = window.prompt("Rate 1-5");
                  if (r && Number(r) >= 1 && Number(r) <= 5) onRate(order.id, Number(r));
                }}
                style={{ background: "#fff", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                ★ Rate
              </button>
            )}
            <button
              onClick={() => window.print()}
              style={{ background: "#fff", color: "#475569", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
            >
              Receipt
            </button>
            <button
              onClick={() => onReorder(order)}
              style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 10, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
            >
              ↻ Reorder all {order.items?.length || 0} items
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Dir4({ orders, handlers }) {
  const { handleConfirm, handleCancel, handleRate, handleReorder, handleTrack } = handlers;
  const [selectedId, setSelectedId]     = useState(() => {
    const first = orders.find((o) => o.order_status === "delivered") || orders[0];
    return first?.id ?? null;
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch]             = useState("");
  const searchRef = useRef(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.order_status !== statusFilter) return false;
      if (!q) return true;
      return (
        (o.completed_store_name || "").toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        (o.items || []).some((i) => i.raw_item_text.toLowerCase().includes(q))
      );
    });
  }, [orders, statusFilter, search]);

  const selectedOrder = orders.find((o) => o.id === selectedId) || null;

  const totalSpent  = orders.reduce((s, o) => s + (o.total_eur || 0), 0);
  const totalSaved  = orders.reduce((s, o) => s + (o.savings_eur || 0), 0);
  const avgBasket   = orders.length ? totalSpent / orders.length : 0;
  const avgItems    = orders.length ? orders.reduce((s, o) => s + (o.items?.length || 0), 0) / orders.length : 0;

  const topStore = useMemo(() => {
    const counts = {};
    for (const o of orders) {
      const key = o.completed_store_id || "";
      counts[key] = (counts[key] || { count: 0, name: o.completed_store_name || key, saved: 0, storeId: key });
      counts[key].count++;
      counts[key].saved += o.savings_eur || 0;
    }
    return Object.entries(counts).sort((a, b) => b[1].count - a[1].count)[0]?.[1] || null;
  }, [orders]);

  const sparkData = useMemo(() => {
    const byMonth = {};
    for (const o of orders) {
      const k = new Date(o.completed_at).toISOString().slice(0, 7);
      byMonth[k] = (byMonth[k] || 0) + (o.savings_eur || 0);
    }
    return Object.keys(byMonth).sort().map((k) => byMonth[k]);
  }, [orders]);

  const statusCounts = useMemo(() => {
    const c = { delivered: 0, shipped: 0, placed: 0, pending: 0, issue: 0 };
    for (const o of orders) c[o.order_status] = (c[o.order_status] || 0) + 1;
    return c;
  }, [orders]);

  function exportCsv() {
    const rows = [
      ["ID", "Store", "Date", "Status", "Total", "Saved", "Items"],
      ...filtered.map((o) => [
        o.id,
        o.completed_store_name || o.completed_store_id,
        fmtDate(o.completed_at),
        o.order_status,
        o.total_eur ?? "",
        o.savings_eur ?? "",
        (o.items || []).map((i) => i.raw_item_text).join("; "),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "desi-deals-orders.csv";
    a.click();
  }

  const FILTER_PILLS = [
    { key: "all",       label: "All" },
    { key: "delivered", label: "Delivered" },
    { key: "shipped",   label: "Shipped" },
    { key: "placed",    label: "Placed" },
    { key: "issue",     label: "Issues" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f8fafc" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid #f1f5f9", background: "#fff" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 20, fontWeight: 800, color: "#0f172a" }}>Orders</span>
          <span style={{ fontSize: 13, color: "#94a3b8" }}>{orders.length} total · {fmt(totalSpent)} spent</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by store, item, ID…"
            style={{ width: 240, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: 13, color: "#0f172a", outline: "none" }}
          />
          <button onClick={exportCsv} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 500, color: "#475569", cursor: "pointer" }}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Savings dashboard */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: 24, padding: "18px 24px", background: "#fff", borderBottom: "1px solid #f1f5f9" }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Total saved · 2026</div>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 30, fontWeight: 800, color: "#16a34a", fontVariantNumeric: "tabular-nums" }}>{fmt(totalSaved)}</div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                {orders.length ? Math.round(totalSaved / orders.reduce((s, o) => s + (o.total_eur || 0) + (o.savings_eur || 0), 0.01) * 100) : 0}% avg savings
              </div>
            </div>
            <SavingsSparkline data={sparkData} width={140} height={42} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Orders</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 24, fontWeight: 800, color: "#0f172a" }}>{orders.length}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {statusCounts.delivered} delivered · {statusCounts.shipped} shipped · {statusCounts.placed} placed
            {statusCounts.issue > 0 && ` · ${statusCounts.issue} issue`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Top store</div>
          {topStore && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StoreLogo storeId={topStore.storeId || ""} storeName={topStore.name} size={28} />
                <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>{topStore.name}</div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{topStore.count} orders · {fmt(topStore.saved)} saved</div>
            </>
          )}
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>Avg basket</div>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: 24, fontWeight: 800, color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>{fmt(avgBasket)}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>~{Math.round(avgItems)} items per order</div>
        </div>
      </div>

      {/* Filters row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 24px", background: "#fff", borderBottom: "1px solid #f1f5f9" }}>
        {FILTER_PILLS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            style={{
              background: statusFilter === key ? "#0f172a" : "#fff",
              color: statusFilter === key ? "#fff" : "#64748b",
              border: statusFilter === key ? "none" : "1px solid #e2e8f0",
              borderRadius: 999,
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: "#e2e8f0", margin: "0 4px" }} />
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#64748b" }}>Showing {filtered.length}</span>
      </div>

      {/* Two-pane body */}
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 420px", overflow: "hidden" }}>
        {/* List pane */}
        <div style={{ background: "#fff", overflowY: "auto", borderRight: "1px solid #f1f5f9" }}>
          {/* Column headers */}
          <div style={{ display: "grid", gridTemplateColumns: "42px 1fr 110px 160px 100px 28px", gap: 14, padding: "10px 18px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
            {["", "Store · Items", "Date", "Status", "Total", ""].map((h, i) => (
              <div key={i} style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.7px" }}>
                {h}
              </div>
            ))}
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: 24, color: "#94a3b8", fontSize: 13, textAlign: "center" }}>No orders match</div>
          )}
          {filtered.map((order) => (
            <D4Row
              key={order.id}
              order={order}
              selected={selectedId}
              onSelect={setSelectedId}
              onConfirm={handleConfirm}
              onCancel={handleCancel}
            />
          ))}
        </div>

        {/* Detail pane */}
        <div style={{ background: "#f8fafc", overflowY: "auto" }}>
          <D4Detail
            order={selectedOrder}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            onRate={handleRate}
            onReorder={handleReorder}
            onTrack={handleTrack}
          />
        </div>
      </div>
    </div>
  );
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
