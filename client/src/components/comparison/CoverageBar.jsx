import React from "react";

export default function CoverageBar({ available, total }) {
  const pct = total > 0 ? Math.min(100, Math.round((available / total) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 99, background: "#f1f5f9", overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`, height: "100%",
            background: "#16a34a", borderRadius: 99,
            transition: "width 0.3s ease",
          }}
        />
      </div>
      <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap", fontWeight: 600 }}>
        {available}/{total} items
      </span>
    </div>
  );
}
