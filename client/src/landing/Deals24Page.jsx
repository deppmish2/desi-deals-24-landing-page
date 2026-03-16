import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import {
  formatBestBefore,
  formatPrice,
  formatPricePerKg,
} from "../utils/formatters";
import { getAuthSession, logoutUser, postContact } from "../utils/api";
import { fetchWaitlistMe } from "../utils/api";
import {
  computeNextRefreshUtcMs,
  formatRefreshCountdown,
  getCurrentPoolDateSeed,
} from "./dealsRefreshSchedule";
import Deals24Header from "./Deals24Header";

const HERO_BG_FIGMA_FALLBACK =
  "https://www.figma.com/api/mcp/asset/2b35ea12-fe60-4ff9-80df-1719cfc2f3f2";
const HERO_BG_LOCAL_JPG = "/landing/50-eur-savings.jpg";
const HERO_BG_LOCAL_WEBP = "/landing/50-eur-savings.webp";
const TODAY_COUNT = 24;

function hasDealsMembership(status) {
  const userType = String(status?.user_type || "")
    .trim()
    .toLowerCase();
  return (
    Boolean(status?.unlocked) &&
    (userType === "basic" || userType === "premium")
  );
}

function inferFeedbackName(user) {
  const email = String(user?.email || "").trim();
  const local = email.includes("@") ? email.split("@")[0] : email;
  const normalized = local.replace(/[._-]+/g, " ").trim();
  if (!normalized) return "DesiDeals24 member";
  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatPoolDate(poolDate) {
  const value = String(poolDate || "").trim();
  if (!value) return "today";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function ArrowSmallIcon({ className }) {
  return (
    <svg
      width="9"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5 12h12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WhatsAppIcon({ className }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width="18"
      height="18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M16 3C9.383 3 4 8.383 4 15c0 2.285.643 4.496 1.86 6.424L4 29l7.737-1.812A11.9 11.9 0 0016 27c6.617 0 12-5.383 12-12S22.617 3 16 3z"
        fill="currentColor"
      />
      <path
        d="M12.35 9.65c-.26-.585-.534-.597-.782-.607l-.667-.012c-.233 0-.61.087-.93.427-.32.34-1.22 1.19-1.22 2.907 0 1.717 1.25 3.377 1.424 3.61.173.233 2.41 3.86 5.945 5.258 2.936 1.161 3.537.93 4.173.87.637-.058 2.054-.84 2.344-1.65.29-.81.29-1.505.203-1.65-.087-.145-.32-.233-.667-.407-.347-.173-2.054-1.015-2.373-1.131-.32-.116-.552-.174-.785.173-.233.347-.9 1.131-1.104 1.364-.203.233-.407.262-.753.088-.347-.174-1.463-.54-2.786-1.72-1.03-.918-1.724-2.052-1.928-2.398-.203-.347-.021-.534.153-.707.156-.156.347-.407.52-.61.174-.204.233-.347.35-.58.116-.233.058-.437-.03-.61-.086-.174-.774-1.916-1.062-2.558z"
        fill="#fff"
      />
    </svg>
  );
}

function inferShareHeadline(productName) {
  const name = String(productName || "").trim().toLowerCase();
  if (/\batta\b/.test(name)) return "Atta Deal";
  if (/\brice\b|\bbasmati\b/.test(name)) return "Rice Deal";
  if (/\bspice\b|\bspices\b|\bmasala\b|\bmirch\b|\bchili\b|\bchilli\b|\bhaldi\b|\bturmeric\b|\bjeera\b|\bcumin\b|\bdhaniya\b|\bcoriander\b/.test(name)) {
    return "Spices Deal";
  }
  return "Deal";
}

function RefreshCountdown({ countdownLabel }) {
  const [hours = "00", minutes = "00", seconds = "00"] = String(
    countdownLabel || "00:00:00",
  ).split(":");

  return (
    <div
      className="bg-white/90 backdrop-blur-md border border-slate-200 rounded-[22px] px-4 sm:px-6 py-4 flex items-center gap-3 sm:gap-6 w-full sm:w-auto"
      style={{
        boxShadow:
          "0px 20px 40px rgba(15,23,42,0.10), 0px 1px 2px rgba(15,23,42,0.06)",
      }}
      aria-label="Deals expiry countdown"
    >
      <div className="pr-1 sm:pr-2 shrink-0">
        <div className="text-slate-800 font-bold text-[14px] sm:text-[18px] leading-snug">
          Deals expire in
        </div>
      </div>

      <div className="h-8 sm:h-10 w-px bg-slate-200 shrink-0" aria-hidden="true" />

      <div className="flex items-center gap-3 sm:gap-6 flex-1 justify-between sm:justify-start">
        {[
          { label: "HRS", fullLabel: "HOURS", value: hours },
          { label: "MIN", fullLabel: "MINUTES", value: minutes },
          { label: "SEC", fullLabel: "SECONDS", value: seconds },
        ].map((item, idx) => (
          <div key={item.label} className="flex items-center gap-3 sm:gap-6">
            <div className="text-center">
              <div className="text-[#16a34a] font-extrabold text-[32px] sm:text-[44px] leading-none tracking-[-1px]">
                {item.value}
              </div>
              <div className="text-slate-400 font-bold text-[9px] sm:text-[12px] tracking-[1.5px] sm:tracking-[2.2px] uppercase mt-1 sm:mt-2">
                <span className="sm:hidden">{item.label}</span>
                <span className="hidden sm:inline">{item.fullLabel}</span>
              </div>
            </div>
            {idx < 2 ? (
              <div className="text-slate-200 text-[20px] sm:text-[28px] leading-none font-bold -mt-3 sm:-mt-4 select-none">
                :
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroImage() {
  const [fallback, setFallback] = useState(false);

  if (fallback) {
    return (
      <img
        src={HERO_BG_FIGMA_FALLBACK}
        alt=""
        className="absolute inset-0 size-full object-cover object-center pointer-events-none"
      />
    );
  }

  return (
    <picture>
      <source srcSet={HERO_BG_LOCAL_WEBP} type="image/webp" />
      <img
        src={HERO_BG_LOCAL_JPG}
        alt=""
        className="absolute inset-0 size-full object-cover object-center pointer-events-none"
        onError={() => setFallback(true)}
        loading="eager"
        decoding="async"
      />
    </picture>
  );
}


function proxyImageUrl(imageUrl) {
  if (!imageUrl) return null;
  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

function storeKeyForDeal(deal) {
  return String(deal?.store?.name || "")
    .trim()
    .toLowerCase();
}

function pickDealsUniqueStores(deals, count) {
  const picked = [];
  const remainder = [];
  const seenStores = new Set();

  for (const deal of deals) {
    if (picked.length >= count) break;
    const key = storeKeyForDeal(deal);
    if (!key) {
      remainder.push(deal);
      continue;
    }
    if (seenStores.has(key)) {
      remainder.push(deal);
      continue;
    }
    seenStores.add(key);
    picked.push(deal);
  }

  if (picked.length >= count) return picked;

  for (const deal of remainder) {
    if (picked.length >= count) break;
    picked.push(deal);
  }

  return picked;
}

function Deals24Card({ deal, number, showBestBefore = true }) {
  const [imgError, setImgError] = useState(false);
  const proxyImg = proxyImageUrl(deal?.image_url);
  const discountPct = deal?.discount_percent
    ? Math.round(deal.discount_percent)
    : null;
  const bestBeforeText = showBestBefore && deal?.best_before
    ? formatBestBefore(deal.best_before)
    : null;

  const priceText = formatPrice(deal.sale_price, deal.currency);
  const originalPriceText = deal.original_price
    ? formatPrice(deal.original_price, deal.currency)
    : null;

  const weightText = [
    deal.weight_raw || null,
    deal.price_per_kg ? formatPricePerKg(deal.price_per_kg) : null,
  ]
    .filter(Boolean)
    .join(" | ");

  function buildShareMessage() {
    const name = deal?.name || deal?.title || "this product";
    const price = priceText || "";
    const orig = originalPriceText ? ` (was ${originalPriceText})` : "";
    return `how is ${name} only ${price}??${orig}\nfound it on DesiDeals24\nhttps://desideals24.com/24deals`;
  }

  function shareOnWhatsApp(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const text = buildShareMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function resolveUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    const storeBase = String(deal?.store?.url || "").replace(/\/+$/, "");
    return storeBase ? `${storeBase}${raw.startsWith("/") ? "" : "/"}${raw}` : raw;
  }

  function goToRedirect(event) {
    event?.preventDefault?.();
    const url = resolveUrl(deal?.product_url);
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className="bg-white border border-[#f1f5f9] rounded-[20px] flex flex-col overflow-hidden"
      style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
    >
      {/* Image area */}
      <div className="relative w-full h-[220px] bg-white flex items-center justify-center p-6">
        <img
          src={
            imgError || !proxyImg
              ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">🛒</text></svg>'
              : proxyImg
          }
          alt={deal.product_name}
          loading="lazy"
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />

        {/* Discount badge — top right */}
        {discountPct > 0 ? (
          <div
            className="absolute top-3 right-3 rounded-[8px] px-2.5 py-1"
            style={{
              backgroundColor:
                discountPct > 50 ? "#ffe4e8" :
                discountPct >= 30 ? "#fff3e0" :
                discountPct >= 20 ? "#e8f0fe" :
                "#f1f5f9",
            }}
          >
            <span
              className="font-bold text-[13px] leading-none"
              style={{
                color:
                  discountPct > 50 ? "#e53e3e" :
                  discountPct >= 30 ? "#c05200" :
                  discountPct >= 20 ? "#1a56db" :
                  "#1e293b",
              }}
            >
              -{discountPct}%
            </span>
          </div>
        ) : null}

        {/* Deal number — top left */}
        {Number.isFinite(number) ? (
          <span
            className="absolute top-3 left-3 rounded-full px-2 py-0.5 text-[10px] leading-[15px] font-extrabold tracking-[1px] text-slate-500 border border-slate-200 bg-white/80 backdrop-blur"
            aria-label={`Deal number ${number}`}
          >
            #{number}
          </span>
        ) : null}

        {/* Best before — bottom left */}
        {bestBeforeText ? (
          <span className="absolute bottom-3 left-3 bg-[#d5890f] text-white text-[10px] leading-[15px] font-medium rounded-full px-2 py-0.5">
            {bestBeforeText}
          </span>
        ) : null}
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 px-5 pt-4 pb-5 gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[#94a3b8] text-[10px] leading-[15px] tracking-[1.5px] uppercase font-extrabold">
            {deal.store?.name || "Store"}
          </p>
          <p className="text-[#1e293b] text-[15px] leading-[22px] font-bold line-clamp-2 min-h-[44px]">
            {deal.product_name}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[#1e293b] text-[22px] leading-[30px] font-extrabold">
                {priceText}
              </span>
              {originalPriceText ? (
                <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">
                  {originalPriceText}
                </span>
              ) : null}
            </div>
            {weightText ? (
              <span className="text-[#94a3b8] text-[11px] leading-[16px] font-medium text-right shrink-0">
                {weightText}
              </span>
            ) : null}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <a
            href={resolveUrl(deal.product_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline hover:no-underline"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">
              Snatch Deal
            </span>
          </a>
          <button
            type="button"
            onClick={shareOnWhatsApp}
            onKeyDown={(event) => event.stopPropagation()}
            className="shrink-0 inline-flex items-center justify-center gap-1.5 h-[46px] px-4 rounded-[14px] border border-slate-200 bg-white hover:bg-slate-50 text-[#16a34a] transition-colors"
            aria-label="Share deal on WhatsApp"
            title="Share on WhatsApp"
          >
            <WhatsAppIcon />
            <span className="text-[13px] font-bold text-slate-600">Share</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Deals24Page() {
  const navigate = useNavigate();
  const dealsRef = useRef(null);
  const countdownRef = useRef(null);
  const [accessState, setAccessState] = useState("checking");
  const [accessError, setAccessError] = useState("");
  const [waitlistStatus, setWaitlistStatus] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackState, setFeedbackState] = useState("idle");
  const [feedbackError, setFeedbackError] = useState("");
  const [clockMs, setClockMs] = useState(() => Date.now());
  const authUser = useMemo(() => getAuthSession()?.user || null, []);
  const dailySeed = useMemo(() => getCurrentPoolDateSeed(clockMs), [clockMs]);
  const nextRefreshLabel = useMemo(
    () =>
      formatRefreshCountdown(
        Math.max(0, computeNextRefreshUtcMs(clockMs) - clockMs),
      ),
    [clockMs],
  );
  const { deals, meta, loading, error } = useDeals({
    enabled: accessState === "allowed" || accessState === "preview",
    limit: TODAY_COUNT,
    curated: "daily_live_pool",
    seed: dailySeed,
  });

  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);


  useEffect(() => {
    // Local dev bypass — show preview state to test the lock wall
    if (import.meta.env.DEV) {
      setAccessState("preview");
      setWaitlistStatus({ confirmed_count: 1, remaining_count: 1 });
      return undefined;
    }

    let cancelled = false;
    const session = getAuthSession();

    if (!session?.accessToken) {
      navigate("/waitlist", { replace: true });
      return undefined;
    }

    fetchWaitlistMe()
      .then((payload) => {
        if (cancelled) return;
        const status = payload?.data || null;
        setWaitlistStatus(status);
        if (hasDealsMembership(status)) {
          setAccessState("allowed");
        } else {
          setAccessState("preview");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err?.message || "Unable to verify your deals access.";
        if (/missing access token|expired access token|invalid/i.test(message)) {
          navigate("/waitlist", { replace: true });
          return;
        }
        setAccessError(message);
        setAccessState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const PREVIEW_LIMIT = 12;

  const shownDeals = useMemo(() => {
    const list = Array.isArray(deals) ? deals : [];
    return list.filter((deal) => deal && deal.product_url && deal.product_name);
  }, [deals]);

  const visibleDeals = accessState === "preview"
    ? shownDeals.slice(0, PREVIEW_LIMIT)
    : shownDeals;
  const peekDeals = accessState === "preview"
    ? shownDeals.slice(PREVIEW_LIMIT, PREVIEW_LIMIT + 12)
    : [];
  // On mobile the lock wall appears after the first 2 blurred cards;
  // the remaining blurred cards scroll below it.
  const MOBILE_PEEK_ABOVE = 2;
  const peekAbove = peekDeals.slice(0, MOBILE_PEEK_ABOVE);   // shown above lock wall on mobile
  const peekBelow = peekDeals.slice(MOBILE_PEEK_ABOVE);      // shown below lock wall on mobile
  const curatedMeta = meta?.curated || null;

  async function handleFeedbackSubmit(event) {
    event.preventDefault();
    const message = String(feedbackMessage || "").trim();
    if (!message) {
      setFeedbackState("error");
      setFeedbackError("Write a quick note before sending your feedback.");
      return;
    }

    const email = String(authUser?.email || "").trim();
    if (!email) {
      setFeedbackState("error");
      setFeedbackError("We couldn't find your account email for this feedback.");
      return;
    }

    setFeedbackState("submitting");
    setFeedbackError("");
    try {
      await postContact({
        name: inferFeedbackName(authUser),
        email,
        subject: "24 Deals Page Feedback",
        message,
      });
      setFeedbackMessage("");
      setFeedbackState("sent");
    } catch (submitError) {
      setFeedbackState("error");
      setFeedbackError(
        submitError?.message || "We couldn't send your feedback right now.",
      );
    }
  }

  function scrollToDeals() {
    dealsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (accessState === "checking") {
    return (
      <div className="min-h-screen bg-[#f8f6f6] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-[#e2e8f0] rounded-[24px] shadow-sm p-8 text-center">
          <h1
            className="text-[#1e293b] text-[30px] leading-[34px] font-black"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            Checking your access
          </h1>
          <p className="mt-3 text-[#64748b] text-[15px] leading-7">
            Hang on — we&apos;re loading today&apos;s deals for you.
          </p>
        </div>
      </div>
    );
  }

  if (accessState === "error") {
    return (
      <div className="min-h-screen bg-[#f8f6f6] flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white border border-[#e2e8f0] rounded-[24px] shadow-sm p-8 text-center">
          <h1
            className="text-[#1e293b] text-[30px] leading-[34px] font-black"
            style={{ fontFamily: "Fraunces, serif" }}
          >
            Access check failed
          </h1>
          <p className="mt-3 text-[#64748b] text-[15px] leading-7">
            {accessError}
          </p>
          <button
            type="button"
            onClick={() => navigate("/waitlist", { replace: true })}
            className="mt-6 bg-[#16a34a] hover:bg-[#15803d] text-white font-extrabold rounded-[12px] px-6 py-3 text-[15px] leading-6 transition-colors"
          >
            Back to waitlist
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f6f6]">
      <Deals24Header onLogout={async () => { await logoutUser(); window.location.replace("/waitlist"); }} />

      {/* Sticky deals-refresh bar */}
      <div className="sticky top-0 z-[9] bg-[#16a34a]">
        <div className="max-w-[1280px] mx-auto px-6 sm:px-10 h-11 flex items-center justify-between gap-3">
          <span className="text-white text-[12px] sm:text-[13px] font-bold leading-tight min-w-0">
            <span className="hidden sm:inline">Today&apos;s deals expire tonight. </span>
            24 new deals every morning.
          </span>
          <div className="shrink-0 flex items-center bg-white rounded-full px-3 py-1">
            <span className="font-mono font-extrabold tabular-nums text-[13px] leading-none text-[#16a34a]">
              {nextRefreshLabel}
            </span>
          </div>
        </div>
      </div>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden bg-black">
          <HeroImage />
          <div className="absolute inset-0 bg-black/25" />
        </div>

        <div className="relative max-w-[1280px] mx-auto px-8 py-24 md:py-28 flex items-center justify-center min-h-[720px]">
          <div className="max-w-[896px] text-center">
            <h1
              className="text-white font-black text-[44px] leading-[1.05] md:text-[72px] md:leading-[72px]"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Germany is Expensive.
            </h1>
            <p className="mt-6 text-white font-normal text-[24px] leading-[32px] md:text-[32px] md:leading-[40px]">
              We help you save on desi groceries every day.
            </p>
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={scrollToDeals}
                className="bg-[#16a34a] hover:bg-[#15803d] text-white font-extrabold rounded-[12px] px-10 py-4 text-[18px] leading-7 transition-colors relative"
                style={{
                  boxShadow:
                    "0px 20px 25px -5px rgba(22,163,74,0.3),0px 8px 10px -6px rgba(22,163,74,0.3)",
                }}
              >
                Browse Deals
              </button>
            </div>
          </div>
        </div>
      </section>

      <section
        ref={dealsRef}
        className="max-w-[1280px] mx-auto px-8 py-24"
        id="todays-deals"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="flex flex-col gap-2">
            <p className="text-[12px] tracking-[3.6px] uppercase font-extrabold text-[rgba(22,163,74,0.7)] leading-4">
              Fixed Daily Pool
            </p>
            <h2
              className="text-[#1e293b] font-bold text-[36px] leading-10"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Today&apos;s 24 Deals
            </h2>
          </div>
          <div ref={countdownRef} className="w-full lg:w-auto flex justify-end">
            <RefreshCountdown countdownLabel={nextRefreshLabel} />
          </div>
        </div>

        <div className="mt-10">
          {loading ? (
            <p className="text-slate-600">Loading deals…</p>
          ) : error ? (
            <p className="text-red-600">{error}</p>
          ) : shownDeals.length === 0 ? (
            <p className="text-slate-600">No deals found.</p>
          ) : (
            <>
              {/* Visible deals */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {(() => {
                  const isBestBeforeValid = (yyyyMm) => {
                    if (!yyyyMm) return false;
                    const [y, m] = yyyyMm.split("-").map(Number);
                    if (!y || !m) return false;
                    const now = new Date();
                    return y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1);
                  };
                  let bestBeforeShown = 0;
                  return visibleDeals.map((deal, idx) => {
                    const canShow = isBestBeforeValid(deal?.best_before) && bestBeforeShown < 4;
                    if (canShow) bestBeforeShown += 1;
                    return (
                      <Deals24Card
                        key={deal.id || deal.product_url}
                        deal={deal}
                        number={idx + 1}
                        showBestBefore={canShow}
                      />
                    );
                  });
                })()}
              </div>

              {/* Lock wall for preview users */}
              {accessState === "preview" && (
                <div className="relative mt-8">
                  {/* Blurred peek — desktop: all cards above lock wall; mobile: first 2 only */}
                  {peekDeals.length > 0 && (
                    <>
                      {/* Mobile: only first 2 blurred cards above lock wall */}
                      <div
                        className="grid grid-cols-1 gap-6 sm:hidden"
                        style={{ filter: "blur(5px)", pointerEvents: "none", userSelect: "none", opacity: 0.45 }}
                        aria-hidden="true"
                      >
                        {peekAbove.map((deal, idx) => (
                          <Deals24Card
                            key={deal.id || deal.product_url}
                            deal={deal}
                            number={PREVIEW_LIMIT + idx + 1}
                            showBestBefore={false}
                          />
                        ))}
                      </div>
                      {/* Desktop: all blurred cards above lock wall */}
                      <div
                        className="hidden sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-6"
                        style={{ filter: "blur(5px)", pointerEvents: "none", userSelect: "none", opacity: 0.45 }}
                        aria-hidden="true"
                      >
                        {peekDeals.map((deal, idx) => (
                          <Deals24Card
                            key={deal.id || deal.product_url}
                            deal={deal}
                            number={PREVIEW_LIMIT + idx + 1}
                            showBestBefore={false}
                          />
                        ))}
                      </div>
                    </>
                  )}

                  {/* Gradient fade */}
                  <div
                    className="absolute inset-x-0 top-0 h-24 pointer-events-none"
                    style={{ background: "linear-gradient(to bottom, #f8f6f6, transparent)" }}
                  />

                  {/* CTA card */}
                  <div className="relative flex justify-center -mt-6">
                    <div className="w-full max-w-lg bg-white border border-[#dcfce7] rounded-[28px] shadow-[0px_20px_60px_rgba(22,163,74,0.12),0px_2px_8px_rgba(0,0,0,0.06)] px-8 py-8 text-center">
                      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-[#f0fdf4] border border-[#dcfce7] mx-auto mb-4">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 2C9.243 2 7 4.243 7 7v2H5a1 1 0 00-1 1v10a2 2 0 002 2h12a2 2 0 002-2V10a1 1 0 00-1-1h-2V7c0-2.757-2.243-5-5-5zm0 2a3 3 0 013 3v2H9V7a3 3 0 013-3zm0 9a2 2 0 110 4 2 2 0 010-4z" fill="#16a34a" />
                        </svg>
                      </div>

                      <h3
                        className="text-[#1e293b] font-black text-[24px] leading-[28px]"
                        style={{ fontFamily: "Fraunces, serif" }}
                      >
                        {shownDeals.length - PREVIEW_LIMIT} more deals waiting
                      </h3>
                      <p className="mt-2 text-[#64748b] text-[15px] leading-6">
                        Invite 2 friends to unlock all{" "}
                        <span className="font-bold text-[#1e293b]">{shownDeals.length} deals</span>{" "}
                        — free, every day.
                      </p>

                      {/* Invite progress */}
                      {waitlistStatus && (
                        <div className="mt-5 flex items-center justify-center gap-3">
                          {[0, 1].map((i) => (
                            <div
                              key={i}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-bold border ${
                                i < (waitlistStatus.confirmed_count || 0)
                                  ? "bg-[#f0fdf4] border-[#86efac] text-[#16a34a]"
                                  : "bg-slate-50 border-slate-200 text-slate-400"
                              }`}
                            >
                              <span>{i < (waitlistStatus.confirmed_count || 0) ? "✓" : "○"}</span>
                              <span>Friend {i + 1}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {waitlistStatus?.referral_code ? (
                        <div className="mt-6 flex flex-col gap-3">
                          <p className="text-[13px] text-[#64748b] font-medium">Your invite link:</p>
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={`${window.location.origin}/waitlist?ref=${waitlistStatus.referral_code}`}
                              className="flex-1 min-w-0 rounded-[10px] border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-[#1e293b] font-mono truncate focus:outline-none"
                              onFocus={(e) => e.target.select()}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard?.writeText(`${window.location.origin}/waitlist?ref=${waitlistStatus.referral_code}`);
                              }}
                              className="shrink-0 px-3 py-2 rounded-[10px] border border-slate-200 bg-white hover:bg-slate-50 text-[13px] font-bold text-slate-600 transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(`Join me on DesiDeals24 — save on desi groceries in Germany every day!\n${window.location.origin}/waitlist?ref=${waitlistStatus.referral_code}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full bg-[#16a34a] hover:bg-[#15803d] text-white font-extrabold rounded-[14px] px-6 py-4 text-[16px] leading-6 transition-colors flex items-center justify-center gap-2 no-underline hover:no-underline"
                            style={{ boxShadow: "0px 8px 20px rgba(22,163,74,0.25)" }}
                          >
                            <WhatsAppIcon />
                            Share invite on WhatsApp
                          </a>
                        </div>
                      ) : (
                        <p className="mt-6 text-[13px] text-[#64748b]">Invite 2 friends using your unique link to unlock all deals.</p>
                      )}
                    </div>
                  </div>

                  {/* Mobile only: remaining blurred deals below the lock wall */}
                  {peekBelow.length > 0 && (
                    <div
                      className="grid grid-cols-1 gap-6 mt-6 sm:hidden"
                      style={{ filter: "blur(5px)", pointerEvents: "none", userSelect: "none", opacity: 0.45 }}
                      aria-hidden="true"
                    >
                      {peekBelow.map((deal, idx) => (
                        <Deals24Card
                          key={deal.id || deal.product_url}
                          deal={deal}
                          number={PREVIEW_LIMIT + MOBILE_PEEK_ABOVE + idx + 1}
                          showBestBefore={false}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-16 rounded-[28px] border border-[#dcfce7] bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-2 mb-6">
            <p className="text-[12px] tracking-[3.2px] uppercase font-extrabold text-[rgba(22,163,74,0.7)] leading-4">
              Feedback
            </p>
            <h3
              className="text-[#1e293b] font-bold text-[30px] leading-[34px]"
              style={{ fontFamily: "Fraunces, serif" }}
            >
              Tell us what to improve
            </h3>
            <p className="text-[#64748b] text-[15px] leading-7 max-w-[720px]">
              Found a bad deal, a category gap, or a better way to browse? Send it
              straight from this page.
            </p>
          </div>

          <form onSubmit={handleFeedbackSubmit} className="flex flex-col gap-4">
            <textarea
              value={feedbackMessage}
              onChange={(event) => {
                setFeedbackMessage(event.target.value);
                if (feedbackState !== "idle") {
                  setFeedbackState("idle");
                  setFeedbackError("");
                }
              }}
              rows={5}
              placeholder="Share what felt off, what you expected, or what you'd like us to add."
              className="w-full rounded-[18px] border border-[#dbe4ee] px-5 py-4 text-[15px] leading-7 text-[#1e293b] focus:outline-none focus:ring-2 focus:ring-[#16a34a]/20 focus:border-[#16a34a] resize-y"
            />
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-[13px] leading-6 text-[#64748b]">
                We&apos;ll send this from {authUser?.email || "your account email"}.
              </p>
              <button
                type="submit"
                disabled={feedbackState === "submitting"}
                className="bg-[#16a34a] hover:bg-[#15803d] disabled:bg-[#86efac] text-white font-extrabold rounded-[12px] px-6 py-3 text-[15px] leading-6 transition-colors"
              >
                {feedbackState === "submitting" ? "Sending..." : "Send feedback"}
              </button>
            </div>
            {feedbackState === "sent" ? (
              <p className="text-[14px] leading-6 text-[#15803d] font-semibold">
                Thanks. Your feedback has been sent to the team.
              </p>
            ) : null}
            {feedbackState === "error" && feedbackError ? (
              <p className="text-[14px] leading-6 text-[#b91c1c] font-semibold">
                {feedbackError}
              </p>
            ) : null}
          </form>
        </div>
      </section>

      <footer className="max-w-[1280px] mx-auto px-8 pb-16">
        <div className="border-t border-slate-200 pt-8 flex justify-center">
          <div
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-200 bg-white/70 backdrop-blur-md text-[13px] text-slate-600"
            style={{
              boxShadow:
                "0px 1px 2px rgba(15,23,42,0.05), 0px 10px 30px rgba(15,23,42,0.06)",
            }}
          >
            <span className="font-semibold">Made with</span>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-50 border border-emerald-100">
              <img
                src="/landing/dd24-logo.svg"
                alt=""
                aria-hidden="true"
                className="w-5 h-5 opacity-85"
              />
            </span>
            <span className="font-semibold">by Desis, for Desis.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
