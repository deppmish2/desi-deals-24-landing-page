import { useState, useEffect, useRef } from "react";

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

const ALL_DEALS = [
  { store:"Jamoona",       product:"Aashirvaad Atta 5kg",     was:"€13.49", now:"€9.99",  off:"26%", emoji:"🌾", tag:"Best price" },
  { store:"Dookan",        product:"Taj Mahal Tea 500g",      was:"€7.99",  now:"€5.49",  off:"31%", emoji:"🍵", tag:"Flash deal" },
  { store:"Grocera ⚡",    product:"Amul Ghee 500ml",         was:"€9.49",  now:"€6.99",  off:"26%", emoji:"🧈", tag:"Same-day" },
  { store:"Namma Markt",   product:"Haldiram Bhujia 400g",   was:"€4.49",  now:"€3.29",  off:"27%", emoji:"🥨", tag:null },
  { store:"Spice Village", product:"MDH Garam Masala 100g",  was:"€3.99",  now:"€2.49",  off:"38%", emoji:"🌶️", tag:"Best price" },
  { store:"Jamoona",       product:"Sona Masoori Rice 10kg", was:"€24.99", now:"€18.99", off:"24%", emoji:"🍚", tag:null },
  { store:"Dookan",        product:"Tata Salt 1kg",          was:"€2.49",  now:"€1.49",  off:"40%", emoji:"🧂", tag:"Flash deal" },
  { store:"Grocera ⚡",    product:"Parachute Coconut Oil",  was:"€8.99",  now:"€6.49",  off:"28%", emoji:"🥥", tag:"Same-day" },
];

// ─── Shared Primitives ────────────────────────────────────────────────────────
function Logo({ light=false }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
      <div style={{ width:34, height:34, borderRadius:10, background:`linear-gradient(135deg,${T.brand},${T.brandDark})`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:17, fontWeight:800, color:"#fff", boxShadow:T.shadowBrand }}>D</div>
      <span style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:18, fontWeight:800, letterSpacing:-0.5, color:light?"#fff":T.textPrimary, textShadow:light?"0 1px 4px rgba(0,0,0,0.3)":"none" }}>
        DesiDeals<span style={{ color:light?T.brandMid:T.brand }}>24</span>
      </span>
    </div>
  );
}

function Divider({ label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, margin:"4px 0" }}>
      <div style={{ flex:1, height:1, background:T.border }} />
      {label && <span style={{ fontSize:12, color:T.textMuted, fontWeight:500 }}>{label}</span>}
      <div style={{ flex:1, height:1, background:T.border }} />
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
function AuthCard({ onAuthChoice, glass=false }) {
  const base = glass
    ? { background:"rgba(255,255,255,0.84)", backdropFilter:"blur(20px) saturate(180%)", border:"1px solid rgba(255,255,255,0.65)", boxShadow:"0 8px 40px rgba(0,0,0,0.16)" }
    : { background:T.bgCard, border:`1px solid ${T.border}`, boxShadow:T.shadowLg };

  return (
    <div style={{ borderRadius:24, padding:32, position:"sticky", top:24, ...base }}>
      <div style={{ textAlign:"center", marginBottom:24 }}>
        <div style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:52, height:52, borderRadius:16, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:26, marginBottom:14 }}>🛒</div>
        <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:21, fontWeight:900, letterSpacing:-0.8, color:T.textPrimary, marginBottom:8 }}>Start saving today</h2>
        <p style={{ fontSize:13, color:T.textSecondary, lineHeight:1.72, maxWidth:260, margin:"0 auto" }}>
          Sign up free. Invite <strong style={{ color:T.textPrimary }}>2 friends</strong> who register and your full deals section unlocks — instantly.
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
            <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:12, paddingBottom: i<arr.length-1?0:16 }}>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                <div style={{ width:26, height:26, borderRadius:"50%", background:s.done?T.brand:T.bgCard, border:`2px solid ${s.done?T.brand:T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:s.done?T.textOnBrand:T.brandDark, zIndex:1 }}>
                  {s.done ? "✓" : s.n}
                </div>
                {i<arr.length-1 && <div style={{ width:2, height:20, background:`linear-gradient(to bottom, ${T.brandMid}, ${T.brandLight})`, margin:"2px 0" }}/>}
              </div>
              <div style={{ paddingTop:4, paddingBottom: i<arr.length-1?20:0 }}>
                <span style={{ fontSize:13, fontWeight:600, color:s.done?T.textMuted:T.textPrimary, textDecoration:s.done?"line-through":"none" }}>{s.label}</span>
              </div>
            </div>
          ))}
        </div>
        {/* Unlock reward banner */}
        <div style={{ background:`linear-gradient(90deg, ${T.brand}, ${T.brandDark})`, padding:"12px 20px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:16 }}>🔓</span>
            <span style={{ fontSize:13, fontWeight:700, color:"#fff" }}>Deals section unlocks</span>
          </div>
          <span style={{ fontSize:11, color:T.brandMid, fontWeight:600 }}>instantly · no credit card</span>
        </div>
      </div>

      <button onClick={()=>onAuthChoice("google")} style={{ width:"100%", padding:"13px 20px", borderRadius:12, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:12, background:T.bgCard, border:`1.5px solid ${T.border}`, fontSize:15, fontWeight:600, color:T.textPrimary, boxShadow:T.shadowSm, transition:"all 0.15s" }}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.borderStrong;e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow=T.shadowMd;}}
        onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow=T.shadowSm;}}>
        <GoogleIcon /> Continue with Google
      </button>
    </div>
  );
}

// ─── DEALS STRIP (Landing teaser) ────────────────────────────────────────────
function DealsStrip() {
  return (
    <div style={{ borderTop:`1px solid ${T.border}`, background:T.bgCard, padding:"28px 0" }}>
      <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 48px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:T.brand, boxShadow:`0 0 6px ${T.brand}` }} />
            <span style={{ fontSize:12, color:T.textMuted, fontWeight:600, letterSpacing:0.6, textTransform:"uppercase" }}>Live deals across 27 stores · refreshed every 24h</span>
          </div>
          <span style={{ fontSize:12, color:T.brand, fontWeight:600 }}>200+ deals unlock after 2 invites →</span>
        </div>
        <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:4, position:"relative" }}>
          {ALL_DEALS.slice(0,5).map((d,i) => (
            <div key={i} style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:16, padding:"14px 18px", minWidth:185, flexShrink:0, boxShadow:T.shadowSm, filter:i>=3?"blur(3px)":"none", pointerEvents:i>=3?"none":"auto", transition:"box-shadow 0.15s,transform 0.15s", animation:`fadeIn 0.4s ease ${i*0.07}s both` }}
              onMouseEnter={e=>{if(i<3){e.currentTarget.style.boxShadow=T.shadowMd;e.currentTarget.style.transform="translateY(-2px)";}}}
              onMouseLeave={e=>{e.currentTarget.style.boxShadow=T.shadowSm;e.currentTarget.style.transform="none";}}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontSize:11, color:T.textMuted, fontWeight:600 }}>{d.store}</span>
                <span style={{ fontSize:10, fontWeight:700, color:T.textOnBrand, background:T.brand, padding:"2px 7px", borderRadius:99 }}>-{d.off}</span>
              </div>
              <div style={{ fontSize:20, marginBottom:4 }}>{d.emoji}</div>
              <div style={{ fontSize:13, fontWeight:600, color:T.textPrimary, marginBottom:6, lineHeight:1.35 }}>{d.product}</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                <span style={{ fontSize:20, fontWeight:800, color:T.brand, fontFamily:"'Fraunces',Georgia,serif" }}>{d.now}</span>
                <span style={{ fontSize:12, color:T.textMuted, textDecoration:"line-through" }}>{d.was}</span>
              </div>
            </div>
          ))}
          {/* Lock overlay on last visible cards */}
          <div style={{ position:"absolute", right:0, top:0, bottom:4, width:220, background:`linear-gradient(90deg,transparent,${T.bgCard})`, display:"flex", alignItems:"center", justifyContent:"flex-end", paddingRight:8, pointerEvents:"none" }}>
            <div style={{ fontSize:11, color:T.textMuted, fontWeight:600, textAlign:"center", lineHeight:1.6 }}>🔒<br/>Invite 2 friends<br/>to unlock all</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function LandingPage({ onAuthChoice }) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError]   = useState(false);

  return (
    <div style={{ minHeight:"100vh", background:T.bg, display:"flex", flexDirection:"column" }}>

      {/* ── Full-bleed hero ─────────────────────────────────────────────────── */}
      <div style={{ position:"relative", width:"100%", minHeight:"90vh", display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {!imgError && (
          <img src="https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=1600&q=85&fit=crop&crop=center"
            alt="Warm Indian home-cooked food"
            onLoad={()=>setImgLoaded(true)} onError={()=>{setImgError(true);setImgLoaded(true);}}
            style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover", objectPosition:"center 40%", opacity:imgLoaded?1:0, transition:"opacity 0.8s ease" }}/>
        )}
        {(!imgLoaded||imgError) && <div style={{ position:"absolute", inset:0, background:"linear-gradient(145deg,#FFF7ED 0%,#FEF3C7 20%,#ECFDF5 55%,#D1FAE5 100%)" }} />}
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to bottom,rgba(0,0,0,0.28) 0%,rgba(0,0,0,0.08) 40%,rgba(248,250,248,0.88) 78%,#F8FAF8 100%)" }} />
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(to right,rgba(0,0,0,0.32) 0%,rgba(0,0,0,0.08) 45%,transparent 70%)" }} />
        <div style={{ position:"absolute", inset:0, background:"linear-gradient(160deg,rgba(22,163,74,0.10) 0%,transparent 50%)" }} />

        {/* Nav */}
        <nav style={{ position:"relative", zIndex:10, padding:"20px 48px", display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1280, margin:"0 auto", width:"100%" }}>
          <Logo light />
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ padding:"5px 14px", borderRadius:99, background:"rgba(255,255,255,0.15)", backdropFilter:"blur(8px)", border:"1px solid rgba(255,255,255,0.3)", fontSize:12, fontWeight:600, color:"#fff" }}>🔓 Free access via 2 invites</div>
            <div style={{ padding:"5px 14px", borderRadius:99, background:"rgba(255,255,255,0.10)", backdropFilter:"blur(8px)", border:"1px solid rgba(255,255,255,0.22)", fontSize:12, color:"rgba(255,255,255,0.85)" }}>🇩🇪 Germany</div>
          </div>
        </nav>

        {/* Hero content */}
        <div style={{ position:"relative", zIndex:10, flex:1, maxWidth:1280, margin:"0 auto", width:"100%", padding:"24px 48px 60px", display:"grid", gridTemplateColumns:"1fr 400px", gap:48, alignItems:"center" }}>
          <div>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"6px 14px", borderRadius:99, background:"rgba(22,163,74,0.25)", border:"1px solid rgba(22,163,74,0.4)", backdropFilter:"blur(6px)", marginBottom:22 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:T.brandMid, display:"inline-block", boxShadow:`0 0 6px ${T.brand}` }} />
              <span style={{ fontSize:12, color:"#fff", fontWeight:600, letterSpacing:0.4 }}>Indian groceries · 27 stores · All of Germany</span>
            </div>

            <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(38px,4.8vw,68px)", fontWeight:900, lineHeight:1.04, letterSpacing:-2.5, margin:"0 0 20px", color:"#fff", textShadow:"0 2px 12px rgba(0,0,0,0.25)", maxWidth:560 }}>
              STOP<br />
              <span style={{ color:T.brandMid }}>Overpaying</span><br />
              for Desi Groceries.
            </h1>

            <div style={{ display:"inline-block", background:"rgba(255,255,255,0.12)", backdropFilter:"blur(10px)", border:"1px solid rgba(255,255,255,0.2)", borderRadius:14, padding:"14px 20px", marginBottom:28, maxWidth:480 }}>
              <p style={{ fontSize:15, color:"rgba(255,255,255,0.92)", lineHeight:1.75, margin:0 }}>
                Stop checking 10 different websites. We monitor every Indian store in Europe to find the lowest prices on Atta, Rice, Spices and more.
              </p>
            </div>

            {/* Social proof */}
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:28 }}>
              <div style={{ display:"flex" }}>
                {["🧑🏽","👩🏾","👨🏻","👩🏽","🧑🏾"].map((e,i)=>(
                  <div key={i} style={{ width:30, height:30, borderRadius:"50%", background:T.brandLight, border:"2.5px solid rgba(255,255,255,0.6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, marginLeft:i?-10:0, zIndex:5-i }}>{e}</div>
                ))}
              </div>
              <div style={{ background:"rgba(255,255,255,0.15)", backdropFilter:"blur(8px)", borderRadius:99, padding:"7px 16px", border:"1px solid rgba(255,255,255,0.25)" }}>
                <span style={{ fontSize:13, color:"#fff", fontWeight:700 }}>4,247</span>
                <span style={{ fontSize:13, color:"rgba(255,255,255,0.8)" }}> members already in</span>
              </div>
            </div>

          </div>

          {/* Auth card */}
          <div style={{ paddingBottom:20 }}>
            <AuthCard onAuthChoice={onAuthChoice} glass />
          </div>
        </div>
      </div>

      {/* ── Value props bar ──────────────────────────────────────────────────── */}
      <div style={{ background:T.bgCard, borderTop:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"20px 48px", display:"flex", justifyContent:"center" }}>
          {[
            { icon:"🏪", title:"Deals from 27 stores",    sub:"Every live deal, aggregated daily" },
            { icon:"🔓", title:"Unlock with 2 invites",  sub:"Invite 2 friends · deals section opens" },
          ].map((v,i,arr)=>(
            <div key={i} style={{ flex:1, display:"flex", alignItems:"center", gap:14, padding:"0 28px", borderRight:i<arr.length-1?`1px solid ${T.border}`:"none" }}>
              <span style={{ fontSize:26, flexShrink:0 }}>{v.icon}</span>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:T.textPrimary, marginBottom:2 }}>{v.title}</div>
                <div style={{ fontSize:11, color:T.textMuted, lineHeight:1.5 }}>{v.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <DealsStrip />
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
// confirmedCount: how many invitees have actually registered (0 or 1 shown here)
function InviteDashboard({ identity, confirmedCount, pendingInvites, onSimulateJoin }) {
  const isPhone     = identity.startsWith("+");
  const displayName = isPhone ? identity : identity.split("@")[0].replace("."," ").replace(/\b\w/g,c=>c.toUpperCase());
  const refCode     = `DD-${(isPhone?identity.replace(/\D/g,""):identity.split("@")[0]).toUpperCase().slice(0,6)}`;
  const inviteLink  = `https://DesiDeals24.com/join?ref=${refCode}`;
  const remaining   = INVITES_NEEDED - confirmedCount;

  const [phoneInvite, setPhoneInvite] = useState("");
  const [iFocus, setIFocus]           = useState(false);
  const [justSent, setJustSent]       = useState(false);

  const sendInvite = () => {
    if(phoneInvite.replace(/\s/g,"").length < 8) return;
    setJustSent(true);
    setPhoneInvite("");
    setTimeout(()=>setJustSent(false), 2500);
  };

  // Mock invite list for display
  const mockConfirmed = [
    { name:"Priya Sharma", contact:"+49 172 ***4821", method:"whatsapp", status:"joined" },
    { name:"Rohan Mehta",  contact:"+49 151 ***2203", method:"whatsapp", status:"joined" },
  ].slice(0, confirmedCount);
  const mockPending = [
    { name:"Karan Bhatia", contact:"+49 176 ***9910", method:"whatsapp", status:"pending" },
    { name:"Ananya Iyer",  contact:"a****@gmail.com", method:"google",   status:"pending" },
  ].slice(0, Math.max(pendingInvites, 0));
  const allInvites = [...mockConfirmed, ...mockPending];

  return (
    <div style={{ minHeight:"100vh", background:T.bg }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${T.brand},${T.brandDark},${T.brand})` }} />

      <nav style={{ padding:"18px 40px", display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1060, margin:"0 auto", borderBottom:`1px solid ${T.border}` }}>
        <Logo />
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:T.brand, boxShadow:`0 0 6px ${T.brand}` }} />
          <span style={{ fontSize:13, color:T.textSecondary, fontWeight:500 }}>Signed up</span>
          <div style={{ padding:"4px 12px", borderRadius:99, background:T.brandDim, border:`1px solid ${T.brandBorder}`, fontSize:12, color:T.brandDark, fontWeight:600 }}>{isPhone?"💬 WhatsApp":"🔵 Google"}</div>
        </div>
      </nav>

      <div style={{ maxWidth:1060, margin:"0 auto", padding:"40px 40px 64px" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom:32 }}>
          {confirmedCount === 0 ? (
            <>
              <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:99, background:T.amberLight, border:`1px solid ${T.amberBorder}`, fontSize:12, fontWeight:600, color:T.amber, marginBottom:14 }}>🔒 Deals locked · 2 registrations needed</div>
              <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(26px,4vw,40px)", fontWeight:900, letterSpacing:-1.5, margin:"0 0 10px", lineHeight:1.1, color:T.textPrimary }}>
                You're in, <span style={{ color:T.brand }}>{displayName}</span>.<br />Now invite 2 friends. 🚀
              </h1>
              <p style={{ color:T.textSecondary, fontSize:15, maxWidth:560 }}>
                Your deals section is currently locked. The moment <strong style={{ color:T.textPrimary }}>2 friends register</strong> using your link, it unlocks instantly.
              </p>
            </>
          ) : (
            <>
              <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:99, background:T.amberLight, border:`1px solid ${T.amberBorder}`, fontSize:12, fontWeight:600, color:T.amber, marginBottom:14 }}>⏳ Almost there · 1 more registration needed</div>
              <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(26px,4vw,40px)", fontWeight:900, letterSpacing:-1.5, margin:"0 0 10px", lineHeight:1.1, color:T.textPrimary }}>
                1 down, <span style={{ color:T.brand }}>1 to go</span>. 🙌
              </h1>
              <p style={{ color:T.textSecondary, fontSize:15, maxWidth:560 }}>
                <strong style={{ color:T.brand }}>Priya just registered!</strong> You need one more friend to register and your full deals section unlocks.
              </p>
            </>
          )}
        </div>

        {/* ── Unlock progress hero ── */}
        <div style={{ background:T.bgCard, border:`1.5px solid ${T.border}`, borderRadius:24, padding:28, marginBottom:20, boxShadow:T.shadowMd, display:"flex", alignItems:"center", gap:32, flexWrap:"wrap" }}>
          <ProgressRing confirmed={confirmedCount} needed={INVITES_NEEDED} />

          <div style={{ flex:1, minWidth:220 }}>
            <div style={{ fontSize:13, color:T.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.6, marginBottom:8 }}>Unlock progress</div>
            <div style={{ display:"flex", gap:10, marginBottom:14 }}>
              {Array.from({length:INVITES_NEEDED}).map((_,i)=>{
                const filled = i < confirmedCount;
                return (
                  <div key={i} style={{ flex:1, height:10, borderRadius:99, background:filled?T.brand:T.bgMuted, border:`1px solid ${filled?T.brandDark:T.border}`, transition:"background 0.5s" }}/>
                );
              })}
            </div>
            <div style={{ fontSize:14, color:T.textSecondary, lineHeight:1.6 }}>
              <span style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:22, fontWeight:900, color:T.brand }}>{confirmedCount}</span>
              <span style={{ color:T.textMuted }}> / {INVITES_NEEDED} friends registered</span>
              {remaining > 0 && <span style={{ display:"block", fontSize:13, color:T.textMuted, marginTop:2 }}>Invite {remaining} more friend{remaining>1?"s":""} to unlock your deals section.</span>}
            </div>
          </div>

          {/* Locked deals preview */}
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
              <div style={{ fontSize:12, fontWeight:700, color:T.textPrimary, textAlign:"center", lineHeight:1.5 }}>Deals locked<br/><span style={{ color:T.textMuted, fontWeight:500 }}>Register {remaining} more friend{remaining>1?"s":""}</span></div>
            </div>
          </div>
        </div>

        {/* ── Simulate demo button (for prototype only) ── */}
        <div style={{ marginBottom:20, padding:"12px 20px", background:T.amberLight, border:`1px dashed ${T.amberBorder}`, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <div style={{ fontSize:12, color:T.amber, fontWeight:600 }}>
            🎮 Prototype demo — simulate a friend registering:
          </div>
          <button onClick={onSimulateJoin}
            style={{ padding:"8px 20px", borderRadius:99, border:`1px solid ${T.amberBorder}`, background:"#fff", color:T.amber, fontWeight:700, fontSize:12, cursor:"pointer" }}>
            + Friend registers →
          </button>
        </div>

        {/* ── Two columns ── */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

          {/* Invite tools */}
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:20, padding:24, boxShadow:T.shadowSm }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:T.brandLight, border:`1px solid ${T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🔗</div>
              <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:20, fontWeight:800, letterSpacing:-0.5, color:T.textPrimary, margin:0 }}>Invite {remaining} more friend{remaining>1?"s":""}</h2>
            </div>
            <p style={{ fontSize:13, color:T.textSecondary, marginBottom:20, lineHeight:1.7 }}>
              Share your link. Your friend signs up, enters your code — and that's it. The moment {INVITES_NEEDED} have registered, your deals section opens.
            </p>

            {/* Copy link */}
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:11, color:T.textMuted, fontWeight:600, letterSpacing:0.7, textTransform:"uppercase", marginBottom:8 }}>Your invite link</div>
              <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                <div style={{ flex:1, padding:"10px 14px", borderRadius:10, fontSize:11, color:T.textMuted, background:T.bgMuted, border:`1px solid ${T.border}`, fontFamily:"monospace", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inviteLink}</div>
                <CopyButton text={inviteLink} />
              </div>
            </div>

            {/* WhatsApp share */}
            <button style={{ width:"100%", padding:"12px", borderRadius:12, marginBottom:10, border:"1.5px solid rgba(37,211,102,0.35)", background:"rgba(37,211,102,0.08)", color:"#15803D", fontWeight:700, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <WhatsAppIcon /> Share on WhatsApp
            </button>

            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {[{label:"Telegram",icon:"✈️",color:"#1D4ED8",bg:"rgba(37,99,235,0.07)",bd:"rgba(37,99,235,0.22)"},{label:"Copy link",icon:"🔗",color:T.textSecondary,bg:T.bgMuted,bd:T.border}].map((s,i)=>(
                <button key={i} style={{ flex:1, padding:"10px", borderRadius:10, border:`1px solid ${s.bd}`, background:s.bg, color:s.color, fontSize:12, fontWeight:600, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>{s.icon} {s.label}</button>
              ))}
            </div>

          </div>

          {/* Invite activity */}
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:20, padding:24, boxShadow:T.shadowSm, display:"flex", flexDirection:"column" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <h2 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:20, fontWeight:800, letterSpacing:-0.5, margin:0, color:T.textPrimary }}>Invite activity</h2>
              <div style={{ padding:"4px 12px", borderRadius:99, background:T.bgMuted, border:`1px solid ${T.border}`, fontSize:12, color:T.textSecondary, fontWeight:600 }}>{allInvites.length} sent</div>
            </div>
            <p style={{ fontSize:13, color:T.textSecondary, marginBottom:16 }}>
              <span style={{ color:T.brand, fontWeight:700 }}>{confirmedCount} registered</span>{mockPending.length>0&&<> · {mockPending.length} pending</>}
            </p>

            {allInvites.length === 0 ? (
              <div style={{ flex:1 }}>
                {/* Illustrated empty state */}
                <div style={{ borderRadius:16, background:`linear-gradient(160deg, ${T.brandLight} 0%, #fff 100%)`, border:`1px solid ${T.brandBorder}`, padding:"28px 20px 20px", marginBottom:16, textAlign:"center" }}>
                  {/* Avatar cluster illustration */}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:0, marginBottom:18, position:"relative", height:64 }}>
                    {/* Dashed orbit ring */}
                    <div style={{ position:"absolute", width:110, height:110, borderRadius:"50%", border:`1.5px dashed ${T.brandMid}`, top:"50%", left:"50%", transform:"translate(-50%,-50%)" }}/>
                    {/* Centre avatar — "you" */}
                    <div style={{ width:44, height:44, borderRadius:"50%", background:`linear-gradient(135deg,${T.brand},${T.brandDark})`, border:"3px solid #fff", boxShadow:T.shadowBrand, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, zIndex:2, position:"relative" }}>🧑🏽</div>
                    {/* Empty friend slots */}
                    {[{ x:-52, y:-8, delay:"0s" },{ x:52, y:-8, delay:"0.4s" }].map((slot,i)=>(
                      <div key={i} style={{ position:"absolute", left:`calc(50% + ${slot.x}px)`, top:`calc(50% + ${slot.y}px)`, transform:"translate(-50%,-50%)", width:38, height:38, borderRadius:"50%", background:"rgba(255,255,255,0.9)", border:`2px dashed ${T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"center", animation:`float${i} 3s ease-in-out ${slot.delay} infinite alternate` }}>
                        <span style={{ fontSize:16, opacity:0.45 }}>👤</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:17, fontWeight:800, color:T.textPrimary, marginBottom:6, letterSpacing:-0.4 }}>No invites sent yet</div>
                  <p style={{ fontSize:13, color:T.textSecondary, lineHeight:1.75, maxWidth:240, margin:"0 auto 0" }}>
                    Share your link on the left. As friends sign up they'll appear here.
                  </p>
                </div>

                {/* What it'll look like — ghost rows */}
                <div style={{ borderRadius:14, border:`1px solid ${T.border}`, overflow:"hidden" }}>
                  <div style={{ padding:"10px 16px", background:T.bgMuted, borderBottom:`1px solid ${T.border}` }}>
                    <span style={{ fontSize:11, color:T.textMuted, fontWeight:700, letterSpacing:0.6, textTransform:"uppercase" }}>What it'll look like</span>
                  </div>
                  {[
                    { initials:"P", label:"Priya Sharma", sub:"Registered via Google", badge:"Registered", badgeColor:T.brandDark, badgeBg:T.brandLight, badgeBd:T.brandMid },
                    { initials:"R", label:"Rohan Mehta",  sub:"Invite sent · waiting",  badge:"Pending",    badgeColor:T.textMuted,  badgeBg:T.bgMuted,    badgeBd:T.border },
                  ].map((row,i)=>(
                    <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px", borderBottom:i===0?`1px solid ${T.border}`:"none", opacity:0.38, filter:"blur(0.4px)" }}>
                      <div style={{ width:34, height:34, borderRadius:"50%", background:i===0?T.brandLight:T.bgMuted, border:`1.5px solid ${i===0?T.brandMid:T.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:i===0?T.brandDark:T.textMuted, flexShrink:0 }}>{row.initials}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:T.textPrimary, marginBottom:2 }}>{row.label}</div>
                        <div style={{ fontSize:11, color:T.textMuted }}>{row.sub}</div>
                      </div>
                      <div style={{ padding:"4px 12px", borderRadius:99, background:row.badgeBg, border:`1px solid ${row.badgeBd}`, fontSize:11, fontWeight:700, color:row.badgeColor, flexShrink:0 }}>{row.badge}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {allInvites.map((inv,i)=><InviteRow key={i} invite={inv} index={i}/>)}
                {mockPending.length > 0 && (
                  <div style={{ marginTop:14, background:T.amberLight, border:`1px solid ${T.amberBorder}`, borderRadius:12, padding:"11px 14px" }}>
                    <div style={{ fontSize:12, color:T.amber, fontWeight:700, marginBottom:2 }}>⏳ {mockPending.length} friend{mockPending.length>1?"s":""} invited but not registered yet</div>
                    <div style={{ fontSize:12, color:T.textSecondary }}>Send them a reminder — they need to complete signup.</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DEALS UNLOCKED SCREEN ────────────────────────────────────────────────────
function DealsUnlocked({ identity }) {
  const isPhone     = identity.startsWith("+");
  const displayName = isPhone ? identity : identity.split("@")[0].replace("."," ").replace(/\b\w/g,c=>c.toUpperCase());
  const [celebrated, setCelebrated] = useState(true);
  const [filter, setFilter]         = useState("all");

  useEffect(()=>{ const t=setTimeout(()=>setCelebrated(false),3500); return()=>clearTimeout(t); },[]);

  const tags = ["all","Best price","Flash deal","Same-day"];
  const filtered = filter==="all" ? ALL_DEALS : ALL_DEALS.filter(d=>d.tag===filter);

  return (
    <div style={{ minHeight:"100vh", background:T.bg }}>
      <div style={{ height:3, background:`linear-gradient(90deg,${T.brand},${T.brandDark},${T.brand})` }} />

      <nav style={{ padding:"18px 40px", display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1060, margin:"0 auto", borderBottom:`1px solid ${T.border}` }}>
        <Logo />
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:7, height:7, borderRadius:"50%", background:T.brand, boxShadow:`0 0 6px ${T.brand}` }} />
          <span style={{ fontSize:13, color:T.textSecondary, fontWeight:500 }}>Deals access · unlocked</span>
          <div style={{ padding:"4px 12px", borderRadius:99, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:12, color:T.brandDark, fontWeight:700 }}>✓ Full access</div>
        </div>
      </nav>

      {/* Celebration banner */}
      {celebrated && (
        <div style={{ background:`linear-gradient(135deg,${T.brand},${T.brandDark})`, padding:"18px 40px", display:"flex", alignItems:"center", justifyContent:"center", gap:16, animation:"slideDown 0.5s ease" }}>
          <span style={{ fontSize:28 }}>🎉</span>
          <div style={{ textAlign:"center" }}>
            <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:18, fontWeight:900, color:"#fff", letterSpacing:-0.5 }}>Deals unlocked, {displayName}!</div>
            <div style={{ fontSize:13, color:T.brandMid }}>2 friends registered · your full deals section is now live</div>
          </div>
          <span style={{ fontSize:28 }}>🎉</span>
        </div>
      )}

      <div style={{ maxWidth:1060, margin:"0 auto", padding:"36px 40px 64px" }}>

        {/* Header */}
        <div style={{ marginBottom:28 }}>
          <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"5px 14px", borderRadius:99, background:T.brandLight, border:`1px solid ${T.brandMid}`, fontSize:12, fontWeight:600, color:T.brandDark, marginBottom:14 }}>🔓 Deals access unlocked</div>
          <h1 style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:"clamp(26px,4vw,40px)", fontWeight:900, letterSpacing:-1.5, margin:"0 0 10px", lineHeight:1.1, color:T.textPrimary }}>
            Best prices across <span style={{ color:T.brand }}>27 stores</span>, live now.
          </h1>
          <p style={{ color:T.textSecondary, fontSize:15, maxWidth:520 }}>
            Deals refresh every 24h. Set alerts to get notified when your favourites drop in price.
          </p>
        </div>

        {/* Stats bar */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:24 }}>
          {[
            { label:"Live deals",    value:"200+", sub:"across 27 stores",         color:T.brand },
            { label:"Avg. saving",   value:"28%",  sub:"vs. highest price",         color:T.brand },
            { label:"Stores live",   value:"27",   sub:"refreshed every 24h",       color:T.blue },
            { label:"Same-day avail",value:"14",   sub:"stores in your postcode",   color:T.brand },
          ].map((s,i)=>(
            <div key={i} style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:16, padding:"18px 20px", boxShadow:T.shadowSm }}>
              <div style={{ fontSize:11, color:T.textMuted, marginBottom:6, letterSpacing:0.6, textTransform:"uppercase", fontWeight:600 }}>{s.label}</div>
              <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:30, fontWeight:900, color:s.color, letterSpacing:-1, lineHeight:1, marginBottom:3 }}>{s.value}</div>
              <div style={{ fontSize:11, color:T.textMuted }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div style={{ display:"flex", gap:8, marginBottom:20 }}>
          {tags.map(t=>(
            <button key={t} onClick={()=>setFilter(t)}
              style={{ padding:"8px 18px", borderRadius:99, border:`1px solid ${filter===t?T.brand:T.border}`, background:filter===t?T.brand:T.bgCard, color:filter===t?T.textOnBrand:T.textSecondary, fontWeight:600, fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
              {t==="all"?"All deals":t}
            </button>
          ))}
        </div>

        {/* Deals grid */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))", gap:14, marginBottom:32 }}>
          {filtered.map((d,i)=>(
            <div key={i} style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:18, padding:"18px 20px", boxShadow:T.shadowSm, transition:"box-shadow 0.15s,transform 0.15s", cursor:"pointer", animation:`fadeIn 0.4s ease ${i*0.06}s both`, position:"relative" }}
              onMouseEnter={e=>{e.currentTarget.style.boxShadow=T.shadowMd;e.currentTarget.style.transform="translateY(-2px)";}}
              onMouseLeave={e=>{e.currentTarget.style.boxShadow=T.shadowSm;e.currentTarget.style.transform="none";}}>
              {d.tag && (
                <div style={{ position:"absolute", top:14, right:14, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:99, background:d.tag==="Flash deal"?T.amberLight:d.tag==="Same-day"?"rgba(37,99,235,0.08)":T.brandLight, color:d.tag==="Flash deal"?T.amber:d.tag==="Same-day"?T.blue:T.brandDark, border:`1px solid ${d.tag==="Flash deal"?T.amberBorder:d.tag==="Same-day"?"rgba(37,99,235,0.2)":T.brandMid}` }}>{d.tag}</div>
              )}
              <div style={{ fontSize:32, marginBottom:10 }}>{d.emoji}</div>
              <div style={{ fontSize:11, color:T.textMuted, fontWeight:600, textTransform:"uppercase", letterSpacing:0.4, marginBottom:4 }}>{d.store}</div>
              <div style={{ fontSize:14, fontWeight:700, color:T.textPrimary, marginBottom:10, lineHeight:1.3 }}>{d.product}</div>
              <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:12 }}>
                <span style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:26, fontWeight:900, color:T.brand, letterSpacing:-1 }}>{d.now}</span>
                <span style={{ fontSize:12, color:T.textMuted, textDecoration:"line-through" }}>{d.was}</span>
                <span style={{ fontSize:10, fontWeight:700, color:T.textOnBrand, background:T.brand, padding:"3px 8px", borderRadius:99 }}>-{d.off}</span>
              </div>
              <button style={{ width:"100%", padding:"9px", borderRadius:10, border:"none", background:T.brandLight, color:T.brandDark, fontWeight:700, fontSize:12, cursor:"pointer", transition:"background 0.15s" }}
                onMouseEnter={e=>e.currentTarget.style.background=T.brandMid}
                onMouseLeave={e=>e.currentTarget.style.background=T.brandLight}>
                View deal →
              </button>
            </div>
          ))}
        </div>

        {/* Invite more CTA */}
        <div style={{ borderRadius:20, padding:"24px 28px", background:`linear-gradient(135deg,${T.brandLight},${T.brandMid}30)`, border:`1px solid ${T.brandMid}`, display:"flex", alignItems:"center", justifyContent:"space-between", gap:20, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <span style={{ fontSize:36 }}>💌</span>
            <div>
              <div style={{ fontFamily:"'Fraunces',Georgia,serif", fontSize:17, fontWeight:800, marginBottom:4, letterSpacing:-0.5, color:T.textPrimary }}>Know more desi shoppers in Germany?</div>
              <div style={{ fontSize:13, color:T.textSecondary }}>Share DesiDeals24 — every friend you bring in saves money on their weekly groceries.</div>
            </div>
          </div>
          <button style={{ padding:"12px 24px", borderRadius:12, border:"none", background:T.brand, color:T.textOnBrand, fontWeight:700, fontSize:14, cursor:"pointer", boxShadow:T.shadowBrand, flexShrink:0 }}>
            Share again →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView]             = useState("landing");
  const [identity, setIdentity]     = useState("");
  const [confirmedCount, setConfirmed] = useState(0);
  const [pendingCount, setPending]     = useState(1); // after signing up, show 1 demo pending

  useEffect(()=>{ const h=()=>setView("landing"); window.addEventListener("dd24back",h); return()=>window.removeEventListener("dd24back",h); },[]);

  const handleAuth = (id) => {
    setIdentity(id);
    setConfirmed(0);
    setPending(1);
    setView("invite");
  };

  const handleSimulateJoin = () => {
    const next = confirmedCount + 1;
    setConfirmed(next);
    setPending(p => Math.max(p-1, 0));
    if (next >= INVITES_NEEDED) {
      setTimeout(()=>setView("unlocked"), 400);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700;9..144,900&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        body{background:${T.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
        input::placeholder{color:${T.textMuted}}
        ::-webkit-scrollbar{width:0;height:4px}
        ::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
        @keyframes fadeIn   {from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
        @keyframes chipFloat{0%{transform:translateY(0px)}100%{transform:translateY(-7px)}}
        @keyframes slideDown{from{opacity:0;transform:translateY(-20px)}to{opacity:1;transform:none}}
        @keyframes float0   {from{transform:translateY(0px)}to{transform:translateY(-5px)}}
        @keyframes float1   {from{transform:translateY(0px)}to{transform:translateY(-7px)}}
        @keyframes float2   {from{transform:translateY(-3px)}to{transform:translateY(4px)}}
      `}</style>

      {view==="landing"  && <LandingPage     onAuthChoice={v=>setView(v)}/>}
      {view==="google"   && <GoogleFlow       onComplete={handleAuth}/>}
      {view==="whatsapp" && <WhatsAppFlow     onComplete={handleAuth}/>}
      {view==="invite"   && <InviteDashboard  identity={identity} confirmedCount={confirmedCount} pendingInvites={pendingCount} onSimulateJoin={handleSimulateJoin}/>}
      {view==="unlocked" && <DealsUnlocked    identity={identity}/>}
    </>
  );
}
