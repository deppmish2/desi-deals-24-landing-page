import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { runComparison, cartTransfer } from "../utils/api";
import StoreComparisonCard from "../components/comparison/StoreComparisonCard";

const SORT_OPTIONS = [
  { key: "confirmed_total", label: "Best value" },
  { key: "estimated_total", label: "Estimated" },
  { key: "coverage_pct",    label: "Coverage" },
];

function sortStores(stores, key) {
  return [...stores].sort((a, b) => {
    if (key === "coverage_pct") return (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0);
    return (a[key] ?? Infinity) - (b[key] ?? Infinity);
  });
}

export default function ComparePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("confirmed_total");
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    runComparison(id)
      .then(data => {
        const raw = data.stores || data.data || data || [];
        setStores(raw);
        if (raw[0]?.coverage?.total) setItemCount(raw[0].coverage.total);
        else if (raw[0]?.items?.length) setItemCount(raw[0].items.length);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const sorted = sortStores(stores, sort);

  const handleShop = async (store) => {
    try {
      await cartTransfer(id, store.store_id, store.items || []);
    } catch {
      // best-effort; navigate regardless
    }
    if (store.store_url) window.open(store.store_url, "_blank", "noopener");
  };

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
          aria-label="Back to cart"
        >←</button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>Compare prices</p>
          {itemCount > 0 && (
            <p style={{ margin: "1px 0 0", fontSize: 11, color: "#94a3b8" }}>
              {itemCount} item{itemCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      </div>

      {/* Sort pills */}
      <div style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", padding: "10px 16px" }}>
        <div className="max-w-2xl mx-auto flex gap-2">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSort(opt.key)}
              aria-pressed={sort === opt.key}
              style={{
                padding: "6px 14px", borderRadius: 99, border: "none", cursor: "pointer",
                fontSize: 12, fontWeight: sort === opt.key ? 700 : 500,
                background: sort === opt.key ? "#16a34a" : "#f1f5f9",
                color: sort === opt.key ? "#fff" : "#64748b",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-4" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 48, gap: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid #16a34a", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} role="status" aria-label="Loading" />
            <p style={{ margin: 0, fontSize: 14, color: "#94a3b8" }}>Comparing prices…</p>
          </div>
        )}

        {error && (
          <div style={{ textAlign: "center", padding: 48 }}>
            <p style={{ fontSize: 14, color: "#ef4444", marginBottom: 16 }}>{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "10px 24px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 14, cursor: "pointer", fontSize: 14, fontWeight: 600 }}
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && sorted.length === 0 && (
          <p style={{ fontSize: 14, color: "#94a3b8", textAlign: "center", padding: 48 }}>
            No stores found for this cart.
          </p>
        )}

        {!loading && !error && sorted.map(store => (
          <StoreComparisonCard
            key={store.store_id}
            store={store}
            onShop={handleShop}
          />
        ))}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
