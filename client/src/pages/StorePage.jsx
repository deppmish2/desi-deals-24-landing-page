import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import DealsGrid from "../components/DealsGrid";
import { fetchStore } from "../utils/api";
import { formatPrice } from "../utils/formatters";

export default function StorePage() {
  const { storeId } = useParams();
  const [store, setStore] = useState(null);
  const [page, setPage] = useState(1);

  const { deals, pagination, loading } = useDeals({
    store: storeId,
    availability: "all",
    sort: "discount_desc",
    page,
    limit: 24,
  });

  useEffect(() => {
    fetchStore(storeId)
      .then((s) => setStore(s))
      .catch(() => {});
  }, [storeId]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Store header */}
      <div className="bg-card rounded-xl border border-border p-6 mb-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center text-2xl shrink-0">
            🏪
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-near-black">
              {store?.name || storeId}
            </h1>
            {store?.url && (
              <a
                href={store.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                {store.url}
              </a>
            )}
            <div className="flex items-center gap-4 mt-2 text-sm text-text-secondary">
              <span>{pagination?.total ?? deals.length} active deals</span>
              <span
                className={`flex items-center gap-1 ${store?.crawl_status === "active" ? "text-success" : "text-gray-400"}`}
              >
                <span
                  className={`w-2 h-2 rounded-full inline-block ${store?.crawl_status === "active" ? "bg-success" : "bg-gray-300"}`}
                />
                {store?.crawl_status || "active"}
              </span>
            </div>
          </div>
          <Link
            to="/deals"
            className="text-sm text-text-secondary hover:text-primary shrink-0"
          >
            ← All Deals
          </Link>
        </div>

        {/* Store info fields — only shown when populated */}
        {store &&
          (store.free_shipping_min ||
            store.address ||
            store.contact_phone ||
            store.contact_email) && (
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {store.free_shipping_min != null && (
                <div className="flex items-start gap-2">
                  <span className="text-base">🚚</span>
                  <div>
                    <span className="font-medium text-text-primary">
                      Free shipping
                    </span>
                    <span className="text-text-secondary">
                      {" "}
                      from {formatPrice(store.free_shipping_min)}
                    </span>
                  </div>
                </div>
              )}
              {store.address && (
                <div className="flex items-start gap-2">
                  <span className="text-base">📍</span>
                  <span className="text-text-secondary">{store.address}</span>
                </div>
              )}
              {store.contact_phone && (
                <div className="flex items-start gap-2">
                  <span className="text-base">📞</span>
                  <a
                    href={`tel:${store.contact_phone}`}
                    className="text-primary hover:underline"
                  >
                    {store.contact_phone}
                  </a>
                </div>
              )}
              {store.contact_email && (
                <div className="flex items-start gap-2">
                  <span className="text-base">✉️</span>
                  <a
                    href={`mailto:${store.contact_email}`}
                    className="text-primary hover:underline"
                  >
                    {store.contact_email}
                  </a>
                </div>
              )}
            </div>
          )}
      </div>

      <DealsGrid
        deals={deals}
        pagination={pagination}
        loading={loading}
        onPageChange={setPage}
        emptyTitle="No active offers right now"
        emptyMessage="Seems there are no active offers at the moment. Come back tomorrow."
      />
    </div>
  );
}
