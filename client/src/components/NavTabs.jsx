import React, { useContext } from "react";
import { Link, useLocation } from "react-router-dom";
import { CartContext } from "../hooks/CartContext";

export default function NavTabs() {
  const { pathname } = useLocation();
  const { count } = useContext(CartContext);

  const isProducts = pathname.startsWith("/products");
  const isDeals = pathname === "/" || pathname === "/deals" || pathname.startsWith("/deal/");

  return (
    <div
      style={{ background: "#fff", borderBottom: "1px solid #f1f5f9", fontFamily: "'DM Sans', system-ui, sans-serif" }}
      className="flex items-center px-4"
    >
      <Link
        to="/products"
        style={{
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: isProducts ? 700 : 500,
          color: isProducts ? "#16a34a" : "#64748b",
          borderBottom: isProducts ? "2px solid #16a34a" : "2px solid transparent",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        All Products
      </Link>
      <Link
        to="/deals"
        style={{
          padding: "12px 16px",
          fontSize: 14,
          fontWeight: isDeals ? 700 : 500,
          color: isDeals ? "#16a34a" : "#64748b",
          borderBottom: isDeals ? "2px solid #16a34a" : "2px solid transparent",
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Deals
      </Link>
      <div style={{ flex: 1 }} />
      <Link
        to="/cart"
        style={{ textDecoration: "none", position: "relative", padding: "8px", color: "#64748b", display: "flex" }}
        aria-label={`Cart, ${count} items`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        {count > 0 && (
          <span
            style={{
              position: "absolute", top: 4, right: 4,
              background: "#16a34a", color: "#fff",
              borderRadius: 99, minWidth: 15, height: 15,
              fontSize: 9, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </div>
  );
}
