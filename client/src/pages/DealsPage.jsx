import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import useStores from "../hooks/useStores";
import FilterPanel from "../components/FilterPanel";
import DealsGrid from "../components/DealsGrid";
import {
  fetchCategories,
  fetchCrawlStatus,
  fetchSuggestions,
  warmup,
} from "../utils/api";
import { setDealsNavSelected } from "../utils/deals-nav-selection";
import { formatTimeAgo } from "../utils/formatters";

export default function DealsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState([]);
  const [crawlStatus, setCrawlStatus] = useState(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchInput, setSearchInput] = useState(
    () => searchParams.get("q") || "",
  );
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchSuggestLoading, setSearchSuggestLoading] = useState(false);
  const [searchSuggestOpen, setSearchSuggestOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const mobileSearchWrapperRef = useRef(null);
  const desktopSearchWrapperRef = useRef(null);

  const filters = {
    q: searchParams.get("q") || "",
    bundle: searchParams.get("bundle") || "",
    selected: searchParams.get("selected") || "",
    suggested: searchParams.get("suggested") || "",
    store: searchParams.get("store") || "",
    category: searchParams.get("category") || "",
    min_discount: searchParams.get("min_discount") || "",
    min_price: searchParams.get("min_price") || "",
    max_price: searchParams.get("max_price") || "",
    availability: searchParams.get("availability") || "in_stock",
    near_expiry: searchParams.get("near_expiry") || "",
    hide_expired: searchParams.get("hide_expired") || "",
    sort: searchParams.get("sort") || "discount_desc",
    page: parseInt(searchParams.get("page") || "1"),
    limit: 24,
  };

  const { deals, pagination, meta, loading } = useDeals(filters);
  const { stores } = useStores();
  const selectedStoreIds = String(filters.store || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const selectedCategories = String(filters.category || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  useEffect(() => {
    const query = String(filters.q || "");
    setSearchInput((current) => (current === query ? current : query));
  }, [filters.q]);

  useEffect(() => {
    fetchCategories()
      .then((r) => setCategories(r.data || []))
      .catch(() => {});
    fetchCrawlStatus()
      .then((s) => setCrawlStatus(s))
      .catch(() => {});
    // Trigger snapshot restore or background crawl if the DB is empty on this cold start
    warmup().catch(() => {});
  }, []);

  useEffect(() => {
    const query = String(searchInput || "").trim();
    let cancelled = false;
    if (query.length < 2) {
      setSearchSuggestions([]);
      setSearchSuggestLoading(false);
      setSearchSuggestOpen(false);
      setActiveSuggestionIndex(-1);
      return () => {};
    }

    setSearchSuggestLoading(true);
    const timeoutId = setTimeout(() => {
      fetchSuggestions(query)
        .then((res) => {
          if (cancelled) return;
          const suggestions = (
            Array.isArray(res?.suggestions) ? res.suggestions : []
          )
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 8);
          setSearchSuggestions(suggestions);
          setSearchSuggestOpen(true);
          setActiveSuggestionIndex(-1);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchSuggestions([]);
          setSearchSuggestOpen(true);
          setActiveSuggestionIndex(-1);
        })
        .finally(() => {
          if (!cancelled) setSearchSuggestLoading(false);
        });
    }, 45);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [searchInput]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (mobileSearchWrapperRef.current?.contains(event.target)) return;
      if (desktopSearchWrapperRef.current?.contains(event.target)) return;
      setSearchSuggestOpen(false);
      setActiveSuggestionIndex(-1);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  function updateFilters(updates) {
    const next = { ...Object.fromEntries(searchParams.entries()), ...updates };
    Object.keys(next).forEach((k) => {
      if (!next[k]) delete next[k];
    });
    setSearchParams(next);
  }

  function removeCsvFilterValue(field, value) {
    const current = String(filters[field] || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    const next = current.filter((entry) => entry !== String(value));
    updateFilters({ [field]: next.join(","), page: 1 });
  }

  const lastCrawl = meta?.last_crawl || crawlStatus?.finished_at;
  const isCrawling = meta?.crawling ?? false;

  function normalizeSuggestionList(values) {
    return (Array.isArray(values) ? values : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function applySearchTerm(term, options = {}) {
    const q = String(term == null ? searchInput : term).trim();
    const fromSuggestion = Boolean(options?.fromSuggestion);
    const fromEnter = Boolean(options?.fromEnter);
    const fallbackSuggestions = normalizeSuggestionList(searchSuggestions);

    if (!q) {
      setDealsNavSelected(false);
      setSearchInput("");
      setSearchSuggestions([]);
      updateFilters({
        q: "",
        availability: "in_stock",
        bundle: "",
        selected: "",
        suggested: "",
        page: 1,
      });
      setSearchSuggestOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }

    const applyWithSuggestions = (values) => {
      const cleanSuggestions = normalizeSuggestionList(values);
      const useSuggestionBundle =
        fromSuggestion || (fromEnter && cleanSuggestions.length > 0);
      const bundleValues = useSuggestionBundle
        ? (() => {
            const merged = [];
            const seen = new Set();
            const selectedForBundle = fromSuggestion ? q : "";
            for (const value of [selectedForBundle, ...cleanSuggestions]) {
              const text = String(value || "").trim();
              if (!text) continue;
              const key = text.toLowerCase();
              if (seen.has(key)) continue;
              seen.add(key);
              merged.push(text);
              if (merged.length >= 12) break;
            }
            if (merged.length === 0) {
              return { bundle: "", selected: "", suggested: "" };
            }
            return {
              bundle: "1",
              selected: fromSuggestion ? q || merged[0] : "",
              suggested: JSON.stringify(merged),
            };
          })()
        : { bundle: "", selected: "", suggested: "" };

      setDealsNavSelected(fromSuggestion);
      setSearchInput(q);
      updateFilters({
        q,
        availability: "in_stock",
        page: 1,
        ...bundleValues,
      });
      setSearchSuggestOpen(false);
      setActiveSuggestionIndex(-1);
    };

    if (fromSuggestion) {
      applyWithSuggestions(fallbackSuggestions);
      return;
    }

    if (fromEnter) {
      fetchSuggestions(q)
        .then((res) => {
          const fetched = normalizeSuggestionList(res?.suggestions);
          if (fetched.length > 0) {
            setSearchSuggestions(fetched);
            applyWithSuggestions(fetched);
            return;
          }
          applyWithSuggestions(fallbackSuggestions);
        })
        .catch(() => {
          applyWithSuggestions(fallbackSuggestions);
        });
      return;
    }

    applyWithSuggestions(fallbackSuggestions);
  }

  function clearSearchInput() {
    applySearchTerm("", { fromSuggestion: false });
  }

  function handleSearchKeyDown(event) {
    if (event.key === "ArrowDown") {
      if (!searchSuggestOpen && searchSuggestions.length > 0) {
        setSearchSuggestOpen(true);
      }
      if (searchSuggestions.length > 0) {
        event.preventDefault();
        setActiveSuggestionIndex((prev) =>
          Math.min(prev + 1, searchSuggestions.length - 1),
        );
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (searchSuggestions.length > 0) {
        event.preventDefault();
        setActiveSuggestionIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }
    if (event.key === "Escape") {
      setSearchSuggestOpen(false);
      setActiveSuggestionIndex(-1);
      return;
    }
    if (event.key !== "Enter") return;
    if (
      searchSuggestOpen &&
      activeSuggestionIndex >= 0 &&
      searchSuggestions[activeSuggestionIndex]
    ) {
      event.preventDefault();
      applySearchTerm(searchSuggestions[activeSuggestionIndex], {
        fromSuggestion: true,
      });
      return;
    }
    event.preventDefault();
    applySearchTerm(searchInput, { fromSuggestion: false, fromEnter: true });
  }

  return (
    <div className="bg-white min-h-screen">
      {/* Mobile header + search + filter chips */}
      <div className="lg:hidden border-b border-gray-100">
        {/* Mini header row */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-lg"
              style={{ backgroundColor: "#16a34a" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line
                  x1="3"
                  y1="6"
                  x2="21"
                  y2="6"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M16 10a4 4 0 01-8 0"
                  stroke="#fff"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span
              className="text-xl font-bold text-[#0f172a]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              DesiDeals24
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilterOpen(true)}
              className="p-2 text-[#475569] hover:text-[#0f172a]"
              aria-label="Filters"
            >
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <path
                  d="M3 5h14M6 10h8M9 15h2"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="px-4 pb-3">
          <div ref={mobileSearchWrapperRef} className="relative">
            <div className="relative flex items-center bg-[#f1f5f9] rounded-xl">
              <svg
                className="absolute left-3 text-[#94a3b8] shrink-0"
                width="16"
                height="16"
                viewBox="0 0 20 20"
                fill="none"
              >
                <circle
                  cx="9"
                  cy="9"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M14 14l3 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="search"
                placeholder="Search deals, groceries, or stores..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => {
                  if (String(searchInput || "").trim().length >= 2) {
                    setSearchSuggestOpen(true);
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                className="w-full pl-10 pr-20 py-3 bg-transparent text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none rounded-xl"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={clearSearchInput}
                  className="absolute right-11 text-[#64748b] hover:text-[#0f172a]"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  applySearchTerm(searchInput, {
                    fromSuggestion: false,
                    fromEnter: true,
                  })
                }
                className="absolute right-2 flex items-center justify-center w-8 h-8 rounded-lg"
                style={{ backgroundColor: "#16a34a" }}
                aria-label="Search deals"
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M3 6h14M6 10h8M9 14h2"
                    stroke="#fff"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            {searchSuggestOpen &&
              String(searchInput || "").trim().length >= 2 && (
                <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e2e8f0] rounded-xl shadow-lg z-40 overflow-hidden">
                  {searchSuggestLoading ? (
                    <li className="px-4 py-2.5 text-sm text-[#64748b]">
                      Searching...
                    </li>
                  ) : searchSuggestions.length === 0 ? (
                    <li className="px-4 py-2.5 text-sm text-[#64748b]">
                      No suggestions found.
                    </li>
                  ) : (
                    searchSuggestions.map((suggestion, index) => (
                      <li
                        key={`${suggestion}-${index}`}
                        onMouseDown={() =>
                          applySearchTerm(suggestion, { fromSuggestion: true })
                        }
                        onMouseEnter={() => setActiveSuggestionIndex(index)}
                        className={`px-4 py-2.5 text-sm cursor-pointer ${
                          index === activeSuggestionIndex
                            ? "bg-[#dcfce7] text-[#166534] font-medium"
                            : "text-[#334155] hover:bg-[#f8fafc]"
                        }`}
                      >
                        {suggestion}
                      </li>
                    ))
                  )}
                </ul>
              )}
          </div>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto px-4 pb-3 no-scrollbar">
          {/* Expiring Soon chip */}
          <button
            onClick={() =>
              updateFilters({
                near_expiry: filters.near_expiry === "1" ? "" : "1",
                page: 1,
              })
            }
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors"
            style={{
              backgroundColor: filters.near_expiry === "1" ? "#16a34a" : "#fff",
              color: filters.near_expiry === "1" ? "#fff" : "#475569",
              borderColor: filters.near_expiry === "1" ? "#16a34a" : "#e2e8f0",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
              <circle
                cx="10"
                cy="10"
                r="8"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M10 6v4l2.5 2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Expiring Soon
          </button>
          {/* Sort chip */}
          <select
            value={filters.sort}
            onChange={(e) => updateFilters({ sort: e.target.value, page: 1 })}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#e2e8f0] bg-white text-[#475569] focus:outline-none"
          >
            <option value="discount_desc">Max Discount</option>
            <option value="price_per_kg_asc">Lowest /Kg</option>
            <option value="price_asc">Lowest Price</option>
          </select>
          {/* Discount chip */}
          <select
            value={filters.min_discount}
            onChange={(e) =>
              updateFilters({ min_discount: e.target.value, page: 1 })
            }
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#e2e8f0] bg-white text-[#475569] focus:outline-none"
          >
            <option value="">Discount ▾</option>
            <option value="10">10%+</option>
            <option value="20">20%+</option>
            <option value="50">50%+</option>
            <option value="90">90%+</option>
          </select>
          {/* Max price chip */}
          <select
            value={filters.max_price}
            onChange={(e) =>
              updateFilters({ max_price: e.target.value, page: 1 })
            }
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#e2e8f0] bg-white text-[#475569] focus:outline-none"
          >
            <option value="">Max Price ▾</option>
            <option value="5">Under 5€</option>
            <option value="10">Under 10€</option>
            <option value="20">Under 20€</option>
          </select>
          {/* Stores chip */}
          <button
            onClick={() => setFilterOpen(true)}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border border-[#e2e8f0] bg-white text-[#475569]"
          >
            Stores ▾
          </button>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
        {/* Crawling banner */}
        {isCrawling && !loading && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-2.5 mb-6 text-sm text-orange-700">
            <svg
              className="animate-spin h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
              />
            </svg>
            <span>Fetching the latest deals — this takes about a minute.</span>
          </div>
        )}

        {/* Desktop search with recommendations */}
        <div className="hidden lg:block mb-6">
          <div ref={desktopSearchWrapperRef} className="relative max-w-[760px]">
            <div className="bg-white border-2 border-[#e2e8f0] rounded-[12px] flex items-center overflow-hidden shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.08),0px_4px_6px_-4px_rgba(0,0,0,0.08)]">
              <svg
                className="ml-4 shrink-0 text-[#94a3b8]"
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
              >
                <circle
                  cx="9"
                  cy="9"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M14 14l3 3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="search"
                placeholder="Search deals, groceries, or stores..."
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onFocus={() => {
                  if (String(searchInput || "").trim().length >= 2) {
                    setSearchSuggestOpen(true);
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                className="flex-1 px-3 py-[16px] text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none bg-transparent"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={clearSearchInput}
                  className="text-[#64748b] hover:text-[#0f172a] px-2"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  applySearchTerm(searchInput, {
                    fromSuggestion: false,
                    fromEnter: true,
                  })
                }
                className="bg-[#16a34a] text-white font-bold text-[15px] px-7 py-3.5 shrink-0 border-none"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Search
              </button>
            </div>
            {searchSuggestOpen &&
              String(searchInput || "").trim().length >= 2 && (
                <ul className="absolute left-0 right-0 top-full mt-2 bg-white border border-[#e2e8f0] rounded-xl shadow-lg z-40 overflow-hidden">
                  {searchSuggestLoading ? (
                    <li className="px-4 py-2.5 text-sm text-[#64748b]">
                      Searching...
                    </li>
                  ) : searchSuggestions.length === 0 ? (
                    <li className="px-4 py-2.5 text-sm text-[#64748b]">
                      No suggestions found.
                    </li>
                  ) : (
                    searchSuggestions.map((suggestion, index) => (
                      <li
                        key={`desktop-${suggestion}-${index}`}
                        onMouseDown={() =>
                          applySearchTerm(suggestion, { fromSuggestion: true })
                        }
                        onMouseEnter={() => setActiveSuggestionIndex(index)}
                        className={`px-4 py-2.5 text-sm cursor-pointer ${
                          index === activeSuggestionIndex
                            ? "bg-[#dcfce7] text-[#166534] font-medium"
                            : "text-[#334155] hover:bg-[#f8fafc]"
                        }`}
                      >
                        {suggestion}
                      </li>
                    ))
                  )}
                </ul>
              )}
          </div>
        </div>

        {/* Desktop filter bar — Figma pill design */}
        <div
          className="hidden lg:flex items-center gap-4 bg-white border border-[#e2e8f0] rounded-[32px] p-[17px] mb-12"
          style={{
            boxShadow:
              "0px 20px 25px -5px rgba(226,232,240,0.5),0px 8px 10px -6px rgba(226,232,240,0.5)",
          }}
        >
          {/* Filters pill button */}
          <button
            onClick={() => setFilterOpen(true)}
            className="shrink-0 flex items-center gap-2 bg-[#0f172a] text-white font-bold text-[14px] uppercase tracking-[0.7px] rounded-[24px] px-6 py-3"
            style={{
              boxShadow:
                "0px 10px 15px -3px rgba(15,23,42,0.1),0px 4px 6px -4px rgba(15,23,42,0.1)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path
                d="M3 5h14M6 10h8M9 15h2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Filters
            <svg width="9" height="6" viewBox="0 0 9 6" fill="none">
              <path
                d="M1 1l3.5 4L8 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Vertical divider */}
          <div className="bg-[#e2e8f0] w-px h-8 shrink-0" />

          {/* Active filter chips — only shown when a filter is active */}
          <div className="flex gap-2 items-center overflow-x-auto flex-1 min-w-0">
            {filters.availability === "in_stock" && (
              <button
                onClick={() => updateFilters({ availability: "all", page: 1 })}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "#f1f5f9",
                  borderColor: "transparent",
                  color: "#334155",
                }}
              >
                In Stock
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {filters.min_discount && (
              <button
                onClick={() => updateFilters({ min_discount: "", page: 1 })}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "rgba(22,163,74,0.1)",
                  borderColor: "rgba(22,163,74,0.2)",
                  color: "#16a34a",
                }}
              >
                {filters.min_discount}%+ Discount
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {filters.min_price && (
              <button
                onClick={() => updateFilters({ min_price: "", page: 1 })}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "rgba(22,163,74,0.1)",
                  borderColor: "rgba(22,163,74,0.2)",
                  color: "#16a34a",
                }}
              >
                From {filters.min_price}€
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {filters.max_price && (
              <button
                onClick={() => updateFilters({ max_price: "", page: 1 })}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "#f1f5f9",
                  borderColor: "transparent",
                  color: "#334155",
                }}
              >
                Under {filters.max_price}€
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {filters.near_expiry === "1" && (
              <button
                onClick={() => updateFilters({ near_expiry: "", page: 1 })}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "rgba(22,163,74,0.1)",
                  borderColor: "rgba(22,163,74,0.2)",
                  color: "#16a34a",
                }}
              >
                Expiring Soon
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {filters.hide_expired === "1" && (
              <button
                onClick={() => updateFilters({ hide_expired: "", page: 1 })}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "#f1f5f9",
                  borderColor: "transparent",
                  color: "#334155",
                }}
              >
                Hide Expired
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            {selectedStoreIds.map((storeId) => (
              <button
                key={`store-chip-${storeId}`}
                onClick={() => removeCsvFilterValue("store", storeId)}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "#f1f5f9",
                  borderColor: "transparent",
                  color: "#334155",
                }}
              >
                {stores.find((s) => s.id === storeId)?.name || storeId}
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ))}
            {selectedCategories.map((categoryName) => (
              <button
                key={`category-chip-${categoryName}`}
                onClick={() => removeCsvFilterValue("category", categoryName)}
                className="shrink-0 flex items-center gap-1.5 px-[17px] py-[9px] rounded-full text-[12px] font-bold border transition-colors"
                style={{
                  backgroundColor: "#f1f5f9",
                  borderColor: "transparent",
                  color: "#334155",
                }}
              >
                {categoryName}
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1 1l6 6M7 1L1 7"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            ))}
            {/* Clear all */}
            {(filters.min_discount ||
              filters.min_price ||
              filters.max_price ||
              filters.near_expiry ||
              filters.hide_expired ||
              filters.store ||
              filters.category) && (
              <button
                onClick={() =>
                  updateFilters({
                    availability: "in_stock",
                    min_discount: "",
                    min_price: "",
                    max_price: "",
                    near_expiry: "",
                    hide_expired: "",
                    store: "",
                    category: "",
                    page: 1,
                  })
                }
                className="shrink-0 text-[10px] font-extrabold uppercase tracking-[1px] text-[#94a3b8] px-2"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Results count */}
          {pagination && (
            <div className="shrink-0 flex flex-col items-start gap-0.5">
              <span className="text-[10px] font-extrabold uppercase tracking-[2px] text-[#94a3b8]">
                Results Found
              </span>
              <span className="text-[14px] font-bold text-[#0f172a]">
                {pagination.total} Items
              </span>
            </div>
          )}

          {/* Vertical divider */}
          <div className="bg-[#e2e8f0] w-px h-8 shrink-0" />

          {/* Sort */}
          <select
            value={filters.sort}
            onChange={(e) => updateFilters({ sort: e.target.value, page: 1 })}
            className="shrink-0 text-[14px] font-bold text-[#334155] bg-transparent focus:outline-none cursor-pointer pr-2"
          >
            <option value="discount_desc">Sort: Max Discount</option>
            <option value="price_per_kg_asc">Sort: Lowest /Kg Price</option>
            <option value="price_asc">Sort: Lowest Price</option>
          </select>
        </div>

        {/* Mobile results count */}
        <div className="lg:hidden flex items-baseline justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-[#0f172a]">
              {filters.q ? `Results for "${filters.q}"` : "Active Deals"}
            </h1>
            {pagination && (
              <p className="text-sm text-[#64748b] mt-0.5">
                {pagination.total} results
              </p>
            )}
          </div>
          <button
            className="text-sm font-medium flex items-center gap-1.5 border rounded-full px-3 py-1.5"
            style={{ color: "#16a34a", borderColor: "#16a34a" }}
            onClick={() => setFilterOpen(true)}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path
                d="M3 5h14M6 10h8M9 15h2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            Filters
          </button>
        </div>

        <DealsGrid
          deals={deals}
          pagination={pagination}
          loading={loading}
          primaryAction="add_to_smart_list"
          onPageChange={(p) => updateFilters({ page: p })}
          emptyTitle={isCrawling ? "Fetching deals..." : undefined}
          emptyMessage={
            isCrawling
              ? "Deals are being collected. This page will refresh automatically in about 15 seconds."
              : undefined
          }
        />
      </div>

      {/* Mobile filter drawer */}
      {filterOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="bg-black/40 flex-1"
            onClick={() => setFilterOpen(false)}
          />
          <div className="bg-white w-72 h-full overflow-y-auto shadow-xl">
            <FilterPanel
              filters={filters}
              onChange={(u) => {
                updateFilters(u);
              }}
              onClose={() => setFilterOpen(false)}
              stores={stores.filter((s) => (s.active_deals_count || 0) > 0)}
              categories={categories}
            />
          </div>
        </div>
      )}

      {/* Desktop filter modal */}
      {filterOpen && (
        <div
          className="hidden lg:flex fixed inset-0 z-50 items-center justify-center p-4"
          style={{
            backgroundColor: "rgba(20,20,20,0.4)",
            backdropFilter: "blur(2px)",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFilterOpen(false);
          }}
        >
          <div style={{ boxShadow: "0px 25px 50px -12px rgba(0,0,0,0.25)" }}>
            <FilterPanel
              filters={filters}
              onChange={(u) => {
                updateFilters(u);
              }}
              onClose={() => setFilterOpen(false)}
              stores={stores.filter((s) => (s.active_deals_count || 0) > 0)}
              categories={categories}
            />
          </div>
        </div>
      )}
    </div>
  );
}
