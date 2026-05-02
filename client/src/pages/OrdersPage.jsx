import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOrders, getAuthSession } from "../utils/api";

function fmt(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!getAuthSession()) { setOrders([]); return; }
    fetchOrders()
      .then(data => setOrders(data.data || []))
      .catch(err => setError(err.message));
  }, []);

  const completed = orders?.filter(o => o.status === "completed") ?? [];
  const pending   = orders?.filter(o => o.status !== "completed") ?? [];

  return (
    <div style={{
      background: "radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)",
      minHeight: "100vh",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #f1f5f9",
        position: "sticky", top: 0, zIndex: 50,
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          type="button"
          onClick={() => navigate("/cart")}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8", padding: 0 }}
        >←</button>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>Recent orders</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orders === null && !error && (
          <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", border: "3px solid #16a34a", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
          </div>
        )}

        {error && (
          <p style={{ fontSize: 14, color: "#ef4444", textAlign: "center", padding: 48 }}>{error}</p>
        )}

        {!getAuthSession() && (
          <p style={{ fontSize: 14, color: "#94a3b8", textAlign: "center", padding: 48 }}>
            Sign in to see your order history.
          </p>
        )}

        {orders !== null && !error && orders.length === 0 && getAuthSession() && (
          <div style={{ textAlign: "center", padding: 64 }}>
            <p style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#1e293b" }}>No orders yet</p>
            <p style={{ margin: "0 0 24px", fontSize: 13, color: "#94a3b8" }}>
              Add items to your cart and compare prices to place an order.
            </p>
            <button
              type="button"
              onClick={() => navigate("/cart")}
              style={{ background: "#16a34a", color: "#fff", border: "none", borderRadius: 14, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Go to cart
            </button>
          </div>
        )}

        {completed.length > 0 && (
          <>
            <p style={{ margin: "8px 0 4px", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Completed
            </p>
            {completed.map(order => (
              <OrderCard key={order.id} order={order} />
            ))}
          </>
        )}

        {pending.length > 0 && (
          <>
            <p style={{ margin: "8px 0 4px", fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              In progress
            </p>
            {pending.map(order => (
              <OrderCard key={order.id} order={order} onResume={() => navigate(`/compare/${order.id}`)} />
            ))}
          </>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function OrderCard({ order, onResume }) {
  const [expanded, setExpanded] = useState(false);
  const isCompleted = order.status === "completed";

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      overflow: "hidden",
    }}>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
              {isCompleted ? (order.completed_store_name || "Unknown store") : (order.name || "Shopping list")}
            </p>
            <p style={{ margin: "3px 0 0", fontSize: 11, color: "#94a3b8" }}>
              {isCompleted ? fmt(order.completed_at) : fmt(order.created_at)}
              {" · "}
              {order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? "s" : ""}
            </p>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            padding: "3px 8px", borderRadius: 99,
            background: isCompleted ? "#f0fdf4" : "#fef9c3",
            color: isCompleted ? "#16a34a" : "#92400e",
          }}>
            {isCompleted ? "Ordered" : "Pending"}
          </span>
        </div>

        {order.items?.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#64748b", padding: "8px 0 0", display: "flex", alignItems: "center", gap: 4 }}
          >
            <span>{expanded ? "▲" : "▾"}</span>
            <span>{expanded ? "Hide items" : "Show items"}</span>
          </button>
        )}

        {expanded && (
          <div style={{ marginTop: 8, borderTop: "1px solid #f1f5f9", paddingTop: 8 }}>
            {order.items.map((item, i) => (
              <p key={i} style={{ margin: "4px 0", fontSize: 12, color: "#475569" }}>
                {(item.item_count > 1 ? `${item.item_count}× ` : "") + item.raw_item_text}
              </p>
            ))}
          </div>
        )}
      </div>

      {!isCompleted && onResume && (
        <div style={{ padding: "0 16px 14px" }}>
          <button
            type="button"
            onClick={onResume}
            style={{
              width: "100%", height: 40, borderRadius: 12, border: "none",
              background: "#16a34a", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            Resume comparison →
          </button>
        </div>
      )}
    </div>
  );
}
