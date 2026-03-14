import React from "react";
import { Link } from "react-router-dom";

function ProfileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M20 21a8 8 0 10-16 0"
        stroke="#0f172a"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13a4 4 0 100-8 4 4 0 000 8z"
        stroke="#0f172a"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Deals24Header() {
  return (
    <header className="backdrop-blur-md bg-white/80 border-b border-slate-200">
      <div className="h-16 max-w-[1280px] mx-auto px-10 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2 no-underline">
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
        </div>

        <div className="flex items-center gap-6">
          <div className="h-8 w-px bg-slate-200" aria-hidden="true" />
          <Link
            to="/profile"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Profile"
          >
            <ProfileIcon />
          </Link>
        </div>
      </div>
    </header>
  );
}
