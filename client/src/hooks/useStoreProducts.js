import { useState, useEffect, useRef } from "react";
import { fetchDeals } from "../utils/api";
import {
  getBerlinDateKey,
  isDefaultDealsRequest,
  readCachedDefaultDeals,
  writeCachedDefaultDeals,
} from "../utils/defaultDealsCache.mjs";

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
    const shouldUseDefaultDealsCache = isDefaultDealsRequest(requestFilters);
    const requestParams = shouldUseDefaultDealsCache
      ? { ...requestFilters, cache_date: getBerlinDateKey() }
      : requestFilters;
    const cachedDefaultDeals = shouldUseDefaultDealsCache
      ? readCachedDefaultDeals()
      : null;

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

    setError(null);
    if (cachedDefaultDeals) {
      setDeals(cachedDefaultDeals.data || []);
      setPagination(cachedDefaultDeals.pagination || null);
      setMeta(cachedDefaultDeals.meta || null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    debounceRef.current = setTimeout(
      async () => {
        if (!cachedDefaultDeals) {
          setLoading(true);
        }
        try {
          const res = await fetchDeals(requestParams);
          if (requestIdRef.current !== requestId) return;
          setDeals(res.data || []);
          setPagination(res.pagination || null);
          setMeta(res.meta || null);
          if (shouldUseDefaultDealsCache) {
            writeCachedDefaultDeals(res);
          }

          // Auto-poll while a crawl is running so deals appear without manual refresh
          if (res.meta?.crawling) {
            pollRef.current = setTimeout(() => {
              if (requestIdRef.current === requestId) {
                setRetryCount((c) => c + 1);
              }
            }, CRAWL_POLL_INTERVAL);
          }
        } catch (e) {
          if (requestIdRef.current !== requestId) return;
          if (!cachedDefaultDeals) {
            setError(e.message);
          }
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
