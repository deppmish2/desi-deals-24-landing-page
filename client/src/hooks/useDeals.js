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
  const requestIdRef = useRef(0);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    clearTimeout(pollRef.current);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

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
          if (requestIdRef.current !== requestId) return;
          setDeals(res.data || []);
          setPagination(res.pagination || null);
          setMeta(res.meta || null);

          // Auto-poll while a crawl is running so deals appear without manual refresh
          if (res.meta?.crawling) {
            pollRef.current = setTimeout(
              () => {
                if (requestIdRef.current === requestId) {
                  setRetryCount((c) => c + 1);
                }
              },
              CRAWL_POLL_INTERVAL,
            );
          }
        } catch (e) {
          if (requestIdRef.current !== requestId) return;
          setError(e.message);
        } finally {
          if (requestIdRef.current === requestId) {
            setLoading(false);
          }
        }
      },
      requestFilters.q ? 400 : 0,
    );

    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(pollRef.current);
    };
  }, [enabled, JSON.stringify(requestFilters), retryCount]);

  return { deals, pagination, meta, loading, error };
}
