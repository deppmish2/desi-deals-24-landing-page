import React, { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOAuthAuthUrl, getAuthSession } from "../utils/api";

const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";

const FEATURED_DEALS = [
  {
    id: "uphaar-chana-dal",
    store: "Global Food Hub",
    title: "Uphaar Chana Dal 1kg",
    heroTitle: "Chana Dal 1kg",
    price: "1,99",
    originalPrice: "3,99",
    discountPct: 50,
    image: "https://cdn.shopify.com/s/files/1/0605/4038/7576/files/Uphaar-Chana-Dal-1Kg-GlobalFoodHub_com_f51ec386.jpg?v=1773668860",
    href: "https://globalfoodhub.com/products/uphaar-chana-dal-indian-origin-1kg",
    weight: "1kg",
    pricePerKg: "1,99 €/kg",
    bestBefore: null,
  },
  {
    id: "happy-desi-rice",
    store: "Global Food Hub",
    title: "Happy Desi Extra Long Basmati Rice 5kg",
    heroTitle: <>Basmati Rice<br />Extra Long 5kg</>,
    price: "9,99",
    originalPrice: "14,99",
    discountPct: 33,
    image: "https://cdn.shopify.com/s/files/1/0605/4038/7576/files/Happy-Desi-Extra-Long-Basmati-Rice-5kgs-GlobalFoodHub_com.webp?v=1769576953",
    href: "https://globalfoodhub.com/products/happy-desi-extra-long-basmati-rice-5kgs",
    weight: "5kg",
    pricePerKg: "2,00 €/kg",
    bestBefore: null,
  },
  {
    id: "aashirvaad-atta",
    store: "Zora Supermarkt",
    title: "Aashirvaad Atta 5kg (Export Pack) – BBE: 11.2026",
    heroTitle: "Aashirvaad Atta 5kg",
    price: "7,99",
    originalPrice: "11,99",
    discountPct: 33,
    image: "https://cdn.shopify.com/s/files/1/0812/6205/1651/products/4533.jpg?width=400",
    href: "https://zorastore.eu/products/aashirvaad-atta-5kg-export-pack",
    weight: "5kg",
    pricePerKg: "1,60 €/kg",
    bestBefore: "Nov 2026",
  },
];

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function DD24Icon() {
  return (
    <svg width="14" height="16" viewBox="0 0 27 32" fill="none" aria-hidden="true">
      <path d="M23.2324 28.8C16.8324 25.6 10.4324 19.2 8.83241 12.8C7.23241 6.39999 13.6324 3.2 20.0324 9.59999C23.2324 12.8 23.2324 28.8 23.2324 28.8Z" fill="currentColor"/>
      <path d="M23.2324 32C13.6324 32 4.03241 28.8 0.832414 22.4C-2.36758 16 4.03241 12.8 13.6324 19.2C20.0324 22.4 23.2324 32 23.2324 32Z" fill="currentColor" fillOpacity="0.8"/>
      <path d="M23.2324 25.6C18.4324 16 18.4324 6.39999 23.2324 0C28.0324 6.39999 28.0324 16 23.2324 25.6Z" fill="currentColor"/>
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GoogleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

async function trackLandingSearch(query) {
  try {
    const sessionId = (() => {
      try {
        const k = "dd24_client_session_id";
        const ex = sessionStorage.getItem(k);
        if (ex) return ex;
        const next = window.crypto?.randomUUID?.() || `dd24-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(k, next);
        return next;
      } catch { return "dd24-anon"; }
    })();
    const url = `/api/v1/deals?search=${encodeURIComponent(query)}&track_search=1&limit=0`;
    await fetch(url, { headers: { "x-dd24-session-id": sessionId } });
  } catch { /* fire-and-forget */ }
}

function LoginModal({ onClose, searchQuery = null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGoogleLogin() {
    setLoading(true);
    setError("");

    try {
      const state = createOAuthState();
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      const redirectTarget = searchQuery
        ? `/deals?search=${encodeURIComponent(searchQuery)}`
        : "/deals";
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, redirectTarget);

      const payload = await fetchOAuthAuthUrl("google", state);
      const authUrl = payload?.authUrl || payload?.url;

      if (!authUrl) {
        throw new Error("Google sign-in is unavailable right now.");
      }

      window.location.assign(authUrl);
    } catch (err) {
      setLoading(false);
      setError(err?.message || "Could not start Google sign-in.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-6 pt-8 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-[28px] bg-white shadow-[0_24px_90px_rgba(0,0,0,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Brand header */}
        <div className="flex flex-col items-center bg-[#14311f] px-6 pb-7 pt-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#16a34a] shadow-[0_8px_24px_rgba(22,163,74,0.35)]">
            <DD24Icon />
          </div>
          <p className="mt-3 text-[13px] font-bold tracking-[0.12em] text-white/60 uppercase">DesiDeals24</p>
        </div>

        <div className="px-6 pb-6 pt-5">
          {searchQuery ? (
            <h2 className="mb-5 text-[22px] font-black leading-[1.15] text-[#0f172a]">
              Log in to see deals for "{searchQuery}"
            </h2>
          ) : (
            <h2 className="mb-5 text-[22px] font-black leading-[1.15] text-[#0f172a]">
              Unlock 1200+ desi deals
            </h2>
          )}
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white px-4 py-4 text-[15px] font-semibold text-[#0f172a] shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <GoogleIcon size={20} />
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-2 text-[14px] text-[#94a3b8] hover:text-slate-600"
        >
          Maybe later
        </button>
        </div>
      </div>
    </div>
  );
}

function FeaturedDealCard({ deal, cardRef, onLoginRequired }) {
  const [imgError, setImgError] = useState(false);
  const pct = deal.discountPct;
  const badgeBg = pct > 50 ? "#ffe4e8" : pct >= 30 ? "#fff3e0" : pct >= 20 ? "#e8f0fe" : "#f1f5f9";
  const badgeColor = pct > 50 ? "#e53e3e" : pct >= 30 ? "#c05200" : pct >= 20 ? "#1a56db" : "#1e293b";
  const waText = encodeURIComponent(`${deal.title} for only ${deal.price}€! ${deal.href}`);

  return (
    <div
      ref={cardRef}
      className="bg-white rounded-[20px] flex flex-col overflow-hidden border border-[#f1f5f9]"
      style={{ boxShadow: "0px 2px 12px rgba(0,0,0,0.06)" }}
    >
      {/* Image */}
      <div className="relative w-full h-[200px] bg-white flex items-center justify-center p-5">
        <img
          src={imgError ? 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 112 112"><rect fill="%23ffffff" width="112" height="112"/><text fill="%2394a3b8" font-size="28" text-anchor="middle" dominant-baseline="middle" x="56" y="58">🛒</text></svg>' : deal.image}
          alt={deal.title}
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
        {pct > 0 && (
          <div className="absolute top-3 right-3 rounded-[8px] px-2.5 py-1" style={{ backgroundColor: badgeBg }}>
            <span className="font-bold text-[13px] leading-none" style={{ color: badgeColor }}>-{pct}%</span>
          </div>
        )}
        {deal.bestBefore && (
          <span className="absolute bottom-3 left-3 bg-[#d5890f] text-white text-[10px] leading-[15px] font-medium rounded-full px-2 py-0.5">
            Best before {deal.bestBefore}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-col flex-1 px-5 pt-4 pb-5 gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[#94a3b8] text-[10px] leading-[15px] tracking-[1.5px] uppercase font-extrabold">
            {deal.store}
          </p>
          <p className="text-[#1e293b] text-[15px] leading-[22px] font-bold line-clamp-2 min-h-[44px]">
            {deal.title}
          </p>
          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-[#1e293b] text-[22px] leading-[30px] font-extrabold">{deal.price} €</span>
              <span className="text-[#94a3b8] text-[14px] leading-[20px] line-through">{deal.originalPrice} €</span>
            </div>
            <span className="text-[#94a3b8] text-[11px] leading-[16px] font-medium text-right shrink-0">
              {deal.weight} | {deal.pricePerKg}
            </span>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-2 pt-2">
          <a
            href={deal.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 justify-center bg-[#16a34a] hover:bg-[#15803d] transition-colors rounded-[14px] py-3 inline-flex items-center gap-2 text-white no-underline hover:no-underline"
            style={{ textDecoration: "none" }}
          >
            <span className="text-[13px] leading-[16px] font-extrabold tracking-wide uppercase">Snatch Deal</span>
          </a>
          <a
            href={`https://wa.me/?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border border-slate-200 bg-white hover:bg-[#e7fbe9] hover:border-[#25D366] transition-colors"
            title="Share on WhatsApp"
          >
            <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
              <path d="M16 3C9.373 3 4 8.373 4 15c0 2.385.67 4.61 1.832 6.5L4 29l7.697-1.803A12.94 12.94 0 0 0 16 27c6.627 0 12-5.373 12-12S22.627 3 16 3z" fill="#25D366"/>
              <path d="M21.786 18.618c-.306-.153-1.81-.894-2.09-.994-.28-.1-.484-.153-.688.153-.204.306-.79.994-.968 1.198-.178.204-.356.23-.662.077-.306-.153-1.29-.476-2.458-1.516-.908-.81-1.522-1.81-1.7-2.116-.178-.306-.019-.47.134-.622.137-.136.306-.356.459-.535.153-.178.204-.306.306-.51.102-.204.051-.382-.025-.535-.077-.153-.688-1.658-.942-2.27-.248-.595-.5-.514-.688-.524l-.586-.01c-.204 0-.535.077-.816.382-.28.306-1.07 1.045-1.07 2.55s1.095 2.96 1.248 3.164c.153.204 2.154 3.29 5.22 4.614.73.315 1.3.503 1.744.644.733.233 1.4.2 1.927.121.588-.087 1.81-.74 2.065-1.455.255-.714.255-1.326.178-1.455-.076-.13-.28-.204-.586-.357z" fill="white"/>
            </svg>
          </a>
          <button
            type="button"
            onClick={onLoginRequired}
            className="shrink-0 inline-flex items-center justify-center w-[46px] h-[46px] rounded-[14px] border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors"
            title="Save deal"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdLandingPage() {
  const navigate = useNavigate();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginSearchQuery, setLoginSearchQuery] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const session = getAuthSession();
  const cardRefs = useRef(FEATURED_DEALS.map(() => React.createRef()));

  function scrollToCard(index) {
    cardRefs.current[index]?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const totalSavings = useMemo(() => {
    return FEATURED_DEALS.reduce((sum, deal) => {
      const orig = Number.parseFloat(deal.originalPrice.replace(",", "."));
      const sale = Number.parseFloat(deal.price.replace(",", "."));
      const diff = orig - sale;
      return sum + (Number.isFinite(diff) ? diff : 0);
    }, 0);
  }, []);

  function handleUnlockDeals() {
    if (session?.accessToken) {
      navigate("/deals");
      return;
    }
    setLoginSearchQuery(null);
    setShowLoginModal(true);
  }

  async function handleSearch(e) {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    if (session?.accessToken) {
      navigate(`/deals?search=${encodeURIComponent(q)}`);
      return;
    }
    await trackLandingSearch(q);
    setLoginSearchQuery(q);
    setShowLoginModal(true);
  }

  return (
    <>
      <main className="min-h-screen bg-[#f6eddc] text-[#14311f]">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0">
            <img
              src="/landing/spices.jpg"
              alt="Indian spices spread across a wooden table"
              className="h-full w-full object-cover object-top"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,22,14,0.55)_0%,rgba(12,42,22,0.82)_45%,rgba(246,237,220,0.98)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-[radial-gradient(circle_at_bottom,rgba(255,210,74,0.38),transparent_70%)]" />
          </div>

          <div className="relative mx-auto flex min-h-[88svh] max-w-md flex-col px-5 pb-16 pt-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <img src="/landing/dd24-logo.svg" alt="DesiDeals24" className="h-8 w-8 object-contain" />
                <span className="text-[17px] font-extrabold leading-none tracking-[-0.04em] text-white">
                  DesiDeals24
                </span>
              </div>
              <button
                type="button"
                onClick={() => scrollToCard(0)}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-[#7a3b10]/80 px-3 py-1.5 text-[11px] font-bold text-white backdrop-blur-md active:scale-95 transition-transform"
              >
                <DD24Icon />
                1200+ Deals
              </button>
            </div>

            <div className="mt-auto">
              <h1 className="font-[‘Space_Grotesk’,sans-serif] text-[3.5rem] font-bold leading-[1.0] tracking-[-0.03em] text-white">
                Same <span className="font-black">desi</span> products.
                <span className="block text-[#ffd54a]">Better prices.</span>
              </h1>

              <div className="mt-6 overflow-hidden rounded-[24px] border border-white/15 bg-[#0d2e18]/80 shadow-[0_16px_40px_rgba(8,25,16,0.35)] backdrop-blur-md">
                <div className="divide-y divide-white/10">
                  {FEATURED_DEALS.map((deal, i) => (
                    <button
                      key={deal.id}
                      type="button"
                      onClick={() => scrollToCard(i)}
                      className="flex w-full items-center justify-between px-5 py-4 text-white text-left active:bg-white/5"
                    >
                      <p className="text-[15px] font-bold leading-5">{deal.heroTitle || deal.title}</p>
                      <div className="ml-4 flex shrink-0 items-center gap-2">
                        <span className="text-sm text-white/45 line-through">{deal.originalPrice}€</span>
                        <span className="text-[1.6rem] font-black leading-none text-[#ffd54a]">
                          {deal.price}€
                        </span>
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => scrollToCard(0)}
                  className="mx-4 mb-4 mt-3 w-[calc(100%-2rem)] rounded-2xl bg-[#ffd11a] px-4 py-4 text-center shadow-[0_10px_30px_rgba(255,209,26,0.22)] active:scale-[0.98] transition-transform"
                >
                  <p className="text-[1.35rem] font-black text-[#c43300]">
                    You Save {totalSavings.toFixed(2).replace(".", ",")}€
                  </p>
                </button>

                <p className="pb-4 text-center text-[12px] text-white/50">
                  1,200+ live deals across Germany · Updated daily
                </p>
              </div>

              <button
                type="button"
                onClick={handleUnlockDeals}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#1dac4b] px-5 py-4 text-[17px] font-black text-white shadow-[0_12px_30px_rgba(29,172,75,0.30)]"
              >
                Browse all deals
                <ArrowRightIcon />
              </button>
            </div>
          </div>
        </section>

        <section className="px-4 pb-12">
          <div className="mx-auto max-w-md">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.26em] text-[#a46a2d]">
                  <span className="text-[#16a34a]"><DD24Icon /></span>
                  Today's deals
                </p>
                <h2 className="mt-2 text-[2rem] font-black leading-[1.05] text-[#173221]">
                  Grab them before they're gone
                </h2>
              </div>
            </div>

            <div className="space-y-5">
              {FEATURED_DEALS.map((deal, i) => (
                <FeaturedDealCard
                  key={deal.id}
                  deal={deal}
                  cardRef={cardRefs.current[i]}
                  onLoginRequired={handleUnlockDeals}
                />
              ))}
            </div>

            <form onSubmit={handleSearch} className="mt-6">
              <div className="flex items-center gap-3 rounded-full border border-[#e2e8f0] bg-white px-5 py-3.5 shadow-sm">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-[#94a3b8]" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
                  <path d="m16.5 16.5 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search for ghee, rice, spices…"
                  className="flex-1 bg-transparent text-[15px] text-[#1e293b] placeholder-[#94a3b8] outline-none"
                />
                {searchInput.trim() && (
                  <button
                    type="submit"
                    className="shrink-0 rounded-full bg-[#16a34a] px-4 py-1.5 text-[13px] font-bold text-white"
                  >
                    Search
                  </button>
                )}
              </div>
            </form>
          </div>
        </section>

        <section className="px-4 pb-32">
          <div className="mx-auto max-w-md rounded-[34px] bg-[#14311f] p-6 text-white shadow-[0_26px_70px_rgba(20,49,31,0.25)]">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#ffd54a]">
              <DD24Icon />
              DesiDeals24
            </div>
            <h2 className="mt-4 text-[2.15rem] font-black leading-[1.02]">
              These 3 deals are just the start.
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-white/80">
              There are 1,200+ live deals across Indian stores in Germany. Log in to see all of them.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                <p className="text-[1.75rem] font-black leading-none text-[#ffd54a]">1200+</p>
                <p className="mt-2 text-white/75">Deals refreshed daily</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                <p className="text-[1.75rem] font-black leading-none text-[#ffd54a]">24/7</p>
                <p className="mt-2 text-white/75">Access on your phone</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUnlockDeals}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-[#ffd54a] px-5 py-4 text-base font-black text-[#173221] shadow-[0_12px_35px_rgba(255,213,74,0.28)] transition-transform duration-150 hover:scale-[1.01]"
            >
              {session?.accessToken ? "Open all deals" : "Log in to access more deals"}
              <ArrowRightIcon />
            </button>
            <p className="mt-3 text-center text-xs text-white/50">
              Free login. No long onboarding.
            </p>
          </div>
        </section>

      </main>

      {showLoginModal ? (
        <LoginModal
          onClose={() => { setShowLoginModal(false); setLoginSearchQuery(null); }}
          searchQuery={loginSearchQuery}
        />
      ) : null}
    </>
  );
}
