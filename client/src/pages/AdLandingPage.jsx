import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOAuthAuthUrl, getAuthSession } from "../utils/api";

const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";

const FEATURED_DEALS = [
  {
    id: "uphaar-chana-dal",
    store: "Global Food Hub",
    title: "Uphaar Chana Dal 1kg",
    price: "1,99€",
    originalPrice: "3,99€",
    savings: "2,00€",
    badge: "-50%",
    image: "/landing/uphaar-card.png",
    href: "https://globalfoodhub.com/products/uphaar-chana-dal-indian-origin-1kg",
    accent: "from-[#ffe08a] via-[#fff3c6] to-[#ffffff]",
  },
  {
    id: "happy-desi-rice",
    store: "Global Food Hub",
    title: "Happy Desi Extra Long Basmati Rice 5kg",
    price: "9,99€",
    originalPrice: "14,99€",
    savings: "5,00€",
    badge: "-33%",
    image: "/landing/happy-desi-card.png",
    href: "https://globalfoodhub.com/products/happy-desi-extra-long-basmati-rice-5kgs",
    accent: "from-[#76d8c3] via-[#d8fff5] to-[#ffffff]",
  },
  {
    id: "aashirvaad-atta",
    store: "Grocera",
    title: "Aashirvaad Multigrain Atta 5kg",
    price: "6,89€",
    originalPrice: "11,49€",
    savings: "4,60€",
    badge: "-40%",
    image: "/landing/aashirvaad-card.png",
    href: "https://grocera.de/product/aashirvaad-multigrain-atta-5kg",
    accent: "from-[#ffce78] via-[#fff1c7] to-[#ffffff]",
  },
];

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function SpiceIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d="M12 3c2.9 3.2 4.35 5.98 4.35 8.34A4.35 4.35 0 1 1 7.65 11.3C7.65 8.98 9.1 6.2 12 3Z"
        fill="currentColor"
      />
      <path
        d="M12 7.5c1.34 1.62 2 3.01 2 4.18a2 2 0 1 1-4 0c0-1.18.66-2.58 2-4.18Z"
        fill="white"
        fillOpacity="0.35"
      />
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

function LoginModal({ onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleGoogleLogin() {
    setLoading(true);
    setError("");

    try {
      const state = createOAuthState();
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, "/deals");

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
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0f2a1d]/65 px-4 pb-4 pt-8 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[28px] border border-white/60 bg-[#fff8ea] p-5 shadow-[0_24px_90px_rgba(15,42,29,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#14532d] text-[#ffd54a]">
          <LockIcon />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#9a6426]">
          Members only
        </p>
        <h2 className="mt-2 text-[28px] font-black leading-[1.05] text-[#14311f]">
          Log in to unlock more deals near you.
        </h2>
        <p className="mt-3 text-sm leading-6 text-[#36503f]">
          See fresh grocery offers, save favorites, and jump straight to the best
          Indian store deals across Germany.
        </p>
        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-[#14532d] px-4 py-4 text-base font-bold text-white transition-transform duration-150 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70"
        >
          <GoogleIcon />
          {loading ? "Redirecting..." : "Continue with Google"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-2xl border border-[#ead7b3] px-4 py-3 text-sm font-semibold text-[#6e5228]"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

function FeaturedDealCard({ deal }) {
  return (
    <article className="overflow-hidden rounded-[30px] border border-white/60 bg-white shadow-[0_18px_60px_rgba(14,26,20,0.12)]">
      <div className={`relative bg-gradient-to-br ${deal.accent} px-5 pb-4 pt-5`}>
        <span className="absolute right-5 top-5 rounded-2xl bg-[#fff4da] px-3 py-2 text-sm font-bold text-[#b56b27] shadow-sm">
          {deal.badge}
        </span>
        <img
          src={deal.image}
          alt={deal.title}
          className="mx-auto h-auto w-[74%] max-w-[260px] rounded-[28px] shadow-[0_20px_35px_rgba(20,49,31,0.12)]"
        />
      </div>
      <div className="space-y-4 px-5 pb-5 pt-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#98a2b7]">
            {deal.store}
          </p>
          <h3 className="mt-2 text-[1.65rem] font-black leading-[1.12] text-[#1b2a41]">
            {deal.title}
          </h3>
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-end gap-2">
              <span className="text-[2rem] font-black leading-none text-[#18253d]">
                {deal.price}
              </span>
              <span className="pb-1 text-base text-[#a6b0c4] line-through">
                {deal.originalPrice}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-[#cf7d00]">
              You save {deal.savings}
            </p>
          </div>
          <a
            href={deal.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#1dac4b] px-4 py-3 text-sm font-bold text-white shadow-[0_12px_25px_rgba(29,172,75,0.24)] transition-transform duration-150 hover:scale-[1.02] hover:no-underline"
          >
            Snatch deal
            <ArrowRightIcon />
          </a>
        </div>
      </div>
    </article>
  );
}

export default function AdLandingPage() {
  const navigate = useNavigate();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const session = getAuthSession();

  const totalSavings = useMemo(() => {
    return FEATURED_DEALS.reduce((sum, deal) => {
      const numeric = Number.parseFloat(deal.savings.replace(",", ".").replace("€", ""));
      return sum + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);
  }, []);

  function handleUnlockDeals() {
    if (session?.accessToken) {
      navigate("/deals");
      return;
    }

    setShowLoginModal(true);
  }

  return (
    <>
      <main className="min-h-screen bg-[#f6eddc] text-[#14311f]">
        <section className="relative overflow-hidden">
          <div className="absolute inset-0">
            <img
              src="/landing/spices-hero.jpg"
              alt="Indian spices spread across a wooden table"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,32,23,0.34)_0%,rgba(15,54,30,0.72)_42%,rgba(246,237,220,0.96)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-[radial-gradient(circle_at_bottom,rgba(255,210,74,0.38),transparent_70%)]" />
          </div>

          <div className="relative mx-auto flex min-h-[88svh] max-w-md flex-col px-5 pb-16 pt-6">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/14 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-white backdrop-blur-md">
                <SpiceIcon />
                1,400+ live deals
              </span>
              <span className="rounded-full bg-[#ffd54a] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-[#274128]">
                Germany-wide
              </span>
            </div>

            <div className="mt-auto">
              <div className="max-w-[18rem] rounded-[28px] border border-white/10 bg-white/10 p-4 backdrop-blur-md">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#ffe29d]">
                  Your kitchen knows this feeling
                </p>
                <p className="mt-2 text-sm leading-6 text-white/88">
                  Warm jeera in the pan. Garlic hitting hot oil. Fresh atta, long-grain
                  basmati, and dal stocked before the weekend rush.
                </p>
              </div>

              <h1 className="mt-6 max-w-[16rem] font-['Space_Grotesk',sans-serif] text-[3.25rem] font-bold leading-[0.94] tracking-[-0.06em] text-white">
                Same desi staples.
                <span className="block text-[#ffd54a]">Better prices.</span>
              </h1>

              <p className="mt-4 max-w-[19rem] text-[15px] leading-7 text-[#f4f4e7]">
                We pulled the exact products from the ad so the offer feels familiar the
                moment you land. Tap into more deals after login.
              </p>

              <div className="mt-7 rounded-[28px] border border-white/10 bg-[#103621]/78 p-4 shadow-[0_16px_40px_rgba(8,25,16,0.25)] backdrop-blur-md">
                <div className="space-y-3">
                  {FEATURED_DEALS.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-white"
                    >
                      <div className="pr-3">
                        <p className="text-sm font-bold leading-5">{deal.title}</p>
                        <p className="mt-1 text-xs text-white/60 line-through">{deal.originalPrice}</p>
                      </div>
                      <span className="shrink-0 text-[1.75rem] font-black leading-none text-[#ffd54a]">
                        {deal.price}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-2xl bg-[#ffd11a] px-4 py-4 text-center shadow-[0_10px_30px_rgba(255,209,26,0.24)]">
                  <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#8a4500]">
                    Basket savings
                  </p>
                  <p className="mt-1 text-[2rem] font-black leading-none text-[#d83300]">
                    {totalSavings.toFixed(2).replace(".", ",")}€
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative -mt-10 px-4 pb-10">
          <div className="mx-auto max-w-md rounded-[32px] bg-[#fff8ea] p-4 shadow-[0_24px_60px_rgba(61,44,16,0.12)]">
            <div className="rounded-[28px] bg-[#14311f] px-5 py-5 text-white">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#ffd54a]">
                Why this page feels right
              </p>
              <p className="mt-3 text-[15px] leading-7 text-white/84">
                This isn’t a generic coupon page. It starts with pantry staples you already
                buy, wraps them in a spice-led visual mood, and then nudges you to unlock
                more useful deals instead of dumping you into a cold catalog.
              </p>
            </div>
          </div>
        </section>

        <section className="px-4 pb-12">
          <div className="mx-auto max-w-md">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-[#a46a2d]">
                  Featured deals
                </p>
                <h2 className="mt-2 text-[2rem] font-black leading-[1.05] text-[#173221]">
                  The exact products from the ad
                </h2>
              </div>
            </div>

            <div className="space-y-5">
              {FEATURED_DEALS.map((deal) => (
                <FeaturedDealCard key={deal.id} deal={deal} />
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-32">
          <div className="mx-auto max-w-md rounded-[34px] bg-[#14311f] p-6 text-white shadow-[0_26px_70px_rgba(20,49,31,0.25)]">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-[#ffd54a]">
              <LockIcon />
              More deals after login
            </div>
            <h2 className="mt-4 text-[2.15rem] font-black leading-[1.02]">
              Keep browsing, but save the full list for members.
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-white/80">
              Log in to access more daily grocery deals, save favorites, and compare what’s
              cheapest before you shop.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
                <p className="text-[1.75rem] font-black leading-none text-[#ffd54a]">1400+</p>
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

        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-md justify-center px-4 pb-4">
          <div className="pointer-events-auto w-full rounded-full border border-[#ffe6a0] bg-[#fff7df]/96 p-2 shadow-[0_12px_40px_rgba(56,40,14,0.18)] backdrop-blur-md">
            <button
              type="button"
              onClick={handleUnlockDeals}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1dac4b] px-5 py-3.5 text-sm font-black uppercase tracking-[0.08em] text-white"
            >
              {session?.accessToken ? "Browse all deals" : "Log in for more deals"}
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      </main>

      {showLoginModal ? <LoginModal onClose={() => setShowLoginModal(false)} /> : null}
    </>
  );
}
