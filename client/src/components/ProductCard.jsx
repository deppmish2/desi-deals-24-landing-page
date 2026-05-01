import React, { useContext, useState, useCallback, useEffect, useRef } from "react";
import { CartContext } from "../hooks/CartContext";

export default function ProductCard({ product, context }) {
  const { addItem } = useContext(CartContext);
  const [imgError, setImgError] = useState(false);
  const [inCart, setInCart] = useState(false);
  const inCartTimerRef = useRef(null);

  const handleAddToCart = useCallback((e) => {
    e.stopPropagation();
    addItem({
      raw_item_text: product.canonical_name,
      canonical_id: product.canonical_id,
      product_category: product.category,
      image_url: product.image_url,
      weight_raw: product.weight_raw ?? null,
      quantity: product.weight_value ?? null,
      quantity_unit: product.weight_unit ?? null,
      item_count: 1,
    });
    if (inCartTimerRef.current) clearTimeout(inCartTimerRef.current);
    setInCart(true);
    inCartTimerRef.current = setTimeout(() => setInCart(false), 1500);
  }, [addItem, product]);

  useEffect(() => {
    return () => { if (inCartTimerRef.current) clearTimeout(inCartTimerRef.current); };
  }, []);

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(`Check out ${product.canonical_name} on DesiDeals24!`)}`;

  return (
    <div style={{
      background: "#fff", border: "1px solid #f1f5f9",
      borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      overflow: "hidden", fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Image */}
      <div style={{ aspectRatio: "4/3", background: "#f8fafc", overflow: "hidden" }}>
        {product.image_url && !imgError ? (
          <img
            src={product.image_url}
            alt={product.canonical_name}
            onError={() => setImgError(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600 }}>{product.category || "?"}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: "12px 14px 14px" }}>
        <p style={{ margin: "0 0 4px", fontSize: 13, color: "#94a3b8" }}>{product.category}</p>
        <p style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#1e293b", lineHeight: 1.3 }}>
          {product.canonical_name}
        </p>
        {product.cheapest_store_name && (
          <p style={{ margin: "0 0 12px", fontSize: 11, color: "#94a3b8" }}>
            From {product.cheapest_store_name}
            {product.store_count > 1 ? ` + ${product.store_count - 1} more` : ""}
          </p>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          {context === "deals" && product.product_url && (
            <a
              href={product.product_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: "#16a34a", color: "#fff",
                borderRadius: 14, padding: "10px 0",
                fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase",
                textDecoration: "none",
              }}
            >
              Snatch Deal
            </a>
          )}

          <button
            type="button"
            onClick={handleAddToCart}
            aria-label="Add to cart"
            style={{
              flex: context === "deals" ? 0 : 1,
              width: context === "deals" ? 44 : undefined,
              height: 44,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: inCart ? "#16a34a" : "#fff",
              border: `1px solid ${inCart ? "#16a34a" : "#e2e8f0"}`,
              borderRadius: 14, cursor: "pointer",
              color: inCart ? "#fff" : "#1e293b",
              fontSize: context === "deals" ? undefined : 13,
              fontWeight: context === "deals" ? undefined : 600,
              gap: 6,
            }}
            title="Add to cart"
          >
            {context === "deals" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
              </svg>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
                {inCart ? "Added!" : "Add to cart"}
              </>
            )}
          </button>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Share on WhatsApp"
            style={{
              width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center",
              border: "1px solid #e2e8f0", borderRadius: 14, flexShrink: 0,
            }}
            title="Share on WhatsApp"
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
