import React from "react";
import { Link, useLocation } from "react-router-dom";

export default function NavTabs() {
  const { pathname } = useLocation();

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
    </div>
  );
}
