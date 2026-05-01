import React from "react";

export default function MissingItemsBanner({ count, estimatedCost }) {
  if (!count) return null;
  return (
    <div style={{
      background: "#fffbeb", border: "1px solid #fde68a",
      borderRadius: 12, padding: "10px 14px",
    }}>
      <p style={{ margin: 0, fontSize: 13, color: "#92400e", fontWeight: 600 }}>
        ⚠ {count} item{count !== 1 ? "s" : ""} not available
        {estimatedCost ? ` · Est. missing: ~€${Number(estimatedCost).toFixed(2)}` : ""}
      </p>
    </div>
  );
}
