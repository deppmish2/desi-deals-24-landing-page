import React, { useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

export default function RedirectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState("before"); // "before" | "after"

  const url = searchParams.get("url") || "";
  const store = searchParams.get("store") || "the store";

  function handleBuyNow() {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    setPhase("after");
  }

  if (!url) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[#64748b]">Invalid redirect link.</p>
          <button
            onClick={() => navigate("/")}
            className="mt-4 text-sm font-semibold text-[#16a34a] hover:underline"
          >
            Go home
          </button>
        </div>
      </div>
    );
  }

  if (phase === "before") {
    return (
      <div className="min-h-screen bg-[#f8f6f6] flex items-center justify-center px-4 py-16">
        <div className="bg-white border border-[#f1f5f9] rounded-[24px] shadow-[0px_20px_25px_-5px_rgba(226,232,240,0.5),0px_8px_10px_-6px_rgba(226,232,240,0.5)] w-full max-w-[672px] overflow-hidden">
          {/* Hero illustration */}
          <div className="relative bg-[#f8fafc] border-b border-[#f1f5f9] h-[256px] flex items-center justify-center">
            {/* Green blur blobs */}
            <div className="absolute top-10 left-10 w-24 h-24 bg-[#16a34a] rounded-full blur-[32px] opacity-10 pointer-events-none" />
            <div className="absolute bottom-10 right-10 w-32 h-32 bg-[#16a34a] rounded-full blur-[32px] opacity-10 pointer-events-none" />
            {/* App icon → arrow → store icon */}
            <div className="relative flex items-center gap-8">
              {/* DesiDeals24 app icon */}
              <div className="w-20 h-20 bg-white border border-[#f1f5f9] rounded-[16px] shadow-sm flex items-center justify-center">
                <svg width="24" height="30" viewBox="0 0 24 30" fill="none">
                  <path
                    d="M4 9h16l-2 16H6L4 9z"
                    stroke="#16a34a"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 9V7a4 4 0 018 0v2"
                    stroke="#16a34a"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              {/* Arrow */}
              <svg width="19" height="9" viewBox="0 0 19 9" fill="none">
                <path
                  d="M1 4.5h17M13.5 1L18 4.5 13.5 8"
                  stroke="#94a3b8"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {/* Store icon */}
              <div className="w-20 h-20 bg-white border border-[#f1f5f9] rounded-[16px] shadow-sm flex items-center justify-center overflow-hidden">
                <span className="text-lg font-bold text-[#0f172a]">
                  {store.slice(0, 2).toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="px-10 py-10 flex flex-col items-center gap-4">
            <h1 className="text-[30px] font-bold text-[#0f172a] text-center leading-[37.5px]">
              Make sure to come back here after
              <br />
              completing order at {store}
            </h1>
            <p className="text-[18px] text-[#475569] text-center leading-[28px] max-w-[448px]">
              You are being redirected to {store} to complete your purchase
              securely.{" "}
              <strong className="font-bold text-[#ef4444]">
                Don't close this tab!
              </strong>
            </p>
            <div className="flex flex-col items-center gap-3 pt-6 w-full">
              <button
                onClick={handleBuyNow}
                className="flex items-center justify-center gap-3 w-full max-w-[384px] bg-[#16a34a] text-white font-bold text-[16px] py-4 rounded-[12px] shadow-[0px_10px_15px_-3px_rgba(22,163,74,0.2),0px_4px_6px_-4px_rgba(22,163,74,0.2)] hover:bg-[#15803d] transition-colors"
              >
                Buy on {store}
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path
                    d="M3 15L15 3M15 3H7M15 3V11"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                onClick={() => navigate(-1)}
                className="text-sm text-[#94a3b8] hover:text-[#64748b] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // phase === "after"
  return (
    <div className="min-h-screen bg-[#f8f6f6] flex items-center justify-center px-4 py-16">
      <div className="bg-white border border-[#e2e8f0] rounded-[12px] shadow-[0px_20px_25px_-5px_rgba(0,0,0,0.1),0px_8px_10px_-6px_rgba(0,0,0,0.1)] w-full max-w-[640px] overflow-hidden">
        {/* Green-tinted header with clock icon */}
        <div className="bg-[rgba(22,163,74,0.05)] h-[192px] flex items-center justify-center relative">
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(15,23,42,0.8) 0%, transparent 70%)",
            }}
          />
          <div className="relative bg-white border-4 border-[rgba(22,163,74,0.2)] rounded-full w-20 h-20 flex items-center justify-center shadow-[0px_10px_15px_-3px_rgba(0,0,0,0.1),0px_4px_6px_-4px_rgba(0,0,0,0.1)]">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <circle
                cx="15"
                cy="15"
                r="11"
                stroke="#16a34a"
                strokeWidth="1.8"
              />
              <path
                d="M15 9v6l4 4"
                stroke="#16a34a"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="px-12 pt-8 pb-10 flex flex-col gap-8">
          <h1 className="text-[30px] font-bold text-[#0f172a] text-center leading-[36px] tracking-[-0.75px]">
            Completed your purchase at{" "}
            <span className="font-extrabold">{store}?</span>
          </h1>

          {/* Progress tracking */}
          <div className="bg-[#f8fafc] border border-[#f1f5f9] rounded-[12px] p-6 flex flex-col gap-4">
            <div className="flex items-end justify-between">
              <div className="flex flex-col gap-1">
                <p className="text-[12px] font-bold text-[#64748b] uppercase tracking-[0.6px]">
                  Order Status
                </p>
                <p className="text-[18px] font-semibold text-[#0f172a]">
                  Waiting for confirmation
                </p>
              </div>
              <p className="text-[18px] font-bold text-[#f97316]">75%</p>
            </div>
            <div className="bg-[#e2e8f0] rounded-full h-3 overflow-hidden">
              <div
                className="bg-[#f97316] h-full rounded-full"
                style={{ width: "75%" }}
              />
            </div>
            <p className="text-[14px] font-medium text-[#475569]">
              Confirm below as soon as you have paid at {store}.
            </p>
          </div>

          {/* Primary action */}
          <div className="flex flex-col gap-4 pt-2">
            <button
              onClick={() => navigate("/orders")}
              className="w-full h-14 bg-[#16a34a] text-white font-bold text-[18px] rounded-[12px] shadow-[0px_10px_15px_-3px_rgba(22,163,74,0.2),0px_4px_6px_-4px_rgba(22,163,74,0.2)] tracking-[-0.45px] hover:bg-[#15803d] transition-colors"
            >
              Mark as Completed &amp; Save to History
            </button>

            {/* Secondary actions */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={() => {
                  if (url) window.open(url, "_blank", "noopener,noreferrer");
                }}
                className="flex-1 h-12 bg-[#f1f5f9] text-[#334155] font-bold text-[14px] rounded-[12px] flex items-center justify-center gap-2 hover:bg-[#e2e8f0] transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M3 13L13 3M13 3H7M13 3V9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                I'm still shopping
              </button>
              <button
                onClick={() => navigate("/deals")}
                className="flex-1 h-12 text-[#64748b] font-bold text-[14px] rounded-[12px] flex items-center justify-center gap-2 hover:bg-[#f8fafc] transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle
                    cx="8"
                    cy="8"
                    r="6.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M8 5v3.5l2.5 2.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                I never ordered anything
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
