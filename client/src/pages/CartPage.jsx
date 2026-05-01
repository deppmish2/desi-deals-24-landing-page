import React, { useContext, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CartContext } from "../hooks/CartContext";
import {
  getAuthSession,
  createList,
  fetchLists,
  mergeCartIntoList,
  fetchProductBrands,
} from "../utils/api";

const CATEGORY_COLORS = {
  "Rice & Grains":    { bg: "#fef3c7", text: "#92400e", label: "RICE" },
  "Lentils & Pulses": { bg: "#fce7f3", text: "#9d174d", label: "DAL" },
  "Spices & Masalas": { bg: "#fff7ed", text: "#9a3412", label: "SPICE" },
  "Dairy & Paneer":   { bg: "#eff6ff", text: "#1e40af", label: "DAIRY" },
  "Flours & Baking":  { bg: "#f0fdf4", text: "#166534", label: "FLOUR" },
};

function CategoryThumb({ category, imageUrl }) {
  const [imgError, setImgError] = useState(false);
  const colors = CATEGORY_COLORS[category] || { bg: "#f1f5f9", text: "#64748b", label: "?" };
  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt=""
        onError={() => setImgError(true)}
        style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: 56, height: 56, borderRadius: 12,
        background: colors.bg, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <span style={{ fontSize: 9, fontWeight: 700, color: colors.text, letterSpacing: "0.08em" }}>
        {colors.label}
      </span>
    </div>
  );
}

function BrandOption({ label, description, selected, onSelect }) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%", background: "none", border: "none", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderRadius: 14, textAlign: "left",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"}
      onMouseLeave={e => e.currentTarget.style.background = "none"}
    >
      <div>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#1e293b" }}>{label}</p>
        {description && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>{description}</p>}
      </div>
      {selected && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </button>
  );
}

function BrandPickerSheet({ canonicalId, canonicalName, currentBrand, anyBrand, onSelect, onClose }) {
  const [brands, setBrands] = useState(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetchProductBrands(canonicalId)
      .then(data => setBrands(data.data || []))
      .catch(() => { setLoadError(true); setBrands([]); });
  }, [canonicalId]);

  return createPortal(
    <div
      style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}
    >
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)" }} />
      <div
        style={{
          position: "relative", width: "100%", maxWidth: 448,
          background: "#fff", borderRadius: "24px 24px 0 0",
          padding: "20px 20px 32px", maxHeight: "70vh", overflowY: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        <p style={{ margin: "0 0 2px", fontSize: 13, color: "#94a3b8" }}>Choose brand for</p>
        <p style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 700, color: "#1e293b" }}>{canonicalName}</p>

        {loadError && (
          <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "16px 0" }}>
            Unable to load brands — tap "Any brand" to continue.
          </p>
        )}

        {brands === null && !loadError && (
          <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #16a34a", borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
          </div>
        )}

        {brands !== null && (
          <div>
            <BrandOption
              label="Any brand"
              description="Match any available brand at comparison"
              selected={anyBrand}
              onSelect={() => onSelect(null, true)}
            />
            {brands.map(brand => (
              <BrandOption
                key={brand}
                label={brand}
                selected={!anyBrand && currentBrand === brand}
                onSelect={() => onSelect(brand, false)}
              />
            ))}
            {brands.length === 0 && !loadError && (
              <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "8px 0 0" }}>
                No specific brands found — "Any brand" will match.
              </p>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function CartItemCard({ item, index, onRemove, onDecrement, onIncrement, onBrandSelect }) {
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const brand = item.brand ?? null;
  const anyBrand = item.anyBrand !== false;
  const qty = item.item_count || 1;

  return (
    <>
      <div style={{
        background: "#fff", border: "1px solid #f1f5f9",
        borderRadius: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", overflow: "hidden",
      }}>
        {/* Top section */}
        <div style={{ padding: "14px 14px 10px", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <CategoryThumb category={item.product_category} imageUrl={item.image_url} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, lineHeight: 1.4, wordBreak: "break-word", color: "#1e293b" }}>
              {item.canonical_id && (
                <>
                  <button
                    onClick={() => setShowBrandPicker(true)}
                    style={{
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontSize: 14, fontWeight: 700,
                      color: anyBrand ? "#94a3b8" : "#16a34a",
                      borderBottom: anyBrand ? "1.5px dashed #cbd5e1" : "1.5px solid #86efac",
                      lineHeight: "inherit",
                    }}
                  >
                    {anyBrand ? "Any brand" : (brand || "Any brand")}
                  </button>
                  {" "}
                </>
              )}
              {item.raw_item_text}
            </p>
            {(item.weight_raw || item.quantity) && (
              <p style={{ margin: "3px 0 0", fontSize: 11, color: "#94a3b8" }}>
                {item.weight_raw || `${item.quantity}${item.quantity_unit || ""}`}
              </p>
            )}
            {anyBrand && item.canonical_id && (
              <p style={{ margin: "3px 0 0", fontSize: 10, color: "#94a3b8" }}>Matches any available brand</p>
            )}
          </div>
        </div>

        {/* Bottom section */}
        <div style={{
          padding: "8px 14px 14px", borderTop: "1px solid #f8fafc",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <button
            onClick={() => onRemove(index)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "4px 6px", borderRadius: 8,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#cbd5e1" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4M6 7v5M10 7v5M3 4l.8 9.5A.5.5 0 004.3 14h7.4a.5.5 0 00.5-.5L13 4"/>
            </svg>
            <span style={{ fontSize: 11, color: "#cbd5e1" }}>Remove</span>
          </button>

          <div style={{
            border: "1.5px solid rgba(22,163,74,0.2)", borderRadius: 10,
            height: 32, display: "flex", overflow: "hidden",
          }}>
            <button
              onClick={() => onDecrement(index)}
              disabled={qty <= 1}
              style={{
                width: 32, background: "none", border: "none",
                cursor: qty <= 1 ? "default" : "pointer",
                fontSize: 15, fontWeight: 700,
                color: qty <= 1 ? "#cbd5e1" : "#16a34a",
              }}
            >−</button>
            <div style={{
              width: 32, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#1e293b",
            }}>
              {qty}
            </div>
            <button
              onClick={() => onIncrement(index)}
              style={{ width: 32, background: "none", border: "none", cursor: "pointer", fontSize: 15, fontWeight: 700, color: "#16a34a" }}
            >+</button>
          </div>
        </div>
      </div>

      {showBrandPicker && (
        <BrandPickerSheet
          canonicalId={item.canonical_id}
          canonicalName={item.raw_item_text}
          currentBrand={brand}
          anyBrand={anyBrand}
          onSelect={(b, ab) => { onBrandSelect(item.canonical_id, b, ab); setShowBrandPicker(false); }}
          onClose={() => setShowBrandPicker(false)}
        />
      )}
    </>
  );
}

export default function CartPage() {
  const { items, removeItem, updateItem, clearCart, setBrand } = useContext(CartContext);
  const [finding, setFinding] = useState(false);
  const navigate = useNavigate();
  const session = getAuthSession();

  const handleDecrement = (index) => {
    const qty = items[index].item_count || 1;
    if (qty <= 1) return;
    updateItem(index, { item_count: qty - 1 });
  };

  const handleIncrement = (index) => {
    updateItem(index, { item_count: (items[index].item_count || 1) + 1 });
  };

  const handleFindBestPrice = async () => {
    if (!items.length || finding) return;
    if (!session) {
      navigate("/?login=1");
      return;
    }
    setFinding(true);
    try {
      const listsRes = await fetchLists();
      const listsData = listsRes.ok ? await listsRes.json() : null;
      let list = listsData?.data?.[0];
      if (!list) {
        const createRes = await createList("My Shopping List");
        const createData = await createRes.json();
        list = createData.data || createData;
      }
      await mergeCartIntoList(list.id, items);
      clearCart();
      navigate(`/compare/${list.id}`);
    } catch (err) {
      console.error("Find best price error:", err);
    } finally {
      setFinding(false);
    }
  };

  return (
    <div style={{
      background: "radial-gradient(circle at top, #ffffff 0%, #f8fbff 32%, #f3f6fb 100%)",
      minHeight: "100vh",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      {/* Header */}
      <div style={{
        background: "#fff", borderBottom: "1px solid #f1f5f9",
        position: "sticky", top: 0, zIndex: 50,
        padding: "14px 16px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#94a3b8", padding: 0, lineHeight: 1 }}
        >←</button>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1e293b" }}>Cart</p>
          <p style={{ margin: "1px 0 0", fontSize: 11, color: "#94a3b8" }}>
            {items.length} item{items.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-2xl mx-auto px-4 py-4 pb-[120px]">
        {items.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 80, textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
              </svg>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "#1e293b" }}>Your cart is empty</p>
            <p style={{ margin: "0 0 28px", fontSize: 13, color: "#94a3b8", lineHeight: 1.6, maxWidth: 280 }}>
              Add products from the catalog to start comparing prices across stores.
            </p>
            <button
              onClick={() => navigate("/products")}
              style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 14, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
            >
              Browse products
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {items.map((item, index) => (
              <CartItemCard
                key={item.canonical_id || String(index)}
                item={item}
                index={index}
                onRemove={removeItem}
                onDecrement={handleDecrement}
                onIncrement={handleIncrement}
                onBrandSelect={setBrand}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "#fff", borderTop: "1px solid #f1f5f9",
        padding: "12px 16px 20px", zIndex: 40,
      }}>
        <div className="max-w-2xl mx-auto">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              {items.length} item{items.length !== 1 ? "s" : ""} in list
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Prices shown at comparison →</span>
          </div>
          <button
            onClick={handleFindBestPrice}
            disabled={!items.length || finding}
            style={{
              width: "100%", height: 52, borderRadius: 16, border: "none",
              cursor: items.length && !finding ? "pointer" : "not-allowed",
              background: items.length ? "#16a34a" : "#f1f5f9",
              color: items.length ? "#fff" : "#94a3b8",
              fontSize: 15, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            }}
          >
            <span>{finding ? "Saving list…" : "Find best price"}</span>
            {!finding && <span>→</span>}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
