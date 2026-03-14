import React from "react";
import DealCard from "./DealCard";
import EmptyState from "./EmptyState";
import Pagination from "./Pagination";

export default function DealsGrid({
  deals,
  pagination,
  loading,
  onPageChange,
  emptyTitle,
  emptyMessage,
  primaryAction = "view_deal",
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="deal-card animate-pulse">
            <div className="aspect-square bg-gray-200" />
            <div className="p-3 space-y-2">
              <div className="h-3 bg-gray-200 rounded w-1/2" />
              <div className="h-4 bg-gray-200 rounded" />
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-5 bg-gray-200 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!deals?.length) {
    return <EmptyState title={emptyTitle} message={emptyMessage} />;
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {deals.map((deal) => (
          <DealCard
            key={deal.id}
            deal={deal}
            primaryAction={primaryAction}
            variant="desktop"
          />
        ))}
      </div>
      <Pagination pagination={pagination} onPageChange={onPageChange} />
    </div>
  );
}
