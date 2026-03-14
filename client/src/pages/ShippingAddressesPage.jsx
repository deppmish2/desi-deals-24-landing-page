import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMe } from "../utils/api";

function PinIcon({ color = "#64748b" }) {
  return (
    <svg width="14" height="17" viewBox="0 0 14 17" fill="none">
      <path
        d="M7 1a5.5 5.5 0 015.5 5.5C12.5 10.5 7 16 7 16S1.5 10.5 1.5 6.5A5.5 5.5 0 017 1z"
        stroke={color}
        strokeWidth="1.3"
      />
      <circle cx="7" cy="6.5" r="1.75" stroke={color} strokeWidth="1.3" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M1.5 1h2.8l1.4 3.2-1.7 1.4A7.5 7.5 0 007.4 8.9l1.4-1.7L12 8.6v2.6a1 1 0 01-1 1A10 10 0 01.5 2a1 1 0 011-1z"
        stroke="#64748b"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M9.5 1.5L12.5 4.5L4.5 12.5H1.5V9.5L9.5 1.5z"
        stroke="#475569"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="14" viewBox="0 0 13 14" fill="none">
      <path
        d="M1 3.5h11M4 3.5V2.5A1 1 0 015 1.5h3a1 1 0 011 1v1M2 3.5l.8 8A1 1 0 003.8 12.5h5.4a1 1 0 001-.95L11 3.5"
        stroke="#dc2626"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MapPlaceholder({ isDefault, grayscale }) {
  return (
    <div
      className="w-full h-[160px] relative overflow-hidden flex items-center justify-center"
      style={{
        background: grayscale
          ? "linear-gradient(135deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%)"
          : "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 50%, #86efac 100%)",
        filter: grayscale ? "grayscale(1)" : "none",
      }}
    >
      {/* Map grid lines */}
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        viewBox="0 0 260 160"
        preserveAspectRatio="none"
      >
        {[20, 40, 60, 80, 100, 120, 140].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="260"
            y2={y}
            stroke="#475569"
            strokeWidth="0.5"
          />
        ))}
        {[30, 65, 100, 135, 170, 205, 240].map((x) => (
          <line
            key={x}
            x1={x}
            y1="0"
            x2={x}
            y2="160"
            stroke="#475569"
            strokeWidth="0.5"
          />
        ))}
        {/* Road lines */}
        <path
          d="M0 80 Q65 60 130 80 Q195 100 260 80"
          stroke="#94a3b8"
          strokeWidth="2"
          fill="none"
        />
        <path
          d="M65 0 Q80 50 65 160"
          stroke="#94a3b8"
          strokeWidth="1.5"
          fill="none"
        />
        <path
          d="M160 0 Q175 80 160 160"
          stroke="#94a3b8"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>

      {/* Pin */}
      <div
        className="flex items-center justify-center w-10 h-10 rounded-full z-10"
        style={{
          backgroundColor: isDefault ? "#16a34a" : "#475569",
          boxShadow: "0px 4px 12px rgba(0,0,0,0.25)",
        }}
      >
        <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
          <path
            d="M9 1a7 7 0 017 7c0 5-7 13-7 13S2 13 2 8a7 7 0 017-7z"
            fill="white"
          />
          <circle
            cx="9"
            cy="8"
            r="2.5"
            fill={isDefault ? "#16a34a" : "#475569"}
          />
        </svg>
      </div>

      {/* Default badge on map */}
      {isDefault && (
        <div
          className="absolute top-3 left-3 text-[11px] font-bold uppercase tracking-[0.6px] px-2.5 py-1 rounded-full"
          style={{ backgroundColor: "#16a34a", color: "white" }}
        >
          DEFAULT
        </div>
      )}
    </div>
  );
}

function AddressCard({
  name,
  addressLine,
  phone,
  isDefault,
  onEdit,
  onDelete,
  onSetDefault,
}) {
  return (
    <div
      className="bg-white rounded-[24px] overflow-hidden flex flex-col"
      style={{
        border: isDefault ? "2px solid #16a34a" : "1px solid #e2e8f0",
        boxShadow: isDefault
          ? "0px 4px 20px rgba(22,163,74,0.12)"
          : "0px 1px 4px rgba(0,0,0,0.05)",
      }}
    >
      <MapPlaceholder isDefault={isDefault} grayscale={!isDefault} />

      <div className="p-4 flex flex-col gap-3">
        {/* Name row + actions */}
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-bold text-[#0f172a]">
            {name || "My Address"}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onEdit}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-[#f8fafc] hover:bg-[#e2e8f0] transition-colors"
              aria-label="Edit address"
            >
              <PencilIcon />
            </button>
            {!isDefault && (
              <button
                onClick={onDelete}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-[#fef2f2] hover:bg-[#fee2e2] transition-colors"
                aria-label="Delete address"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        </div>

        {/* Address line */}
        <div className="flex items-start gap-2">
          <div className="mt-0.5 shrink-0">
            <PinIcon color={isDefault ? "#16a34a" : "#94a3b8"} />
          </div>
          <p className="text-[13px] text-[#475569] leading-[20px]">
            {addressLine}
          </p>
        </div>

        {/* Phone */}
        {phone && (
          <div className="flex items-center gap-2">
            <PhoneIcon />
            <span className="text-[13px] text-[#64748b]">{phone}</span>
          </div>
        )}

        {/* Set as default */}
        {!isDefault && onSetDefault && (
          <button
            onClick={onSetDefault}
            className="text-[13px] font-semibold text-[#16a34a] hover:underline text-left"
          >
            Set as Default
          </button>
        )}

        {isDefault && (
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-[#16a34a] rounded-full" />
            <span className="text-[12px] font-semibold text-[#16a34a]">
              Default Address
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function AddNewCard({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-[24px] border-2 border-dashed border-[#cbd5e1] flex flex-col items-center justify-center gap-3 min-h-[280px] hover:border-[#16a34a] hover:bg-[rgba(22,163,74,0.02)] transition-colors group"
    >
      <div
        className="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
        style={{ backgroundColor: "rgba(22,163,74,0.1)" }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M10 3v14M3 10h14"
            stroke="#16a34a"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="text-[14px] font-semibold text-[#64748b] group-hover:text-[#16a34a] transition-colors">
        Add New Address
      </span>
    </button>
  );
}

export default function ShippingAddressesPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [user, setUser] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((res) => {
        if (cancelled) return;
        const me = res?.data || null;
        if (!me) {
          navigate("/login");
          return;
        }
        setUser(me);
      })
      .catch(() => {
        if (!cancelled) navigate("/login");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const hasAddress = useMemo(() => {
    const postcode = String(user?.postcode || "").trim();
    const city = String(user?.city || "").trim();
    return Boolean(postcode || city);
  }, [user]);

  const addressLine = useMemo(() => {
    const postcode = String(user?.postcode || "").trim();
    const city = String(user?.city || "").trim();
    const parts = [postcode, city].filter(Boolean);
    return parts.length > 0
      ? `${parts.join(" ")}, Germany`
      : "No address saved yet";
  }, [user]);

  const displayName = user?.name || user?.email?.split("@")[0] || "My Address";

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-16">
      <div className="max-w-4xl mx-auto px-4 lg:px-8 pt-8 pb-12">
        {/* Page header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[30px] font-black text-[#0f172a] leading-tight tracking-[-0.5px]">
              Shipping Addresses
            </h1>
            <p className="text-[14px] text-[#64748b] mt-1">
              Manage your saved delivery addresses
            </p>
          </div>
          <button
            onClick={() => navigate("/addresses/new")}
            className="flex items-center gap-2 bg-[#16a34a] text-white font-bold text-[14px] px-5 py-2.5 rounded-full hover:bg-[#15803d] transition-colors"
            style={{ boxShadow: "0px 4px 12px rgba(22,163,74,0.25)" }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M6 1v10M1 6h10"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            Add New Address
          </button>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <p className="text-[#64748b] text-sm">Loading addresses...</p>
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {hasAddress && (
              <AddressCard
                name={displayName}
                addressLine={addressLine}
                phone={user?.phone || ""}
                isDefault={true}
                onEdit={() => navigate("/addresses/me/edit")}
              />
            )}
            <AddNewCard onClick={() => navigate("/addresses/new")} />
          </div>
        )}
      </div>
    </div>
  );
}
