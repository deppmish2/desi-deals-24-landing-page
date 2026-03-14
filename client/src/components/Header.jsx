import React, { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  buildDealsSearchPath,
  fetchMe,
  fetchSuggestions,
  getAuthSession,
  logoutUser,
} from "../utils/api";
import {
  countSmartListItems,
  readSmartListSessionDrafts,
} from "../utils/smartListSession";
import {
  dealsNavSelectionEventName,
  isDealsNavSelected,
  setDealsNavSelected,
} from "../utils/deals-nav-selection";

function readCartCount() {
  return countSmartListItems(readSmartListSessionDrafts());
}

const NAV_LINKS = [
  { to: "/deals", label: "Deals" },
  { to: "/deals?view=stores", label: "Stores" },
  { to: "/orders", label: "Orders" },
];

function ShoppingBagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="3"
        y1="6"
        x2="21"
        y2="6"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M16 10a4 4 0 01-8 0"
        stroke="#fff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"
        stroke="#0f172a"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        x1="3"
        y1="6"
        x2="21"
        y2="6"
        stroke="#0f172a"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16 10a4 4 0 01-8 0"
        stroke="#0f172a"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="3.5" stroke="#475569" strokeWidth="1.5" />
      <path
        d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6"
        stroke="#475569"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LocationPinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.375 4.5 8.5 4.5 8.5S12.5 9.375 12.5 6c0-2.485-2.015-4.5-4.5-4.5z" stroke="#475569" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="8" cy="6" r="1.5" stroke="#475569" strokeWidth="1.3" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="#475569" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="6.5" cy="6.5" r="5" stroke="#6b7280" strokeWidth="1.3" />
      <path
        d="M11 11l2.5 2.5"
        stroke="#6b7280"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function Header() {
  const [, setAuthTick] = useState(0);
  const [dealsSelected, setDealsSelected] = useState(() =>
    isDealsNavSelected(),
  );
  const [cartCount, setCartCount] = useState(() => readCartCount());
  const [search, setSearch] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [postcodeOpen, setPostcodeOpen] = useState(false);
  const [userAddress, setUserAddress] = useState(null);
  const searchWrapperRef = useRef(null);
  const postcodeWrapperRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const session = getAuthSession();
  const isLoggedIn = Boolean(session?.accessToken);

  React.useEffect(() => {
    function onAuthChange() {
      setAuthTick((v) => v + 1);
    }
    window.addEventListener("dd24-auth-changed", onAuthChange);
    return () => window.removeEventListener("dd24-auth-changed", onAuthChange);
  }, []);

  React.useEffect(() => {
    function onListChange() {
      setCartCount(readCartCount());
    }
    window.addEventListener("dd24-list-changed", onListChange);
    return () => window.removeEventListener("dd24-list-changed", onListChange);
  }, []);

  React.useEffect(() => {
    const eventName = dealsNavSelectionEventName();
    function onDealsSelectionChange() {
      setDealsSelected(isDealsNavSelected());
    }
    window.addEventListener(eventName, onDealsSelectionChange);
    return () => window.removeEventListener(eventName, onDealsSelectionChange);
  }, []);

  React.useEffect(() => {
    const query = String(search || "").trim();
    let cancelled = false;
    if (query.length < 2) {
      setSearchSuggestions([]);
      setSearchLoading(false);
      setSearchOpen(false);
      setActiveSearchIndex(-1);
      return () => {};
    }

    setSearchLoading(true);
    const timeoutId = setTimeout(() => {
      fetchSuggestions(query)
        .then((res) => {
          if (cancelled) return;
          const suggestions = (
            Array.isArray(res?.suggestions) ? res.suggestions : []
          )
            .map((item) => String(item || "").trim())
            .filter(Boolean)
            .slice(0, 8);
          setSearchSuggestions(suggestions);
          setSearchOpen(true);
          setActiveSearchIndex(-1);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchSuggestions([]);
          setSearchOpen(true);
          setActiveSearchIndex(-1);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [search]);

  React.useEffect(() => {
    function handleOutsideClick(event) {
      if (searchWrapperRef.current?.contains(event.target)) return;
      setSearchOpen(false);
      setActiveSearchIndex(-1);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  async function onLogout() {
    await logoutUser();
  }

  function isActive(to) {
    const path = to.split("?")[0];
    if (path === "/deals") {
      const onDeals =
        location.pathname === "/deals" ||
        location.pathname.startsWith("/deals/");
      return onDeals && dealsSelected;
    }
    return (
      location.pathname === path || location.pathname.startsWith(path + "/")
    );
  }

  function normalizeSuggestionList(values) {
    return (Array.isArray(values) ? values : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function executeSearch(term, options = {}) {
    const text = String(term == null ? search : term).trim();
    if (!text) return;
    const fromSuggestion = Boolean(options?.fromSuggestion);
    const fromEnter = Boolean(options?.fromEnter);
    const fallbackSuggestions = normalizeSuggestionList(searchSuggestions);

    const applyWithSuggestions = (values) => {
      const cleanSuggestions = normalizeSuggestionList(values);
      const useSuggestionBundle =
        fromSuggestion || (fromEnter && cleanSuggestions.length > 0);
      const selectedForBundle = fromSuggestion ? text : "";

      setDealsNavSelected(fromSuggestion);
      navigate(
        buildDealsSearchPath(text, {
          bundle: useSuggestionBundle,
          selected: selectedForBundle,
          suggestions: cleanSuggestions,
        }),
      );
      setSearch("");
      setSearchSuggestions([]);
      setSearchOpen(false);
      setActiveSearchIndex(-1);
    };

    if (fromSuggestion) {
      applyWithSuggestions(fallbackSuggestions);
      return;
    }

    if (fromEnter) {
      fetchSuggestions(text)
        .then((res) => {
          const fetchedSuggestions = normalizeSuggestionList(res?.suggestions);
          if (fetchedSuggestions.length > 0) {
            setSearchSuggestions(fetchedSuggestions);
            applyWithSuggestions(fetchedSuggestions);
            return;
          }
          applyWithSuggestions(fallbackSuggestions);
        })
        .catch(() => {
          applyWithSuggestions(fallbackSuggestions);
        });
      return;
    }

    applyWithSuggestions(fallbackSuggestions);
  }

  function handleSearch(event) {
    event.preventDefault();
    executeSearch(search, { fromEnter: true });
  }

  function handleSearchKeyDown(event) {
    if (event.key === "ArrowDown") {
      if (!searchOpen && searchSuggestions.length > 0) {
        setSearchOpen(true);
      }
      if (searchSuggestions.length > 0) {
        event.preventDefault();
        setActiveSearchIndex((prev) =>
          Math.min(prev + 1, searchSuggestions.length - 1),
        );
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (searchSuggestions.length > 0) {
        event.preventDefault();
        setActiveSearchIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }
    if (event.key === "Escape") {
      setSearchOpen(false);
      setActiveSearchIndex(-1);
      return;
    }
    if (event.key !== "Enter") return;
    if (
      searchOpen &&
      activeSearchIndex >= 0 &&
      searchSuggestions[activeSearchIndex]
    ) {
      event.preventDefault();
      executeSearch(searchSuggestions[activeSearchIndex], {
        fromSuggestion: true,
      });
      return;
    }
    event.preventDefault();
    executeSearch(search, { fromEnter: true });
  }

  return (
    <header
      className="sticky top-0 z-50 border-b border-[#e2e8f0]"
      style={{
        backdropFilter: "blur(6px)",
        backgroundColor: "rgba(255,255,255,0.9)",
      }}
    >
      {/* ── Desktop header ───────────────────────────────────────── */}
      <div className="hidden lg:flex items-center justify-between gap-8 px-10 py-3 max-w-[1440px] mx-auto">
        {/* Logo + Nav */}
        <div className="flex items-center gap-8 shrink-0">
          <Link
            to="/"
            className="flex items-center gap-2 no-underline shrink-0"
          >
            <img
              src="/landing/dd24-logo.svg"
              alt="DesiDeals24"
              className="w-10 h-10 object-contain"
            />
            <div className="flex items-baseline gap-1">
              <span
                className="font-extrabold text-[32px] text-[#0f172a] tracking-[-1.2px] leading-none"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                DesiDeals24
              </span>
              <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-slate-400 -translate-y-1">
                · Beta
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-6">
            {NAV_LINKS.map(({ to, label }) => {
              const active = isActive(to);
              return (
                <Link
                  key={label}
                  to={to}
                  className="no-underline text-[14px] transition-colors"
                  style={{
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontWeight: active ? 600 : 500,
                    color: active ? "#16a34a" : "#475569",
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Search + Location + Cart + Divider + Profile */}
        <div className="flex items-center gap-6 flex-1 justify-end">
          {/* Search bar */}
          <form
            ref={searchWrapperRef}
            onSubmit={handleSearch}
            className="relative flex-1 max-w-[360px]"
          >
            <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <SearchIcon />
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => {
                if (String(search || "").trim().length >= 2) {
                  setSearchOpen(true);
                }
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search deals..."
              className="w-full bg-[#f1f5f9] rounded-[8px] pl-9 pr-4 py-[9px] text-[14px] text-[#0f172a] placeholder:text-[#6b7280] focus:outline-none focus:ring-2 focus:ring-[#16a34a] focus:ring-opacity-30 transition-all"
            />
            {searchOpen && String(search || "").trim().length >= 2 && (
              <ul className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#e2e8f0] rounded-xl shadow-lg z-40 overflow-hidden">
                {searchLoading ? (
                  <li className="px-4 py-2.5 text-sm text-[#64748b]">
                    Searching...
                  </li>
                ) : searchSuggestions.length === 0 ? (
                  <li className="px-4 py-2.5 text-sm text-[#64748b]">
                    No suggestions found.
                  </li>
                ) : (
                  searchSuggestions.map((suggestion, index) => (
                    <li
                      key={`header-${suggestion}-${index}`}
                      onMouseDown={() =>
                        executeSearch(suggestion, { fromSuggestion: true })
                      }
                      onMouseEnter={() => setActiveSearchIndex(index)}
                      className={`px-4 py-2.5 text-sm cursor-pointer ${
                        index === activeSearchIndex
                          ? "bg-[#dcfce7] text-[#166534] font-medium"
                          : "text-[#334155] hover:bg-[#f8fafc]"
                      }`}
                    >
                      {suggestion}
                    </li>
                  ))
                )}
              </ul>
            )}
          </form>

          {/* Location */}
          <div ref={postcodeWrapperRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setPostcodeOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-[8px] px-2 py-1.5 transition-colors ${postcodeOpen ? "bg-[#f1f5f9]" : "hover:bg-[#f1f5f9]"}`}
            >
              <LocationPinIcon />
              <span
                className="text-[14px] text-[#0f172a]"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontWeight: 600 }}
              >
                {userAddress?.postcode || "10115"}
              </span>
              <ChevronDownIcon />
            </button>

            {postcodeOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-[280px] bg-white rounded-[16px] z-50 overflow-hidden"
                style={{ boxShadow: "0px 8px 32px rgba(0,0,0,0.12), 0px 0px 0px 1px rgba(0,0,0,0.06)" }}
              >
                {/* Header */}
                <div className="px-4 pt-4 pb-3 border-b border-[#f1f5f9]">
                  <p className="text-[12px] font-semibold text-[#94a3b8] uppercase tracking-[0.6px]">Delivery Address</p>
                </div>

                {isLoggedIn && userAddress ? (
                  <div className="px-4 py-4 flex flex-col gap-3">
                    {/* Address display */}
                    <div className="flex items-start gap-3">
                      <div
                        className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 mt-0.5"
                        style={{ backgroundColor: "rgba(22,163,74,0.1)" }}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.375 4.5 8.5 4.5 8.5S12.5 9.375 12.5 6c0-2.485-2.015-4.5-4.5-4.5z" fill="#16a34a" />
                          <circle cx="8" cy="6" r="1.5" fill="white" />
                        </svg>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold text-[#0f172a]">
                            {userAddress.postcode || "—"}
                            {userAddress.city ? `, ${userAddress.city}` : ""}
                          </p>
                          <span
                            className="text-[10px] font-bold uppercase tracking-[0.5px] px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: "#dcfce7", color: "#16a34a" }}
                          >
                            Default
                          </span>
                        </div>
                        <p className="text-[12px] text-[#64748b]">Germany</p>
                      </div>
                    </div>

                    {/* Manage link */}
                    <Link
                      to="/addresses"
                      onClick={() => setPostcodeOpen(false)}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-[10px] text-[13px] font-semibold no-underline transition-colors"
                      style={{ backgroundColor: "#f1f5f9", color: "#475569" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M9.5 1.5L12.5 4.5L4.5 12.5H1.5V9.5L9.5 1.5z" stroke="#475569" strokeWidth="1.3" strokeLinejoin="round" />
                      </svg>
                      Manage Addresses
                    </Link>
                  </div>
                ) : isLoggedIn ? (
                  <div className="px-4 py-4 flex flex-col gap-3">
                    <p className="text-[13px] text-[#64748b]">No address saved yet.</p>
                    <Link
                      to="/addresses"
                      onClick={() => setPostcodeOpen(false)}
                      className="flex items-center justify-center gap-2 w-full py-2.5 rounded-[10px] text-[13px] font-semibold no-underline transition-colors"
                      style={{ backgroundColor: "#16a34a", color: "white" }}
                    >
                      Add Address
                    </Link>
                  </div>
                ) : (
                  <div className="px-4 py-4 flex flex-col gap-3">
                    <p className="text-[13px] text-[#64748b] leading-[20px]">
                      Sign in to save your delivery address and get personalised deals.
                    </p>
                    <Link
                      to="/login"
                      onClick={() => setPostcodeOpen(false)}
                      className="flex items-center justify-center w-full py-2.5 rounded-[10px] text-[13px] font-semibold no-underline transition-colors"
                      style={{ backgroundColor: "#16a34a", color: "white" }}
                    >
                      Sign In
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart with badge */}
          <Link
            to="/list"
            className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-[#f1f5f9] transition-colors no-underline shrink-0"
          >
            <CartIcon />
            {cartCount > 0 && (
              <span
                className="absolute top-1.5 right-1.5 min-w-[16px] h-[16px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-[3px]"
                style={{
                  backgroundColor: "#16a34a",
                  border: "2px solid white",
                }}
              >
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </Link>

          {/* Vertical divider */}
          <div className="h-8 w-px bg-[#e2e8f0] shrink-0" />

          {/* Profile / Auth */}
          {isLoggedIn ? (
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="/profile"
                className="flex items-center justify-center w-9 h-9 rounded-[8px] hover:bg-[#f1f5f9] transition-colors no-underline"
                title="Profile"
              >
                <ProfileIcon />
              </Link>
              <button
                type="button"
                onClick={onLogout}
                className="text-[13px] font-semibold text-[#475569] px-3 py-1.5 rounded-[8px] hover:bg-[#f1f5f9] transition-colors border border-[#e2e8f0]"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="/login"
                className="text-[13px] font-semibold text-[#475569] px-3 py-1.5 rounded-[8px] hover:bg-[#f1f5f9] transition-colors no-underline"
              >
                Login
              </Link>
              <Link
                to="/register"
                className="text-[13px] font-bold text-white px-4 py-1.5 rounded-[8px] no-underline transition-colors hover:bg-[#15803d]"
                style={{ backgroundColor: "#16a34a" }}
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* ── Mobile header ────────────────────────────────────────── */}
      <div className="flex lg:hidden items-center justify-between px-4 h-14">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <img
            src="/landing/dd24-logo.svg"
            alt="DesiDeals24"
            className="w-10 h-10 object-contain"
          />
          <div className="flex items-baseline gap-1">
            <span
              className="font-extrabold text-[#0f172a] text-[32px] tracking-[-1.2px] leading-none"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              DesiDeals24
            </span>
            <span className="text-[10px] font-extrabold tracking-[2px] uppercase text-slate-400 -translate-y-1">
              · Beta
            </span>
          </div>
        </Link>
        <Link
          to={isLoggedIn ? "/profile" : "/login"}
          className="flex items-center justify-center w-9 h-9 rounded-full no-underline"
          style={{ backgroundColor: "#f3f4f6" }}
        >
          <ProfileIcon />
        </Link>
      </div>
    </header>
  );
}
