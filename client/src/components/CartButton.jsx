import React, { useContext } from "react";
import { CartContext } from "../hooks/CartContext";
import { matchBrand } from "../utils/brands";

function detectBrand(deal) {
  if (deal.primary_brand) return { brand: deal.primary_brand, anyBrand: false };
  const words = (deal.product_name || "").split(/\s+/);
  for (let len = Math.min(3, words.length); len >= 1; len--) {
    const b = matchBrand(words.slice(0, len).join(" "));
    if (b) return { brand: b, anyBrand: false };
  }
  return { brand: null, anyBrand: true };
}

export default function CartButton({ deal, fullWidth = false, className = "" }) {
  const { addItem, items } = useContext(CartContext);

  const inCart = items.some(i =>
    (deal.canonical_id && i.canonical_id === deal.canonical_id) ||
    i.raw_item_text === deal.product_name
  );

  function handleAdd(e) {
    e.preventDefault();
    e.stopPropagation();
    const { brand, anyBrand } = detectBrand(deal);
    addItem({
      raw_item_text: deal.product_name,
      canonical_id: deal.canonical_id || null,
      product_category: deal.product_category || null,
      image_url: deal.image_url || null,
      weight_raw: deal.weight_raw || null,
      quantity: deal.weight_value || null,
      quantity_unit: deal.weight_unit || null,
      item_count: 1,
      brand,
      anyBrand,
    });
  }

  if (fullWidth) {
    return (
      <button
        onClick={handleAdd}
        type="button"
        aria-label={inCart ? "In cart" : "Add to cart"}
        className={`flex-1 flex items-center justify-center gap-1.5 rounded-[14px] border text-[13px] font-semibold transition-colors ${className}`}
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
    );
  }

  return (
    <button
      onClick={handleAdd}
      className={`shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border transition-colors ${
        inCart
          ? "bg-orange-500 border-orange-500 text-white"
          : "border-slate-200 bg-white hover:bg-orange-50 hover:border-orange-300 text-slate-500"
      } ${className}`}
      title={inCart ? "In cart" : "Add to cart"}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        {!inCart && <><line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/></>}
      </svg>
    </button>
  );
}
