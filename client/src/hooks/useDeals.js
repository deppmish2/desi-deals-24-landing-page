import { useState, useEffect, useRef } from "react";
import { fetchDeals } from "../utils/api";

const CRAWL_POLL_INTERVAL = 15000; // re-fetch every 15s while a crawl is running

export default function useDeals(filters = {}) {
  const { enabled = true, ...requestFilters } = filters || {};
  const [deals, setDeals] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const debounceRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    clearTimeout(pollRef.current);

    if (!enabled) {
      setDeals([]);
      setPagination(null);
      setMeta(null);
      setLoading(false);
      setError(null);
      return () => {
        clearTimeout(debounceRef.current);
        clearTimeout(pollRef.current);
      };
    }

    debounceRef.current = setTimeout(
      async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await fetchDeals(requestFilters);
          setDeals(res.data || []);
          setPagination(res.pagination || null);
          setMeta(res.meta || null);

          // Auto-poll while a crawl is running so deals appear without manual refresh
          if (res.meta?.crawling) {
            pollRef.current = setTimeout(
              () => setRetryCount((c) => c + 1),
              CRAWL_POLL_INTERVAL,
            );
          }
        } catch (e) {
          setError(e.message);
        } finally {
          setLoading(false);
        }
      },
      requestFilters.q ? 60 : 0,
    );

    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(pollRef.current);
    };
  }, [enabled, JSON.stringify(requestFilters), retryCount]);

  return { deals, pagination, meta, loading, error };
}
