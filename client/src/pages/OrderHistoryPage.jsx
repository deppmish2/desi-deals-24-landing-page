import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchLists } from "../utils/api";
import { formatPrice } from "../utils/formatters";

const TABS = ["All Orders", "Pending", "Ordered", "Abandoned"];

const STATUS_CONFIG = {
  pending: {
    label: "Pending",
    color: "#d97706",
    bg: "#fef3c7",
  },
  ordered: {
    label: "Ordered",
    color: "#16a34a",
    bg: "rgba(22,163,74,0.1)",
  },
  abandoned: {
    label: "Abandoned",
    color: "#64748b",
    bg: "#f1f5f9",
  },
};

const STORE_PLACEHOLDER_COLORS = [
  "#f0fdf4",
  "#eff6ff",
  "#fdf4ff",
  "#fff7ed",
  "#f0f9ff",
];

function parseDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

function formatDate(value) {
  const d = parseDate(value);
  if (!d) return "Unknown date";
  return d.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getStatus(list) {
  const created = parseDate(list.created_at);
  if (!created) return "ordered";
  const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 2) return "pending";
  if (
    Number.isFinite(list.reorder_reminder_days) &&
    list.reorder_reminder_days > 0 &&
    ageDays > list.reorder_reminder_days
  ) {
    return "abandoned";
  }
  return "ordered";
}

function toOrderRow(list) {
  return {
    id: list.id,
    status: getStatus(list),
    title: list.name || "Smart Shopping List",
    orderNumber:
      String(list.id || "")
        .slice(0, 8)
        .toUpperCase() || "N/A",
    dateLabel: formatDate(list.created_at),
    itemCount: Number(list.items_count || 0),
    canCompare: Number(list.items_count || 0) > 0,
    storeName: list.store_name || null,
    totalPrice: list.total_price || null,
    savings: list.savings || null,
  };
}

function OrderCard({ order, onCompare, onOpenList, colorIdx }) {
  const cfg = STATUS_CONFIG[order.status] || STATUS_CONFIG.ordered;
  const bgColor =
    STORE_PLACEHOLDER_COLORS[colorIdx % STORE_PLACEHOLDER_COLORS.length];
  const isPending = order.status === "pending";
  const isOrdered = order.status === "ordered";
  const isAbandoned = order.status === "abandoned";

  return (
    <div
      className="bg-white border border-[#e2e8f0] rounded-[24px] overflow-hidden flex flex-col lg:flex-row"
      style={{ boxShadow: "0px 1px 4px rgba(0,0,0,0.06)" }}
    >
      {/* Left image panel */}
      <div
        className="lg:w-[260px] h-[140px] lg:h-auto shrink-0 relative flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        {/* Feedback required banner for pending */}
        {isPending && (
          <div className="absolute top-0 left-0 right-0 bg-[#fef3c7] flex items-center justify-center gap-1.5 py-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 1L1 10.5h10L6 1z"
                stroke="#d97706"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M6 5v2.5M6 9h.01"
                stroke="#d97706"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-[11px] font-bold text-[#d97706] uppercase tracking-[0.6px]">
              Feedback Required
            </span>
          </div>
        )}
        {/* Store icon placeholder */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 bg-white rounded-[16px] flex items-center justify-center shadow-sm">
            <span className="text-2xl">🛍️</span>
          </div>
          {order.storeName && (
            <span className="text-[12px] font-semibold text-[#475569]">
              {order.storeName}
            </span>
          )}
        </div>
      </div>

      {/* Right content */}
      <div className="flex-1 flex flex-col p-5 gap-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[17px] font-bold text-[#0f172a] truncate">
                {order.title}
              </h3>
              <span
                className="text-[11px] font-bold uppercase tracking-[0.5px] px-2.5 py-0.5 rounded-full shrink-0"
                style={{ color: cfg.color, backgroundColor: cfg.bg }}
              >
                {cfg.label}
              </span>
            </div>
            <p className="text-[13px] text-[#64748b] mt-0.5">
              Order #{order.orderNumber} &middot; {order.dateLabel}
            </p>
          </div>
        </div>

        {/* Order details */}
        <div className="flex items-center gap-6 flex-wrap">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-[#94a3b8] uppercase tracking-[0.4px]">
              Items
            </span>
            <span className="text-[15px] font-bold text-[#0f172a]">
              {order.itemCount}
            </span>
          </div>
          {order.totalPrice != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] text-[#94a3b8] uppercase tracking-[0.4px]">
                Total
              </span>
              <span className="text-[15px] font-bold text-[#0f172a]">
                {formatPrice(order.totalPrice)}
              </span>
            </div>
          )}
          {order.savings != null && Number(order.savings) > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] text-[#94a3b8] uppercase tracking-[0.4px]">
                Savings
              </span>
              <span className="text-[15px] font-bold text-[#16a34a]">
                {formatPrice(order.savings)}
              </span>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 flex-wrap border-t border-[#f8fafc] pt-4">
          <div className="flex items-center gap-2 flex-wrap">
            {isPending && (
              <>
                <button
                  onClick={() => onCompare(order)}
                  className="bg-[#16a34a] text-white font-bold text-[13px] px-4 py-2 rounded-full hover:bg-[#15803d] transition-colors"
                >
                  I already paid
                </button>
                <button className="border border-[#e2e8f0] text-[#475569] font-semibold text-[13px] px-4 py-2 rounded-full hover:bg-[#f8fafc] transition-colors">
                  Never ordered
                </button>
              </>
            )}
            {isOrdered && (
              <button className="bg-[#0f172a] text-white font-bold text-[13px] px-4 py-2 rounded-full hover:bg-[#1e293b] transition-colors">
                Reorder
              </button>
            )}
            {isAbandoned && (
              <button
                onClick={() => onCompare(order)}
                className="bg-[#16a34a] text-white font-bold text-[13px] px-4 py-2 rounded-full hover:bg-[#15803d] transition-colors"
              >
                Resume Order
              </button>
            )}
            <button
              onClick={onOpenList}
              className="border border-[#e2e8f0] text-[#475569] font-semibold text-[13px] px-4 py-2 rounded-full hover:bg-[#f8fafc] transition-colors"
            >
              Order Details
            </button>
          </div>

          {/* Add to Smart List */}
          <button
            className="flex items-center gap-1.5 text-[13px] font-semibold text-[#16a34a] px-3.5 py-2 rounded-full transition-colors"
            style={{ backgroundColor: "rgba(22,163,74,0.08)" }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path
                d="M6.5 1v11M1 6.5h11"
                stroke="#16a34a"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            Add to Smart List
          </button>
        </div>
      </div>
    </div>
  );
}

function Pagination({ current, total, onChange }) {
  if (total <= 1) return null;
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <div className="flex items-center justify-center gap-1.5">
      <button
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        className="w-9 h-9 flex items-center justify-center rounded-full border border-[#e2e8f0] text-[#475569] disabled:opacity-40 hover:border-[#16a34a] hover:text-[#16a34a] transition-colors"
      >
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
          <path
            d="M6 1L1 6l5 5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className="w-9 h-9 flex items-center justify-center rounded-full text-[13px] font-semibold transition-colors"
          style={
            p === current
              ? { backgroundColor: "#16a34a", color: "white" }
              : { border: "1px solid #e2e8f0", color: "#475569" }
          }
        >
          {p}
        </button>
      ))}
      <button
        disabled={current === total}
        onClick={() => onChange(current + 1)}
        className="w-9 h-9 flex items-center justify-center rounded-full border border-[#e2e8f0] text-[#475569] disabled:opacity-40 hover:border-[#16a34a] hover:text-[#16a34a] transition-colors"
      >
        <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
          <path
            d="M1 1l5 5-5 5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

const PAGE_SIZE = 8;

export default function OrderHistoryPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("All Orders");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetchLists()
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res?.data) ? res.data.map(toOrderRow) : [];
        setOrders(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        if (
          String(err?.message || "")
            .toLowerCase()
            .includes("401")
        ) {
          navigate("/login");
          return;
        }
        setError(err?.message || "Failed to load order history.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      const tabMatch =
        activeTab === "All Orders" || order.status === activeTab.toLowerCase();
      if (!tabMatch) return false;
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        order.title.toLowerCase().includes(q) ||
        order.orderNumber.toLowerCase().includes(q)
      );
    });
  }, [orders, activeTab, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const tabCounts = useMemo(
    () => ({
      "All Orders": orders.length,
      Pending: orders.filter((o) => o.status === "pending").length,
      Ordered: orders.filter((o) => o.status === "ordered").length,
      Abandoned: orders.filter((o) => o.status === "abandoned").length,
    }),
    [orders],
  );

  function handleCompare(order) {
    if (!order?.id || !order.canCompare) return;
    navigate(`/list/${order.id}/result`);
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-16">
      <div className="max-w-5xl mx-auto px-4 lg:px-8 pt-8 pb-12">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-[36px] font-black text-[#0f172a] leading-tight tracking-[-0.8px]">
            Order History
          </h1>
          <p className="text-[14px] text-[#64748b] mt-1">
            Track and manage your past orders and shopping lists
          </p>
        </div>

        {/* Search */}
        <div className="relative mb-5">
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
            placeholder="Search orders..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full bg-white border border-[#e2e8f0] rounded-[16px] pl-11 pr-4 py-3 text-[14px] text-[#0f172a] focus:outline-none focus:border-[#16a34a] transition-colors"
          />
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mb-6 bg-[#f1f5f9] p-1.5 rounded-[16px] w-fit">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setPage(1);
              }}
              className="shrink-0 px-4 py-2 rounded-[12px] text-[13px] font-semibold transition-all whitespace-nowrap"
              style={
                activeTab === tab
                  ? {
                      backgroundColor: "white",
                      color: "#0f172a",
                      boxShadow: "0px 1px 4px rgba(0,0,0,0.08)",
                    }
                  : { color: "#64748b" }
              }
            >
              {tab}
              {tabCounts[tab] > 0 && (
                <span
                  className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full"
                  style={
                    activeTab === tab
                      ? {
                          backgroundColor: "rgba(22,163,74,0.1)",
                          color: "#16a34a",
                        }
                      : { backgroundColor: "#e2e8f0", color: "#64748b" }
                  }
                >
                  {tabCounts[tab]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16">
            <p className="text-[#64748b] text-sm">Loading order history...</p>
          </div>
        ) : error ? (
          <div className="bg-white border border-[#e2e8f0] rounded-[20px] p-10 text-center">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-[#e2e8f0] rounded-[24px] p-12 text-center">
            <div className="w-16 h-16 bg-[#f8fafc] rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">📋</span>
            </div>
            <p className="text-[#0f172a] font-bold text-[16px]">
              No orders found
            </p>
            <p className="text-[#64748b] text-sm mt-1">
              Create a smart shopping list to see your order history here.
            </p>
            <button
              onClick={() => navigate("/list")}
              className="mt-4 bg-[#16a34a] text-white font-bold text-sm px-6 py-3 rounded-full hover:bg-[#15803d] transition-colors"
            >
              Go to Smart Shopping List
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 mb-8">
              {paginated.map((order, i) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  colorIdx={i}
                  onCompare={handleCompare}
                  onOpenList={() => navigate("/list")}
                />
              ))}
            </div>
            <Pagination current={page} total={totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}
