import React, { useContext } from "react";
import { CartContext } from "../hooks/CartContext";

export default function CartButton({ deal, className = "" }) {
  const { addItem, items } = useContext(CartContext);

  const inCart = items.some(i =>
    (deal.canonical_id && i.canonical_id === deal.canonical_id) ||
    i.raw_item_text === deal.product_name
  );

  function handleAdd(e) {
    e.preventDefault();
    e.stopPropagation();
    addItem({
      raw_item_text: deal.product_name,
      canonical_id: deal.canonical_id || null,
      quantity: deal.weight_value || null,
      quantity_unit: deal.weight_unit || null,
      item_count: 1,
    });
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
