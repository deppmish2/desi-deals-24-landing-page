import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchDealById } from "../utils/api";
import { trackAnalyticsEvent } from "../utils/analytics";
import { formatBestBefore, formatPrice, formatPricePerKg } from "../utils/formatters";
import { buildWhatsAppDealShareUrl } from "../utils/share";

function proxyImageUrl(imageUrl) {
  if (!imageUrl) return null;
  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(imageUrl)}`;
}

function resolveUrl(deal, url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const storeBase = String(deal?.store?.url || "").replace(/\/+$/, "");
  return storeBase ? `${storeBase}${raw.startsWith("/") ? "" : "/"}${raw}` : raw;
}

function buildSharedDealAnalyticsPayload(deal) {
  return {
    page_type: "shared_deal",
    deal_id: deal?.id || undefined,
    store_id: deal?.store?.id || undefined,
    store_name: deal?.store?.name || undefined,
    category: deal?.product_category || undefined,
  };
}

export default function DealSharePage() {
  const { dealId } = useParams();
  const [deal, setDeal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!dealId) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    fetchDealById(dealId)
      .then((d) => {
        if (!d) { setNotFound(true); } else { setDeal(d); }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [dealId]);

  const priceText = deal ? formatPrice(deal.sale_price, deal.currency) : "";
  const originalPriceText = deal?.original_price ? formatPrice(deal.original_price, deal.currency) : null;
  const weightText = deal ? [
    deal.weight_raw || null,
    deal.price_per_kg ? formatPricePerKg(deal.price_per_kg) : null,
  ].filter(Boolean).join(" | ") : "";
  const discountPct = deal?.discount_percent ? Math.round(deal.discount_percent) : null;
  const bestBeforeText = deal?.best_before ? formatBestBefore(deal.best_before) : null;
  const proxyImg = deal ? proxyImageUrl(deal.image_url) : null;

  return (
    <div className="bg-[radial-gradient(circle_at_top,_#ffffff_0%,_#f8fbff_32%,_#f3f6fb_100%)] min-h-screen">

      {/* Header */}
      <div className="sticky top-0 z-50">
        <div className="flex h-[60px] items-center justify-between gap-4 bg-white px-6 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)]">
          <Link to="/" className="flex items-center gap-2 no-underline" style={{ textDecoration: "none" }}>
            <img src="/landing/dd24-logo.svg" alt="DesiDeals24" className="w-5 h-6 object-contain" />
            <span className="font-bold tracking-[-1.2px] text-[24px] sm:text-[18px] text-[#15803d]">DesiDeals24</span>
          </Link>
          <Link
            to="/"
            onClick={() =>
              trackAnalyticsEvent("explore_all_deals_click", {
                page_type: "shared_deal",
                source: "header",
              })
            }
            className="bg-[#eff8f1] border border-[#d8eadb] text-[#17874a] text-[13px] font-bold px-4 py-2 rounded-full no-underline transition-colors hover:bg-[#e7f5ea]"
            style={{ textDecoration: "none" }}
          >
            Explore deals →
          </Link>
        </div>
      </div>

      {/* Hero text — only shown when deal exists */}
      {!notFound && (
        <div className="text-center px-4 py-8">
          <p className="text-[11px] font-extrabold uppercase tracking-[2px] text-slate-400">SHARED WITH YOU</p>
          <h1 className="text-[24px] sm:text-[30px] font-black text-[#111827] mt-2">Someone found a great deal</h1>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 rounded-full animate-spin" style={{ borderWidth: 3, borderStyle: "solid", borderColor: "#e2e8f0", borderTopColor: "#16a34a" }} />
        </div>
      )}

      {!loading && notFound && (
        <div className="flex flex-col items-center px-4 py-12 gap-0">
          <div className="text-[52px] mb-4">🛒</div>
          <h2 className="text-[22px] sm:text-[26px] font-black text-[#111827] text-center">This deal has flown away</h2>
          <p className="text-[15px] text-slate-500 text-center mt-2 max-w-xs leading-relaxed">
            Deals move fast — this one's already gone. But don't worry, there are hundreds of fresh Indian grocery deals waiting for you.
          </p>
          <div className="mt-8 w-full max-w-sm rounded-[24px] bg-[#eef4ff] border border-[#dbe9ff] p-8 text-center">
            <h3 className="text-[18px] font-black text-[#111827]">Fresh deals, every day</h3>
            <p className="text-[13px] text-slate-500 mt-1.5">Indian groceries. German stores. Real savings.</p>
            <Link
              to="/"
              onClick={() =>
                trackAnalyticsEvent("explore_all_deals_click", {
                  page_type: "shared_deal_missing",
                  source: "empty_state",
                })
              }
              className="mt-5 inline-block bg-[#17874a] hover:bg-[#15803d] text-white font-bold text-[15px] px-8 py-3.5 rounded-[14px] no-underline transition-colors"
              style={{ textDecoration: "none" }}
            >
              Explore all deals →
            </Link>
          </div>
        </div>
      )}

      {!loading && deal && (
        <>
          {/* Deal card */}
          <div className="max-w-sm mx-auto px-4">
            <div
              className="bg-white border border-[#f1f5f9] rounded-[20px] flex flex-col overflow-hidden"
              style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
            >
              {/* Image */}
              <div className="relative w-full bg-white flex items-center justify-center p-5" style={{ height: 200 }}>
                <img
                  src={imgError || !proxyImg
                    ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">🛒</text></svg>'
                    : proxyImg}
                  alt={deal.product_name}
                  loading="lazy"
                  className="w-full h-full object-contain"
                  onError={() => setImgError(true)}
                />
                {discountPct > 0 && (
                  <div className="absolute top-3 right-3 rounded-[8px] px-2.5 py-1"
                    style={{ backgroundColor: discountPct > 50 ? "#ffe4e8" : discountPct >= 30 ? "#fff3e0" : discountPct >= 20 ? "#e8f0fe" : "#f1f5f9" }}>
                    <span className="font-bold text-[13px] leading-none"
                      style={{ color: discountPct > 50 ? "#e53e3e" : discountPct >= 30 ? "#c05200" : discountPct >= 20 ? "#1a56db" : "#1e293b" }}>
                      -{discountPct}%
                    </span>
                  </div>
                )}
                {bestBeforeText && (
                  <span className="absolute bottom-3 left-3 bg-[#d5890f] text-white text-[10px] leading-[15px] font-medium rounded-full px-2 py-0.5">
                    {bestBeforeText}
                  </span>
                )}
              </div>

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
                      <span className="text-[#1e293b] text-[22px] leading-[30px] font-extrabold">{priceText}</span>
                      {originalPriceText && (
                        <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">{originalPriceText}</span>
                      )}
                    </div>
                    {weightText && (
                      <span className="text-[#94a3b8] text-[11px] leading-[16px] font-medium text-right shrink-0">{weightText}</span>
                    )}
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2 pt-2">
                  <a
                    href={resolveUrl(deal, deal.product_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      trackAnalyticsEvent(
                        "snatch_deal_click",
                        buildSharedDealAnalyticsPayload(deal),
                      )
                    }
                    className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline hover:no-underline"
                    style={{ textDecoration: "none" }}
                  >
                    <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">Snatch Deal</span>
                  </a>
                  <a
                    href={buildWhatsAppDealShareUrl({
                      dealId: deal.id,
                      productName: deal.product_name,
                      priceText,
                      originalPriceText,
                      storeName: deal.store?.name,
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() =>
                      trackAnalyticsEvent(
                        "whatsapp_share_click",
                        buildSharedDealAnalyticsPayload(deal),
                      )
                    }
                    className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border border-slate-200 bg-white hover:bg-[#e7fbe9] hover:border-[#25D366] transition-colors"
                    title="Share on WhatsApp"
                  >
                    <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
                      <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.67 4.61 1.832 6.5L4 29l7.697-1.803A12.94 12.94 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
                      <path d="M21.786 18.618c-.306-.153-1.81-.894-2.09-.994-.28-.1-.484-.153-.688.153-.204.306-.79.994-.968 1.198-.178.204-.356.23-.662.077-.306-.153-1.29-.476-2.458-1.516-.908-.81-1.522-1.81-1.7-2.116-.178-.306-.019-.47.134-.622.137-.136.306-.356.459-.535.153-.178.204-.306.306-.51.102-.204.051-.382-.025-.535-.077-.153-.688-1.658-.942-2.27-.248-.595-.5-.514-.688-.524l-.586-.01c-.204 0-.535.077-.816.382-.28.306-1.07 1.045-1.07 2.55s1.095 2.96 1.248 3.164c.153.204 2.154 3.29 5.22 4.614.73.315 1.3.503 1.744.644.733.233 1.4.2 1.927.121.588-.087 1.81-.74 2.065-1.455.255-.714.255-1.326.178-1.455-.076-.13-.28-.204-.586-.357z" fill="white"/>
                    </svg>
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom CTA */}
          <div className="mt-8 px-4 pb-12">
            <div className="rounded-[24px] bg-[#eef4ff] border border-[#dbe9ff] p-8 mx-auto max-w-sm text-center">
              <h2 className="text-[20px] font-black text-[#111827]">Discover more deals</h2>
              <p className="text-[14px] text-slate-500 mt-2">Hundreds of Indian grocery deals in Germany, updated daily.</p>
              <Link
                to="/"
                onClick={() =>
                  trackAnalyticsEvent("explore_all_deals_click", {
                    page_type: "shared_deal",
                    source: "bottom_cta",
                  })
                }
                className="bg-[#17874a] text-white font-bold text-[15px] px-8 py-3.5 rounded-[14px] mt-4 inline-block no-underline transition-colors hover:bg-[#15803d]"
                style={{ textDecoration: "none" }}
              >
                Explore all deals
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
