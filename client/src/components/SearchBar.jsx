import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { buildDealsSearchPath, fetchSuggestions } from "../utils/api";
import { setDealsNavSelected } from "../utils/deals-nav-selection";

export default function SearchBar({ onNavigate, placeholder }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  function normalizeSuggestionList(values) {
    return (Array.isArray(values) ? values : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  useEffect(() => {
    let cancelled = false;
    clearTimeout(debounceRef.current);
    const nextQuery = String(query || "").trim();
    if (nextQuery.length < 2) {
      setSuggestions([]);
      setLoading(false);
      setOpen(false);
      setActive(-1);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(nextQuery)
        .then((data) => {
          if (cancelled) return;
          const nextSuggestions = normalizeSuggestionList(data?.suggestions);
          setSuggestions(nextSuggestions);
          setOpen(true);
          setActive(-1);
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          setOpen(true);
          setActive(-1);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    function handler(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function commit(term, options = {}) {
    const trimmed = String(term == null ? query : term).trim();
    if (!trimmed) return;
    const fromSuggestion = Boolean(options?.fromSuggestion);
    const fromEnter = Boolean(options?.fromEnter);
    const fallbackSuggestions = normalizeSuggestionList(suggestions);

    const applyWithSuggestions = (values) => {
      const cleanSuggestions = normalizeSuggestionList(values);
      const useSuggestionBundle =
        fromSuggestion || (fromEnter && cleanSuggestions.length > 0);
      const selectedForBundle = fromSuggestion ? trimmed : "";
      setDealsNavSelected(fromSuggestion);
      navigate(
        buildDealsSearchPath(trimmed, {
          bundle: useSuggestionBundle,
          selected: selectedForBundle,
          suggestions: cleanSuggestions,
        }),
      );
      setOpen(false);
      setQuery("");
      setSuggestions([]);
      setActive(-1);
      onNavigate?.();
    };

    if (fromSuggestion) {
      applyWithSuggestions(fallbackSuggestions);
      return;
    }

    if (fromEnter) {
      fetchSuggestions(trimmed)
        .then((res) => {
          const fetchedSuggestions = normalizeSuggestionList(res?.suggestions);
          if (fetchedSuggestions.length > 0) {
            setSuggestions(fetchedSuggestions);
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

  function handleKeyDown(e) {
    if (e.key === "ArrowDown") {
      if (!open && suggestions.length > 0) {
        setOpen(true);
      }
      if (suggestions.length > 0) {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, suggestions.length - 1));
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (suggestions.length > 0) {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
      return;
    }
    if (e.key !== "Enter") return;
    if (open && active >= 0 && suggestions[active]) {
      e.preventDefault();
      commit(suggestions[active], { fromSuggestion: true });
      return;
    }
    e.preventDefault();
    commit(query, { fromEnter: true });
  }

  const showDropdown = open && String(query || "").trim().length >= 2;

  return (
    <div ref={wrapperRef} className="relative w-full">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (String(query || "").trim().length >= 2) setOpen(true);
        }}
        placeholder={
          placeholder || "Search deals (e.g. basmati rice, toor dal...)"
        }
        className="aura-input pl-4 pr-12"
        autoComplete="off"
      />
      <button
        type="button"
        onClick={() => commit(query, { fromEnter: true })}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-primary"
      >
        🔍
      </button>

      {showDropdown && (
        <ul className="absolute top-full left-0 right-0 mt-1 bg-white border border-border rounded-lg shadow-lg z-50 overflow-hidden text-left">
          {loading ? (
            <li className="px-4 py-2.5 text-sm text-[#64748b]">Searching...</li>
          ) : suggestions.length === 0 ? (
            <li className="px-4 py-2.5 text-sm text-[#64748b]">
              No suggestions found.
            </li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={`${s}-${i}`}
                onMouseDown={() => commit(s, { fromSuggestion: true })}
                onMouseEnter={() => setActive(i)}
                className={`px-4 py-2 text-sm cursor-pointer ${
                  i === active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-text-primary hover:bg-secondary"
                }`}
              >
                {s}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
