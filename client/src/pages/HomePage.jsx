import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import useStores from "../hooks/useStores";
import DealCard from "../components/DealCard";
import {
  buildDealsSearchPath,
  fetchCategories,
  fetchSuggestions,
  warmup,
} from "../utils/api";
import { setDealsNavSelected } from "../utils/deals-nav-selection";
import {
  formatPrice,
  formatPricePerKg,
  formatBestBefore,
} from "../utils/formatters";

const PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="%23F5F5F7" width="200" height="200"/><text fill="%23D2D2D7" font-size="48" text-anchor="middle" dominant-baseline="middle" x="100" y="100">🛒</text></svg>';

function MobileDealCard({ deal }) {
  const [imgError, setImgError] = useState(false);
  const proxyImg = deal.image_url
    ? `/api/v1/admin/proxy/image?url=${encodeURIComponent(deal.image_url)}`
    : null;

  function addToList() {
    try {
      const existing = JSON.parse(
        window.sessionStorage.getItem("dd24_smart_list_state_v1") || "[]",
      );
      const name = String(deal.product_name || "")
        .replace(/\b\d+(?:[.,]\d+)?\s*(kg|g|ml|l|pcs?)\b/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (
        name &&
        !existing.some(
          (i) =>
            String(i.raw_item_text || "").toLowerCase() === name.toLowerCase(),
        )
      ) {
        existing.push({
          raw_item_text: name,
          quantity: String(deal.weight_value || ""),
          quantity_unit: deal.weight_unit || "",
        });
        window.sessionStorage.setItem(
          "dd24_smart_list_state_v1",
          JSON.stringify(existing),
        );
      }
    } catch {}
  }

  return (
    <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden shadow-sm">
      {/* Image */}
      <div className="relative w-full h-48">
        <img
          src={imgError || !proxyImg ? PLACEHOLDER : proxyImg}
          alt={deal.product_name}
          loading="lazy"
          className="w-full h-full object-cover bg-[#f1f5f9]"
          onError={() => setImgError(true)}
        />
        {deal.best_before && (
          <span
            className="absolute top-2 left-2 text-white text-xs font-semibold px-2 py-1 rounded-lg"
            style={{ backgroundColor: "rgba(22,163,74,0.9)", fontSize: 10 }}
          >
            BEST BEFORE: {formatBestBefore(deal.best_before)}
          </span>
        )}
        {deal.discount_percent > 0 && (
          <span
            className="absolute top-2 right-2 text-white text-xs font-bold px-2 py-0.5 rounded"
            style={{ backgroundColor: "#dc2626" }}
          >
            -{Math.round(deal.discount_percent)}%
          </span>
        )}
        {/* Wishlist button */}
        <button
          type="button"
          onClick={addToList}
          className="absolute bottom-2 right-2 w-8 h-8 flex items-center justify-center rounded-full"
          style={{
            backgroundColor: "rgba(255,255,255,0.9)",
            backdropFilter: "blur(4px)",
          }}
          aria-label="Add to list"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"
              stroke="#16a34a"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {/* Content */}
      <div className="p-4">
        <p className="font-bold text-[#0f172a] text-base mb-0.5 line-clamp-2">
          {deal.product_name}
        </p>
        {deal.weight_raw && (
          <p className="text-xs text-[#64748b] mb-2">
            {deal.weight_raw}
            {deal.price_per_kg
              ? ` • ${formatPricePerKg(deal.price_per_kg)}`
              : ""}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-[#0f172a]">
              {formatPrice(deal.sale_price, deal.currency)}
            </span>
            {deal.original_price && (
              <span
                className="text-sm line-through"
                style={{ color: "#94a3b8" }}
              >
                {formatPrice(deal.original_price, deal.currency)}
              </span>
            )}
          </div>
          <button
            onClick={addToList}
            className="flex items-center gap-1.5 text-sm font-bold text-white px-4 py-2 rounded-xl"
            style={{ backgroundColor: "#16a34a" }}
          >
            Add to List
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeHeroSearch({ mobile = false }) {
  const navigate = useNavigate();
  const wrapperRef = useRef(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    const nextQuery = String(query || "").trim();

    if (nextQuery.length < 2) {
      setSuggestions([]);
      setLoading(false);
      setOpen(false);
      setActiveIndex(-1);
      return () => {};
    }

    setLoading(true);
    const timeoutId = setTimeout(() => {
      fetchSuggestions(nextQuery)
        .then((res) => {
          if (cancelled) return;
          const nextSuggestions = (
            Array.isArray(res?.suggestions) ? res.suggestions : []
          )
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 8);
          setSuggestions(nextSuggestions);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          setOpen(true);
          setActiveIndex(-1);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    function handleOutsideClick(event) {
      if (wrapperRef.current?.contains(event.target)) return;
      setOpen(false);
      setActiveIndex(-1);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  function submit(nextValue, options = {}) {
    const text = String(nextValue == null ? query : nextValue).trim();
    if (!text) return;
    const isSuggestionPick = Boolean(options?.fromSuggestion);
    const fromEnter = Boolean(options?.fromEnter);
    const baseSuggestions = suggestions
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const submitWithSuggestions = (cleanSuggestions) => {
      const useSuggestionBundle =
        isSuggestionPick || (fromEnter && cleanSuggestions.length > 0);
      const selectedForBundle = isSuggestionPick ? text : "";
      setDealsNavSelected(isSuggestionPick);
      setOpen(false);
      setActiveIndex(-1);
      navigate(
        buildDealsSearchPath(text, {
          bundle: useSuggestionBundle,
          selected: selectedForBundle,
          suggestions: cleanSuggestions,
        }),
      );
    };

    if (isSuggestionPick) {
      submitWithSuggestions(baseSuggestions);
      return;
    }

    fetchSuggestions(text)
      .then((res) => {
        const fetchedSuggestions = (
          Array.isArray(res?.suggestions) ? res.suggestions : []
        )
          .map((item) => String(item || "").trim())
          .filter(Boolean)
          .slice(0, 8);
        if (fetchedSuggestions.length > 0) {
          setSuggestions(fetchedSuggestions);
          submitWithSuggestions(fetchedSuggestions);
          return;
        }
        submitWithSuggestions(baseSuggestions);
      })
      .catch(() => {
        submitWithSuggestions(baseSuggestions);
      });
  }

  function clearQuery() {
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event) {
    if (event.key === "ArrowDown") {
      if (!open && suggestions.length > 0) {
        setOpen(true);
      }
      if (suggestions.length > 0) {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (suggestions.length > 0) {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (open && activeIndex >= 0 && suggestions[activeIndex]) {
      submit(suggestions[activeIndex], { fromSuggestion: true });
      return;
    }
    submit(null, { fromSuggestion: false, fromEnter: true });
  }

  const showDropdown = open && String(query || "").trim().length >= 2;

  const dropdown = showDropdown ? (
    <ul className="absolute left-0 right-0 top-full mt-2 bg-white border border-[#e2e8f0] rounded-xl shadow-lg z-40 overflow-hidden">
      {loading ? (
        <li className="px-4 py-2.5 text-sm text-[#64748b]">Searching...</li>
      ) : suggestions.length === 0 ? (
        <li className="px-4 py-2.5 text-sm text-[#64748b]">
          No suggestions found.
        </li>
      ) : (
        suggestions.map((suggestion, index) => (
          <li
            key={`${suggestion}-${index}`}
            onMouseDown={() => submit(suggestion, { fromSuggestion: true })}
            onMouseEnter={() => setActiveIndex(index)}
            className={`px-4 py-2.5 text-sm cursor-pointer ${
              index === activeIndex
                ? "bg-[#dcfce7] text-[#166534] font-medium"
                : "text-[#334155] hover:bg-[#f8fafc]"
            }`}
          >
            {suggestion}
          </li>
        ))
      )}
    </ul>
  ) : null;

  if (mobile) {
    return (
      <div ref={wrapperRef} className="relative">
        <div
          className="relative flex items-center bg-white rounded-xl border border-[#e2e8f0]"
          style={{ boxShadow: "0 10px 20px rgba(0,0,0,0.08)" }}
        >
          <svg
            className="absolute left-3 text-gray-400 shrink-0"
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
            placeholder="Search Desi essentials..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => {
              if (
                String(query || "").trim().length >= 2 &&
                suggestions.length > 0
              ) {
                setOpen(true);
              }
            }}
            onKeyDown={onKeyDown}
            className="w-full pl-9 pr-20 py-3 bg-transparent text-sm text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={clearQuery}
              className="absolute right-12 text-[#64748b] hover:text-[#0f172a]"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => submit(null, { fromEnter: true })}
            className="absolute right-2 flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
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
        {dropdown}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative max-w-[672px]">
      <div className="bg-white border-2 border-[#e2e8f0] rounded-[12px] flex items-center overflow-hidden shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)]">
        <svg
          className="ml-4 shrink-0 text-[#94a3b8]"
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
        >
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M14 14l3 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          placeholder="Search for deals"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => {
            if (
              String(query || "").trim().length >= 2 &&
              suggestions.length > 0
            ) {
              setOpen(true);
            }
          }}
          onKeyDown={onKeyDown}
          className="flex-1 px-3 py-[18px] text-[18px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none bg-transparent"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        />
        {query ? (
          <button
            type="button"
            onClick={clearQuery}
            className="text-[#64748b] hover:text-[#0f172a] px-2"
            aria-label="Clear search"
          >
            ✕
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => submit(null, { fromEnter: true })}
          className="bg-[#16a34a] text-white font-bold text-[16px] px-8 py-4 shrink-0 border-none"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Search
        </button>
      </div>
      {dropdown}
    </div>
  );
}

export default function HomePage() {
  const [categories, setCategories] = useState([]);
  const [shuffledDeals, setShuffledDeals] = useState([]);

  const { deals: topDeals, loading } = useDeals({
    sort: "discount_desc",
    limit: 20,
    availability: "in_stock",
  });

  const { stores } = useStores();

  useEffect(() => {
    fetchCategories()
      .then((r) => setCategories((r.data || []).slice(0, 8)))
      .catch(() => {});
    warmup().catch(() => {});
  }, []);

  useEffect(() => {
    if (topDeals.length > 0) {
      const shuffled = [...topDeals]
        .sort(() => Math.random() - 0.5)
        .slice(0, 8);
      setShuffledDeals(shuffled);
    }
  }, [topDeals]);

  const totalDeals = stores.reduce(
    (sum, s) => sum + (s.active_deals_count || 0),
    0,
  );
  const activeStores = stores.filter(
    (s) => (s.active_deals_count || 0) > 0,
  ).length;

  return (
    <div className="bg-white">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* Desktop hero: two-col */}
        <div className="hidden lg:flex max-w-[1200px] mx-auto px-8 py-20 gap-12 items-center">
          {/* Left */}
          <div className="flex-1 min-w-0 flex flex-col gap-6">
            {/* Search bar — Figma positions it at top */}
            <HomeHeroSearch />

            {/* Badge */}
            <span
              className="inline-flex items-center gap-2 text-[12px] font-bold uppercase px-3 py-1 rounded-full self-start tracking-[0.6px]"
              style={{
                backgroundColor: "rgba(22,163,74,0.1)",
                color: "#16a34a",
              }}
            >
              <svg width="9" height="11" viewBox="0 0 9 11" fill="none">
                <path
                  d="M4.5 1L8 5.5H5.5V10H3.5V5.5H1L4.5 1z"
                  fill="currentColor"
                />
              </svg>
              Live in 12+ European Countries
            </span>

            {/* Headline */}
            <h1
              className="text-[60px] font-extrabold text-[#141414] leading-none tracking-[-1.5px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Find the best <span style={{ color: "#16a34a" }}>Desi</span>
              <br />
              <span style={{ color: "#16a34a" }}>Deals</span> across Europe
            </h1>

            {/* Subtitle */}
            <p
              className="text-[18px] text-[#475569] leading-[28px] max-w-[512px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Save big on your favorite spices, lentils, and fresh produce from
              local Desi stores. Compare prices and build smart shopping
              lists.
            </p>

            {/* CTAs */}
            <div className="flex gap-4 pt-2">
              <Link
                to="/deals"
                className="inline-flex items-center gap-2 font-bold text-[16px] px-8 py-3 rounded-[8px] text-white no-underline"
                style={{
                  backgroundColor: "#16a34a",
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                }}
              >
                Explore Deals
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none">
                  <path
                    d="M1 8L8 1M8 1H3M8 1v5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </Link>
              <Link
                to="/list"
                className="inline-flex items-center font-bold text-[16px] px-8 py-3 rounded-[8px] text-[#0f172a] no-underline border border-[#e2e8f0] bg-white"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                How it Works
              </Link>
            </div>
          </div>

          {/* Right — hero visual */}
          <div className="flex-1 max-w-lg relative">
            <div
              className="w-full rounded-[16px] overflow-hidden shadow-[0px_25px_50px_-12px_rgba(0,0,0,0.25)]"
              style={{
                aspectRatio: "4/3",
                background:
                  "linear-gradient(135deg, #1a3a1a 0%, #2d5a2d 40%, #4a8c3f 70%, #6aaf4a 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 80,
              }}
            >
              🌶️
            </div>
            {/* Floating price-drop card */}
            <div
              className="absolute -bottom-6 -left-6 bg-white rounded-[12px] px-6 py-5 flex items-center gap-3 border border-[#f1f5f9]"
              style={{
                boxShadow:
                  "0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)",
              }}
            >
              <div className="flex items-center justify-center w-9 h-7 text-xl">
                📉
              </div>
              <div>
                <p className="text-[14px] font-bold text-[#0f172a] leading-[20px]">
                  Price Drop Alert
                </p>
                <p className="text-[12px] text-[#64748b] leading-[16px]">
                  Heera Basmati down by 15%
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile hero: Figma design */}
        <div
          className="lg:hidden px-4 pt-6 pb-8"
          style={{
            background:
              "linear-gradient(180deg, rgba(22,163,74,0.1) 0%, transparent 100%)",
          }}
        >
          <h1
            className="text-2xl font-bold text-[#0f172a] mb-1"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Fresh Desi Groceries
          </h1>
          <p className="text-base text-[#475569] mb-5">
            Find the best deals in your neighborhood
          </p>
          {/* Search bar */}
          <HomeHeroSearch mobile />
        </div>
      </section>

      {/* ── Top Deals ── */}
      <section className="bg-[#f1f5f9] py-16">
        <div className="max-w-[1280px] mx-auto px-10">
          <div className="flex items-end justify-between mb-10">
            <div>
              <h2
                className="text-[30px] font-bold text-[#141414] tracking-[-0.75px] leading-[36px]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                Top Deals
              </h2>
              <p className="text-[16px] text-[#64748b] leading-[24px] mt-2">
                Handpicked savings from your local stores
              </p>
            </div>
            <Link
              to="/deals"
              className="text-[16px] font-semibold no-underline flex items-center gap-1"
              style={{ color: "#16a34a" }}
            >
              View All Deals
              <svg width="5" height="8" viewBox="0 0 5 8" fill="none">
                <path
                  d="M1 1l3 3-3 3"
                  stroke="#16a34a"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          </div>

          {loading || (topDeals.length > 0 && shuffledDeals.length === 0) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-gray-100 overflow-hidden animate-pulse"
                >
                  <div className="bg-gray-100" style={{ aspectRatio: "4/3" }} />
                  <div className="p-3 space-y-2">
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                    <div className="h-4 bg-gray-100 rounded w-3/4" />
                    <div className="h-5 bg-gray-100 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : shuffledDeals.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200">
              <p className="text-4xl mb-3">🌿</p>
              <p className="font-semibold text-gray-700 mb-1">No deals yet</p>
              <p className="text-sm text-gray-500">
                Run{" "}
                <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">
                  npm run crawl
                </code>{" "}
                to fetch deals
              </p>
            </div>
          ) : (
            <>
              {/* Desktop: 3-col grid */}
              <div className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {shuffledDeals.slice(0, 3).map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    primaryAction="add_to_smart_list"
                  />
                ))}
              </div>

              {/* Mobile: vertical list cards */}
              <div className="sm:hidden space-y-3">
                {shuffledDeals.slice(0, 5).map((deal) => (
                  <MobileDealCard key={deal.id} deal={deal} />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* ── Why Shop ── */}
      <section className="py-16 lg:py-20">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-10">
          <div className="text-center mb-16 max-w-[672px] mx-auto">
            <h2
              className="text-[36px] font-extrabold text-[#0f172a] tracking-[-0.9px] leading-[40px] mb-4"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              Why Shop with DesiDeals24?
            </h2>
            <p
              className="text-[16px] text-[#475569] leading-[24px]"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              We take the guesswork out of grocery shopping. Save time and money
              with tools designed for the Desi community.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                icon: (
                  <svg width="33" height="24" viewBox="0 0 33 24" fill="none">
                    <rect
                      x="1"
                      y="8"
                      width="6"
                      height="15"
                      rx="1"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="10"
                      y="4"
                      width="6"
                      height="19"
                      rx="1"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="19"
                      y="1"
                      width="6"
                      height="22"
                      rx="1"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="28"
                      y="5"
                      width="4"
                      height="18"
                      rx="1"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                    />
                  </svg>
                ),
                title: "Compare Prices",
                desc: "Instantly find which store offers the lowest price for your essentials across all major European retailers.",
              },
              {
                icon: (
                  <svg width="30" height="23" viewBox="0 0 30 23" fill="none">
                    <rect
                      x="1"
                      y="1"
                      width="28"
                      height="21"
                      rx="3"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M7 7h16M7 11.5h12M7 16h8"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                ),
                title: "Smart Shopping Lists",
                desc: "Organize your pantry needs, share lists with family, and never miss an item during your weekend grocery run.",
              },
              {
                icon: (
                  <svg width="30" height="31" viewBox="0 0 30 31" fill="none">
                    <path
                      d="M15 3a8 8 0 018 8v4l2 3.5H5L7 15v-4a8 8 0 018-8z"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M11.5 24.5a3.5 3.5 0 007 0"
                      stroke="#16a34a"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <circle cx="23" cy="5" r="4" fill="#16a34a" />
                  </svg>
                ),
                title: "Store Alerts",
                desc: "Get personalized mobile notifications when your favorite brands or seasonal products go on sale nearby.",
              },
            ].map(({ icon, title, desc }) => (
              <div
                key={title}
                className="bg-white rounded-[16px] p-8 text-center border border-[#e2e8f0] flex flex-col items-center"
              >
                <div
                  className="flex items-center justify-center w-16 h-16 rounded-[16px] mb-6"
                  style={{ backgroundColor: "rgba(22,163,74,0.1)" }}
                >
                  {icon}
                </div>
                <h3
                  className="text-[20px] font-bold text-[#0f172a] mb-3"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {title}
                </h3>
                <p
                  className="text-[16px] text-[#64748b] leading-[24px]"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-gray-900 text-gray-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-3">
                <img
                  src="/logo.svg"
                  alt="DesiDeals24"
                  className="h-7 w-auto brightness-200"
                />
              </div>
              <p className="text-xs text-gray-400 leading-relaxed mb-4">
                Empowering the Desi diaspora in Europe to shop smarter and save
                more on their traditional favorites.
              </p>
              <div className="flex gap-3">
                {["𝕏", "📸", "💼"].map((s) => (
                  <span
                    key={s}
                    className="text-gray-500 cursor-pointer hover:text-gray-300 text-base"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
            {/* Company */}
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Company</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                {["About Us", "Partner Stores", "Careers", "Press Kit"].map(
                  (l) => (
                    <li key={l}>
                      <span className="hover:text-gray-200 cursor-pointer">
                        {l}
                      </span>
                    </li>
                  ),
                )}
              </ul>
            </div>
            {/* Support */}
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Support</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                {[
                  "Help Center",
                  "Contact Support",
                  "Store Registration",
                  "FAQs",
                ].map((l) => (
                  <li key={l}>
                    <Link
                      to="/contact"
                      className="hover:text-gray-200 no-underline text-gray-400"
                    >
                      {l}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            {/* Legal */}
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Legal</h4>
              <ul className="space-y-2 text-xs text-gray-400">
                {[
                  "Privacy Policy",
                  "Terms of Service",
                  "Cookie Policy",
                  "GDPR Compliance",
                ].map((l) => (
                  <li key={l}>
                    <span className="hover:text-gray-200 cursor-pointer">
                      {l}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-5 flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs text-gray-500">
              © 2024 DesiDeals24. All rights reserved.
            </p>
            <p className="text-xs text-gray-600">Powered by SmartCompany AI</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
