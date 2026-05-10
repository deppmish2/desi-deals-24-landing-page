import React, { useState } from "react";
import { updateCanonical, changeCanonicalCategory } from "../utils/api";

const CATEGORIES = [
  "Rice & Grains", "Flours & Baking", "Lentils & Pulses", "Spices & Masalas",
  "Oils & Ghee", "Sauces & Pastes", "Snacks & Sweets", "Snacks & Namkeen", "Beverages",
  "Dairy & Paneer", "Frozen Foods", "Fresh Produce", "Noodles & Pasta",
  "Canned & Packaged", "Personal Care", "Household", "Ready Meals & Mixes", "Other",
];

export default function AdminProductEditor({ canonicalId, initialName, initialBrand, initialType, initialCategory, onClose, onSaved }) {
  const [name, setName] = useState(initialName || "");
  const [brand, setBrand] = useState(initialBrand || "");
  const [type, setType] = useState(initialType || "");
  const [category, setCategory] = useState(initialCategory || "Other");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [error, setError] = useState(null);

  const categoryChanged = category !== (initialCategory || "Other");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      let remapSummary = null;
      if (categoryChanged) {
        remapSummary = await changeCanonicalCategory(canonicalId, category);
      }
      const result = await updateCanonical(canonicalId, {
        canonical_name: name.trim() || undefined,
        brand: brand.trim() || undefined,
        product_type: type.trim() || undefined,
        category,
      });
      const newId = result?.new_id || canonicalId;
      window.dispatchEvent(new CustomEvent("dd24-canonical-updated", {
        detail: { oldId: canonicalId, newId },
      }));
      setSaved(true);
      setSaveMessage(remapSummary
        ? `Saved ✓ · ${remapSummary.products_remapped} remapped, ${remapSummary.products_queued} queued`
        : "Saved ✓");
      onSaved?.({ newId });
      setTimeout(onClose, 2000);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  const fields = [
    { label: "Canonical", value: name, set: setName, placeholder: "Full product name" },
    { label: "Brand", value: brand, set: setBrand, placeholder: "Brand name" },
    { label: "Type / Variant", value: type, set: setType, placeholder: "e.g. Extra Long, Whole" },
  ];

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(15, 23, 42, 0.97)",
        borderRadius: 20,
        padding: "14px 14px 12px",
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <p style={{ color: "#60a5fa", fontSize: 10, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", margin: 0 }}>
          Admin · Edit Metadata
        </p>
        <span style={{ color: "#475569", fontSize: 10 }}>{canonicalId}</span>
      </div>

      {fields.map(({ label, value, set, placeholder }) => (
        <div key={label} style={{ marginBottom: 8 }}>
          <label style={{ color: "#64748b", fontSize: 10, fontWeight: 600, display: "block", marginBottom: 3 }}>{label}</label>
          <input
            value={value}
            onChange={e => set(e.target.value)}
            placeholder={placeholder}
            style={{
              width: "100%",
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: 7,
              color: "#e2e8f0",
              fontSize: 12,
              padding: "5px 8px",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      ))}

      <div style={{ marginBottom: 8 }}>
        <label style={{ color: "#64748b", fontSize: 10, fontWeight: 600, display: "block", marginBottom: 3 }}>
          Category
          {categoryChanged && (
            <span style={{ color: "#f59e0b", marginLeft: 6 }}>· will remap products</span>
          )}
        </label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          style={{
            width: "100%",
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 7,
            color: "#e2e8f0",
            fontSize: 12,
            padding: "5px 8px",
            outline: "none",
            boxSizing: "border-box",
          }}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {error && <p style={{ color: "#f87171", fontSize: 11, margin: "4px 0" }}>{error}</p>}

      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            flex: 1, height: 32, borderRadius: 8,
            background: saved ? "#16a34a" : saving ? "#1e40af" : "#3b82f6",
            color: "#fff", fontSize: 12, fontWeight: 600,
            border: "none", cursor: saving ? "default" : "pointer",
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saveMessage || (saved ? "Saved ✓" : saving ? "Saving…" : "Save")}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          style={{
            flex: 1, height: 32, borderRadius: 8,
            background: "#1e293b", color: "#94a3b8",
            fontSize: 12, fontWeight: 500,
            border: "1px solid #334155", cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
