import React, { useState, useEffect } from "react";
import CoverageBar from "./CoverageBar";
import MissingItemsBanner from "./MissingItemsBanner";
import ReplacementsModal from "../ReplacementsModal";
import { fetchReplacements, fetchSameProductOtherStores } from "../../utils/api";

export default function StoreComparisonCard({ store, onShop }) {
  const [expanded, setExpanded] = useState(false);
  const [replacingItem, setReplacingItem] = useState(null);
  const [repTiers, setRepTiers] = useState(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repOtherStores, setRepOtherStores] = useState(null);

  const {
    store_name, store_id,
    confirmed_total, estimated_total,
    coverage, items = [],
  } = store;

  const available = (coverage?.available ?? 0) + (coverage?.replaced ?? 0);
  const missing = coverage?.missing ?? 0;
  const total = coverage?.total ?? (items.length || 1);

  useEffect(() => {
    if (!replacingItem) { setRepTiers(null); setRepOtherStores(null); return; }
    let cancelled = false;
    setRepLoading(true);
    Promise.all([
      fetchReplacements(replacingItem.canonical_id, store_id, null),
      fetchSameProductOtherStores(replacingItem.canonical_id, store_id),
    ]).then(([repData, otherData]) => {
      if (cancelled) return;
      setRepTiers(repData.tiers || []);
      setRepOtherStores(otherData.stores || []);
      setRepLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setRepTiers([]);
      setRepOtherStores([]);
      setRepLoading(false);
    });
    return () => { cancelled = true; };
  }, [replacingItem, store_id]);

  return (
    <div style={{
      background: "#fff", border: "1px solid #f1f5f9",
      borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      overflow: "hidden", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{ padding: "16px 16px 0" }}>
        {/* Store name */}
        <p style={{ margin: "0 0 12px", fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
          {store_name}
        </p>

        {/* Totals */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 14 }}>
          <div>
            <p style={{ margin: "0 0 2px", fontSize: 11, color: "#94a3b8" }}>Cart total</p>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1e293b" }}>
              €{Number(confirmed_total || 0).toFixed(2)}
            </p>
          </div>
          {estimated_total && Math.abs(estimated_total - confirmed_total) > 0.01 && (
            <div>
              <p style={{ margin: "0 0 2px", fontSize: 11, color: "#94a3b8" }}>Fair total</p>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "#64748b" }}>
                €{Number(estimated_total).toFixed(2)}
              </p>
            </div>
          )}
        </div>

        {/* Coverage */}
        <div style={{ marginBottom: 12 }}>
          <CoverageBar available={available} total={total} />
        </div>

        {/* Missing banner */}
        {missing > 0 && (
          <div style={{ marginBottom: 12 }}>
            <MissingItemsBanner count={missing} estimatedCost={store.missing_cost_est} />
          </div>
        )}

        {/* Expand toggle */}
        {items.length > 0 && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(e => !e)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "#64748b", padding: "0 0 12px",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span>{expanded ? "▲" : "▾"}</span>
            <span>{expanded ? "Hide breakdown" : "Show full breakdown"}</span>
          </button>
        )}

        {/* Item breakdown */}
        {expanded && (
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 12, marginBottom: 12 }}>
            {items.map((item, i) => (
              <div
                key={item.canonical_id ?? `item-${i}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  gap: 8, padding: "6px 0",
                  borderBottom: i < items.length - 1 ? "1px solid #f8fafc" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                  {item.state === "ok"       && <span style={{ color: "#16a34a", fontSize: 13 }}>✓</span>}
                  {item.state === "replaced" && <span style={{ color: "#f59e0b", fontSize: 13 }}>↔</span>}
                  {item.state === "missing"  && <span style={{ color: "#94a3b8", fontSize: 13 }}>✗</span>}
                  <p style={{
                    margin: 0, fontSize: 13, color: "#1e293b",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {item.product_name || item.canonical_name}
                  </p>
                  {item.state === "replaced" && (
                    <span style={{ fontSize: 10, color: "#f59e0b", background: "#fffbeb", padding: "1px 6px", borderRadius: 99, flexShrink: 0 }}>
                      replaced
                    </span>
                  )}
                  {item.state === "missing" && (
                    <span style={{ fontSize: 10, color: "#94a3b8", background: "#f8fafc", padding: "1px 6px", borderRadius: 99, flexShrink: 0 }}>
                      not found
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {item.price != null && (
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>
                      €{Number(item.price).toFixed(2)}
                    </span>
                  )}
                  {(item.state === "replaced" || item.state === "missing") && item.canonical_id && (
                    <button
                      type="button"
                      aria-label={`Replace ${item.product_name || item.canonical_name}`}
                      onClick={() => setReplacingItem({ canonical_id: item.canonical_id, product_name: item.product_name || item.canonical_name })}
                      style={{
                        fontSize: 11, color: "#16a34a",
                        background: "#f0fdf4", border: "1px solid #86efac",
                        borderRadius: 8, padding: "3px 8px", cursor: "pointer",
                      }}
                    >
                      Replace
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: "0 16px 16px" }}>
        <button
          type="button"
          onClick={() => onShop && onShop(store)}
          style={{
            width: "100%", height: 46,
            background: "#16a34a", color: "#fff", border: "none",
            borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >
          Shop at {store_name} →
        </button>
      </div>

      {/* Replacements modal */}
      {replacingItem && (
        <ReplacementsModal
          sourceDeal={{ id: null, canonical_id: replacingItem.canonical_id, product_name: replacingItem.product_name, store: { id: store_id, name: store_name } }}
          tiers={repTiers}
          loading={repLoading}
          otherStores={repOtherStores}
          isAdmin={false}
          onClose={() => setReplacingItem(null)}
        />
      )}
    </div>
  );
}
