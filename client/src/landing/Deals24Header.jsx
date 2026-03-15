import React from "react";
import { Link } from "react-router-dom";

export default function Deals24Header() {
  return (
    <header className="backdrop-blur-md bg-white/80 border-b border-slate-200">
      <div className="h-16 max-w-[1280px] mx-auto px-6 sm:px-10 flex items-center justify-between gap-6">
        <Link to="/24deals" className="flex items-center gap-2 no-underline">
          <img
            src="/landing/dd24-logo.svg"
            alt="DesiDeals24"
            className="w-5 h-6 object-contain"
          />
          <span className="font-['Plus_Jakarta_Sans',sans-serif] font-extrabold tracking-[-0.5px] text-[20px] leading-[28px] text-[#141414]">
            DesiDeals24
          </span>
          <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-slate-400 -translate-y-1">
            · Beta
          </span>
        </Link>

        <div className="rounded-full border border-[#dcfce7] bg-[#f0fdf4] px-4 py-2 text-[12px] font-bold uppercase tracking-[1.4px] text-[#166534]">
          Daily 24 live deals
        </div>
      </div>
    </header>
  );
}
