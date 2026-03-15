import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import {
  formatBestBefore,
  formatPrice,
  formatPricePerKg,
} from "../utils/formatters";
import { getAuthSession, postContact } from "../utils/api";
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
      className="bg-white/90 backdrop-blur-md border border-slate-200 rounded-[22px] px-6 py-4 flex items-center gap-6"
      style={{
        boxShadow:
          "0px 20px 40px rgba(15,23,42,0.10), 0px 1px 2px rgba(15,23,42,0.06)",
      }}
      aria-label="Next refresh countdown"
    >
      <div className="pl-0 pr-2">
        <div className="text-slate-800 font-bold text-[18px] leading-[22px]">
          New deals in
        </div>
      </div>

      <div className="h-10 w-px bg-slate-200" aria-hidden="true" />

      <div className="flex items-center gap-6">
        {[
          { label: "HOURS", value: hours },
          { label: "MINUTES", value: minutes },
          { label: "SECONDS", value: seconds },
        ].map((item, idx) => (
          <div key={item.label} className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-[#16a34a] font-extrabold text-[44px] leading-[44px] tracking-[-1px]">
                {item.value}
              </div>
              <div className="text-slate-400 font-bold text-[12px] tracking-[2.2px] uppercase mt-2">
                {item.label}
              </div>
            </div>
            {idx < 2 ? (
              <div className="text-slate-200 text-[28px] leading-[28px] font-bold -mt-4 select-none">
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
    return `just give this a try, thank me later\ndesi grocery deals across 24 stores in germany, updated every morning\nwww.DesiDeals24.com`;
  }

  function shareOnWhatsApp(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const text = buildShareMessage();
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function goToRedirect(event) {
    event?.preventDefault?.();
    const url = String(deal?.product_url || "").trim();
    if (!url) return;
    // Keep it a full navigation so store pages open reliably outside the SPA.
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function discountBg(pct) {
    if (!Number.isFinite(pct)) return "#000000";
    if (pct >= 80) return "#CF0000";
    if (pct >= 50) return "#B25F00";
    if (pct >= 20) return "#004CB0";
    return "#000000";
  }

  return (
    <div
      className="border border-[#f1f5f9] rounded-[16px] p-4 sm:p-[21px] flex flex-col sm:flex-row gap-4 sm:gap-6 items-stretch sm:items-start sm:h-[218.8px]"
      style={{
        backgroundImage:
          "linear-gradient(134.83388041398146deg, rgb(255, 255, 255) 0%, rgb(248, 250, 252) 100%)",
        boxShadow: "0px 1px 2px 0px rgba(0,0,0,0.05)",
        cursor: "pointer",
      }}
      role="link"
      tabIndex={0}
      onClick={goToRedirect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          goToRedirect(event);
        }
      }}
    >
      <div
        className="bg-white border border-[#f8fafc] rounded-[12px] relative shrink-0 w-full sm:w-[112px] h-[160px] sm:h-[112px]"
        style={{ boxShadow: "0px 1px 2px 0px rgba(0,0,0,0.05)" }}
      >
        <div className="overflow-hidden rounded-[inherit] p-[13px] flex items-center justify-center relative size-full">
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

          {discountPct > 0 ? (
            <div
              className="absolute left-0 top-0 rounded-br-[8px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] px-2 py-[2px]"
              style={{ backgroundColor: discountBg(discountPct) }}
            >
              <span className="text-white font-extrabold text-[9px] leading-[12px]">
                {discountPct}% OFF
              </span>
            </div>
          ) : null}

          <div className="absolute inset-0 pointer-events-none rounded-[inherit] shadow-[inset_0px_2px_4px_1px_rgba(0,0,0,0.05)]" />
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {Number.isFinite(number) ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] leading-[15px] font-extrabold tracking-[1px] text-slate-500 border border-slate-200 bg-white/70 backdrop-blur shrink-0"
                  aria-label={`Deal number ${number}`}
                >
                  #{number}
                </span>
              ) : null}
              <p className="text-[#64748b] text-[10px] leading-[15px] tracking-[1px] uppercase font-extrabold truncate">
                {deal.store?.name || "Store"}
              </p>
            </div>
            {bestBeforeText ? (
              <span className="bg-[#d5890f] text-white text-[10px] leading-[15px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap">
                {bestBeforeText}
              </span>
            ) : null}
          </div>

          <p className="text-[#1e293b] text-[16px] leading-[22px] font-extrabold line-clamp-2 h-[44.8px]">
            {deal.product_name}
          </p>

          <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[#16a34a] text-[24px] leading-[32px] font-extrabold">
                {priceText}
              </span>
              {originalPriceText ? (
                <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">
                  {originalPriceText}
                </span>
              ) : null}
            </div>

            <div className="sm:text-right text-[#64748b] text-[10px] leading-[15px] font-medium whitespace-nowrap">
              {weightText || " "}
            </div>
          </div>
        </div>

        <div className="pt-4">
          <div className="border-t border-[#f1f5f9] pt-4 sm:pt-[17px] flex items-center justify-stretch sm:justify-end gap-3">
            <a
              href={deal.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-none justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[12px] px-5 py-2.5 inline-flex items-center gap-2 text-white no-underline"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <span className="text-[12px] leading-[16px] font-extrabold">
                Snatch deal
              </span>
              <ArrowSmallIcon className="text-white" />
            </a>
            <button
              type="button"
              onClick={shareOnWhatsApp}
              onKeyDown={(event) => event.stopPropagation()}
              className="shrink-0 inline-flex items-center justify-center gap-1.5 h-[44px] px-3 rounded-[12px] border border-slate-200 bg-white hover:bg-slate-50 text-[#16a34a] transition-colors"
              aria-label="Share deal on WhatsApp"
              title="Share deal"
            >
              <WhatsAppIcon />
              <span className="hidden sm:inline text-[13px] font-bold text-slate-600">Share</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Deals24Page() {
  const navigate = useNavigate();
  const dealsRef = useRef(null);
  const [accessState, setAccessState] = useState("checking");
  const [accessError, setAccessError] = useState("");
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
    enabled: accessState === "allowed",
    limit: TODAY_COUNT,
    curated: "daily_live_pool",
    seed: dailySeed,
  });

  useEffect(() => {
    const id = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    // Local dev bypass — skip auth check entirely when running via Vite dev server
    if (import.meta.env.DEV) {
      setAccessState("allowed");
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
        if (hasDealsMembership(payload?.data)) {
          setAccessState("allowed");
          return;
        }
        navigate("/waitlist", { replace: true });
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

  const shownDeals = useMemo(() => {
    const list = Array.isArray(deals) ? deals : [];
    return list.filter((deal) => deal && deal.product_url && deal.product_name);
  }, [deals]);
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
            We&apos;re confirming that your 2 invites were tracked before we open
            today&apos;s 24 deals.
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
      <Deals24Header />

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
            <p className="mt-6 text-white font-normal text-[32px] leading-[40px]">
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
            <p className="text-[#64748b] text-[15px] leading-7 max-w-[720px]">
              Fixed for {formatPoolDate(curatedMeta?.pool_date || dailySeed)} and
              refreshed daily at 07:00 Berlin time. Live products only, spanning at
              least {curatedMeta?.store_target || 10} shops and{" "}
              {curatedMeta?.category_target || 4} core grocery categories.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-4 py-2 text-[13px] font-bold text-[#166534]">
              {curatedMeta?.store_count || 0} shops in today&apos;s pool
            </div>
            <div className="rounded-full border border-[#dcfce7] bg-white px-4 py-2 text-[13px] font-bold text-[#166534]">
              {curatedMeta?.category_count || 0} categories covered
            </div>
          </div>
          <div className="w-full lg:w-auto flex justify-end">
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {(() => {
                let bestBeforeShown = 0;
                return shownDeals.map((deal, idx) => {
                  const canShow = deal?.best_before && bestBeforeShown < 4;
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
