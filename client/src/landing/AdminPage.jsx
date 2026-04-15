import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

import {
  fetchAdminStats,
  fetchBrands,
  fetchCanonicalStats,
  fetchMappedProducts,
  reprocessUnmapped,
  fetchRemapStatus,
  triggerBrandRemap,
  getAuthSession,
  logoutUser,
  fetchReviewQueue,
  confirmQueueItem,
  dismissQueueItem,
  createCanonicalFromQueue,
  updateCanonical,
} from "../utils/api";

function BarChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[120px] text-slate-300 text-sm">
        No data yet
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const chartH = 100;
  const barW = Math.min(20, Math.floor(560 / data.length) - 2);
  const totalW = data.length * (barW + 2);

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(totalW, 200)} height={chartH + 24} className="block">
        {data.map((d, i) => {
          const barH = Math.max(2, Math.round((d.count / max) * chartH));
          const x = i * (barW + 2);
          const y = chartH - barH;
          const every = Math.max(1, Math.ceil(data.length / 8));
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill="#16a34a"
                rx={2}
              />
              {d.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#64748b"
                >
                  {d.count}
                </text>
              )}
              {i % every === 0 && (
                <text
                  x={x + barW / 2}
                  y={chartH + 16}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#94a3b8"
                >
                  {d.day ? d.day.slice(5) : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function KpiCard({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-2">
        {label}
      </div>
      <div className="text-[34px] font-extrabold text-slate-900 leading-none">
        {value ?? "—"}
      </div>
    </div>
  );
}

function formatActorLabel(search) {
  if (search.user_email) return search.user_email;
  if (search.session_id) {
    const value = String(search.session_id);
    return `anon · ${value.slice(0, 10)}`;
  }
  return "unknown";
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ status }) {
  const normalized = String(status || "").toLowerCase();
  const styles =
    normalized === "completed"
      ? "bg-green-50 text-green-700"
      : normalized === "failed"
        ? "bg-red-50 text-red-700"
        : normalized.includes("warning")
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";

  return (
    <span
      className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles}`}
    >
      {status || "unknown"}
    </span>
  );
}

function UserStatusPill({ user }) {
  const status = String(user?.status || "").toLowerCase();
  let label = "Signed up";
  let styles = "bg-slate-100 text-slate-500";

  if (status === "admin") {
    label = "Admin";
    styles = "bg-violet-50 text-violet-700";
  } else if (status === "premium") {
    label = "Premium";
    styles = "bg-amber-50 text-amber-700";
  } else if (status === "basic") {
    label = "Basic";
    styles = "bg-emerald-50 text-emerald-700";
  } else if (status === "verified") {
    label = "Verified";
    styles = "bg-green-50 text-green-700";
  }

  return (
    <span
      className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles}`}
    >
      {label}
    </span>
  );
}

function aliasesToText(aliases) {
  return Array.isArray(aliases) ? aliases.join(", ") : String(aliases || "");
}

function parseAliases(raw) {
  return raw.split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
}

function BrandRow({ brand, index, isDeleted, onBrandFieldChange, onDeleteBrand, onUndoDelete }) {
  const [aliasText, setAliasText] = useState(() => aliasesToText(brand.aliases));

  function commitAliases(raw) {
    const aliases = parseAliases(raw);
    onBrandFieldChange(index, "aliases", aliases);
    setAliasText(aliases.join(", "));
  }

  return (
    <div className={`grid grid-cols-[1fr_2fr_auto] gap-2 items-center py-1 ${isDeleted ? "opacity-40 line-through" : ""}`}>
      <input
        className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-green-500"
        value={brand.name}
        disabled={isDeleted}
        onChange={(e) => onBrandFieldChange(index, "name", e.target.value)}
      />
      <input
        className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:border-green-500 font-mono text-xs"
        value={aliasText}
        disabled={isDeleted}
        placeholder="e.g. haldiram, sona masoori"
        onChange={(e) => setAliasText(e.target.value)}
        onBlur={(e) => commitAliases(e.target.value)}
      />
      {isDeleted ? (
        <button onClick={() => onUndoDelete(brand.id)} className="text-xs text-slate-400 hover:text-slate-700">Undo</button>
      ) : (
        <button onClick={() => onDeleteBrand(index)} className="text-xs text-red-400 hover:text-red-600">✕</button>
      )}
    </div>
  );
}

function MappedProductsTable({ products, loading, error, onRetry }) {
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState(new Set());

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10">
        <span className="text-red-500 text-sm">{error}</span>
        <button
          onClick={onRetry}
          className="text-xs font-bold text-green-700 hover:text-green-900"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!products) return null;
  if (products.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-6 text-center">
        No mapped products yet
      </div>
    );
  }

  const q = search.toLowerCase();
  const filtered = q
    ? products.filter((p) => p.canonical_name.toLowerCase().includes(q))
    : products;

  function toggleRow(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search canonical name…"
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-600 outline-none focus:border-green-400 max-w-[240px]"
        />
        <span className="text-[11px] text-slate-400">
          Showing {filtered.length} of {products.length}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px] border-collapse">
          <thead>
            <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
              <th className="pb-2 pr-4">Canonical name</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Stores</th>
              <th className="pb-2 w-6" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const isOpen = expandedIds.has(item.canonical_id);
              return (
                <React.Fragment key={item.canonical_id}>
                  <tr
                    className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50"
                    onClick={() => toggleRow(item.canonical_id)}
                  >
                    <td className="py-2.5 pr-4 font-semibold text-slate-700 max-w-[280px]">
                      {item.canonical_name}
                    </td>
                    <td className="py-2.5 pr-4">
                      {item.has_active_deal ? (
                        <span className="inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-400 text-[10px] font-bold rounded-full px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-slate-500 font-semibold">
                      {item.store_count} {item.store_count === 1 ? "store" : "stores"}
                    </td>
                    <td className="py-2.5 text-slate-300 text-[11px] select-none w-6">
                      {isOpen ? "▼" : "▶"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-slate-50">
                      <td colSpan={4} className="pb-2">
                        <div className="bg-slate-50 rounded-lg overflow-hidden">
                          <div className="grid grid-cols-[140px_1fr_72px] gap-3 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-200">
                            <span>Store</span>
                            <span>Product name on store</span>
                            <span>Link</span>
                          </div>
                          {item.deals.map((deal, i) => (
                            <div
                              key={i}
                              className="grid grid-cols-[140px_1fr_72px] gap-3 px-3 py-1.5 text-xs border-b border-slate-100 last:border-0 items-center"
                            >
                              <span className="text-slate-500 font-semibold truncate">{deal.store_name}</span>
                              <span className="text-slate-700">{deal.product_name}</span>
                              <a
                                href={deal.product_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] text-green-700 font-bold hover:underline whitespace-nowrap"
                              >
                                View ↗
                              </a>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CanonicalStatsTab({
  loading, error, stats, brandDraft, brandsDirty, deletedBrandIds,
  remapStatus, remapError, remapToast,
  onBrandFieldChange, onAddBrand, onDeleteBrand, onUndoDelete, onSaveAndRemap,
  onAddBrandFromSuggestion,
  mappedSubTab, mappedProducts, mappedLoading, mappedError,
  onMappedTabOpen, onRetryMapped,
  reprocessing, reprocessToast, onReprocessUnmapped,
}) {
  const [selectedChip, setSelectedChip] = useState(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-500 text-sm">
        {error}
      </div>
    );
  }
  if (!stats) return null;

  const mappedPct = stats.total_active_deals > 0
    ? Math.round((stats.mapped_deals / stats.total_active_deals) * 100)
    : 0;
  const unmappedCount = stats.total_active_deals - stats.mapped_deals;
  const unmappedPct = 100 - mappedPct;

  // Derive suggested brand names from unmapped products (first word, deduped, not already in draft)
  const existingTokens = new Set(
    (brandDraft || []).flatMap((b) => [
      String(b.name).toLowerCase(),
      ...(Array.isArray(b.aliases) ? b.aliases.map((a) => String(a).toLowerCase()) : []),
    ]),
  );
  const chipCounts = {};
  for (const p of stats.unmapped_products || []) {
    const first = (p.product_name || "").split(/\s+/)[0].replace(/[^a-zA-Z0-9'&.-]/g, "").trim();
    if (first.length < 2) continue;
    const lower = first.toLowerCase();
    chipCounts[lower] = (chipCounts[lower] || 0) + 1;
  }
  const suggestions = Object.entries(chipCounts)
    .filter(([lower]) => !existingTokens.has(lower))
    .sort((a, b) => b[1] - a[1])
    .map(([lower, count]) => ({ name: lower, count }));

  return (
    <div className="space-y-8">
      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard label="Total canonicals" value={stats.total_canonicals} />
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-2">
            Deals mapped
          </div>
          <div className="text-[34px] font-extrabold text-green-700 leading-none">
            {stats.mapped_deals}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {mappedPct}% of {stats.total_active_deals} active
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-red-100 shadow-sm px-5 py-5">
          <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-red-400 mb-2">
            Unmapped products
          </div>
          <div className="text-[34px] font-extrabold text-red-600 leading-none">
            {unmappedCount}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {unmappedPct}% of active deals
          </div>
        </div>
      </div>

      {/* Mapping health bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
          Mapping health
        </div>
        <div className="flex h-4 rounded-full overflow-hidden">
          <div
            className="bg-green-500 transition-all"
            style={{ width: `${mappedPct}%` }}
          />
          <div
            className="bg-red-300 transition-all"
            style={{ width: `${unmappedPct}%` }}
          />
        </div>
        <div className="flex gap-6 mt-2 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />
            Slot matched ({mappedPct}%)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-300" />
            Unmapped ({unmappedPct}%)
          </span>
        </div>
      </div>

      {/* Brand Manager */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400">
            Known Brands
          </span>
          {brandDraft && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
              {brandDraft.filter((b) => !deletedBrandIds.has(b.id)).length} brands
            </span>
          )}
        </div>

        {brandDraft && (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-[10px] font-bold uppercase tracking-[1px] text-slate-400 pb-1 border-b border-slate-100">
              <span>Brand name</span>
              <span>Aliases (comma-separated)</span>
              <span />
            </div>
            {brandDraft.map((brand, i) => (
              <BrandRow
                key={brand.id ?? brand._key ?? `new-${i}`}
                brand={brand}
                index={i}
                isDeleted={deletedBrandIds.has(brand.id)}
                onBrandFieldChange={onBrandFieldChange}
                onDeleteBrand={onDeleteBrand}
                onUndoDelete={onUndoDelete}
              />
            ))}
            <button
              onClick={onAddBrand}
              className="mt-1 text-xs font-bold text-green-700 hover:text-green-900 transition-colors"
            >
              + Add brand
            </button>
          </div>
        )}

        {/* Suggestions from unmapped products */}
        {suggestions.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-[10px] font-bold uppercase tracking-[1px] text-slate-400 mb-2">
              Suggested from unmapped — click to filter · + to add as brand
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map(({ name, count }) => {
                const isActive = selectedChip === name;
                return (
                  <span
                    key={name}
                    className={`inline-flex items-center rounded-full text-xs font-medium overflow-hidden border transition-colors ${
                      isActive
                        ? "bg-green-100 border-green-400 text-green-800"
                        : "bg-slate-100 border-slate-200 text-slate-600"
                    }`}
                  >
                    <button
                      onClick={() =>
                        setSelectedChip((prev) => prev === name ? null : name)
                      }
                      className={`px-2.5 py-1 transition-colors ${
                        isActive ? "hover:bg-green-200" : "hover:bg-slate-200"
                      }`}
                      title="Filter unmapped products by this word"
                    >
                      {name}
                      <span className={`ml-1 text-[10px] font-bold ${isActive ? "text-green-600" : "text-slate-400"}`}>
                        {count}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        onAddBrandFromSuggestion(name);
                        if (selectedChip === name) setSelectedChip(null);
                      }}
                      className={`px-1.5 py-1 border-l transition-colors ${
                        isActive
                          ? "border-green-300 hover:bg-green-200"
                          : "border-slate-300 hover:bg-green-100 hover:text-green-800"
                      }`}
                      title="Add as brand"
                    >
                      +
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Toast / status */}
        {remapToast && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-green-50 text-green-800 text-sm font-medium">
            {remapToast}
          </div>
        )}
        {remapError && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 text-red-700 text-sm">
            {remapError}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <button
            onClick={onSaveAndRemap}
            disabled={!brandsDirty || remapStatus === "running"}
            className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-colors ${
              !brandsDirty || remapStatus === "running"
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700"
            }`}
          >
            {remapStatus === "running" ? "Remapping…" : "Save & Re-map"}
          </button>
        </div>
      </div>

      {/* Unmapped / Mapped sub-tabs */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
        {/* Sub-tab switcher */}
        <div className="flex items-end gap-0 border-b-2 border-slate-100 mb-4">
          <button
            onClick={() => {}}
            className={`pb-2 px-4 text-[11px] font-bold uppercase tracking-[1px] border-b-2 -mb-[2px] transition-colors ${
              mappedSubTab === "unmapped"
                ? "text-green-700 border-green-600"
                : "text-slate-400 border-transparent hover:text-slate-600"
            }`}
          >
            Unmapped
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              mappedSubTab === "unmapped" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
            }`}>
              {stats.total_active_deals - stats.mapped_deals}
            </span>
          </button>
          <button
            onClick={onMappedTabOpen}
            className={`pb-2 px-4 text-[11px] font-bold uppercase tracking-[1px] border-b-2 -mb-[2px] transition-colors ${
              mappedSubTab === "mapped"
                ? "text-green-700 border-green-600"
                : "text-slate-400 border-transparent hover:text-slate-600"
            }`}
          >
            Mapped
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
              mappedSubTab === "mapped" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"
            }`}>
              {mappedProducts ? mappedProducts.length : stats.total_canonicals}
            </span>
          </button>
          <button
            onClick={onReprocessUnmapped}
            disabled={reprocessing}
            className="ml-auto mb-1 px-3 py-1 text-[11px] font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {reprocessing ? "Processing…" : "Reprocess Unmapped"}
          </button>
        </div>

        {reprocessToast && (
          <div className={`mb-3 px-3 py-2 rounded-lg text-xs font-medium ${
            reprocessToast.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {reprocessToast.msg}
          </div>
        )}

        {mappedSubTab === "mapped" ? (
          <MappedProductsTable
            products={mappedProducts}
            loading={mappedLoading}
            error={mappedError}
            onRetry={onRetryMapped}
          />
        ) : (
        <>
        <div className="flex items-center gap-3 mb-4">
          <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 sr-only">
            Unmapped products
          </div>
          {selectedChip && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[10px] font-bold">
              {selectedChip}
              <button
                onClick={() => setSelectedChip(null)}
                className="hover:text-green-600 leading-none"
                title="Clear filter"
              >
                ×
              </button>
            </span>
          )}
        </div>
        {stats.unmapped_products.length === 0 ? (
          <div className="flex items-center gap-2 text-green-700 text-sm font-medium py-4">
            <span className="text-lg">✓</span> All active products are mapped
          </div>
        ) : (() => {
          let exact = stats.unmapped_products;
          let similar = [];
          if (selectedChip) {
            const threshold = Math.min(3, Math.ceil(selectedChip.length / 4));
            const exactSet = new Set();
            exact = [];
            for (const p of stats.unmapped_products) {
              const first = (p.product_name || "").split(/\s+/)[0].replace(/[^a-zA-Z0-9'&.-]/g, "").trim().toLowerCase();
              if (first === selectedChip) { exact.push(p); exactSet.add(p.id); }
            }
            for (const p of stats.unmapped_products) {
              if (exactSet.has(p.id)) continue;
              const first = (p.product_name || "").split(/\s+/)[0].replace(/[^a-zA-Z0-9'&.-]/g, "").trim().toLowerCase();
              if (levenshtein(first, selectedChip) <= threshold) similar.push(p);
            }
          }
          const hasResults = exact.length > 0 || similar.length > 0;

          function ProductRow({ p }) {
            return (
              <tr key={p.id} className="border-b border-slate-50 last:border-0">
                <td className="py-2.5 pr-4 font-medium text-slate-700 max-w-[260px] truncate">{p.product_name}</td>
                <td className="py-2.5 pr-4 text-slate-500 text-xs">{p.store_name}</td>
                <td className="py-2.5 pr-4 text-slate-400 text-xs">{p.product_category}</td>
                <td className="py-2.5 pr-4 text-slate-700 text-xs">
                  {p.sale_price != null ? `${p.currency || "€"} ${Number(p.sale_price).toFixed(2)}` : "—"}
                </td>
                <td className="py-2.5">
                  <a href={p.product_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-green-700 font-bold hover:underline whitespace-nowrap">
                    View ↗
                  </a>
                </td>
              </tr>
            );
          }

          const thead = (
            <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
              <th className="pb-2 pr-4">Product</th>
              <th className="pb-2 pr-4">Store</th>
              <th className="pb-2 pr-4">Category</th>
              <th className="pb-2 pr-4">Price</th>
              <th className="pb-2">Link</th>
            </tr>
          );

          return (
          <div className="overflow-x-auto">
            {!hasResults ? (
              <div className="text-sm text-slate-400 py-4 text-center">
                No unmapped products match "{selectedChip}"
              </div>
            ) : (
              <>
                {similar.length > 0 && (
                  <>
                    <div className="text-[10px] font-bold uppercase tracking-[1px] text-amber-500 mb-1">
                      Possible misspellings ({similar.length})
                    </div>
                    <table className="w-full text-sm min-w-[640px] mb-4">
                      <thead>{thead}</thead>
                      <tbody>{similar.map((p) => <ProductRow key={p.id} p={p} />)}</tbody>
                    </table>
                  </>
                )}
                {exact.length > 0 && (
                  <>
                    {similar.length > 0 && (
                      <div className="text-[10px] font-bold uppercase tracking-[1px] text-slate-400 mb-1">
                        Exact matches ({exact.length})
                      </div>
                    )}
                    <table className="w-full text-sm min-w-[640px]">
                      <thead>{thead}</thead>
                      <tbody>{exact.map((p) => <ProductRow key={p.id} p={p} />)}</tbody>
                    </table>
                  </>
                )}
              </>
            )}
          </div>
          );
        })()}
        </>
        )}
      </div>
    </div>
  );
}

function ReviewQueueTab() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [createForm, setCreateForm] = useState(null);
  const [createFields, setCreateFields] = useState({ name: "", brand: "", baseProduct: "", productType: "", category: "" });
  const [editForm, setEditForm] = useState(null); // { canonicalId, rawName }
  const [editFields, setEditFields] = useState({ brand: "", baseProduct: "", productType: "", category: "" });

  const CATEGORIES = ["Rice & Grains","Flours & Baking","Lentils & Pulses","Spices & Masalas","Oils & Ghee","Sauces & Pastes","Snacks & Sweets","Beverages","Dairy & Paneer","Frozen Foods","Fresh Produce","Noodles & Pasta","Canned & Packaged","Personal Care","Household","Other"];
  const PAGE_SIZE = 50;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchReviewQueue({ status, page });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status, page]);

  async function handleConfirm(id, canonicalId) {
    setActionError(null);
    try {
      await confirmQueueItem(id, canonicalId);
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleDismiss(id) {
    setActionError(null);
    try {
      await dismissQueueItem(id);
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleCreateCanonical(e) {
    e.preventDefault();
    if (!createFields.name.trim() || !createForm) return;
    setActionError(null);
    try {
      await createCanonicalFromQueue({
        queue_item_id: createForm.queueItemId,
        canonical_name: createFields.name.trim(),
        category: createFields.category || createForm.category,
        brand: createFields.brand.trim(),
        base_product: createFields.baseProduct.trim(),
        product_type: createFields.productType.trim(),
      });
      setCreateForm(null);
      setCreateFields({ name: "", brand: "", baseProduct: "", productType: "", category: "" });
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  async function handleEditCanonical(e) {
    e.preventDefault();
    if (!editForm) return;
    setActionError(null);
    try {
      await updateCanonical(editForm.canonicalId, {
        brand: editFields.brand.trim(),
        base_product: editFields.baseProduct.trim(),
        product_type: editFields.productType.trim(),
        category: editFields.category,
      });
      setEditForm(null);
      load();
    } catch (e) {
      setActionError(e.message);
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="text-lg font-semibold text-slate-700">Review Queue</h2>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="text-sm border border-slate-200 rounded px-2 py-1"
        >
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <span className="text-sm text-slate-500">{total} items</span>
      </div>

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}
      {actionError && <div className="text-red-600 text-sm mb-2">{actionError}</div>}

      {createForm && (
        <form onSubmit={handleCreateCanonical} className="mb-4 p-4 bg-green-50 border border-green-200 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-700">New canonical for: <span className="text-green-700">{createForm.rawName}</span></div>
              {createForm.suggestedName && (
                <div className="text-xs text-slate-500">Closest match (rejected): <span className="font-medium text-slate-600">{createForm.suggestedName}</span></div>
              )}
            </div>
            <button type="button" onClick={() => setCreateForm(null)} className="text-slate-400 hover:text-slate-600 text-xs">Cancel</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="block text-xs text-slate-500 mb-0.5">Canonical Name *</label>
              <input
                type="text"
                value={createFields.name}
                onChange={(e) => setCreateFields((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Heera Soan Papdi 500g"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Brand</label>
              <input
                type="text"
                value={createFields.brand}
                onChange={(e) => setCreateFields((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. Heera"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Base Product</label>
              <input
                type="text"
                value={createFields.baseProduct}
                onChange={(e) => setCreateFields((f) => ({ ...f, baseProduct: e.target.value }))}
                placeholder="e.g. Soan Papdi"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Type / Variant</label>
              <input
                type="text"
                value={createFields.productType}
                onChange={(e) => setCreateFields((f) => ({ ...f, productType: e.target.value }))}
                placeholder="e.g. Classic, Mango, Cardamom"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Category</label>
              <select
                value={createFields.category || createForm.category || "Other"}
                onChange={(e) => setCreateFields((f) => ({ ...f, category: e.target.value }))}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="bg-green-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-green-700">
            Create Canonical
          </button>
        </form>
      )}

      {editForm && (
        <form onSubmit={handleEditCanonical} className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-700">Edit canonical for: <span className="text-amber-700">{editForm.rawName}</span></div>
              {editForm.canonicalName && (
                <div className="text-xs text-slate-500">Current canonical: <span className="font-medium text-slate-600">{editForm.canonicalName}</span></div>
              )}
            </div>
            <button type="button" onClick={() => setEditForm(null)} className="text-slate-400 hover:text-slate-600 text-xs">Cancel</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Brand</label>
              <input
                type="text"
                value={editFields.brand}
                onChange={(e) => setEditFields((f) => ({ ...f, brand: e.target.value }))}
                placeholder="e.g. Heera"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Base Product</label>
              <input
                type="text"
                value={editFields.baseProduct}
                onChange={(e) => setEditFields((f) => ({ ...f, baseProduct: e.target.value }))}
                placeholder="e.g. Soan Papdi"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Type / Variant</label>
              <input
                type="text"
                value={editFields.productType}
                onChange={(e) => setEditFields((f) => ({ ...f, productType: e.target.value }))}
                placeholder="e.g. Classic, Mango"
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-0.5">Category</label>
              <select
                value={editFields.category}
                onChange={(e) => setEditFields((f) => ({ ...f, category: e.target.value }))}
                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm bg-white"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="bg-amber-600 text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-amber-700">
            Save Changes
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-slate-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-slate-400 text-sm">No items</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase">
                <th className="text-left p-2 border-b">Raw Name</th>
                <th className="text-left p-2 border-b">Normalised</th>
                <th className="text-left p-2 border-b">Store</th>
                <th className="text-left p-2 border-b">Category</th>
                <th className="text-right p-2 border-b">Confidence</th>
                <th className="text-left p-2 border-b">Suggested</th>
                <th className="text-left p-2 border-b">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b hover:bg-slate-50">
                  <td className="p-2 max-w-[200px] truncate" title={item.raw_name}>{item.raw_name}</td>
                  <td className="p-2 max-w-[180px] truncate text-slate-500" title={item.normalised_name}>{item.normalised_name || "—"}</td>
                  <td className="p-2 text-slate-500">{item.store_name || item.store_id || "—"}</td>
                  <td className="p-2 text-slate-500">{item.category || "—"}</td>
                  <td className="p-2 text-right tabular-nums">
                    {item.confidence != null ? (item.confidence * 100).toFixed(0) + "%" : "—"}
                  </td>
                  <td className="p-2 text-slate-600 max-w-[160px] truncate" title={item.suggested_canonical_name}>
                    {item.suggested_canonical_name || "—"}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1 flex-wrap">
                      {status === "pending" && (<>
                        {item.suggested_canonical_id && (
                          <button
                            onClick={() => handleConfirm(item.id, item.suggested_canonical_id)}
                            className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded hover:bg-blue-200"
                          >
                            Confirm
                          </button>
                        )}
                        <button
                          onClick={() => handleDismiss(item.id)}
                          className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded hover:bg-slate-200"
                        >
                          Dismiss
                        </button>
                        <button
                          onClick={() => { setEditForm(null); setCreateForm({ queueItemId: item.id, rawName: item.raw_name, category: item.category, suggestedName: item.suggested_canonical_name }); setCreateFields({ name: item.raw_name || "", brand: "", baseProduct: "", productType: "", category: item.category || "Other" }); }}
                          className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded hover:bg-green-200"
                        >
                          Create
                        </button>
                      </>)}
                      {(status === "confirmed" || status === "dismissed") && item.suggested_canonical_id && (
                        <button
                          onClick={() => {
                            setCreateForm(null);
                            const slots = (s) => { try { return JSON.parse(s || "[]").map((g) => Array.isArray(g) ? g[0] : g).filter(Boolean).join(" "); } catch { return ""; } };
                            setEditFields({
                              brand: slots(item.brand_slots),
                              baseProduct: slots(item.base_product_slots),
                              productType: slots(item.type_slots),
                              category: item.canonical_category || item.category || "Other",
                            });
                            setEditForm({ canonicalId: item.suggested_canonical_id, rawName: item.raw_name, canonicalName: item.suggested_canonical_name });
                          }}
                          className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded hover:bg-amber-200"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 mt-3 items-center text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded border disabled:opacity-40"
          >
            Prev
          </button>
          <span>{page} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded border disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState("user");

  // Canonical Stats tab state
  const [canonicalStats, setCanonicalStats] = useState(null);
  const [canonicalLoading, setCanonicalLoading] = useState(false);
  const [canonicalError, setCanonicalError] = useState(null);

  // Mapped products sub-tab state
  const [mappedSubTab, setMappedSubTab] = useState("unmapped");
  const [mappedProducts, setMappedProducts] = useState(null);
  const [mappedLoading, setMappedLoading] = useState(false);
  const [mappedError, setMappedError] = useState(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [reprocessToast, setReprocessToast] = useState(null);

  // Brand manager draft state
  const [brandDraft, setBrandDraft] = useState(null);
  const [brandsDirty, setBrandsDirty] = useState(false);
  const [deletedBrandIds, setDeletedBrandIds] = useState(new Set());
  const [remapJobId, setRemapJobId] = useState(null);
  const [remapStatus, setRemapStatus] = useState(null);
  const [remapStats, setRemapStats] = useState(null);
  const [remapError, setRemapError] = useState(null);
  const [remapToast, setRemapToast] = useState(null);

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.accessToken && import.meta.env.PROD) {
      navigate("/", { replace: true });
      return;
    }

    fetchAdminStats()
      .then(setStats)
      .catch((err) => {
        const msg = String(err?.message || "");
        if (
          msg.includes("401") ||
          msg.includes("Missing") ||
          msg.includes("expired")
        ) {
          navigate("/", { replace: true });
        } else {
          setError(msg || "Failed to load dashboard");
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleLogout() {
    await logoutUser();
    navigate("/", { replace: true });
  }

  async function handleCanonicalTabOpen() {
    if (canonicalStats) return;
    setCanonicalLoading(true);
    setCanonicalError(null);
    try {
      const [cs, brands] = await Promise.all([
        fetchCanonicalStats(),
        fetchBrands(),
      ]);
      setCanonicalStats(cs);
      setBrandDraft(brands);
    } catch (err) {
      setCanonicalError(String(err?.message || "Failed to load"));
    } finally {
      setCanonicalLoading(false);
    }
  }

  function handleTabChange(newTab) {
    setTab(newTab);
    if (newTab === "canonical") handleCanonicalTabOpen();
  }

  async function loadMappedProducts() {
    setMappedLoading(true);
    setMappedError(null);
    try {
      const data = await fetchMappedProducts();
      setMappedProducts(data);
    } catch (err) {
      setMappedError(String(err?.message || "Failed to load"));
    } finally {
      setMappedLoading(false);
    }
  }

  function handleMappedTabOpen() {
    setMappedSubTab("mapped");
    if (!mappedProducts && !mappedLoading) loadMappedProducts();
  }

  function handleRetryMapped() {
    loadMappedProducts();
  }

  async function handleReprocessUnmapped() {
    setReprocessing(true);
    setReprocessToast(null);
    try {
      const result = await reprocessUnmapped();
      const s = result?.stats || {};
      setReprocessToast({
        type: "success",
        msg: `Done: ${s.mapped ?? 0} mapped · ${s.created ?? 0} new canonicals · ${s.manual_review ?? 0} queued for review`,
      });
      fetchCanonicalStats().then(setCanonicalStats).catch(() => {});
    } catch (err) {
      setReprocessToast({ type: "error", msg: String(err?.message || "Reprocess failed") });
    } finally {
      setReprocessing(false);
    }
  }

  function handleBrandFieldChange(index, field, value) {
    setBrandDraft((prev) =>
      prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
    );
    setBrandsDirty(true);
  }

  function handleAddBrand() {
    setBrandDraft((prev) => [...(prev || []), { id: null, _key: crypto.randomUUID(), name: "", aliases: [] }]);
    setBrandsDirty(true);
  }

  function handleAddBrandFromSuggestion(name) {
    setBrandDraft((prev) => [
      ...(prev || []),
      { id: null, _key: crypto.randomUUID(), name, aliases: [name.toLowerCase()] },
    ]);
    setBrandsDirty(true);
  }

  function handleDeleteBrand(index) {
    const brand = brandDraft[index];
    const label = brand.name?.trim() || "this brand";
    if (!window.confirm(`Remove "${label}" from the known brands list?`)) return;
    setBrandDraft((prev) => {
      const b = prev[index];
      if (b.id) {
        setDeletedBrandIds((ids) => new Set([...ids, b.id]));
      }
      return prev.filter((_, i) => i !== index);
    });
    setBrandsDirty(true);
  }

  function handleUndoDelete(brandId) {
    setDeletedBrandIds((ids) => {
      const next = new Set(ids);
      next.delete(brandId);
      return next;
    });
    setBrandsDirty(true);
  }

  async function handleSaveAndRemap() {
    setRemapStatus("running");
    setRemapError(null);
    setRemapToast(null);

    const finalBrands = (brandDraft || [])
      .filter((b) => !deletedBrandIds.has(b.id) && String(b.name).trim())
      .map((b) => ({
        name: String(b.name).trim(),
        aliases: Array.isArray(b.aliases)
          ? b.aliases
          : String(b.aliases || "")
              .split(",")
              .map((a) => a.trim().toLowerCase())
              .filter(Boolean),
      }));

    try {
      // Endpoint now runs synchronously and returns the result directly
      const result = await triggerBrandRemap(finalBrands);
      setBrandsDirty(false);

      if (result.status === "completed") {
        setRemapStatus("completed");
        setRemapStats(result.stats);
        setRemapToast(
          `${result.stats?.newlyMapped ?? 0} newly mapped · ` +
          `${result.stats?.canonicalsCreated ?? 0} canonicals created · ` +
          `${result.stats?.stillUnmapped ?? 0} still unmapped · ` +
          `${result.stats?.canonicalsDeleted ?? 0} canonicals deleted`,
        );
        const [freshStats, freshBrands] = await Promise.all([
          fetchCanonicalStats(),
          fetchBrands(),
        ]);
        setCanonicalStats(freshStats);
        setBrandDraft(freshBrands);
      } else {
        setRemapStatus("failed");
        setRemapError(result.error || "Remap failed");
      }
    } catch (err) {
      setRemapStatus(null);
      setRemapError(String(err?.message || "Failed to start remap"));
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-slate-900 font-extrabold text-xl mb-2">
            Access denied
          </div>
          <div className="text-slate-500 text-sm mb-6">{error}</div>
          <button
            onClick={() => navigate("/")}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!stats?.kpis) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-slate-900 font-extrabold text-xl mb-2">
            Unexpected response
          </div>
          <div className="text-slate-500 text-sm mb-6">
            The server returned an unexpected response. Make sure the backend is
            running and restart it.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    kpis,
    latest_crawl,
    recent_crawl_runs,
    signups_by_day,
    searches_by_day,
    top_search_terms,
    recent_searches,
    all_users,
  } = stats;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-slate-900 text-base">
              DesiDeals24
            </span>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold uppercase tracking-wide">
              Admin
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Tab bar */}
        <div className="max-w-6xl mx-auto px-6 flex gap-0">
          {[
            { id: "user",      label: "User Stats"      },
            { id: "crawl",     label: "Crawl Stats"     },
            { id: "canonical", label: "Canonical Stats" },
            { id: "queue",     label: "Review Queue"    },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className={`px-5 py-3 text-[13px] font-bold border-b-2 transition-colors ${
                tab === id
                  ? "border-green-600 text-green-700"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* ── Crawl Stats tab ── */}
        {tab === "crawl" && (
          <>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5 space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400">
                    Latest crawl
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 mt-1">
                    {latest_crawl?.crawl_date || "No crawl yet"}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Started {formatDateTime(latest_crawl?.started_at)}
                  </div>
                </div>
                <StatusPill status={latest_crawl?.status || "unknown"} />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Stores ok"
                  value={latest_crawl?.stores_succeeded ?? 0}
                />
                <KpiCard
                  label="Stores failed"
                  value={latest_crawl?.stores_failed ?? 0}
                />
                <KpiCard
                  label="Deals found"
                  value={latest_crawl?.deals_found ?? 0}
                />
                <KpiCard
                  label="Finished"
                  value={latest_crawl?.finished_at ? "Yes" : "No"}
                />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-6">
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
                      Store crawl report
                    </div>
                    {!latest_crawl?.store_results?.length ? (
                      <div className="text-slate-300 text-sm py-4">
                        No crawl store results yet
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {latest_crawl.store_results.map((store) => (
                          <div
                            key={`${latest_crawl.id}-${store.store_id}`}
                            className="rounded-2xl border border-slate-100 px-4 py-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[14px] font-bold text-slate-800">
                                  {store.store_name}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate">
                                  {store.store_url}
                                </div>
                              </div>
                              <StatusPill status={store.status} />
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                                  Scraped
                                </div>
                                <div className="text-base font-extrabold text-slate-900">
                                  {store.deals_scraped}
                                </div>
                              </div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                                  New
                                </div>
                                <div className="text-base font-extrabold text-slate-900">
                                  {store.deals_inserted}
                                </div>
                              </div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                                  Changed
                                </div>
                                <div className="text-base font-extrabold text-slate-900">
                                  {store.deals_updated}
                                </div>
                              </div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                                  Removed
                                </div>
                                <div className="text-base font-extrabold text-slate-900">
                                  {store.deals_removed}
                                </div>
                              </div>
                              <div className="rounded-xl bg-slate-50 px-3 py-2">
                                <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                                  History rows
                                </div>
                                <div className="text-base font-extrabold text-slate-900">
                                  {store.history_rows_written}
                                </div>
                              </div>
                            </div>

                            {store.error_message ? (
                              <div className="mt-3 text-[12px] text-red-600 bg-red-50 rounded-xl px-3 py-2">
                                {store.error_message}
                              </div>
                            ) : null}

                            <div className="mt-3 flex flex-wrap gap-2">
                              {Object.entries(store.category_counts || {})
                                .slice(0, 10)
                                .map(([category, count]) => (
                                  <span
                                    key={`${store.store_id}-${category}`}
                                    className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium"
                                  >
                                    {category} · {count}
                                  </span>
                                ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-100 px-4 py-4">
                    <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
                      Category totals
                    </div>
                    {!latest_crawl?.category_totals?.length ? (
                      <div className="text-slate-300 text-sm">
                        No category data yet
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {latest_crawl.category_totals.slice(0, 12).map((row) => (
                          <div
                            key={row.category}
                            className="flex items-center justify-between gap-3 text-sm"
                          >
                            <span className="text-slate-600">{row.category}</span>
                            <span className="font-extrabold text-[#16a34a]">
                              {row.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-100 px-4 py-4">
                    <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
                      Recent crawl runs
                    </div>
                    {!recent_crawl_runs?.length ? (
                      <div className="text-slate-300 text-sm">
                        No crawl history yet
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {recent_crawl_runs.map((run) => (
                          <div
                            key={run.id}
                            className="flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-slate-700">
                                {run.crawl_date || "No date"}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {run.stores_succeeded}/{run.stores_attempted} stores
                                · {run.deals_found} deals
                              </div>
                            </div>
                            <StatusPill status={run.status} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── User Stats tab ── */}
        {tab === "user" && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiCard label="Total users" value={kpis.total_users} />
              <KpiCard label="New users (30d)" value={kpis.new_users_30d} />
              <KpiCard label="Searches today" value={kpis.searches_today} />
              <KpiCard
                label="Unique searchers (30d)"
                value={kpis.unique_searchers_30d}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
                  Signups — last 30 days
                </div>
                <BarChart data={signups_by_day} />
              </div>
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
                  Searches — last 30 days
                </div>
                <BarChart data={searches_by_day} />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
                  Top search terms
                </div>
                {top_search_terms.length === 0 ? (
                  <div className="text-slate-300 text-sm py-4">No searches yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
                        <th className="pb-2 pr-3">#</th>
                        <th className="pb-2 pr-3">Query</th>
                        <th className="pb-2 text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {top_search_terms.map((term, i) => (
                        <tr
                          key={`${term.normalized_query}-${i}`}
                          className="border-b border-slate-50 last:border-0"
                        >
                          <td className="py-2.5 pr-3 text-slate-300 font-mono text-xs">
                            {i + 1}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="font-medium text-slate-700 text-[13px] truncate max-w-[240px]">
                              {term.query}
                            </div>
                            <div className="text-slate-400 text-[11px] truncate max-w-[240px]">
                              {term.unique_searchers} unique searchers
                            </div>
                          </td>
                          <td className="py-2.5 text-right font-extrabold text-[#16a34a]">
                            {term.search_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
                  Recent searches
                </div>
                {recent_searches.length === 0 ? (
                  <div className="text-slate-300 text-sm py-4">No searches yet</div>
                ) : (
                  <div className="space-y-3">
                    {recent_searches.map((search, index) => (
                      <div
                        key={`${search.created_at}-${search.query}-${index}`}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-slate-700 truncate">
                            {search.query}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">
                            {formatActorLabel(search)}
                            {search.result_count != null
                              ? ` · ${search.result_count} results`
                              : ""}
                          </div>
                          {search.created_at && (
                            <div className="text-[10px] text-slate-300 mt-0.5">
                              {new Date(search.created_at).toLocaleString("en-GB", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500">
                          Search
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
              <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
                All current users
              </div>
              {all_users.length === 0 ? (
                <div className="text-slate-300 text-sm py-4">No users yet</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
                        <th className="pb-2 pr-4">User</th>
                        <th className="pb-2 pr-4">Email</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Joined</th>
                        <th className="pb-2">Last login</th>
                      </tr>
                    </thead>
                    <tbody>
                      {all_users.map((user) => (
                        <tr
                          key={user.email}
                          className="border-b border-slate-50 last:border-0"
                        >
                          <td className="py-3 pr-4">
                            <div className="font-medium text-slate-700">
                              {user.name || user.email.split("@")[0]}
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-[12px] text-slate-500">
                            {user.email}
                          </td>
                          <td className="py-3 pr-4">
                            <UserStatusPill user={user} />
                          </td>
                          <td className="py-3 pr-4 text-[12px] text-slate-500">
                            {formatDateTime(user.created_at)}
                          </td>
                          <td className="py-3 text-[12px] text-slate-500">
                            {formatDateTime(user.last_login_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Canonical Stats tab ── */}
        {tab === "canonical" && (
          <CanonicalStatsTab
            loading={canonicalLoading}
            error={canonicalError}
            stats={canonicalStats}
            brandDraft={brandDraft}
            brandsDirty={brandsDirty}
            deletedBrandIds={deletedBrandIds}
            remapStatus={remapStatus}
            remapError={remapError}
            remapToast={remapToast}
            onBrandFieldChange={handleBrandFieldChange}
            onAddBrand={handleAddBrand}
            onAddBrandFromSuggestion={handleAddBrandFromSuggestion}
            onDeleteBrand={handleDeleteBrand}
            onUndoDelete={handleUndoDelete}
            onSaveAndRemap={handleSaveAndRemap}
            mappedSubTab={mappedSubTab}
            mappedProducts={mappedProducts}
            mappedLoading={mappedLoading}
            mappedError={mappedError}
            onMappedTabOpen={handleMappedTabOpen}
            onRetryMapped={handleRetryMapped}
            reprocessing={reprocessing}
            reprocessToast={reprocessToast}
            onReprocessUnmapped={handleReprocessUnmapped}
          />
        )}

        {tab === "queue" && (
          <ReviewQueueTab />
        )}

      </div>
    </div>
  );
}
