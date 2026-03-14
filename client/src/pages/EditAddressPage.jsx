import React, { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { fetchMe, updateMe } from "../utils/api";

function Toggle({ active, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        position: "relative",
        flexShrink: 0,
        width: 44,
        height: 24,
        borderRadius: 9999,
        backgroundColor: active ? "#16a34a" : "#e2e8f0",
        transition: "background-color 0.2s ease",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: active ? 22 : 2,
          width: 20,
          height: 20,
          backgroundColor: "white",
          borderRadius: 9999,
          boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
          transition: "left 0.2s ease",
        }}
      />
    </button>
  );
}

function FormField({ label, required, children, className = "" }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label className="flex items-center gap-1 text-[13px] font-semibold text-[#475569] px-1">
        {label}
        {required && <span className="text-[#ef4444]">*</span>}
      </label>
      {children}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = "text", disabled }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[12px] px-4 py-3 text-[14px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] transition-colors w-full disabled:opacity-60"
    />
  );
}

function MapPreview() {
  return (
    <div className="relative w-full h-[200px] rounded-[20px] overflow-hidden">
      {/* Grayscale map placeholder */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, #e2e8f0 0%, #f1f5f9 50%, #e2e8f0 100%)",
          filter: "grayscale(1)",
        }}
      >
        <svg
          className="w-full h-full opacity-20"
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
        >
          {[25, 50, 75, 100, 125, 150, 175].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="400"
              y2={y}
              stroke="#475569"
              strokeWidth="0.5"
            />
          ))}
          {[40, 90, 140, 190, 240, 290, 340, 390].map((x) => (
            <line
              key={x}
              x1={x}
              y1="0"
              x2={x}
              y2="200"
              stroke="#475569"
              strokeWidth="0.5"
            />
          ))}
          <path
            d="M0 100 Q100 80 200 100 Q300 120 400 100"
            stroke="#94a3b8"
            strokeWidth="3"
            fill="none"
          />
          <path
            d="M100 0 Q120 60 100 200"
            stroke="#94a3b8"
            strokeWidth="2"
            fill="none"
          />
          <path
            d="M250 0 Q270 100 250 200"
            stroke="#94a3b8"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      </div>

      {/* Center pin */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-10 h-10 bg-[#475569] rounded-full flex items-center justify-center shadow-lg">
          <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
            <path
              d="M9 1a7 7 0 017 7c0 5-7 13-7 13S2 13 2 8a7 7 0 017-7z"
              fill="white"
            />
            <circle cx="9" cy="8" r="2.5" fill="#475569" />
          </svg>
        </div>
      </div>

      {/* Preview label pill */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white text-[#475569] font-bold text-[12px] uppercase tracking-[0.7px] px-4 py-1.5 rounded-full shadow">
        PREVIEW LOCATION
      </div>
    </div>
  );
}

const COUNTRIES = [
  "Germany",
  "Austria",
  "Switzerland",
  "Netherlands",
  "Belgium",
];

export default function EditAddressPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isNew = id === "new" || !id;

  const [form, setForm] = useState({
    fullName: "",
    whatsapp: "",
    street: "",
    houseNo: "",
    postcode: "",
    city: "",
    country: "Germany",
    setDefault: true,
    quickSearch: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((res) => {
        if (cancelled) return;
        const user = res?.data;
        if (!user) {
          navigate("/login");
          return;
        }
        setForm((prev) => ({
          ...prev,
          fullName: user.name || "",
          postcode: user.postcode || "",
          city: user.city || "",
          whatsapp: user.phone || "",
        }));
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

  async function handleSave(e) {
    if (e) e.preventDefault();
    const postcode = String(form.postcode || "").trim();
    const city = String(form.city || "").trim();

    if (!postcode) {
      setError("Postcode is required.");
      return;
    }

    setError("");
    setSaving(true);
    try {
      await updateMe({ postcode, city: city || null });
      navigate("/addresses");
    } catch (err) {
      setError(err?.message || "Failed to save address.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-16">
      <div className="max-w-2xl mx-auto px-4 lg:px-8 pt-8 pb-12">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[13px] text-[#94a3b8] mb-6">
          <Link
            to="/profile"
            className="hover:text-[#16a34a] transition-colors"
          >
            Account
          </Link>
          <svg width="6" height="10" viewBox="0 0 6 10" fill="none">
            <path
              d="M1 1l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <Link
            to="/addresses"
            className="hover:text-[#16a34a] transition-colors"
          >
            Addresses
          </Link>
          <svg width="6" height="10" viewBox="0 0 6 10" fill="none">
            <path
              d="M1 1l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-[#475569] font-medium">
            {isNew ? "Add Address" : "Edit Address"}
          </span>
        </div>

        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-[28px] font-black text-[#0f172a] tracking-[-0.5px]">
            {isNew ? "Add New Address" : "Edit Address"}
          </h1>
          <p className="text-[14px] text-[#64748b] mt-1">
            {isNew
              ? "Add a new delivery address to your account"
              : "Update your delivery address details"}
          </p>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <p className="text-[#64748b] text-sm">Loading...</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex flex-col gap-5">
            {/* Form card */}
            <div className="bg-white border border-[#e2e8f0] rounded-[24px] p-6 flex flex-col gap-5">
              {/* Quick Address Search */}
              <div>
                <label className="text-[13px] font-semibold text-[#475569] px-1 mb-1.5 block">
                  Quick Address Search
                </label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2">
                    <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
                      <path
                        d="M8 1a6 6 0 016 6c0 4-6 12-6 12S2 11 2 7a6 6 0 016-6z"
                        stroke="#16a34a"
                        strokeWidth="1.4"
                      />
                      <circle
                        cx="8"
                        cy="7"
                        r="2"
                        stroke="#16a34a"
                        strokeWidth="1.4"
                      />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={form.quickSearch}
                    onChange={set("quickSearch")}
                    placeholder="Search for your address..."
                    className="w-full bg-[#f8fafc] border border-[#e2e8f0] rounded-[24px] pl-11 pr-4 py-3 text-[14px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] transition-colors"
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="flex-1 border-t border-[#f1f5f9]" />
                <span className="text-[12px] text-[#94a3b8] font-medium">
                  or fill manually
                </span>
                <div className="flex-1 border-t border-[#f1f5f9]" />
              </div>

              {/* 2-column grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Full Name" required>
                  <Input
                    value={form.fullName}
                    onChange={set("fullName")}
                    placeholder="Jane Doe"
                  />
                </FormField>

                <FormField label="WhatsApp Number">
                  <div className="flex">
                    <div className="bg-[#f8fafc] border border-r-0 border-[#e2e8f0] rounded-l-[12px] px-3 py-3 flex items-center shrink-0">
                      <span className="text-[14px] text-[#475569] font-medium">
                        🇩🇪 +49
                      </span>
                      <svg
                        width="10"
                        height="6"
                        viewBox="0 0 10 6"
                        fill="none"
                        className="ml-1.5"
                      >
                        <path
                          d="M1 1l4 4 4-4"
                          stroke="#94a3b8"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <input
                      type="tel"
                      value={form.whatsapp}
                      onChange={set("whatsapp")}
                      placeholder="176 1234 5678"
                      className="flex-1 bg-[#f8fafc] border border-[#e2e8f0] rounded-r-[12px] px-4 py-3 text-[14px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] transition-colors min-w-0"
                    />
                  </div>
                </FormField>

                <FormField label="Street Name" required>
                  <Input
                    value={form.street}
                    onChange={set("street")}
                    placeholder="Musterstraße"
                  />
                </FormField>

                <FormField label="House / Flat No." required>
                  <Input
                    value={form.houseNo}
                    onChange={set("houseNo")}
                    placeholder="42a"
                  />
                </FormField>

                <FormField label="Postcode" required>
                  <Input
                    value={form.postcode}
                    onChange={set("postcode")}
                    placeholder="10115"
                  />
                </FormField>

                <FormField label="City" required>
                  <Input
                    value={form.city}
                    onChange={set("city")}
                    placeholder="Berlin"
                  />
                </FormField>

                <FormField label="Country" className="sm:col-span-2">
                  <select
                    value={form.country}
                    onChange={set("country")}
                    className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[12px] px-4 py-3 text-[14px] text-[#0f172a] focus:outline-none focus:border-[#16a34a] transition-colors w-full appearance-none"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              {/* Set as default toggle */}
              <div
                className="flex items-center justify-between px-4 py-3 rounded-[24px]"
                style={{ backgroundColor: "#f8fafc" }}
              >
                <div>
                  <p className="text-[14px] font-semibold text-[#0f172a]">
                    Set as Default Address
                  </p>
                  <p className="text-[12px] text-[#64748b] mt-0.5">
                    Use this address for all future orders
                  </p>
                </div>
                <Toggle
                  active={form.setDefault}
                  onChange={() =>
                    setForm((prev) => ({
                      ...prev,
                      setDefault: !prev.setDefault,
                    }))
                  }
                />
              </div>
            </div>

            {/* Map preview */}
            <div className="bg-white border border-[#e2e8f0] rounded-[24px] p-5">
              <p className="text-[13px] font-semibold text-[#475569] mb-3">
                Map Preview
              </p>
              <MapPreview />
            </div>

            {/* Error */}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 border border-[#e2e8f0] text-[#475569] font-bold text-[15px] py-3.5 rounded-[16px] hover:bg-[#f8fafc] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || loading}
                className="flex-1 bg-[#16a34a] text-white font-bold text-[15px] py-3.5 rounded-[16px] disabled:opacity-60 hover:bg-[#15803d] transition-colors"
                style={{ boxShadow: "0px 8px 20px rgba(22,163,74,0.25)" }}
              >
                {saving ? "Saving..." : "Save Address"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
