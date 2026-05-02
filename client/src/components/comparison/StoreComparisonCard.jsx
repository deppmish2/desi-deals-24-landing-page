import React, { useState, useEffect } from "react";
import ReplacementsModal from "../ReplacementsModal";
import { fetchReplacements, fetchSameProductOtherStores } from "../../utils/api";

function CoverageBar({ available, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((available / total) * 100)) : 0;
  return (
    <div style={{ height: 4, borderRadius: 99, background: "#f1f5f9", overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${pct}%`, background: "#16a34a", borderRadius: 99 }} />
    </div>
  );
}

export default function StoreComparisonCard({ store, onShop, isWinner, priceDiff }) {
  const [expanded, setExpanded] = useState(isWinner);
  const [replacingItem, setReplacingItem] = useState(null);
  const [repTiers, setRepTiers] = useState(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repOtherStores, setRepOtherStores] = useState(null);

  const { store_name, store_id, confirmed_total, coverage, items = [] } = store;

  const missingItems = store.items_not_found || [];
  const available = coverage?.available ?? 0;
  const replaced  = coverage?.replaced ?? 0;
  const missing   = coverage?.missing ?? missingItems.length ?? 0;
  const total     = coverage?.total ?? (items.length + missing || 1);
  const allCount  = items.length + missingItems.length;

  useEffect(() => {
    if (!replacingItem) { setRepTiers(null); setRepOtherStores(null); return; }
    let cancelled = false;
    setRepLoading(true);
    Promise.all([
      fetchReplacements(replacingItem.canonical_id, store_id, null),
      fetchSameProductOtherStores(replacingItem.canonical_id, store_id),
    ]).then(([repData, otherData]) => {
      if (cancelled) return;
      setRepTiers(repData?.tiers || []);
      setRepOtherStores(otherData?.stores || []);
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
      background: "#fff",
      border: isWinner ? "2px solid #16a34a" : "1px solid #e2e8f0",
      borderRadius: 20,
      boxShadow: isWinner ? "0 4px 20px rgba(22,163,74,0.12)" : "0 2px 8px rgba(0,0,0,0.04)",
      overflow: "hidden",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {isWinner && (
        <div style={{ background: "#16a34a", padding: "5px 14px" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: "#fff", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Best price
          </span>
        </div>
      )}

      <div style={{ padding: "16px 16px 0" }}>
        {/* Name + price */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#1e293b" }}>{store_name}</p>
            <p style={{ margin: "4px 0 0", fontSize: 11, color: "#64748b" }}>
              {available}/{total} available
              {replaced > 0 && <span style={{ color: "#f59e0b" }}> · {replaced} replaced</span>}
              {missing > 0  && <span style={{ color: "#94a3b8" }}> · {missing} missing</span>}
            </p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
            <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#1e293b", lineHeight: 1 }}>
              €{Number(confirmed_total || 0).toFixed(2)}
            </p>
            {!isWinner && priceDiff != null && priceDiff > 0.01 && (
              <p style={{ margin: "3px 0 0", fontSize: 11, fontWeight: 600, color: "#ef4444" }}>
                +€{priceDiff.toFixed(2)} more
              </p>
            )}
          </div>
        </div>

        {/* Coverage bar */}
        <div style={{ marginBottom: 12 }}>
          <CoverageBar available={available + replaced} total={total} />
        </div>

        {/* Missing banner */}
        {missing > 0 && (
          <div style={{
            background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10,
            padding: "7px 12px", marginBottom: 12,
            fontSize: 12, color: "#92400e", display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>⚠</span>
            <span>{missing} item{missing !== 1 ? "s" : ""} not available at this store</span>
          </div>
        )}

        {/* Toggle */}
        {allCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "#64748b", padding: "0 0 12px",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span>{expanded ? "▲" : "▾"}</span>
            <span>{expanded ? `Hide all ${allCount} items` : "Show full breakdown"}</span>
          </button>
        )}

        {/* Breakdown */}
        {expanded && (
          <div style={{ borderTop: "1px solid #f1f5f9", paddingTop: 10, marginBottom: 12 }}>
            {items.map((item, i) => {
              const name = (item.packs_needed > 1)
                ? `${item.packs_needed}× ${item.query || item.product_name}`
                : (item.query || item.product_name);
              const price = item.effective_price ?? item.sale_price;
              const perUnit = (item.price_per_unit && item.unit_label)
                ? `${Number(item.price_per_unit).toFixed(2)} ${item.unit_label}`
                : null;
              return (
                <div key={`m-${i}`} style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  gap: 8, padding: "7px 0", borderBottom: "1px solid #f8fafc",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 7, flex: 1, minWidth: 0 }}>
                    <span style={{ color: "#16a34a", fontSize: 14, marginTop: 1, flexShrink: 0 }}>✓</span>
                    <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: "1.3", wordBreak: "break-word" }}>
                      {name}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    {price != null && (
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                        {Number(price).toFixed(2)} €
                      </p>
                    )}
                    {perUnit && (
                      <p style={{ margin: "1px 0 0", fontSize: 10, color: "#94a3b8" }}>{perUnit}</p>
                    )}
                  </div>
                </div>
              );
            })}

            {missingItems.map((name, i) => (
              <div key={`miss-${i}`} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 8, padding: "7px 0",
                borderBottom: i < missingItems.length - 1 ? "1px solid #f8fafc" : "none",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0 }}>
                  <span style={{ color: "#94a3b8", fontSize: 14, flexShrink: 0 }}>✗</span>
                  <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", textDecoration: "line-through", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReplacingItem({ canonical_id: null, product_name: name })}
                  style={{
                    fontSize: 11, color: "#16a34a",
                    background: "#f0fdf4", border: "1px solid #86efac",
                    borderRadius: 8, padding: "3px 8px", cursor: "pointer", flexShrink: 0,
                  }}
                >
                  Replace
                </button>
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
            width: "100%", height: 48,
            background: isWinner ? "#16a34a" : "#f8fafc",
            color: isWinner ? "#fff" : "#1e293b",
            border: isWinner ? "none" : "1px solid #e2e8f0",
            borderRadius: 14, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >
          Order from {store_name} →
        </button>
      </div>

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
