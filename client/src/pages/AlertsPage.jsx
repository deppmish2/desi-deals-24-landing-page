import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAlerts, updateAlert, deleteAlert } from "../utils/api";
import { formatPrice } from "../utils/formatters";
import AlertModal from "../components/AlertModal";

function Toggle({ active, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        position: "relative",
        flexShrink: 0,
        width: 44,
        height: 24,
        borderRadius: 9999,
        backgroundColor: active ? "#16a34a" : "#e2e8f0",
        transition: "background-color 0.2s ease",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: active ? 22 : 2,
          width: 20,
          height: 20,
          backgroundColor: "white",
          borderRadius: 9999,
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          transition: "left 0.2s ease",
        }}
      />
    </button>
  );
}

function PriceDropIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7.5" fill="rgba(22,163,74,0.1)" />
      <path
        d="M5 10L8 7l3 3"
        stroke="#16a34a"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackInStockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7.5" fill="rgba(37,99,235,0.1)" />
      <path
        d="M5 8h6M8 5v6"
        stroke="#2563eb"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AlertCard({ alert, onToggle, onDelete, onEdit }) {
  const isPrice = alert.alert_type === "price" || alert.alert_type === "deal";
  const isActive = alert.is_active;

  return (
    <div
      className="bg-white border border-[#f1f5f9] rounded-[16px] flex flex-col overflow-hidden"
      style={{
        boxShadow: "0px 1px 4px rgba(0,0,0,0.06)",
        opacity: isActive ? 1 : 0.75,
      }}
    >
      {/* Card body */}
      <div className="flex gap-5 p-5">
        {/* Product image */}
        <div className="w-[90px] h-[90px] lg:w-[110px] lg:h-[110px] rounded-[16px] bg-[#f1f5f9] shrink-0 overflow-hidden flex items-center justify-center">
          <span className="text-4xl">🛒</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {/* Name row + toggle */}
          <div className="flex items-start justify-between gap-3">
            <p className="text-[15px] font-semibold text-[#0f172a] leading-[22px] line-clamp-2">
              {alert.product_query || alert.canonical_id || "Product Alert"}
            </p>
            <Toggle active={isActive} onChange={() => onToggle(alert)} />
          </div>

          {/* Status badge */}
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold uppercase tracking-[0.5px] px-2.5 py-0.5 rounded-full"
              style={
                isActive
                  ? { backgroundColor: "rgba(22,163,74,0.1)", color: "#16a34a" }
                  : { backgroundColor: "#fef3c7", color: "#d97706" }
              }
            >
              {isActive ? "Active" : "Paused"}
            </span>
          </div>

          {/* Alert type */}
          <div className="flex items-center gap-1.5">
            {isPrice ? <PriceDropIcon /> : <BackInStockIcon />}
            <span
              className="text-[13px] font-medium"
              style={{ color: isPrice ? "#16a34a" : "#2563eb" }}
            >
              {isPrice
                ? alert.target_price != null
                  ? `Price Drop Alert`
                  : `Discount Alert`
                : "Back in Stock Alert"}
            </span>
          </div>

          {/* Target price / discount */}
          {isPrice && alert.target_price != null && (
            <p className="text-[18px] font-black text-[#16a34a] leading-none">
              {formatPrice(alert.target_price)}
            </p>
          )}
          {isPrice && alert.min_discount_pct != null && (
            <p className="text-[18px] font-black text-[#0f172a] leading-none">
              {alert.min_discount_pct}%+ off
            </p>
          )}

          {/* Store */}
          <div className="flex items-center gap-1.5 text-[13px] text-[#64748b]">
            <svg width="13" height="12" viewBox="0 0 13 12" fill="none">
              <path
                d="M1 4.5L2.2 1.5h8.6L12 4.5M1 4.5v6a.75.75 0 00.75.75h9.5A.75.75 0 0012 10.5v-6M1 4.5h11"
                stroke="#94a3b8"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {alert.target_store_id || "Any Store"}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[#f8fafc] px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onEdit && onEdit(alert)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold text-[#475569] bg-[#f1f5f9] hover:bg-[#e2e8f0] transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path
                d="M7.5 1L10 3.5 3.5 10H1V7.5L7.5 1z"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            Edit
          </button>
          <button
            onClick={() => onDelete(alert)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold text-[#dc2626] bg-[#fef2f2] hover:bg-[#fee2e2] transition-colors"
          >
            <svg width="10" height="11" viewBox="0 0 10 11" fill="none">
              <path
                d="M1 3h8M3.5 3V2a.75.75 0 01.75-.75h1.5A.75.75 0 016.5 2v1M2 3l.6 6.5A.75.75 0 003.35 10.25h3.3a.75.75 0 00.75-.75L8 3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Delete
          </button>
        </div>
        <button className="text-[12px] font-semibold text-[#16a34a] hover:underline">
          View Product
        </button>
      </div>
    </div>
  );
}

export default function AlertsPage() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(10);

  async function load() {
    try {
      const res = await fetchAlerts();
      setAlerts(res?.data || []);
    } catch {
      navigate("/login");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleToggle(alert) {
    setError("");
    try {
      await updateAlert(alert.id, { is_active: !alert.is_active });
      await load();
    } catch (err) {
      setError(err.message || "Failed to update alert");
    }
  }

  async function handleDelete(alert) {
    setError("");
    try {
      await deleteAlert(alert.id);
      await load();
    } catch (err) {
      setError(err.message || "Failed to delete alert");
    }
  }

  const filtered = alerts.filter(
    (a) =>
      !search ||
      (a.product_query || "").toLowerCase().includes(search.toLowerCase()),
  );
  const activeCount = alerts.filter((a) => a.is_active).length;
  const visible = filtered.slice(0, visibleCount);

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20">
      {/* Desktop: full-width layout */}
      <div className="max-w-4xl mx-auto px-4 lg:px-8 pt-8 pb-12">
        {/* Page header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-[30px] font-black text-[#0f172a] leading-tight tracking-[-0.5px]">
              My Alerts
            </h1>
            <p className="text-[14px] text-[#64748b] mt-1">
              Manage your price drop and availability alerts
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 bg-[#16a34a] text-white font-bold text-[14px] px-5 py-2.5 rounded-full hover:bg-[#15803d] transition-colors"
            style={{ boxShadow: "0px 4px 12px rgba(22,163,74,0.25)" }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 1v10M1 6h10"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            New Alert
          </button>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-4 mb-6">
          <div className="bg-white border border-[#e2e8f0] rounded-[16px] px-5 py-3 flex items-center gap-3">
            <span className="text-[22px] font-black text-[#16a34a]">
              {activeCount}
            </span>
            <span className="text-[13px] text-[#64748b]">Active Alerts</span>
          </div>
          <div className="bg-white border border-[#e2e8f0] rounded-[16px] px-5 py-3 flex items-center gap-3">
            <span className="text-[22px] font-black text-[#0f172a]">
              {alerts.length}
            </span>
            <span className="text-[13px] text-[#64748b]">Total Alerts</span>
          </div>
        </div>

        {/* Search + filter row */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[#94a3b8]"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="7"
                cy="7"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <path
                d="M12 12l2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              placeholder="Search alerts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-[#e2e8f0] rounded-[24px] pl-11 pr-4 py-3 text-[14px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] transition-colors"
            />
          </div>
          <button className="flex items-center gap-2 bg-white border border-[#e2e8f0] rounded-[24px] px-4 py-3 text-[14px] font-semibold text-[#475569] hover:border-[#16a34a] hover:text-[#16a34a] transition-colors">
            <svg width="15" height="13" viewBox="0 0 15 13" fill="none">
              <path
                d="M1 2h13M3 6.5h9M5.5 11h4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            Filter
          </button>
        </div>

        {/* Error */}
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {/* Alerts list */}
        {loading ? (
          <div className="text-center py-16">
            <p className="text-[#64748b] text-sm">Loading alerts…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-[#e2e8f0] rounded-[24px] p-12 text-center">
            <div className="w-16 h-16 bg-[rgba(22,163,74,0.08)] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path
                  d="M14 4a10 10 0 100 20A10 10 0 0014 4zM14 9v5M14 18h.01"
                  stroke="#16a34a"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="text-[#0f172a] font-bold text-[16px]">
              No alerts yet
            </p>
            <p className="text-[#64748b] text-sm mt-1">
              Create your first alert to get notified when prices drop.
            </p>
            <button
              onClick={() => setModalOpen(true)}
              className="mt-4 bg-[#16a34a] text-white font-bold text-sm px-6 py-3 rounded-full hover:bg-[#15803d] transition-colors"
            >
              Create Alert
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4">
              {visible.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>

            {/* Load more */}
            {visibleCount < filtered.length && (
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => setVisibleCount((n) => n + 10)}
                  className="bg-white border border-[#e2e8f0] text-[#475569] font-semibold text-[14px] px-8 py-3 rounded-full hover:border-[#16a34a] hover:text-[#16a34a] transition-colors"
                >
                  Load More Alerts
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create alert modal */}
      {modalOpen && (
        <AlertModal
          deal={null}
          initialTab="price"
          onClose={() => {
            setModalOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}
