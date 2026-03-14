import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  dealsNavSelectionEventName,
  isDealsNavSelected,
} from "../utils/deals-nav-selection";

const NAV_ITEMS = [
  {
    to: "/",
    label: "Home",
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M3 12L12 4l9 8"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5 10v9a1 1 0 001 1h4v-4h4v4h4a1 1 0 001-1v-9"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    to: "/orders",
    label: "History",
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect
          x="4"
          y="3"
          width="16"
          height="18"
          rx="2"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
        />
        <path
          d="M8 8h8M8 12h8M8 16h5"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    to: "/deals",
    label: "Deals",
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path
          d="M7 7h.01M17 17h.01"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M3.5 12.5L12.5 3.5a2 2 0 012.83 0l5.17 5.17a2 2 0 010 2.83l-9 9a2 2 0 01-2.83 0L3.5 15.33a2 2 0 010-2.83z"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
  {
    to: "/list",
    label: "Smart List",
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="2"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
        />
        <path
          d="M7 8h10M7 12h10M7 16h6"
          stroke={active ? "#16a34a" : "#475569"}
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

export default function BottomNav() {
  const location = useLocation();
  const [dealsSelected, setDealsSelected] = React.useState(() =>
    isDealsNavSelected(),
  );

  React.useEffect(() => {
    const eventName = dealsNavSelectionEventName();
    function onDealsSelectionChange() {
      setDealsSelected(isDealsNavSelected());
    }
    window.addEventListener(eventName, onDealsSelectionChange);
    return () => window.removeEventListener(eventName, onDealsSelectionChange);
  }, []);

  function isActive(to) {
    if (to === "/") return location.pathname === "/";
    if (to === "/deals") {
      const onDealsRoute =
        location.pathname === "/deals" ||
        location.pathname.startsWith("/deals/");
      return onDealsRoute && dealsSelected;
    }
    return location.pathname.startsWith(to);
  }

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 px-4 mb-4"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div
        className="bg-white rounded-2xl border border-gray-100 flex items-center justify-around py-3"
        style={{
          boxShadow:
            "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
        }}
      >
        {NAV_ITEMS.map(({ to, label, icon }) => {
          const active = isActive(to);
          return (
            <Link
              key={to}
              to={to}
              className="flex flex-col items-center justify-center gap-1 no-underline px-4"
            >
              {icon(active)}
              <span
                className="text-xs font-medium"
                style={{ color: active ? "#16a34a" : "#475569" }}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
