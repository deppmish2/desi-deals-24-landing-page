import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import useDeals from "../hooks/useDeals";
import { formatPrice } from "../utils/formatters";
import {
  claimWaitlistReferral,
  completeEmailAuth,
  fetchMe,
  fetchOAuthAuthUrl,
  fetchWaitlistMe,
  getAuthSession,
  logoutUser,
  updateAuthSessionUser,
} from "../utils/api";
import { getCurrentPoolDateSeed } from "./dealsRefreshSchedule";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const T = {
  brand:        "#16A34A",
  brandDark:    "#15803D",
  brandLight:   "#DCFCE7",
  brandMid:     "#BBF7D0",
  brandDim:     "rgba(22,163,74,0.08)",
  brandBorder:  "rgba(22,163,74,0.22)",
  bg:           "#F8FAF8",
  bgCard:       "#FFFFFF",
  bgMuted:      "#F1F5F1",
  border:       "#DCE8DC",
  borderStrong: "#B8D4BA",
  textPrimary:  "#0F1F0F",
  textSecondary:"#4B6652",
  textMuted:    "#8BA98F",
  textOnBrand:  "#FFFFFF",
  whatsapp:     "#25D366",
  blue:         "#2563EB",
  amber:        "#D97706",
  amberLight:   "#FEF3C7",
  amberBorder:  "rgba(217,119,6,0.25)",
  shadowSm:     "0 1px 3px rgba(15,31,15,0.06),0 1px 2px rgba(15,31,15,0.04)",
  shadowMd:     "0 4px 12px rgba(15,31,15,0.08),0 2px 4px rgba(15,31,15,0.04)",
  shadowLg:     "0 12px 32px rgba(15,31,15,0.10),0 4px 8px rgba(15,31,15,0.06)",
  shadowBrand:  "0 4px 20px rgba(22,163,74,0.25)",
};

// ─── Constants ────────────────────────────────────────────────────────────────
const INVITES_NEEDED = 2;
const HERO_IMAGE_URL = "/landing/24deals-hero.jpg";
const HERO_IMAGE_MOBILE_URL = "/landing/24deals-hero-mobile.jpg";
const HERO_IMAGE_WEBP_URL = "/landing/24deals-hero.webp";
const WAITLIST_REF_STORAGE_KEY = "dd24_waitlist_referral_code";
const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";
const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
const AUTH_ERROR_STORAGE_KEY = "dd24_auth_error";

const ALL_DEALS = [
  { store:"Jamoona",       product:"Aashirvaad Atta 5kg",     was:"13.49€", now:"9.99€",  off:"26%", emoji:"🌾", tag:"Best price" },
  { store:"Dookan",        product:"Taj Mahal Tea 500g",      was:"7.99€",  now:"5.49€",  off:"31%", emoji:"🍵", tag:"Flash deal" },
  { store:"Grocera ⚡",    product:"Amul Ghee 500ml",         was:"9.49€",  now:"6.99€",  off:"26%", emoji:"🧈", tag:"Same-day" },
  { store:"Namma Markt",   product:"Haldiram Bhujia 400g",   was:"4.49€",  now:"3.29€",  off:"27%", emoji:"🥨", tag:null },
  { store:"Spice Village", product:"MDH Garam Masala 100g",  was:"3.99€",  now:"2.49€",  off:"38%", emoji:"🌶️", tag:"Best price" },
  { store:"Jamoona",       product:"Sona Masoori Rice 10kg", was:"24.99€", now:"18.99€", off:"24%", emoji:"🍚", tag:null },
  { store:"Dookan",        product:"Tata Salt 1kg",          was:"2.49€",  now:"1.49€",  off:"40%", emoji:"🧂", tag:"Flash deal" },
  { store:"Grocera ⚡",    product:"Parachute Coconut Oil",  was:"8.99€",  now:"6.49€",  off:"28%", emoji:"🥥", tag:"Same-day" },
];

function normalizeReferralCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

function buildDisplayName(identity) {
  if (identity && typeof identity === "object") {
    const firstName = String(identity.first_name || "").trim();
    if (firstName) return firstName;

    const fullName = String(identity.name || "").trim();
    if (fullName) {
      const leading = fullName.split(/\s+/).find(Boolean);
      if (leading) return leading;
    }

    const email = String(identity.email || "").trim();
    if (email) {
      return buildDisplayName(email);
    }

    const id = String(identity.id || "").trim();
    if (id) {
      return buildDisplayName(id);
    }
  }

  const source = String(identity || "").trim();
  if (!source) return "friend";
  const localPart = source.includes("@") ? source.split("@")[0] : source;
  const normalized = localPart.replace(/[._-]+/g, " ").trim();
  if (!normalized) return "friend";
  const firstWord = normalized.split(/\s+/).find(Boolean) || normalized;
  return firstWord.replace(/\b\w/g, (char) => char.toUpperCase());
}

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function hasDealsAccess(status) {
  const userType = String(status?.user_type || "")
    .trim()
    .toLowerCase();
  return Boolean(status?.unlocked) && (userType === "basic" || userType === "premium");
}

// ─── Shared Primitives ────────────────────────────────────────────────────────
function Logo({ light=false }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
      <img
        src="/landing/dd24-logo.svg"
        alt="DesiDeals24"
        style={{
          width: 40,
          height: 40,
          objectFit: "contain",
          filter: light ? "drop-shadow(0 10px 20px rgba(0,0,0,0.28))" : "none",
        }}
      />
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily:"'Plus Jakarta Sans',sans-serif", fontSize:32, fontWeight:800, letterSpacing:-1.2, color:light?"#fff":T.textPrimary, textShadow:light?"0 1px 10px rgba(0,0,0,0.35)":"none", lineHeight:1 }}>
          DesiDeals24
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.6,
            textTransform: "uppercase",
            color: light ? "rgba(255,255,255,0.72)" : "rgba(15,23,42,0.48)",
            transform: "translateY(-6px)",
            textShadow: light ? "0 1px 8px rgba(0,0,0,0.28)" : "none",
          }}
        >
          · Beta
        </span>
      </div>
    </div>
  );
}

function DealsStripCard({
  index,
  store,
  product,
  now,
  was,
  off,
  imageUrl,
  mode = "normal", // normal | blurred | locked
  onClick,
}) {
  const [imgError, setImgError] = useState(false);
  const proxyImg = imageUrl
    ? `/api/v1/admin/proxy/image?url=${encodeURIComponent(imageUrl)}`
    : null;

  const isBlurred = mode === "blurred";
  const isLocked = mode === "locked";

  const cardBase = {
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: 24,
    padding: 18,
    boxShadow: T.shadowSm,
    position: "relative",
    overflow: "hidden",
    minHeight: 340,
    width: 300,
    flex: "0 0 300px",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
    opacity: isBlurred ? 0.35 : 1,
    filter: isBlurred ? "blur(1.2px)" : "none",
    cursor: onClick ? "pointer" : "default",
  };

  const inner = (
    <>
      <div
        style={{
          position: "relative",
          height: 176,
          borderRadius: 18,
          background: "#F8FAFC",
          border: `1px solid ${T.border}`,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        {proxyImg && !imgError ? (
          <img
            src={proxyImg}
            alt={product}
            loading="lazy"
            onError={() => setImgError(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: 16,
            }}
          />
        ) : (
          <div style={{ fontSize: 34, color: "#94A3B8", fontWeight: 800 }}>
            🛒
          </div>
        )}

        {off ? (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              padding: "6px 10px",
              borderRadius: 999,
              background: T.brand,
              color: "#fff",
              fontSize: 12,
              fontWeight: 800,
              boxShadow: "0 10px 26px rgba(22,163,74,0.28)",
            }}
          >
            -{off}
          </div>
        ) : null}
      </div>

      <div
        style={{
          fontFamily: "'Fraunces',Georgia,serif",
          fontSize: 14,
          fontWeight: 900,
          color: T.textPrimary,
          lineHeight: 1.3,
          marginBottom: 18,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
          minHeight: 36,
        }}
      >
        {product}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            fontFamily: "'Fraunces',Georgia,serif",
            fontSize: 36,
            fontWeight: 900,
            color: T.brand,
            letterSpacing: -0.8,
            lineHeight: 1,
          }}
        >
          {now}
        </span>
        {was ? (
          <span
            style={{
              fontSize: 14,
              color: "#94A3B8",
              textDecoration: "line-through",
              fontWeight: 600,
            }}
          >
            {was}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <div
      style={{
        ...(isLocked
          ? {
              ...cardBase,
              border: `1px dashed ${T.borderStrong}`,
              boxShadow: "0 18px 36px rgba(15,23,42,0.10)",
            }
          : cardBase),
        animation: `fadeIn 0.4s ease ${index * 0.07}s both`,
        transform: "translateY(0px)",
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (mode !== "normal") return;
        e.currentTarget.style.boxShadow = T.shadowMd;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = T.shadowSm;
        e.currentTarget.style.transform = "translateY(0px)";
      }}
    >
      {isLocked ? (
        <>
          <div style={{ opacity: 0.22, filter: "blur(2.8px)" }}>{inner}</div>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              style={{
                width: "100%",
                maxWidth: 220,
                background: "rgba(255,255,255,0.90)",
                border: `1px solid ${T.border}`,
                boxShadow: "0 22px 50px rgba(15,23,42,0.12)",
                borderRadius: 18,
                padding: "18px 16px",
                textAlign: "center",
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ fontSize: 30, marginBottom: 8 }}>🔒</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.textPrimary, marginBottom: 4 }}>
                Invite 2 friends
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>
                to unlock all deals
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.();
                }}
                style={{
                  width: "100%",
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 12px",
                  fontWeight: 800,
                  cursor: "pointer",
                  background: T.brand,
                  color: "#fff",
                }}
              >
                Reveal Deals
              </button>
            </div>
          </div>
        </>
      ) : (
        inner
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function WhatsAppIcon({ size=18, color="#25D366" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
      <path d="M12 0C5.373 0 0 5.373 0 12c0 2.126.556 4.121 1.527 5.849L.057 23.617a.75.75 0 0 0 .921.921l5.768-1.47A11.952 11.952 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.659-.523-5.17-1.432l-.37-.22-3.826.976.992-3.826-.242-.392A10 10 0 1 1 12 22z"/>
    </svg>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).catch(()=>{}); setCopied(true); setTimeout(()=>setCopied(false),2000); }}
      style={{ padding:"9px 16px", borderRadius:9, border:"none", cursor:"pointer", background:copied?T.brand:T.brandLight, color:copied?T.textOnBrand:T.brandDark, fontWeight:700, fontSize:12, transition:"all 0.2s", flexShrink:0, boxShadow:copied?T.shadowBrand:"none" }}>
      {copied?"✓ Copied!":"Copy"}
    </button>
  );
}

// ─── Unlock Progress Ring ─────────────────────────────────────────────────────
function ProgressRing({ confirmed, needed=2 }) {
  const r = 44, circ = 2 * Math.PI * r;
  const pct = Math.min(confirmed / needed, 1);
  const done = confirmed >= needed;
  return (
    <div style={{ position:"relative", width:120, height:120, flexShrink:0 }}>
      <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform:"rotate(-90deg)" }}>
        <circle cx="60" cy="60" r={r} fill="none" stroke={T.bgMuted} strokeWidth="8"/>
        <circle cx="60" cy="60" r={r} fill="none" stroke={done?"#16A34A":T.brandMid} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)" }}/>
      </svg>
      <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
        {done ? (
          <span style={{ fontSize:32 }}>🎉</span>
        ) : (
          <>
            <span style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:28, fontWeight:900, color:T.brand, lineHeight:1, letterSpacing:-1 }}>{confirmed}</span>
            <span style={{ fontSize:12, color:T.textMuted, fontWeight:600 }}>of {needed}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Invite Row ───────────────────────────────────────────────────────────────
function InviteRow({ invite, index }) {
  const isJoined = invite.status === "joined";
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderBottom:`1px solid ${T.border}`, animation:`fadeIn 0.3s ease ${index*0.06}s both` }}>
      <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0, background:isJoined?T.brandLight:T.bgMuted, border:`1.5px solid ${isJoined?T.brandMid:T.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:isJoined?T.brandDark:T.textMuted }}>
        {invite.name.charAt(0)}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:600, color:T.textPrimary, marginBottom:1, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{invite.name}</div>
        <div style={{ display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ fontSize:10 }}>{invite.method==="whatsapp"?"💬":"🔵"}</span>
          <span style={{ fontSize:11, color:T.textMuted }}>{invite.contact}</span>
        </div>
      </div>
      {isJoined ? (
        <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:99, background:T.brandLight, border:`1px solid ${T.brandMid}` }}>
          <span style={{ fontSize:10 }}>✓</span>
          <span style={{ fontSize:11, fontWeight:700, color:T.brandDark }}>Registered</span>
        </div>
      ) : (
        <span style={{ fontSize:11, fontWeight:600, color:T.textMuted, padding:"4px 12px", borderRadius:99, background:T.bgMuted, border:`1px solid ${T.border}` }}>Pending</span>
      )}
    </div>
  );
}

// ─── AUTH CARD (Landing) ──────────────────────────────────────────────────────
function AuthCard({
  onAuthChoice,
  glass = false,
  pulseGoogle = false,
  onDealsClick,
  authError = "",
  authLoading = false,
}) {
  const base = glass
    ? { background:"rgba(255,255,255,0.84)", backdropFilter:"blur(20px) saturate(180%)", border:"1px solid rgba(255,255,255,0.65)", boxShadow:"0 8px 40px rgba(0,0,0,0.16)" }
    : { background:T.bgCard, border:`1px solid ${T.border}`, boxShadow:T.shadowLg };

  return (
    <div className="dd24-auth-card" style={{ borderRadius:24, padding:32, position:"sticky", top:24, ...base }}>
      <div style={{ textAlign:"center", marginBottom:24 }}>
        <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:52, height:52, borderRadius:16, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:26, marginBottom:14 }}>🛒</div>
        <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:21, fontWeight:900, letterSpacing:-0.8, color:T.textPrimary, marginBottom:8 }}>Start saving today</h2>
        <p style={{ fontSize:13, color:T.textSecondary, lineHeight:1.72, maxWidth:260, margin:"0 auto" }}>
          Sign up for free. Invite <strong style={{ color:T.textPrimary }}>2 friends</strong> who register and your deals section unlocks.
        </p>
      </div>

      {/* Unlock mechanic — redesigned */}
      <div style={{ marginBottom:24, borderRadius:16, overflow:"hidden", border:`1px solid ${T.brandBorder}`, background:`linear-gradient(160deg, ${T.brandLight} 0%, #fff 100%)` }}>
        {/* Steps */}
        <div style={{ padding:"16px 20px 0" }}>
          {[
            { n:1, label:"Sign up with Google", done:false },
            { n:2, label:"Invite 2 friends",    done:false },
            { n:3, label:"They register",       done:false },
          ].map((s,i,arr)=>(
            <div key={i} style={{ display:"flex", alignItems:"center", gap:12, paddingBottom: i<arr.length-1?0:16 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:s.done?T.brand:T.bgCard, border:`2px solid ${s.done?T.brand:T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:s.done?T.textOnBrand:T.brandDark, zIndex:1 }}>
                  {s.done ? "✓" : s.n}
                </div>
                {i<arr.length-1 && <div style={{ width:2, height:20, background:`linear-gradient(to bottom, ${T.brandMid}, ${T.brandLight})`, margin:"2px 0" }}/>}
              </div>
              <div style={{ paddingBottom: i<arr.length-1?20:0 }}>
                <span style={{ fontSize:13, fontWeight:600, lineHeight:1.2, color:s.done?T.textMuted:T.textPrimary, textDecoration:s.done?"line-through":"none" }}>{s.label}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Unlock reward banner */}
        <div
          role={onDealsClick ? "button" : undefined}
          tabIndex={onDealsClick ? 0 : undefined}
          onClick={() => onDealsClick?.()}
          onKeyDown={(e) => {
            if (!onDealsClick) return;
            if (e.key === "Enter" || e.key === " ") onDealsClick();
          }}
          style={{ background:`linear-gradient(90deg, ${T.brand}, ${T.brandDark})`, padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between", cursor:onDealsClick?"pointer":"default" }}
        >
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🔓</span>
            <span style={{ fontSize:13, fontWeight:700, color:"#fff" }}>Deals section unlocks</span>
          </div>
        </div>
      </div>

      <button onClick={()=>onAuthChoice("google")} disabled={authLoading} style={{ width:"100%", padding:"13px 20px", borderRadius:12, cursor:authLoading?"wait":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:12, background:T.bgCard, border:`1.5px solid ${pulseGoogle ? T.brand : T.border}`, fontSize:15, fontWeight:600, color:T.textPrimary, boxShadow:pulseGoogle?"0 18px 60px rgba(22,163,74,0.20)":T.shadowSm, transition:"all 0.15s", animation:pulseGoogle?"dd24Pulse 1.1s ease-in-out 0s 3":"none", opacity:authLoading?0.7:1 }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderStrong;e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow=T.shadowMd;}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=T.shadowSm;}}>
        <GoogleIcon /> {authLoading ? "Redirecting to Google..." : "Continue with Google"}
      </button>
      <button
        type="button"
        onClick={() => onAuthChoice?.("google")}
        disabled={authLoading}
        style={{
          marginTop: 10,
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          fontSize: 12,
          fontWeight: 600,
          color: "rgba(100,116,139,0.95)",
          cursor: authLoading ? "not-allowed" : "pointer",
          textDecoration: "none",
          textUnderlineOffset: 3,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "rgba(22,163,74,0.95)";
          e.currentTarget.style.textDecoration = "underline";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(100,116,139,0.95)";
          e.currentTarget.style.textDecoration = "none";
        }}
      >
        Already a member? Login here
      </button>
      {authError ? (
        <div style={{ marginTop: 12, fontSize: 12, color: "#B91C1C", textAlign: "center" }}>
          {authError}
        </div>
      ) : null}
    </div>
  );
}

// ─── DEALS STRIP (Landing teaser) ────────────────────────────────────────────
function DealsStrip({ onCtaClick, onDealClick }) {
  const [seedClock, setSeedClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setSeedClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const dailySeed = useMemo(() => getCurrentPoolDateSeed(seedClock), [seedClock]);
  const { deals: liveDeals, loading, error } = useDeals({
    limit: 24,
    curated: "daily_live_pool",
    seed: dailySeed,
  });
  const stripRef = useRef(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const sampledDeals = useMemo(() => {
    const source = Array.isArray(liveDeals) ? liveDeals.filter(Boolean) : [];
    return source.length > 0 ? source.slice(0, 5) : null;
  }, [liveDeals]);

  const cards = sampledDeals && sampledDeals.length ? sampledDeals : null;
  const displayed = cards;

  useEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;

    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) {
        setScrollProgress(0);
        return;
      }
      setScrollProgress(Math.min(1, Math.max(0, el.scrollLeft / max)));
    };

    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [displayed?.length]);

  return (
    <div style={{ background:T.bg, padding:"28px 0 44px" }}>
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 48px" }}>
        <div style={{ height:1, background:T.border, margin:"6px 0 20px" }} />

        <div className="dd24-waitlist-strip-header" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:26 }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:T.brand, boxShadow:`0 0 10px rgba(22,163,74,0.35)` }} />
            <span style={{ fontSize:13, color:"#64748B", fontWeight:800, letterSpacing:1.6, textTransform:"uppercase" }}>
              Today&apos;s fixed 24 live deals · refreshed daily
            </span>
          </div>
          <span
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onCtaClick?.();
            }}
            onClick={() => onCtaClick?.()}
            style={{ fontSize:16, color:T.brand, fontWeight:800, display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}
          >
            Daily 24 live deals unlock after 2 invites
            <span style={{ fontSize:22, lineHeight:1 }}>›</span>
          </span>
        </div>

        <div style={{ position:"relative" }}>
          {loading && (
            <div style={{ fontSize:13, color:T.textMuted, padding:"12px 2px" }}>
              Loading deals…
            </div>
          )}
          {!loading && error && (
            <div style={{ fontSize:13, color:T.textMuted, padding:"12px 2px" }}>
              Deals unavailable right now.
            </div>
          )}
          {!loading && !error && !displayed?.length && (
            <div style={{ fontSize:13, color:T.textMuted, padding:"12px 2px" }}>
              No eligible deals found.
            </div>
          )}

          <div
            ref={stripRef}
            style={{
              display: "flex",
              gap: 24,
              overflowX: "auto",
              paddingBottom: 18,
              scrollSnapType: "x mandatory",
              WebkitOverflowScrolling: "touch",
            }}
          >
            {(displayed || []).slice(0, 5).map((d, i) => {
              const store =
                d?.store?.name || d?.store_name || d?.store || "Store";
              const product =
                d?.product_name || d?.product || d?.name || "Deal";
              const imageUrl = d?.image_url || d?.imageUrl || null;

              const currency = d?.currency || "EUR";
              const salePrice =
                d?.sale_price != null
                  ? Number(d.sale_price)
                  : d?.now != null
                    ? d.now
                    : null;
              const originalPrice =
                d?.original_price != null
                  ? Number(d.original_price)
                  : d?.was != null
                    ? d.was
                    : null;

              const now =
                typeof salePrice === "number" && Number.isFinite(salePrice)
                  ? formatPrice(salePrice, currency)
                  : String(d?.now || "—");
              const was =
                typeof originalPrice === "number" &&
                Number.isFinite(originalPrice)
                  ? formatPrice(originalPrice, currency)
                  : d?.was
                    ? String(d.was)
                    : null;

              const rawDiscount = Number(d?.discount_percent);
              const discountPercent = Number.isFinite(rawDiscount)
                ? rawDiscount
                : typeof originalPrice === "number" &&
                    typeof salePrice === "number" &&
                    originalPrice > 0
                  ? ((originalPrice - salePrice) / originalPrice) * 100
                  : null;
              const off = Number.isFinite(discountPercent)
                ? `${Math.round(discountPercent)}%`
                : d?.off
                  ? String(d.off).replace(/^-/, "")
                  : null;

              const mode = i === 3 ? "locked" : i >= 4 ? "blurred" : "normal";

              return (
                <div key={`${store}:${product}:${i}`} style={{ scrollSnapAlign: "start" }}>
                  <DealsStripCard
                    index={i}
                    store={store}
                    product={product}
                    now={now}
                    was={was}
                    off={off}
                    imageUrl={imageUrl}
                    mode={mode}
                    onClick={onDealClick}
                  />
                </div>
              );
            })}
          </div>

          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 18,
              width: 128,
              pointerEvents: "none",
              background:
                "linear-gradient(90deg, rgba(248,250,248,0) 0%, rgba(248,250,248,0.9) 70%, #F8FAF8 100%)",
            }}
          />
        </div>

        <div style={{ marginTop: 22, maxWidth: 420, marginInline: "auto" }}>
          <div style={{ height: 4, borderRadius: 999, background: "#E5E7EB", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.max(10, Math.round(scrollProgress * 100))}%`,
                background: T.brand,
                borderRadius: 999,
                transition: "width 120ms linear",
              }}
            />
          </div>
          <div style={{ marginTop: 8, textAlign: "center", fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: "#6B7280" }}>
            SCROLL TO SEE MORE DEALS
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function LandingPage({
  onAuthChoice,
  authError = "",
  authLoading = false,
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError]   = useState(false);
  const startSavingRef = useRef(null);
  const dealsSectionRef = useRef(null);
  const pulseTimeoutRef = useRef(null);
  const [pulseGoogle, setPulseGoogle] = useState(false);

  const focusStartSaving = () => {
    startSavingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setPulseGoogle(false);
    window.requestAnimationFrame(() => setPulseGoogle(true));
    clearTimeout(pulseTimeoutRef.current);
    pulseTimeoutRef.current = window.setTimeout(() => setPulseGoogle(false), 3600);
  };

  const focusDealsSection = () => {
    dealsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    return () => clearTimeout(pulseTimeoutRef.current);
  }, []);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" }}>

      {/* ── Full-bleed hero ─────────────────────────────────────────────────── */}
      <div style={{ position:"relative", width:"100%", minHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {!imgError && (
          <picture>
            <source media="(max-width: 640px)" srcSet={HERO_IMAGE_MOBILE_URL} />
            <source srcSet={HERO_IMAGE_WEBP_URL} type="image/webp" />
            <img
              src={HERO_IMAGE_URL}
              alt="Desi groceries hero"
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                setImgError(true);
                setImgLoaded(true);
              }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "center 40%",
                opacity: imgLoaded ? 1 : 0,
                transition: "opacity 0.8s ease",
              }}
              loading="eager"
              decoding="async"
            />
          </picture>
        )}
        {(!imgLoaded||imgError) && <div style={{ position:"absolute", inset:0, background:"linear-gradient(145deg,#FFF7ED 0%,#FEF3C7 20%,#ECFDF5 55%,#D1FAE5 100%)" }} />}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom,rgba(0,0,0,0.28) 0%,rgba(0,0,0,0.08) 40%,rgba(0,0,0,0.55) 78%,rgba(0,0,0,0.75) 100%)" }} />
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to right,rgba(0,0,0,0.32) 0%,rgba(0,0,0,0.08) 45%,transparent 70%)" }} />
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(160deg,rgba(22,163,74,0.10) 0%,transparent 50%)" }} />

        {/* Nav */}
        <nav className="dd24-waitlist-nav" style={{ position:"relative", zIndex:10, padding:"20px 48px", display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1280, margin:"0 auto", width:"100%" }}>
          <Logo light />

          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div
              role="button"
              tabIndex={0}
              onClick={focusDealsSection}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") focusDealsSection();
              }}
              style={{ padding:"6px 14px", borderRadius:99, background:"rgba(22,163,74,0.30)", backdropFilter:"blur(10px)", border:"1px solid rgba(187,247,208,0.55)", fontSize:12, fontWeight:800, color:"#fff", cursor:"pointer", boxShadow:"0 14px 42px rgba(22,163,74,0.22)", animation:"dd24NavPulse 1.6s ease-in-out infinite", display:"flex", alignItems:"center", gap:8 }}
            >
              <span aria-hidden="true" style={{ fontSize:14, lineHeight:1 }}>🔒</span>
              <span>Today&apos;s 24 deals</span>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!authLoading) onAuthChoice?.("google");
              }}
              onKeyDown={(e) => {
                if (authLoading) return;
                if (e.key === "Enter" || e.key === " ") onAuthChoice?.("google");
              }}
              aria-label="Login"
              style={{
                padding: "8px 14px",
                borderRadius: 99,
                background: "rgba(255,255,255,0.16)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.34)",
                fontSize: 12,
                fontWeight: 800,
                color: "#fff",
                cursor: authLoading ? "not-allowed" : "pointer",
                boxShadow: "0 10px 26px rgba(0,0,0,0.22)",
                opacity: authLoading ? 0.65 : 1,
              }}
              title="Already registered? Log in with Google"
            >
              {authLoading ? "Opening…" : "Login"}
            </div>
          </div>
        </nav>

        {/* Hero content */}
        <div className="dd24-waitlist-hero-grid" style={{ position:"relative", zIndex:10, flex:1, maxWidth:1280, margin:"0 auto", width:"100%", padding:"24px 48px 60px", display:"grid", gridTemplateColumns:"1fr 400px", gap:48, alignItems:"center" }}>
          <div>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:99, background:"rgba(22,163,74,0.25)", border:"1px solid rgba(22,163,74,0.4)", backdropFilter:"blur(6px)", marginBottom:22 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:T.brandMid, display:"inline-block", boxShadow:`0 0 6px ${T.brand}` }} />
              <span
                role="button"
                tabIndex={0}
                onClick={focusDealsSection}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") focusDealsSection();
                }}
                style={{ fontSize:12, color:"#fff", fontWeight:600, letterSpacing:0.4, cursor:"pointer" }}
              >
                Desi groceries · 24 stores · All of Germany
              </span>
            </div>

            <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(38px,4.8vw,68px)", fontWeight:900, lineHeight:1.04, letterSpacing:-2.5, margin:"0 0 20px", color:"#fff", textShadow:"0 2px 12px rgba(0,0,0,0.25)", maxWidth:560 }}>
              STOP<br />
              <span style={{ color:T.brandMid }}>Overpaying</span><br />
              for Desi Groceries.
            </h1>

            <div style={{ display:"inline-block", background:"rgba(255,255,255,0.12)", backdropFilter:"blur(10px)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:14, padding:"14px 20px", marginBottom:28, maxWidth:480 }}>
              <p style={{ fontSize:15, color:"rgba(255,255,255,0.92)", lineHeight:1.75, margin:0 }}>
                Stop checking 10 different websites. We monitor every Desi store in Europe to find the lowest prices on Atta, Rice, Spices and more.
              </p>
            </div>

            {/* Social proof */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:28 }}>
              <div style={{ display:"flex" }}>
                {["🧑🏽","👩🏾","👨🏻","👩🏽","🧑🏾"].map((e,i)=>(
                  <div key={i} style={{ width:30, height:30, borderRadius:"50%", background:T.brandLight, border:"2.5px solid rgba(255,255,255,0.6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, marginLeft:i?-10:0, zIndex:5-i }}>{e}</div>
                ))}
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={focusStartSaving}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") focusStartSaving();
                }}
                style={{ background:"rgba(255,255,255,0.15)", backdropFilter:"blur(8px)", borderRadius:99, padding:"7px 16px", border:"1px solid rgba(255,255,255,0.25)", cursor:"pointer" }}
              >
                <span style={{ fontSize:13, color:"#fff", fontWeight:700 }}>4,247</span>
                <span style={{ fontSize:13, color:"rgba(255,255,255,0.8)" }}> members already in</span>
              </div>
            </div>

          </div>

          {/* Auth card */}
          <div ref={startSavingRef} style={{ paddingBottom:20, scrollMarginTop: 24 }}>
            <AuthCard onAuthChoice={onAuthChoice} glass pulseGoogle={pulseGoogle} onDealsClick={focusDealsSection} authError={authError} authLoading={authLoading} />
          </div>
        </div>
      </div>

      {/* ── Value props bar ──────────────────────────────────────────────────── */}
      <div style={{ background:T.bgCard, borderTop:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}` }}>
        <div className="dd24-waitlist-props" style={{ maxWidth:1200, margin:"0 auto", padding:"22px 48px", display:"grid", gridTemplateColumns:"1fr 1px 1fr", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16, padding:"0 26px 0 0", justifyContent:"flex-start" }}>
            <div style={{ width:46, height:46, borderRadius:16, background:"#fff", border:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:T.shadowSm, flexShrink:0, fontSize:22 }}>
              🏪
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:18, fontWeight:800, color:T.textPrimary, marginBottom:4 }}>Deals from 24 stores</div>
              <div style={{ fontSize:15, color:"#64748B", lineHeight:1.4 }}>24 live deals, curated daily</div>
            </div>
          </div>

          <div style={{ width:1, height:52, background:T.border, justifySelf:"center" }} />

          <div style={{ display:"flex", alignItems:"center", gap:16, padding:"0 0 0 26px", justifyContent:"flex-end" }}>
            <div style={{ width:46, height:46, borderRadius:16, background:"#fff", border:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:T.shadowSm, flexShrink:0, fontSize:22 }}>
              🔒
            </div>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:18, fontWeight:800, color:T.textPrimary, marginBottom:4 }}>Unlock with 2 invites</div>
              <div style={{ fontSize:15, color:"#64748B", lineHeight:1.4 }}>Invite 2 friends · deals section opens</div>
            </div>
          </div>
        </div>
      </div>

      <div ref={dealsSectionRef} style={{ scrollMarginTop: 24 }}>
        <DealsStrip onCtaClick={focusStartSaving} onDealClick={focusStartSaving} />
      </div>

      <div
        style={{
          background: T.bg,
          borderTop: `1px solid ${T.border}`,
          padding: "22px 20px",
          textAlign: "center",
          color: T.textMuted,
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderRadius: 999,
              border: `1px solid ${T.border}`,
              background: "rgba(255,255,255,0.72)",
              backdropFilter: "blur(10px)",
              boxShadow:
                "0px 1px 2px rgba(15,23,42,0.05), 0px 10px 30px rgba(15,23,42,0.06)",
              color: "#64748B",
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            <span style={{ fontWeight: 700, color: "#475569" }}>
              Made with
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 999,
                background: "rgba(16,185,129,0.10)",
                border: "1px solid rgba(16,185,129,0.14)",
              }}
            >
              <img
                src="/landing/dd24-logo.svg"
                alt=""
                aria-hidden="true"
                style={{ width: 20, height: 20, opacity: 0.85 }}
              />
            </span>
            <span style={{ fontWeight: 700, color: "#475569" }}>
              by Desis, for Desis.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WHATSAPP FLOW ────────────────────────────────────────────────────────────
function WhatsAppFlow({ onComplete }) {
  const [step, setStep]         = useState("phone");
  const [phone, setPhone]       = useState("");
  const [otp, setOtp]           = useState(["","","","","",""]);
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading]   = useState(false);
  const [timer, setTimer]       = useState(45);
  const [pFocus, setPFocus]     = useState(false);
  const [pcFocus, setPcFocus]   = useState(false);
  const otpRefs                 = useRef([]);
  const stepIdx                 = step==="phone"?0:step==="otp"?1:2;

  useEffect(()=>{
    if(step!=="otp")return;
    const id=setInterval(()=>setTimer(t=>t>0?t-1:0),1000);
    return()=>clearInterval(id);
  },[step]);

  const sendOtp=()=>{ if(phone.replace(/\s/g,"").length<9)return; setLoading(true); setTimeout(()=>{setLoading(false);setStep("otp");setTimer(45);},1100); };
  const handleDigit=(val,idx)=>{
    const d=val.replace(/\D/g,"").slice(-1); const next=[...otp]; next[idx]=d; setOtp(next);
    if(d&&idx<5)otpRefs.current[idx+1]?.focus();
    if(next.every(x=>x!=="")){ setTimeout(()=>{setLoading(true);setTimeout(()=>{setLoading(false);setStep("postcode");},800);},150); }
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${T.brand},${T.brandDark})` }} />
      <nav style={{ padding:"18px 36px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"center" }}><Logo /></nav>
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
        <div style={{ width:"100%", maxWidth:420 }}>
          {/* Steps */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6, marginBottom:32 }}>
            {["Phone","Verify","Postcode"].map((s,i)=>{
              const done=i<stepIdx,active=i===stepIdx;
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:5 }}>
                    <div style={{ width:30, height:30, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:done?T.brand:active?T.brandLight:T.bgMuted, border:`1.5px solid ${done?T.brand:active?T.brandMid:T.border}`, fontSize:12, fontWeight:700, color:done?T.textOnBrand:active?T.brandDark:T.textMuted, transition:"all 0.3s" }}>
                      {done?"✓":i+1}
                    </div>
                    <span style={{ fontSize:10, color:active?T.textPrimary:T.textMuted, fontWeight:active?700:400 }}>{s}</span>
                  </div>
                  {i<2&&<div style={{ width:30, height:2, background:done?T.brand:T.border, marginBottom:16, borderRadius:99, transition:"background 0.3s" }}/>}
                </div>
              );
            })}
          </div>
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:24, padding:32, boxShadow:T.shadowLg }}>
            {step==="phone"&&(
              <div style={{ animation:"fadeIn 0.3s ease" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}><WhatsAppIcon/><h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:800, letterSpacing:-0.8, color:T.textPrimary, margin:0 }}>Your number</h2></div>
                <p style={{ fontSize:13, color:T.textSecondary, marginBottom:24, lineHeight:1.7 }}>We'll send a one-time code via WhatsApp. No account needed.</p>
                <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                  <div style={{ padding:"12px 14px", borderRadius:10, fontSize:14, fontWeight:600, border:`1.5px solid ${T.border}`, background:T.bgMuted, color:T.textPrimary, flexShrink:0, display:"flex", alignItems:"center", gap:6 }}>🇩🇪 +49</div>
                  <input type="tel" placeholder="172 000 0000" value={phone} onChange={e=>setPhone(e.target.value.replace(/[^\d\s]/g,""))} onFocus={()=>setPFocus(true)} onBlur={()=>setPFocus(false)} onKeyDown={e=>e.key==="Enter"&&sendOtp()}
                    style={{ flex:1, padding:"12px 16px", borderRadius:10, fontSize:15, border:`1.5px solid ${pFocus?T.brand:T.border}`, background:T.bgCard, color:T.textPrimary, outline:"none", transition:"border 0.2s", boxSizing:"border-box" }}/>
                </div>
                <button onClick={sendOtp} disabled={phone.replace(/\s/g,"").length<9||loading} style={{ width:"100%", padding:"13px", borderRadius:12, border:"none", cursor:phone.replace(/\s/g,"").length>=9?"pointer":"not-allowed", background:phone.replace(/\s/g,"").length>=9?`linear-gradient(135deg,${T.whatsapp},#1aad52)`:T.bgMuted, color:phone.replace(/\s/g,"").length>=9?T.textOnBrand:T.textMuted, fontSize:15, fontWeight:700, marginBottom:12, boxShadow:phone.replace(/\s/g,"").length>=9?"0 4px 14px rgba(37,211,102,0.35)":"none", transition:"all 0.2s" }}>
                  {loading?"Sending…":"Send WhatsApp Code →"}
                </button>
                <button onClick={()=>window.dispatchEvent(new CustomEvent("dd24back"))} style={{ width:"100%", padding:"11px", borderRadius:12, border:`1px solid ${T.border}`, background:"transparent", color:T.textSecondary, fontSize:13, cursor:"pointer", fontWeight:500 }}>← Use Google instead</button>
              </div>
            )}
            {step==="otp"&&(
              <div style={{ animation:"fadeIn 0.3s ease" }}>
                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}><span style={{ fontSize:24 }}>💬</span><h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:800, letterSpacing:-0.8, color:T.textPrimary, margin:0 }}>Check WhatsApp</h2></div>
                <p style={{ fontSize:13, color:T.textSecondary, marginBottom:26, lineHeight:1.7 }}>6-digit code sent to <strong style={{ color:T.textPrimary }}>+49 {phone}</strong></p>
                <div style={{ display:"flex", gap:8, marginBottom:22, justifyContent:"center" }}>
                  {otp.map((d,i)=>(
                    <input key={i} ref={el=>otpRefs.current[i]=el} type="text" inputMode="numeric" maxLength={1} value={d}
                      onChange={e=>handleDigit(e.target.value,i)} onKeyDown={e=>e.key==="Backspace"&&!otp[i]&&i>0&&otpRefs.current[i-1]?.focus()}
                      style={{ width:46, height:54, textAlign:"center", fontSize:22, fontWeight:700, borderRadius:10, border:`2px solid ${d?T.brand:T.border}`, background:d?T.brandLight:T.bgCard, color:d?T.brandDark:T.textPrimary, outline:"none", transition:"all 0.15s" }}/>
                  ))}
                </div>
                {loading&&<div style={{ textAlign:"center", fontSize:13, color:T.brand, marginBottom:14, fontWeight:600 }}>✓ Verifying…</div>}
                <div style={{ textAlign:"center", fontSize:13, color:T.textSecondary }}>
                  {timer>0?<>Resend in <span style={{ color:T.textPrimary, fontWeight:600 }}>0:{String(timer).padStart(2,"0")}</span></>:<span style={{ color:T.brand, cursor:"pointer", fontWeight:600 }} onClick={()=>{setOtp(["","","","","",""]);setTimer(45);}}>Resend code</span>}
                </div>
              </div>
            )}
            {step==="postcode"&&(
              <div style={{ animation:"fadeIn 0.3s ease" }}>
                <div style={{ fontSize:36, marginBottom:10 }}>📍</div>
                <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:800, letterSpacing:-0.8, color:T.textPrimary, marginBottom:8 }}>One last thing</h2>
                <p style={{ fontSize:13, color:T.textSecondary, marginBottom:22, lineHeight:1.7 }}>Your postcode helps us surface same-day delivery and local deals near you.</p>
                <input type="text" placeholder="e.g. 10115" value={postcode} onChange={e=>setPostcode(e.target.value.replace(/\D/g,"").slice(0,5))} onFocus={()=>setPcFocus(true)} onBlur={()=>setPcFocus(false)}
                  style={{ width:"100%", padding:"14px 16px", borderRadius:10, fontSize:22, fontWeight:700, letterSpacing:4, border:`2px solid ${pcFocus?T.brand:T.border}`, background:T.bgCard, color:T.textPrimary, outline:"none", marginBottom:14, textAlign:"center", boxSizing:"border-box", transition:"border 0.2s" }}/>
                <button onClick={()=>{ if(postcode.length<4)return; setLoading(true); setTimeout(()=>onComplete(`+49 ${phone}`),900); }} disabled={postcode.length<4||loading}
                  style={{ width:"100%", padding:"13px", borderRadius:12, border:"none", cursor:postcode.length>=4?"pointer":"not-allowed", background:postcode.length>=4?`linear-gradient(135deg,${T.brand},${T.brandDark})`:T.bgMuted, color:postcode.length>=4?T.textOnBrand:T.textMuted, fontSize:15, fontWeight:700, boxShadow:postcode.length>=4?T.shadowBrand:"none", transition:"all 0.2s" }}>
                  {loading?"Confirming…":"Get my invite link →"}
                </button>
                <div style={{ marginTop:10, fontSize:11, color:T.textMuted, textAlign:"center" }}>Used only for delivery relevance. Never shared.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── GOOGLE FLOW ──────────────────────────────────────────────────────────────
function GoogleFlow({ onComplete }) {
  const [ready, setReady]       = useState(false);
  const [postcode, setPostcode] = useState("");
  const [loading, setLoading]   = useState(false);
  const [pcFocus, setPcFocus]   = useState(false);
  useEffect(()=>{const t=setTimeout(()=>setReady(true),1100);return()=>clearTimeout(t);},[]);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${T.brand},${T.brandDark})` }} />
      <nav style={{ padding:"18px 36px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"center" }}><Logo /></nav>
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
        <div style={{ width:"100%", maxWidth:420 }}>
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:24, padding:32, boxShadow:T.shadowLg }}>
            {!ready?(
              <div style={{ textAlign:"center", padding:"28px 0", animation:"fadeIn 0.3s ease" }}>
                <div style={{ fontSize:42, marginBottom:14 }}>🔵</div>
                <div style={{ fontSize:15, color:T.textPrimary, fontWeight:600, marginBottom:6 }}>Connecting to Google…</div>
                <div style={{ fontSize:13, color:T.textSecondary }}>Completing sign-in securely</div>
              </div>
            ):(
              <div style={{ animation:"fadeIn 0.4s ease" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", borderRadius:12, background:T.brandDim, border:`1px solid ${T.brandBorder}`, marginBottom:24 }}>
                  <div style={{ width:36, height:36, borderRadius:"50%", background:"linear-gradient(135deg,#4285F4,#34A853)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", fontWeight:700, flexShrink:0 }}>S</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:T.textPrimary }}>Sharma Priya</div>
                    <div style={{ fontSize:11, color:T.textSecondary }}>sharma.priya@gmail.com</div>
                  </div>
                  <span style={{ fontSize:11, color:T.brand, fontWeight:700, padding:"3px 10px", borderRadius:99, background:T.brandLight, border:`1px solid ${T.brandMid}`, flexShrink:0 }}>✓ Verified</span>
                </div>
                <div style={{ fontSize:32, marginBottom:10 }}>📍</div>
                <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:800, letterSpacing:-0.8, color:T.textPrimary, marginBottom:8 }}>One last thing</h2>
                <p style={{ fontSize:13, color:T.textSecondary, marginBottom:22, lineHeight:1.7 }}>Your postcode helps us show same-day delivery options and local deals.</p>
                <input type="text" placeholder="e.g. 10115" value={postcode} onChange={e=>setPostcode(e.target.value.replace(/\D/g,"").slice(0,5))} onFocus={()=>setPcFocus(true)} onBlur={()=>setPcFocus(false)}
                  style={{ width:"100%", padding:"14px 16px", borderRadius:10, fontSize:22, fontWeight:700, letterSpacing:4, border:`2px solid ${pcFocus?T.brand:T.border}`, background:T.bgCard, color:T.textPrimary, outline:"none", marginBottom:14, textAlign:"center", boxSizing:"border-box", transition:"border 0.2s" }}/>
                <button onClick={()=>{ if(postcode.length<4)return; setLoading(true); setTimeout(()=>onComplete("sharma.priya@gmail.com"),900); }} disabled={postcode.length<4||loading}
                  style={{ width:"100%", padding:"13px", borderRadius:12, border:"none", cursor:postcode.length>=4?"pointer":"not-allowed", background:postcode.length>=4?`linear-gradient(135deg,${T.brand},${T.brandDark})`:T.bgMuted, color:postcode.length>=4?T.textOnBrand:T.textMuted, fontSize:15, fontWeight:700, boxShadow:postcode.length>=4?T.shadowBrand:"none", transition:"all 0.2s" }}>
                  {loading?"Confirming…":"Get my invite link →"}
                </button>
                <div style={{ marginTop:10, fontSize:11, color:T.textMuted, textAlign:"center" }}>Used only for delivery relevance. Never shared.</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── INVITE DASHBOARD ─────────────────────────────────────────────────────────
function InviteDashboard({ identity, status, onLogout, logoutLoading = false }) {
  const displayName = buildDisplayName(identity);
  const confirmedCount = Number(status?.confirmed_count || 0);
  const remaining = Math.max(
    0,
    Number(status?.remaining_count ?? INVITES_NEEDED - confirmedCount),
  );
  const invitees = Array.isArray(status?.invitees) ? status.invitees : [];
  const inviteLink =
    typeof window !== "undefined"
      ? `${window.location.origin}${status?.invite_url || "/waitlist"}`
      : status?.invite_url || "/waitlist";
  const shareCopy = `Join DesiDeals24 with my invite link and help unlock the deals section: ${inviteLink}`;

  const openShare = (url) => {
    if (typeof window === "undefined") return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ minHeight:"100vh", background:T.bg }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${T.brand},${T.brandDark},${T.brand})` }} />

      <nav className="dd24-waitlist-nav" style={{ padding:"18px 40px", display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1060, margin:"0 auto", borderBottom:`1px solid ${T.border}` }}>
        <Logo />
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button
            type="button"
            onClick={onLogout}
            disabled={logoutLoading}
            style={{
              padding:"9px 16px",
              borderRadius:99,
              background:"#fff",
              border:`1px solid ${T.borderStrong}`,
              fontSize:13,
              color:T.textPrimary,
              fontWeight:700,
              cursor:logoutLoading ? "wait" : "pointer",
              boxShadow:T.shadowSm,
            }}
          >
            {logoutLoading ? "Logging out..." : "Logout"}
          </button>
        </div>
      </nav>

      <div className="dd24-waitlist-shell" style={{ maxWidth:1060, margin:"0 auto", padding:"40px 40px 64px" }}>
        <div style={{ marginBottom:32 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:99, background:T.amberLight, border:`1px solid ${T.amberBorder}`, fontSize:12, fontWeight:600, color:T.amber, marginBottom:14 }}>
            🔒 Deals locked · {remaining} registration{remaining === 1 ? "" : "s"} needed
          </div>
          <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(26px,4vw,40px)", fontWeight:900, letterSpacing:-1.5, margin:"0 0 10px", lineHeight:1.1, color:T.textPrimary }}>
            You're in, <span style={{ color:T.brand }}>{displayName || "friend"}</span>.<br />Now invite 2 friends. 🚀
          </h1>
          <p style={{ color:T.textSecondary, fontSize:15, maxWidth:560 }}>
            The moment <strong style={{ color:T.textPrimary }}>2 friends register</strong> from your invite link, the deals section unlocks automatically.
          </p>
        </div>

        <div className="dd24-waitlist-progress-card" style={{ background:T.bgCard, border:`1.5px solid ${T.border}`, borderRadius:24, padding:28, marginBottom:24, boxShadow:T.shadowMd, display:"flex", alignItems:"center", gap:32, flexWrap:"wrap" }}>
          <ProgressRing confirmed={confirmedCount} needed={INVITES_NEEDED} />

          <div style={{ flex:1, minWidth:220 }}>
            <div style={{ fontSize:13, color:T.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>Unlock progress</div>
            <div style={{ display:"flex", gap:10, marginBottom:14 }}>
              {Array.from({ length: INVITES_NEEDED }).map((_, i) => {
                const filled = i < confirmedCount;
                return (
                  <div key={i} style={{ flex:1, height:10, borderRadius:99, background:filled?T.brand:T.bgMuted, border:`1px solid ${filled?T.brandDark:T.border}`, transition:"background 0.5s" }} />
                );
              })}
            </div>
            <div style={{ fontSize:14, color:T.textSecondary, lineHeight:1.6 }}>
              <span style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:900, color:T.brand }}>{confirmedCount}</span>
              <span style={{ color:T.textMuted }}> / {INVITES_NEEDED} friends registered</span>
              <span style={{ display:"block", fontSize:13, color:T.textMuted, marginTop:2 }}>
                Invite {remaining} more friend{remaining === 1 ? "" : "s"} to unlock your deals section.
              </span>
            </div>
          </div>

          <div style={{ position:"relative", borderRadius:16, overflow:"hidden", flexShrink:0, width:260 }}>
            <div style={{ display:"flex", gap:8, padding:"14px 16px", background:T.bgMuted, borderRadius:16, filter:"blur(3px)" }}>
              {ALL_DEALS.slice(0,3).map((d,i)=>(
                <div key={i} style={{ background:T.bgCard, borderRadius:12, padding:"10px 12px", minWidth:72, fontSize:11 }}>
                  <div style={{ fontSize:16, marginBottom:3 }}>{d.emoji}</div>
                  <div style={{ fontWeight:800, color:T.brand, fontSize:13 }}>{d.now}</div>
                  <div style={{ color:T.textMuted, textDecoration:"line-through", fontSize:10 }}>{d.was}</div>
                </div>
              ))}
            </div>
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", background:"rgba(248,250,248,0.6)", backdropFilter:"blur(1px)", borderRadius:16 }}>
              <div style={{ fontSize:28, marginBottom:6 }}>🔒</div>
              <div style={{ fontSize:12, fontWeight:700, color:T.textPrimary, textAlign:"center", lineHeight:1.5 }}>
                Deals locked
                <br />
                <span style={{ color:T.textMuted, fontWeight:500 }}>
                  Register {remaining} more friend{remaining === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="dd24-waitlist-dashboard-grid" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:20, padding:24, boxShadow:T.shadowSm }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:T.brandLight, border:`1px solid ${T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🔗</div>
              <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:20, fontWeight:800, letterSpacing:-0.5, color:T.textPrimary, margin:0 }}>Invite {remaining} more friend{remaining === 1 ? "" : "s"}</h2>
            </div>
            <p style={{ fontSize:13, color:T.textSecondary, marginBottom:20, lineHeight:1.7 }}>
              Share your invite link. Once 2 friends sign up through it, your deals section unlocks automatically.
            </p>

            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.textMuted, fontWeight:600, letterSpacing:0.7, textTransform:"uppercase", marginBottom:8 }}>Your invite link</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ flex:1, padding:"10px 14px", borderRadius:10, fontSize:11, color:T.textMuted, background:T.bgMuted, border:`1px solid ${T.border}`, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inviteLink}</div>
                <CopyButton text={inviteLink} />
              </div>
            </div>

            <div style={{ marginBottom:16, padding:"12px 14px", borderRadius:12, background:T.bgMuted, border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:11, color:T.textMuted, fontWeight:700, letterSpacing:0.6, textTransform:"uppercase", marginBottom:6 }}>Your referral code</div>
              <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:24, fontWeight:900, letterSpacing:-0.8, color:T.textPrimary }}>{status?.referral_code || "—"}</div>
            </div>

            <button
              type="button"
              onClick={() => openShare(`https://wa.me/?text=${encodeURIComponent(shareCopy)}`)}
              style={{ width:"100%", padding:"12px", borderRadius:12, marginBottom:10, border:"1.5px solid rgba(37,211,102,0.35)", background:"rgba(37,211,102,0.08)", color:"#15803D", fontWeight:700, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
            >
              <WhatsAppIcon /> Share on WhatsApp
            </button>

            <div style={{ display:"flex", gap:8 }}>
              <button
                type="button"
                onClick={() => openShare(`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent("Join DesiDeals24 with my invite link.")}`)}
                style={{ flex:1, padding:"10px", borderRadius:10, border:"1px solid rgba(37,99,235,0.22)", background:"rgba(37,99,235,0.07)", color:"#1D4ED8", fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
              >
                ✈️ Telegram
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(shareCopy).catch(() => {});
                }}
                style={{ flex:1, padding:"10px", borderRadius:10, border:`1px solid ${T.border}`, background:T.bgMuted, color:T.textSecondary, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}
              >
                🔗 Copy message
              </button>
            </div>
          </div>

          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:20, padding:24, boxShadow:T.shadowSm, display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:20, fontWeight:800, letterSpacing:-0.5, margin:0, color:T.textPrimary }}>Invite activity</h2>
              <div style={{ padding:"4px 12px", borderRadius:99, background:T.bgMuted, border:`1px solid ${T.border}`, fontSize:12, color:T.textSecondary, fontWeight:600 }}>{invitees.length} registered</div>
            </div>
            <p style={{ fontSize:13, color:T.textSecondary, marginBottom:16 }}>
              <span style={{ color:T.brand, fontWeight:700 }}>{confirmedCount} registered</span> · {remaining} still needed
            </p>

            {invitees.length === 0 ? (
              <div style={{ flex:1 }}>
                <div style={{ borderRadius:16, background:`linear-gradient(160deg, ${T.brandLight} 0%, #fff 100%)`, border:`1px solid ${T.brandBorder}`, padding:"28px 20px 20px", textAlign:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:0, marginBottom:18, position:"relative", height:64 }}>
                    <div style={{ position:"absolute", width:110, height:110, borderRadius:"50%", border:`1.5px dashed ${T.brandMid}`, top:"50%", left:"50%", transform:"translate(-50%,-50%)" }} />
                    <div style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${T.brand},${T.brandDark})`, border:"3px solid #fff", boxShadow:T.shadowBrand, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, zIndex:2, position:"relative" }}>🧑🏽</div>
                    {[{ x:-52, y:-8, delay:"0s" },{ x:52, y:-8, delay:"0.4s" }].map((slot,i)=>(
                      <div key={i} style={{ position:"absolute", left:`calc(50% + ${slot.x}px)`, top:`calc(50% + ${slot.y}px)`, transform:"translate(-50%,-50%)", width:38, height:38, borderRadius:"50%", background:"rgba(255,255,255,0.9)", border:`2px dashed ${T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"center", animation:`float${i} 3s ease-in-out ${slot.delay} infinite alternate` }}>
                        <span style={{ fontSize:16, opacity:0.45 }}>👤</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:17, fontWeight:800, color:T.textPrimary, marginBottom:6, letterSpacing:-0.4 }}>No friends registered yet</div>
                  <p style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, maxWidth:240, margin:"0 auto 0" }}>
                    Share your invite link. As friends register through it, they’ll appear here.
                  </p>
                </div>
              </div>
            ) : (
              invitees.map((invite, index) => (
                <InviteRow
                  key={invite.id || index}
                  invite={{
                    name: invite.display_name || "Friend",
                    contact: invite.contact_label || "Registered",
                    method: "google",
                    status: "joined",
                  }}
                  index={index}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DEALS UNLOCKED SCREEN ────────────────────────────────────────────────────
function DealsUnlocked({ identity, status }) {
  const displayName = buildDisplayName(identity);
  const [celebrated, setCelebrated] = useState(true);
  const [seedClock, setSeedClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setSeedClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const dailySeed = useMemo(() => getCurrentPoolDateSeed(seedClock), [seedClock]);
  const { deals: liveDeals, loading, error } = useDeals({
    limit: 24,
    curated: "daily_live_pool",
    seed: dailySeed,
  });

  useEffect(() => {
    const t = setTimeout(() => setCelebrated(false), 3500);
    return () => clearTimeout(t);
  }, []);

  const normalizedDeals = useMemo(() => {
    const source =
      Array.isArray(liveDeals) && liveDeals.length > 0 ? liveDeals : ALL_DEALS;

    return source.slice(0, 24).map((deal, index) => {
      const store =
        deal?.store?.name || deal?.store_name || deal?.store || "Store";
      const product = deal?.product_name || deal?.product || deal?.name || "Deal";
      const imageUrl = deal?.image_url || deal?.imageUrl || null;
      const currency = deal?.currency || "EUR";
      const salePrice =
        deal?.sale_price != null
          ? Number(deal.sale_price)
          : deal?.now != null
            ? Number(String(deal.now).replace(/[^\d.,-]/g, "").replace(",", "."))
            : null;
      const originalPrice =
        deal?.original_price != null
          ? Number(deal.original_price)
          : deal?.was != null
            ? Number(String(deal.was).replace(/[^\d.,-]/g, "").replace(",", "."))
            : null;

      const now =
        typeof salePrice === "number" && Number.isFinite(salePrice)
          ? formatPrice(salePrice, currency)
          : String(deal?.now || "—");
      const was =
        typeof originalPrice === "number" && Number.isFinite(originalPrice)
          ? formatPrice(originalPrice, currency)
          : deal?.was
            ? String(deal.was)
            : null;

      const rawDiscount = Number(deal?.discount_percent);
      const computedDiscount =
        Number.isFinite(rawDiscount)
          ? rawDiscount
          : typeof originalPrice === "number" &&
              Number.isFinite(originalPrice) &&
              typeof salePrice === "number" &&
              Number.isFinite(salePrice) &&
              originalPrice > 0
            ? ((originalPrice - salePrice) / originalPrice) * 100
            : null;

      return {
        id: deal?.id || `${store}:${product}:${index}`,
        store,
        product,
        imageUrl,
        now,
        was,
        off:
          Number.isFinite(computedDiscount) && computedDiscount > 0
            ? `${Math.round(computedDiscount)}%`
            : deal?.off
              ? String(deal.off).replace(/^-/, "")
              : null,
      };
    });
  }, [liveDeals]);

  const uniqueStores = useMemo(
    () => new Set(normalizedDeals.map((deal) => String(deal.store || "").trim())).size,
    [normalizedDeals],
  );
  const bestDiscount = useMemo(() => {
    const values = normalizedDeals
      .map((deal) => Number(String(deal.off || "").replace(/[^\d.]/g, "")))
      .filter((value) => Number.isFinite(value) && value > 0);
    return values.length ? Math.max(...values) : null;
  }, [normalizedDeals]);

  const shareUrl =
    typeof window !== "undefined" && status?.invite_url
      ? `${window.location.origin}${status.invite_url}`
      : "";

  return (
    <div style={{ minHeight:"100vh", background:T.bg }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${T.brand},${T.brandDark},${T.brand})` }} />

      <nav className="dd24-waitlist-nav" style={{ padding:"18px 40px", display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1060, margin:"0 auto", borderBottom:`1px solid ${T.border}` }}>
        <Logo />
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:T.brand, boxShadow:`0 0 6px ${T.brand}` }} />
          <span style={{ fontSize:13, color:T.textSecondary, fontWeight:500 }}>Deals access · unlocked</span>
          <div style={{ padding:"4px 12px", borderRadius:99, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:12, color:T.brandDark, fontWeight:700 }}>✓ Full access</div>
        </div>
      </nav>

      {celebrated && (
        <div style={{ background:`linear-gradient(135deg,${T.brand},${T.brandDark})`, padding:"18px 40px", display:"flex", alignItems:"center", justifyContent:"center", gap:16, animation:"slideDown 0.5s ease" }}>
          <span style={{ fontSize:28 }}>🎉</span>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:18, fontWeight:900, color:"#fff", letterSpacing:-0.5 }}>Deals unlocked, {displayName}!</div>
            <div style={{ fontSize:13, color:T.brandMid }}>2 friends registered · your deals section is now live</div>
          </div>
          <span style={{ fontSize:28 }}>🎉</span>
        </div>
      )}

      <div className="dd24-waitlist-shell" style={{ maxWidth:1060, margin:"0 auto", padding:"36px 40px 64px" }}>
        <div style={{ marginBottom:28 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:99, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:12, fontWeight:600, color:T.brandDark, marginBottom:14 }}>🔓 Deals access unlocked</div>
          <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(26px,4vw,40px)", fontWeight:900, letterSpacing:-1.5, margin:"0 0 10px", lineHeight:1.1, color:T.textPrimary }}>
            Daily deals from <span style={{ color:T.brand }}>real stores</span>, now unlocked.
          </h1>
          <p style={{ color:T.textSecondary, fontSize:15, maxWidth:560 }}>
            Your invite unlock is active. Browse today&apos;s live deals below and keep sharing your invite link if you want friends to unlock it too.
          </p>
        </div>

        <div className="dd24-waitlist-stats-grid" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
          {[
            {
              label:"Live deals",
              value:String(normalizedDeals.length || 0),
              sub:"currently loaded",
              color:T.brand,
            },
            {
              label:"Stores shown",
              value:String(uniqueStores || 0),
              sub:"in this unlocked view",
              color:T.blue,
            },
            {
              label:"Best discount",
              value:bestDiscount ? `${bestDiscount}%` : "—",
              sub:"largest visible saving",
              color:T.brand,
            },
            {
              label:"Invite unlock",
              value:"2/2",
              sub:"friends registered",
              color:T.brandDark,
            },
          ].map((item) => (
            <div key={item.label} style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:16, padding:"18px 20px", boxShadow:T.shadowSm }}>
              <div style={{ fontSize:11, color:T.textMuted, marginBottom:6, letterSpacing:0.6, textTransform:"uppercase", fontWeight:600 }}>{item.label}</div>
              <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:30, fontWeight:900, color:item.color, letterSpacing:-1, lineHeight:1, marginBottom:3 }}>{item.value}</div>
              <div style={{ fontSize:11, color:T.textMuted }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {loading ? (
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:20, padding:"26px 24px", color:T.textSecondary, boxShadow:T.shadowSm, marginBottom:24 }}>
            Loading unlocked deals…
          </div>
        ) : null}
        {!loading && error ? (
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:20, padding:"26px 24px", color:T.textSecondary, boxShadow:T.shadowSm, marginBottom:24 }}>
            Live deals are unavailable right now, so the unlocked view is showing fallback examples.
          </div>
        ) : null}

        <div className="dd24-waitlist-deals-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:14, marginBottom:32 }}>
          {normalizedDeals.map((deal, index) => (
            <div key={deal.id} style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:18, padding:"18px 20px", boxShadow:T.shadowSm, transition:"box-shadow 0.15s,transform 0.15s", animation:`fadeIn 0.4s ease ${index*0.05}s both` }}
              onMouseEnter={e=>{e.currentTarget.style.boxShadow=T.shadowMd;e.currentTarget.style.transform="translateY(-2px)";}}
              onMouseLeave={e=>{e.currentTarget.style.boxShadow=T.shadowSm;e.currentTarget.style.transform="none";}}>
              <div
                style={{
                  height: 150,
                  borderRadius: 16,
                  border: `1px solid ${T.border}`,
                  background: "#F8FAFC",
                  marginBottom: 14,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {deal.imageUrl ? (
                  <img
                    src={`/api/v1/admin/proxy/image?url=${encodeURIComponent(deal.imageUrl)}`}
                    alt={deal.product}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "contain", padding: 14 }}
                  />
                ) : (
                  <span style={{ fontSize: 34, opacity: 0.55 }}>🛒</span>
                )}
              </div>
              <div style={{ fontSize:14, fontWeight:700, color:T.textPrimary, marginBottom:10, lineHeight:1.3, minHeight: 38 }}>{deal.product}</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                <span style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:26, fontWeight:900, color:T.brand, letterSpacing:-1 }}>{deal.now}</span>
                {deal.was ? (
                  <span style={{ fontSize:12, color:T.textMuted, textDecoration:"line-through" }}>{deal.was}</span>
                ) : null}
                {deal.off ? (
                  <span style={{ fontSize:10, fontWeight:700, color:T.textOnBrand, background:T.brand, padding:"3px 8px", borderRadius:99 }}>-{deal.off}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {shareUrl ? (
          <div style={{ borderRadius:20, padding:"24px 28px", background:`linear-gradient(135deg,${T.brandLight},${T.brandMid}30)`, border:`1px solid ${T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:20, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <span style={{ fontSize:36 }}>💌</span>
              <div>
                <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:17, fontWeight:800, marginBottom:4, letterSpacing:-0.5, color:T.textPrimary }}>Share your invite link again</div>
                <div style={{ fontSize:13, color:T.textSecondary }}>Your deals are unlocked, and friends can still use your link to join DesiDeals24.</div>
              </div>
            </div>
            <CopyButton text={shareUrl} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function WaitlistPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailAuthToken = String(
    searchParams.get("email_auth_token") || "",
  ).trim();
  const [authSession, setAuthSession] = useState(() => getAuthSession());
  const [status, setStatus] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [statusLoading, setStatusLoading] = useState(
    () => Boolean(getAuthSession()?.accessToken),
  );
  const [statusError, setStatusError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const incomingReferral = normalizeReferralCode(searchParams.get("ref"));
    if (!incomingReferral || typeof window === "undefined") return;
    window.localStorage.setItem(WAITLIST_REF_STORAGE_KEY, incomingReferral);
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const syncAuth = () => {
      setAuthSession(getAuthSession());
    };
    window.addEventListener("dd24-auth-changed", syncAuth);
    return () => window.removeEventListener("dd24-auth-changed", syncAuth);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshProfileName() {
      if (!authSession?.accessToken) return;
      if (authSession?.user?.first_name || authSession?.user?.name) return;

      try {
        const payload = await fetchMe();
        const user = payload?.data || null;
        if (!user || cancelled) return;
        if (user.first_name || user.name) {
          updateAuthSessionUser(user);
          setAuthSession(getAuthSession());
        }
      } catch {
        // Keep the existing fallback display if the profile refresh fails.
      }
    }

    refreshProfileName();
    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken, authSession?.user?.first_name, authSession?.user?.name]);

  useEffect(() => {
    if (!emailAuthToken) return undefined;
    let cancelled = false;

    async function finishEmailAuth() {
      setAuthLoading(true);
      setAuthError("");

      try {
        await completeEmailAuth(emailAuthToken);
        if (cancelled) return;
        setAuthSession(getAuthSession());
        navigate("/waitlist", { replace: true });
      } catch (error) {
        if (cancelled) return;
        setAuthError(
          error?.message || "Unable to verify this email link right now.",
        );
        navigate("/waitlist", { replace: true });
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }

    finishEmailAuth();
    return () => {
      cancelled = true;
    };
  }, [emailAuthToken, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function loadWaitlistState() {
      if (!authSession?.accessToken) {
        setStatus(null);
        setStatusLoading(false);
        setStatusError("");
        return;
      }

      setStatusLoading(true);
      setStatusError("");

      try {
        let nextStatus = null;
        const storedReferral =
          typeof window !== "undefined"
            ? normalizeReferralCode(
                window.localStorage.getItem(WAITLIST_REF_STORAGE_KEY),
              )
            : "";

        if (storedReferral) {
          try {
            const claimResponse = await claimWaitlistReferral(storedReferral);
            nextStatus = claimResponse?.data || null;

            const shouldClearReferral =
              Boolean(claimResponse?.applied) ||
              claimResponse?.reason === "already_claimed" ||
              claimResponse?.reason === "self_referral_not_allowed";

            if (shouldClearReferral && typeof window !== "undefined") {
              window.localStorage.removeItem(WAITLIST_REF_STORAGE_KEY);
            }
          } catch (claimError) {
            const message = String(claimError?.message || "");
            if (
              /Referral code not found/i.test(message) &&
              typeof window !== "undefined"
            ) {
              window.localStorage.removeItem(WAITLIST_REF_STORAGE_KEY);
            }
          }
        }

        if (!nextStatus) {
          const payload = await fetchWaitlistMe();
          nextStatus = payload?.data || null;
        }

        if (cancelled) return;
        setStatus(nextStatus);
      } catch (error) {
        if (cancelled) return;
        setStatusError(error?.message || "Unable to load your waitlist status.");
      } finally {
        if (!cancelled) {
          setStatusLoading(false);
        }
      }
    }

    loadWaitlistState();
    return () => {
      cancelled = true;
    };
  }, [authSession?.accessToken, reloadKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedError = sessionStorage.getItem(AUTH_ERROR_STORAGE_KEY);
    if (!storedError) return;
    sessionStorage.removeItem(AUTH_ERROR_STORAGE_KEY);
    setAuthLoading(false);
    setAuthError(storedError);
  }, []);

  const handleGoogleAuth = async () => {
    setAuthError("");
    setAuthLoading(true);

    try {
      const state = createOAuthState();
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, "/waitlist");

      const payload = await fetchOAuthAuthUrl("google", state);
      const authUrl = payload?.authUrl || payload?.url;
      if (!authUrl) {
        throw new Error("Google sign-in is unavailable right now.");
      }

      window.location.assign(authUrl);
    } catch (error) {
      setAuthLoading(false);
      setAuthError(error?.message || "Unable to start Google sign-in.");
    }
  };

  const handleLogout = async () => {
    setAuthLoading(true);
    setAuthError("");

    try {
      await logoutUser();
      setAuthSession(getAuthSession());
      setStatus(null);
      setStatusError("");
      navigate("/waitlist", { replace: true });
    } finally {
      setAuthLoading(false);
    }
  };

  const identity = authSession?.user || authSession?.user?.email || authSession?.user?.id || "friend";

  const centerPanel = (title, body, actions = null) => (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ width:"100%", maxWidth:440, background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:24, padding:"30px 28px", boxShadow:T.shadowLg }}>
        <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:52, height:52, borderRadius:16, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:26, marginBottom:16 }}>🛒</div>
        <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:28, fontWeight:900, letterSpacing:-1, color:T.textPrimary, marginBottom:8 }}>{title}</h1>
        <p style={{ fontSize:14, color:T.textSecondary, lineHeight:1.75, marginBottom:actions ? 22 : 0 }}>{body}</p>
        {actions}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:${T.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow-x:hidden}
        input::placeholder{color:${T.textMuted}}
        ::-webkit-scrollbar{width:0;height:4px}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
        @keyframes fadeIn   {from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
        @keyframes chipFloat{0%{transform:translateY(0px)}100%{transform:translateY(-7px)}}
        @keyframes slideDown{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:none}}
        @keyframes dd24Pulse{0%{transform:translateY(0) scale(1);box-shadow:${T.shadowSm}}45%{transform:translateY(-2px) scale(1.02);box-shadow:0 22px 70px rgba(22,163,74,0.28)}100%{transform:translateY(0) scale(1);box-shadow:${T.shadowSm}}}
        @keyframes dd24NavPulse{0%{transform:translateY(0);filter:saturate(1)}50%{transform:translateY(-1px);filter:saturate(1.1)}100%{transform:translateY(0);filter:saturate(1)}}
        @keyframes float0   {from{transform:translateY(0px)}to{transform:translateY(-5px)}}
        @keyframes float1   {from{transform:translateY(0px)}to{transform:translateY(-7px)}}
        @keyframes float2   {from{transform:translateY(-3px)}to{transform:translateY(4px)}}
        @media (max-width: 900px){
          .dd24-waitlist-nav{padding:16px 20px !important;gap:12px;flex-wrap:wrap}
          .dd24-waitlist-hero-grid{grid-template-columns:1fr !important;gap:24px !important;padding:20px 20px 36px !important}
          .dd24-auth-card{position:static !important;top:auto !important;padding:24px !important}
          .dd24-waitlist-props{grid-template-columns:1fr !important;gap:18px !important;padding:20px !important}
          .dd24-waitlist-props > div:nth-child(2){display:none !important}
          .dd24-waitlist-strip-header{flex-direction:column !important;align-items:flex-start !important;gap:12px !important}
          .dd24-waitlist-shell{padding:24px 20px 40px !important}
          .dd24-waitlist-dashboard-grid{grid-template-columns:1fr !important}
          .dd24-waitlist-stats-grid{grid-template-columns:1fr 1fr !important}
          .dd24-waitlist-deals-grid{grid-template-columns:1fr !important}
          .dd24-waitlist-progress-card{padding:22px !important}
        }
        @media (max-width: 640px){
          .dd24-waitlist-stats-grid{grid-template-columns:1fr !important}
        }
      `}</style>

      {emailAuthToken ? (
        centerPanel(
          "Confirming your email",
          "We’re verifying your email link and preparing your waitlist access.",
        )
      ) : !authSession?.accessToken ? (
        <>
          <LandingPage
            onAuthChoice={handleGoogleAuth}
            authError={authError}
            authLoading={authLoading}
          />
        </>
      ) : statusLoading ? (
        centerPanel(
          "Checking your unlock",
          "We're loading your waitlist status and confirming whether your deals section is already unlocked.",
        )
      ) : statusError ? (
        centerPanel(
          "Unable to load waitlist",
          statusError,
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            style={{ width:"100%", border:"none", borderRadius:12, padding:"12px 14px", fontWeight:800, cursor:"pointer", background:T.brand, color:"#fff" }}
          >
            Try again
          </button>,
        )
      ) : hasDealsAccess(status) ? (
        <DealsUnlocked identity={identity} status={status || {}} />
      ) : (
        <InviteDashboard
          identity={identity}
          status={status || {}}
          onLogout={handleLogout}
          logoutLoading={authLoading}
        />
      )}
    </>
  );
}
