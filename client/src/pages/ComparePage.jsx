import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { runComparison, cartTransfer } from "../utils/api";

function StoreCard({ result, onOrder, ordering }) {
  const { store, confirmed_total, estimated_total, shipping_cost, coverage_pct, items } = result;
  const total = ((estimated_total ?? confirmed_total ?? 0) + (shipping_cost ?? 0));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-3 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-bold text-gray-900">{store.name}</p>
          {coverage_pct != null && (
            <p className="text-xs text-gray-400 mt-0.5">
              {Math.round(coverage_pct * 100)}% items available
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-orange-600">€{total.toFixed(2)}</p>
          {shipping_cost > 0 && (
            <p className="text-xs text-gray-400">incl. €{shipping_cost.toFixed(2)} shipping</p>
          )}
        </div>
      </div>

      {(items || []).length > 0 && (
        <ul className="text-xs text-gray-500 space-y-1 mb-3 border-t border-gray-100 pt-3">
          {(items || []).slice(0, 5).map((item, i) => (
            <li key={i} className="flex justify-between">
              <span className={item.status === "estimated" ? "text-amber-600" : ""}>
                {item.name || item.raw_item_text}
                {item.status === "estimated" ? " (est.)" : ""}
              </span>
              <span className="font-medium">{item.price != null ? `€${item.price.toFixed(2)}` : "—"}</span>
            </li>
          ))}
          {(items || []).length > 5 && (
            <li className="text-gray-300">+{(items || []).length - 5} more items</li>
          )}
        </ul>
      )}

      <button
        onClick={() => onOrder(store.id)}
        disabled={ordering === store.id}
        className="w-full bg-orange-500 text-white font-semibold text-sm py-2.5 rounded-xl hover:bg-orange-600 disabled:opacity-50 transition-colors"
      >
        {ordering === store.id ? "Redirecting…" : `Order from ${store.name} →`}
      </button>
    </div>
  );
}

export default function ComparePage() {
  const { id: listId } = useParams();
  const navigate = useNavigate();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ordering, setOrdering] = useState(null);
  const [sortBy, setSortBy] = useState("estimated_total");

  useEffect(() => {
    runComparison(listId)
      .then(async (res) => {
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setError(err.error || "Failed to compare");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setResults(data);
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [listId]);

  async function handleOrder(storeId) {
    setOrdering(storeId);
    try {
      const res = await cartTransfer(listId, storeId, results?.items);
      const data = await res.json();
      if (data.cart_url) {
        window.location.href = data.cart_url;
      } else {
        window.open(data.store_url || "#", "_blank");
        setOrdering(null);
      }
    } catch {
      setOrdering(null);
    }
  }

  const sorted = [...(results?.stores || [])].sort((a, b) => {
    const aTotal = (a.estimated_total ?? a.confirmed_total ?? 999) + (a.shipping_cost ?? 0);
    const bTotal = (b.estimated_total ?? b.confirmed_total ?? 999) + (b.shipping_cost ?? 0);
    if (sortBy === "estimated_total") return aTotal - bTotal;
    if (sortBy === "confirmed_total") {
      return ((a.confirmed_total ?? 999) + (a.shipping_cost ?? 0)) - ((b.confirmed_total ?? 999) + (b.shipping_cost ?? 0));
    }
    if (sortBy === "coverage") return (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0);
    return 0;
  });

  if (loading) return (
    <div className="p-8 text-center">
      <div className="text-gray-400 text-sm mb-2">Comparing prices across stores…</div>
      <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
    </div>
  );

  if (error) return (
    <div className="max-w-2xl mx-auto px-4 py-8 text-center">
      <p className="text-red-500 mb-4">{error}</p>
      <button onClick={() => navigate("/list")} className="text-orange-600 text-sm">← Back to list</button>
    </div>
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <button onClick={() => navigate("/list")} className="text-sm text-orange-600 hover:text-orange-700">← Back to list</button>
        <h1 className="text-xl font-bold text-gray-900">Price Comparison</h1>
      </div>

      {results?.freshness === "stale" && (
        <div className="bg-amber-50 text-amber-700 text-xs rounded-xl px-3 py-2 mb-4 border border-amber-100">
          Prices may be updating — results could be slightly stale.
        </div>
      )}

      <div className="flex gap-2 mb-5">
        {[
          { key: "estimated_total", label: "Best price" },
          { key: "confirmed_total", label: "In stock" },
          { key: "coverage", label: "Coverage" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSortBy(key)}
            className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
              sortBy === key
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-12">No stores could price your list yet.</p>
      ) : (
        sorted.map(r => (
          <StoreCard key={r.store.id} result={r} onOrder={handleOrder} ordering={ordering} />
        ))
      )}
    </div>
  );
}
