import React, { useContext, useState, useCallback, useEffect, useRef } from "react";
import { CartContext } from "../hooks/CartContext";
import { formatPrice, formatPricePerKg } from "../utils/formatters";
import { resolveAbsoluteImageUrl } from "../utils/images";
import { matchBrand } from "../utils/brands";

function proxyCatalogImageUrl(imageUrl) {
  const abs = resolveAbsoluteImageUrl(imageUrl, null);
  if (!abs) return null;
  if (/cdn\.shopify\.com/i.test(abs)) {
    const sep = abs.includes("?") ? "&" : "?";
    return `${abs}${sep}width=400`;
  }
  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(abs)}`;
}

function extractBrandFromName(name) {
  if (!name) return null;
  const words = name.split(/\s+/);
  for (let len = 2; len >= 1; len--) {
    const candidate = words.slice(0, len).join(" ");
    const brand = matchBrand(candidate);
    if (brand) return brand;
  }
  // Fallback: first word if all-caps (e.g., "TRS") — catches brands not yet in DB
  if (words[0] && /^[A-Z]{2,}$/.test(words[0])) return words[0];
  return null;
}

export default function ProductCard({ product, context }) {
  const { addItem } = useContext(CartContext);
  const [imgError, setImgError] = useState(false);
  const [inCart, setInCart] = useState(false);
  const inCartTimerRef = useRef(null);

  const handleAddToCart = useCallback((e) => {
    e.stopPropagation();
    const detectedBrand = product.primary_brand || extractBrandFromName(product.canonical_name);
    addItem({
      raw_item_text: product.canonical_name,
      canonical_id: product.canonical_id,
      product_category: product.category,
      image_url: product.image_url,
      weight_raw: product.weight_raw ?? null,
      quantity: product.weight_value ?? null,
      quantity_unit: product.weight_unit ?? null,
      item_count: 1,
      brand: detectedBrand || null,
      anyBrand: !detectedBrand,
    });
    if (inCartTimerRef.current) clearTimeout(inCartTimerRef.current);
    setInCart(true);
    inCartTimerRef.current = setTimeout(() => setInCart(false), 1500);
  }, [addItem, product]);

  useEffect(() => {
    return () => { if (inCartTimerRef.current) clearTimeout(inCartTimerRef.current); };
  }, []);

  const discountPct = product.discount_pct ? Math.round(product.discount_pct) : null;
  const priceText = product.cheapest_price != null ? formatPrice(product.cheapest_price) : null;
  const originalPriceText = product.original_price ? formatPrice(product.original_price) : null;
  const weightText = product.price_per_kg ? formatPricePerKg(product.price_per_kg) : null;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Check out ${product.canonical_name} on DesiDeals24!`)}`;
  const proxiedImg = proxyCatalogImageUrl(product.image_url);

  return (
    <div
      className="bg-white rounded-[20px] flex flex-col border border-[#f1f5f9]"
      style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
    >
      {/* Image */}
      <div className="relative w-full h-[200px] bg-white flex items-center justify-center p-5 overflow-hidden rounded-t-[20px]">
        <img
          src={
            imgError || !proxiedImg
              ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">%F0%9F%9B%92</text></svg>'
              : proxiedImg
          }
          alt={product.canonical_name}
          loading="lazy"
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
        {discountPct > 0 && (
          <div
            className="absolute top-3 right-3 rounded-[8px] px-2.5 py-1"
            style={{
              backgroundColor:
                discountPct > 50 ? "#ffe4e8" :
                discountPct >= 30 ? "#fff3e0" :
                discountPct >= 20 ? "#e8f0fe" : "#f1f5f9",
            }}
          >
            <span
              className="font-bold text-[13px] leading-none"
              style={{
                color:
                  discountPct > 50 ? "#e53e3e" :
                  discountPct >= 30 ? "#c05200" :
                  discountPct >= 20 ? "#1a56db" : "#1e293b",
              }}
            >
              -{discountPct}%
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col flex-1 px-5 pt-4 pb-5 gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[#94a3b8] text-[10px] leading-[15px] tracking-[1.5px] uppercase font-extrabold">
            {product.category}
          </p>
          <p className="text-[#1e293b] text-[15px] leading-[22px] font-bold line-clamp-2 min-h-[44px]">
            {product.canonical_name}
          </p>
          {product.cheapest_store_name && (
            <p className="text-[#94a3b8] text-[11px] leading-[15px]">
              From {product.cheapest_store_name}
              {product.store_count > 1 ? ` + ${product.store_count - 1} more` : ""}
            </p>
          )}
          {priceText && (
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-[#1e293b] text-[22px] leading-[30px] font-extrabold">
                  {priceText}
                </span>
                {originalPriceText && (
                  <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">
                    {originalPriceText}
                  </span>
                )}
              </div>
              {weightText && (
                <span className="text-[#94a3b8] text-[11px] leading-[16px] font-medium text-right shrink-0">
                  {weightText}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-auto">
          {context === "deals" && product.product_url && (
            <a
              href={product.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center rounded-[14px] py-2.5 text-white text-[12px] font-extrabold tracking-[0.04em] uppercase no-underline"
              style={{ background: "#16a34a" }}
            >
              Snatch Deal
            </a>
          )}

          <button
            type="button"
            onClick={handleAddToCart}
            aria-label="Add to cart"
            className="flex-1 flex items-center justify-center gap-1.5 rounded-[14px] border text-[13px] font-semibold transition-colors"
            style={{
              height: 44,
              background: inCart ? "#16a34a" : "#fff",
              borderColor: inCart ? "#16a34a" : "#e2e8f0",
              color: inCart ? "#fff" : "#1e293b",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 01-8 0"/>
            </svg>
            {inCart ? "Added!" : "Add to cart"}
          </button>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Share on WhatsApp"
            className="w-11 h-11 flex items-center justify-center border border-[#e2e8f0] rounded-[14px] shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.67 4.61 1.832 6.5L4 29l7.697-1.803A12.94 12.94 0 0016 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
              <path d="M21.786 18.618c-.306-.153-1.81-.894-2.09-.994-.28-.1-.484-.153-.688.153-.204.306-.79.994-.968 1.198-.178.204-.356.23-.662.077-.306-.153-1.29-.476-2.458-1.516-.908-.81-1.522-1.81-1.7-2.116-.178-.306-.019-.47.134-.622.137-.136.306-.356.459-.535.153-.178.204-.306.306-.51.102-.204.051-.382-.025-.535-.077-.153-.688-1.658-.942-2.27-.248-.595-.5-.514-.688-.524l-.586-.01c-.204 0-.535.077-.816.382-.28.306-1.07 1.045-1.07 2.55s1.095 2.96 1.248 3.164c.153.204 2.154 3.29 5.22 4.614.73.315 1.3.503 1.744.644.733.233 1.4.2 1.927.121.588-.087 1.81-.74 2.065-1.455.255-.714.255-1.326.178-1.455-.076-.13-.28-.204-.586-.357z" fill="white"/>
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
