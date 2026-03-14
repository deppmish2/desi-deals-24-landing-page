import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import DealsGrid from "../components/DealsGrid";

const SORT_OPTIONS = [
  { value: "discount_desc", label: "Best Discount" },
  { value: "price_asc", label: "Price: Low → High" },
  { value: "price_desc", label: "Price: High → Low" },
  { value: "newest", label: "Newest" },
];

export default function CategoryPage() {
  const { category } = useParams();
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("discount_desc");
  const [hideSoldOut, setHideSoldOut] = useState(false);

  const { deals, pagination, loading } = useDeals({
    category: decodeURIComponent(category),
    availability: hideSoldOut ? "in_stock" : "all",
    sort,
    page,
    limit: 24,
  });

  function handleSort(val) {
    setSort(val);
    setPage(1);
  }

  function handleHideSoldOut(val) {
    setHideSoldOut(val);
    setPage(1);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {decodeURIComponent(category)}
          </h1>
          {pagination && (
            <p className="text-sm text-text-secondary mt-1">
              {pagination.total} deals
            </p>
          )}
        </div>
        <Link
          to="/deals"
          className="text-sm text-text-secondary hover:text-primary shrink-0"
        >
          ← All Deals
        </Link>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-5 pb-4 border-b border-border">
        {/* Sort */}
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-text-secondary whitespace-nowrap">
            Sort by
          </label>
          <select
            value={sort}
            onChange={(e) => handleSort(e.target.value)}
            className="text-sm border border-border rounded-md px-2 py-1.5 bg-white text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Hide sold out toggle */}
        <button
          onClick={() => handleHideSoldOut(!hideSoldOut)}
          className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-md border transition-all ${
            hideSoldOut
              ? "bg-primary text-white border-primary"
              : "bg-white text-text-secondary border-border hover:border-primary hover:text-primary"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${hideSoldOut ? "bg-white" : "bg-error"}`}
          />
          Hide sold out
        </button>
      </div>

      <DealsGrid
        deals={deals}
        pagination={pagination}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  );
}
