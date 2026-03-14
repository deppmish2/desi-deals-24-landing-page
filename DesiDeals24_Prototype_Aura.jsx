import { useState, useEffect } from "react";

// ─── Aura CSS (injected once at mount) ────────────────────────────────────────
const AURA_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  :root {
    --aura-color-action-blue:    #007AFF;
    --aura-color-near-black:     #1D1D1F;
    --aura-color-secondary-gray: #86868B;
    --aura-color-fill-gray:      #F5F5F7;
    --aura-color-divider-gray:   #D2D2D7;
    --aura-color-white:          #FFFFFF;
    --aura-color-success:        #34C759;
    --aura-color-error:          #FF3B30;
    --aura-color-warning:        #FF9500;

    --aura-color-text-primary:         var(--aura-color-near-black);
    --aura-color-text-secondary:       var(--aura-color-secondary-gray);
    --aura-color-text-interactive:     var(--aura-color-action-blue);
    --aura-color-text-on-accent:       var(--aura-color-white);
    --aura-color-background-primary:   var(--aura-color-white);
    --aura-color-background-secondary: var(--aura-color-fill-gray);
    --aura-color-border-primary:       var(--aura-color-divider-gray);

    --aura-font-family-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

    --aura-font-size-display:     4rem;
    --aura-font-size-headline:    2.5rem;
    --aura-font-size-title:       1.5rem;
    --aura-font-size-body:        1rem;
    --aura-font-size-callout:     1.125rem;
    --aura-font-size-subheadline: 0.875rem;
    --aura-font-size-footnote:    0.75rem;

    --aura-font-weight-regular:  400;
    --aura-font-weight-medium:   500;
    --aura-font-weight-semibold: 600;
    --aura-font-weight-bold:     700;

    --aura-line-height-tight:  1.2;
    --aura-line-height-normal: 1.4;
    --aura-line-height-loose:  1.6;

    --aura-space-xxs: 0.25rem;
    --aura-space-xs:  0.5rem;
    --aura-space-s:   0.75rem;
    --aura-space-m:   1rem;
    --aura-space-l:   1.5rem;
    --aura-space-xl:  2rem;
    --aura-space-xxl: 3rem;

    --aura-border-radius-small:  4px;
    --aura-border-radius-medium: 8px;
    --aura-border-radius-large:  12px;
    --aura-border-radius-circle: 50%;

    --aura-shadow-small:  0 1px 2px rgba(0,0,0,0.04);
    --aura-shadow-medium: 0 4px 8px rgba(0,0,0,0.08);
    --aura-shadow-large:  0 10px 20px rgba(0,0,0,0.10);
  }

  *, *::before, *::after { box-sizing: border-box; }

  body {
    font-family: var(--aura-font-family-sans);
    font-size: var(--aura-font-size-body);
    color: var(--aura-color-text-primary);
    background-color: var(--aura-color-background-secondary);
    line-height: var(--aura-line-height-loose);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    margin: 0;
  }

  h1, h2, h3, h4, h5, h6 {
    margin: 0 0 var(--aura-space-l) 0;
    font-weight: var(--aura-font-weight-bold);
    line-height: var(--aura-line-height-tight);
    font-family: var(--aura-font-family-sans);
  }
  h1 { font-size: var(--aura-font-size-headline); }
  h2 { font-size: var(--aura-font-size-title); }
  h3 { font-size: var(--aura-font-size-callout); }
  p  { margin: 0 0 var(--aura-space-m) 0; }
  a  { color: var(--aura-color-text-interactive); text-decoration: none; font-weight: var(--aura-font-weight-medium); }
  a:hover { text-decoration: underline; }

  /* ── Aura Button System ── */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: var(--aura-space-s) var(--aura-space-l);
    font-family: var(--aura-font-family-sans);
    font-size: var(--aura-font-size-body);
    font-weight: var(--aura-font-weight-semibold);
    line-height: 1.2;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
    border: 1px solid transparent;
    border-radius: var(--aura-border-radius-medium);
    transition: all 150ms ease-in-out;
    white-space: nowrap;
  }
  .btn:focus-visible {
    outline: 2px solid var(--aura-color-action-blue);
    outline-offset: 2px;
  }
  .btn--primary {
    background-color: var(--aura-color-action-blue);
    color: var(--aura-color-text-on-accent);
    box-shadow: var(--aura-shadow-small);
  }
  .btn--primary:hover  { background-color: #0069D9; text-decoration: none; }
  .btn--primary:disabled { background-color: var(--aura-color-secondary-gray); cursor: not-allowed; }

  .btn--secondary {
    background-color: var(--aura-color-background-secondary);
    color: var(--aura-color-text-interactive);
  }
  .btn--secondary:hover { background-color: #E9E9ED; text-decoration: none; }

  .btn--tertiary {
    background-color: transparent;
    color: var(--aura-color-text-interactive);
  }
  .btn--tertiary:hover { background-color: var(--aura-color-background-secondary); text-decoration: none; }

  .btn--full { width: 100%; }
  .btn--sm   { padding: 6px 12px; font-size: 0.8125rem; border-radius: var(--aura-border-radius-small); }

  /* ── Animations ── */
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  button, input, textarea, select { font-family: var(--aura-font-family-sans); }

  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--aura-color-divider-gray); border-radius: 3px; }
`;

// ─── Aura JS token mirror (for inline styles) ─────────────────────────────────
const T = {
  // colours
  blue: "#007AFF",
  blueDark: "#0069D9",
  blueLight: "#E5F0FF",
  black: "#1D1D1F",
  gray: "#86868B",
  fillGray: "#F5F5F7",
  divider: "#D2D2D7",
  white: "#FFFFFF",
  success: "#34C759",
  successLight: "#E8F8ED",
  error: "#FF3B30",
  errorLight: "#FFEBE9",
  warning: "#FF9500",
  warningLight: "#FFF4E5",
  // spacing
  xxs: "4px",
  xs: "8px",
  s: "12px",
  m: "16px",
  l: "24px",
  xl: "32px",
  xxl: "48px",
  // radius
  rS: "4px",
  rM: "8px",
  rL: "12px",
  // shadow
  shSm: "0 1px 2px rgba(0,0,0,0.04)",
  shMd: "0 4px 8px rgba(0,0,0,0.08)",
  shLg: "0 10px 20px rgba(0,0,0,0.10)",
  // font
  font: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
};

// ─── Mock Data ────────────────────────────────────────────────────────────────
const STORES = [
  {
    id: "jamoona",
    name: "Jamoona",
    url: "jamoona.com",
    sameDay: false,
    city: null,
    deals: 47,
  },
  {
    id: "grocera",
    name: "Grocera",
    url: "grocera.de",
    sameDay: true,
    city: "Munich",
    deals: 83,
  },
  {
    id: "dookan",
    name: "Dookan",
    url: "eu.dookan.com",
    sameDay: false,
    city: null,
    deals: 124,
  },
  {
    id: "spice-village",
    name: "Spice Village",
    url: "spicevillage.eu",
    sameDay: true,
    city: "Berlin",
    deals: 31,
  },
  {
    id: "desi-store",
    name: "Desi Store",
    url: "india-store.de",
    sameDay: false,
    city: null,
    deals: 19,
  },
  {
    id: "namma-markt",
    name: "Namma Markt",
    url: "nammamarkt.com",
    sameDay: false,
    city: null,
    deals: 55,
  },
];

const DEALS = [
  {
    id: "1",
    storeId: "jamoona",
    storeName: "Jamoona",
    productName: "Toor Dal 1kg",
    category: "Lentils & Pulses",
    weight: "1kg",
    salePrice: 2.49,
    originalPrice: 3.99,
    discount: 37.6,
    pricePerKg: 2.49,
    availability: "in_stock",
    updated: "2h ago",
    emoji: "🫘",
    sameDay: false,
  },
  {
    id: "2",
    storeId: "grocera",
    storeName: "Grocera",
    productName: "Desi Gate Basmati Rice 5kg",
    category: "Rice & Grains",
    weight: "5kg",
    salePrice: 12.99,
    originalPrice: 17.49,
    discount: 25.7,
    pricePerKg: 2.6,
    availability: "in_stock",
    updated: "3h ago",
    emoji: "🍚",
    sameDay: true,
  },
  {
    id: "3",
    storeId: "dookan",
    storeName: "Dookan",
    productName: "MDH Chana Masala 100g",
    category: "Spices & Masalas",
    weight: "100g",
    salePrice: 1.79,
    originalPrice: 2.99,
    discount: 40.1,
    pricePerKg: 17.9,
    availability: "in_stock",
    updated: "1h ago",
    emoji: "🌶️",
    sameDay: false,
  },
  {
    id: "4",
    storeId: "spice-village",
    storeName: "Spice Village",
    productName: "Everest Garam Masala 200g",
    category: "Spices & Masalas",
    weight: "200g",
    salePrice: 3.49,
    originalPrice: 4.99,
    discount: 30.1,
    pricePerKg: 17.45,
    availability: "in_stock",
    updated: "5h ago",
    emoji: "🌶️",
    sameDay: true,
  },
  {
    id: "5",
    storeId: "jamoona",
    storeName: "Jamoona",
    productName: "Aashirvaad Atta 5kg",
    category: "Flours & Baking",
    weight: "5kg",
    salePrice: 9.99,
    originalPrice: 13.49,
    discount: 25.9,
    pricePerKg: 2.0,
    availability: "limited",
    updated: "4h ago",
    emoji: "🌾",
    sameDay: false,
  },
  {
    id: "6",
    storeId: "grocera",
    storeName: "Grocera",
    productName: "Amul Ghee 500ml",
    category: "Oils & Ghee",
    weight: "500ml",
    salePrice: 6.99,
    originalPrice: 9.49,
    discount: 26.3,
    pricePerKg: 13.98,
    availability: "in_stock",
    updated: "2h ago",
    emoji: "🧈",
    sameDay: true,
  },
  {
    id: "7",
    storeId: "namma-markt",
    storeName: "Namma Markt",
    productName: "Haldiram's Bhujia 400g",
    category: "Snacks & Sweets",
    weight: "400g",
    salePrice: 3.29,
    originalPrice: 4.49,
    discount: 26.7,
    pricePerKg: 8.23,
    availability: "in_stock",
    updated: "6h ago",
    emoji: "🥨",
    sameDay: false,
  },
  {
    id: "8",
    storeId: "dookan",
    storeName: "Dookan",
    productName: "Taj Mahal Tea 500g",
    category: "Beverages",
    weight: "500g",
    salePrice: 5.49,
    originalPrice: 7.99,
    discount: 31.3,
    pricePerKg: 10.98,
    availability: "in_stock",
    updated: "1h ago",
    emoji: "🍵",
    sameDay: false,
  },
  {
    id: "9",
    storeId: "desi-store",
    storeName: "Desi Store",
    productName: "Urad Dal 2kg",
    category: "Lentils & Pulses",
    weight: "2kg",
    salePrice: 4.99,
    originalPrice: 7.49,
    discount: 33.4,
    pricePerKg: 2.5,
    availability: "in_stock",
    updated: "8h ago",
    emoji: "🫘",
    sameDay: false,
  },
  {
    id: "10",
    storeId: "grocera",
    storeName: "Grocera",
    productName: "Frozen Paratha 5pcs",
    category: "Frozen Foods",
    weight: "300g",
    salePrice: 2.99,
    originalPrice: 4.29,
    discount: 30.3,
    pricePerKg: 9.97,
    availability: "in_stock",
    updated: "3h ago",
    emoji: "🫓",
    sameDay: true,
  },
  {
    id: "11",
    storeId: "jamoona",
    storeName: "Jamoona",
    productName: "Sona Masoori Rice 10kg",
    category: "Rice & Grains",
    weight: "10kg",
    salePrice: 18.99,
    originalPrice: 24.99,
    discount: 24.0,
    pricePerKg: 1.9,
    availability: "in_stock",
    updated: "2h ago",
    emoji: "🍚",
    sameDay: false,
  },
  {
    id: "12",
    storeId: "spice-village",
    storeName: "Spice Village",
    productName: "Chyawanprash 500g",
    category: "Personal Care",
    weight: "500g",
    salePrice: 7.49,
    originalPrice: 10.99,
    discount: 31.8,
    pricePerKg: 14.98,
    availability: "limited",
    updated: "7h ago",
    emoji: "🏺",
    sameDay: true,
  },
];

const CATEGORIES = [
  "All",
  "Rice & Grains",
  "Flours & Baking",
  "Lentils & Pulses",
  "Spices & Masalas",
  "Oils & Ghee",
  "Snacks & Sweets",
  "Beverages",
  "Dairy & Paneer",
  "Frozen Foods",
];

const PARSED_ITEMS = [
  {
    text: "2 kg basmati rice",
    canonical: "Desi Gate Basmati",
    status: "resolved",
  },
  { text: "toor dal", canonical: "Toor Dal", status: "resolved" },
  {
    text: "Everest garam masala",
    canonical: "Everest Garam Masala 200g",
    status: "resolved",
  },
  { text: "curry leaves", canonical: null, status: "unresolvable" },
  { text: "hing powder", canonical: "Asafoetida Powder", status: "ambiguous" },
];

const ALERT_TYPES = [
  {
    id: "price",
    label: "Price Drop",
    icon: "💰",
    desc: "When price falls below your target",
  },
  {
    id: "deal",
    label: "Any Deal",
    icon: "🏷️",
    desc: "When any discount appears",
  },
  {
    id: "restock_any",
    label: "Back in Stock",
    icon: "📦",
    desc: "When available at any store",
  },
  {
    id: "fresh_arrived",
    label: "Fresh Produce",
    icon: "🌿",
    desc: "When fresh stock arrives",
  },
];

// ─── Utilities ────────────────────────────────────────────────────────────────
const fmt = (n) => `€${n.toFixed(2)}`;

// ─── Aura Badge ───────────────────────────────────────────────────────────────
function Badge({ children, color = T.blue, style: s = {} }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.03em",
        backgroundColor: color + "18",
        color,
        fontFamily: T.font,
        ...s,
      }}
    >
      {children}
    </span>
  );
}

function SameDayBadge({ small = false }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: small ? "1px 6px" : "2px 8px",
        borderRadius: 999,
        fontFamily: T.font,
        fontSize: small ? 10 : 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        backgroundColor: T.warningLight,
        color: "#C75000",
        border: `1px solid ${T.warning}44`,
      }}
    >
      ⚡ Same Day
    </span>
  );
}

function AvailDot({ status }) {
  const map = {
    in_stock: T.success,
    limited: T.warning,
    out_of_stock: T.error,
    unknown: T.gray,
  };
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        backgroundColor: map[status] ?? T.gray,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

// ─── Focused Input helpers ────────────────────────────────────────────────────
const focusStyle = {
  borderColor: T.blue,
  boxShadow: `0 0 0 3px ${T.blue}18`,
  outline: "none",
};
const blurStyle = {
  borderColor: T.divider,
  boxShadow: "none",
  outline: "none",
};
const inputBase = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: T.rM,
  border: `1.5px solid ${T.divider}`,
  fontSize: 14,
  fontFamily: T.font,
  color: T.black,
  backgroundColor: T.white,
  boxSizing: "border-box",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

// ─── Search Bar ───────────────────────────────────────────────────────────────
function SearchBar({ value, onChange }) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <span
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 14,
          color: T.gray,
          pointerEvents: "none",
        }}
      >
        🔍
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search 3,000+ Desi groceries…"
        style={{
          ...inputBase,
          paddingLeft: 36,
          ...(focused ? focusStyle : blurStyle),
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

// ─── Deal Card ────────────────────────────────────────────────────────────────
function DealCard({ deal, onAlert }) {
  const [hovered, setHovered] = useState(false);
  return (
    <article
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        backgroundColor: T.white,
        borderRadius: T.rL,
        border: `1px solid ${hovered ? T.blue : T.divider}`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        boxShadow: hovered ? `${T.shMd}, 0 0 0 3px ${T.blue}12` : T.shSm,
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "border-color 0.18s, box-shadow 0.18s, transform 0.18s",
        animation: "fadeIn 0.25s ease both",
      }}
    >
      {/* Image area */}
      <div
        style={{
          background: T.fillGray,
          height: 118,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          fontSize: 46,
          borderBottom: `1px solid ${T.divider}`,
        }}
      >
        {deal.emoji}
        {deal.discount >= 5 && (
          <div
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              backgroundColor: T.error,
              color: T.white,
              borderRadius: T.rS,
              padding: "3px 8px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.03em",
              boxShadow: T.shSm,
            }}
          >
            −{Math.round(deal.discount)}%
          </div>
        )}
        {deal.sameDay && (
          <div style={{ position: "absolute", top: 10, left: 10 }}>
            <SameDayBadge small />
          </div>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          padding: T.m,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: T.xs,
        }}
      >
        {/* Store + avail */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: T.blue,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            {deal.storeName}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <AvailDot status={deal.availability} />
            <span style={{ fontSize: 11, color: T.gray }}>
              {deal.availability === "in_stock"
                ? "In Stock"
                : deal.availability === "limited"
                  ? "Limited"
                  : "Unknown"}
            </span>
          </div>
        </div>

        {/* Name */}
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: T.black,
            lineHeight: 1.35,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {deal.productName}
        </div>

        {/* Badges */}
        <div style={{ display: "flex", gap: T.xxs, flexWrap: "wrap" }}>
          <Badge color={T.success}>{deal.category}</Badge>
          {deal.weight && (
            <span style={{ fontSize: 11, color: T.gray, alignSelf: "center" }}>
              {deal.weight}
            </span>
          )}
        </div>

        {/* Pricing */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: T.s,
            borderTop: `1px solid ${T.divider}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: T.xs }}>
            <span
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: T.success,
                letterSpacing: "-0.02em",
              }}
            >
              {fmt(deal.salePrice)}
            </span>
            {deal.originalPrice && (
              <span
                style={{
                  fontSize: 13,
                  color: T.gray,
                  textDecoration: "line-through",
                }}
              >
                {fmt(deal.originalPrice)}
              </span>
            )}
          </div>
          {deal.pricePerKg && (
            <div style={{ fontSize: 11, color: T.gray, marginTop: 2 }}>
              {fmt(deal.pricePerKg)} / kg
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: T.xs, marginTop: T.xs }}>
          <button
            className="btn btn--primary btn--full"
            style={{ fontSize: 13, borderRadius: T.rM }}
          >
            View Deal →
          </button>
          <button
            className="btn btn--secondary btn--sm"
            onClick={() => onAlert(deal)}
            title="Set price alert"
            style={{
              borderRadius: T.rM,
              padding: "0 12px",
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            🔔
          </button>
        </div>

        <div style={{ fontSize: 11, color: T.gray, textAlign: "center" }}>
          Updated {deal.updated}
        </div>
      </div>
    </article>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────
function RecommendationCard({
  rank = "winner",
  store,
  matched,
  total,
  subtotal,
  shipping,
  delivery,
  upsell,
}) {
  const isWinner = rank === "winner";
  return (
    <div
      style={{
        borderRadius: T.rL,
        backgroundColor: T.white,
        overflow: "hidden",
        border: `1.5px solid ${isWinner ? T.blue : T.divider}`,
        boxShadow: isWinner ? `${T.shMd}, 0 0 0 3px ${T.blue}12` : T.shSm,
        animation: "fadeIn 0.35s ease both",
      }}
    >
      {isWinner && (
        <div
          style={{
            backgroundColor: T.blue,
            padding: "8px 20px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: T.white,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.07em",
          }}
        >
          🏆 BEST MATCH FOR YOUR BASKET
        </div>
      )}

      <div style={{ padding: T.l }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: T.m,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.black }}>
              {store}
            </div>
            <div style={{ fontSize: 13, color: T.gray, marginTop: 3 }}>
              {matched}/{total} items matched
              {total - matched > 0 && (
                <span style={{ color: T.warning, marginLeft: 4 }}>
                  ({total - matched} not found)
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: isWinner ? T.success : T.black,
                letterSpacing: "-0.02em",
              }}
            >
              {fmt(subtotal + shipping)}
            </div>
            <div style={{ fontSize: 11, color: T.gray }}>incl. shipping</div>
          </div>
        </div>

        {/* Breakdown */}
        <div
          style={{
            backgroundColor: T.fillGray,
            borderRadius: T.rM,
            padding: `${T.s} ${T.m}`,
            marginBottom: T.m,
            fontSize: 13,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: T.gray,
              marginBottom: T.xxs,
            }}
          >
            <span>Subtotal</span>
            <span>{fmt(subtotal)}</span>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              color: T.gray,
              marginBottom: T.xs,
            }}
          >
            <span>Shipping ({delivery.label})</span>
            <span
              style={{
                color: shipping === 0 ? T.success : T.black,
                fontWeight: shipping === 0 ? 600 : 400,
              }}
            >
              {shipping === 0 ? "FREE" : fmt(shipping)}
            </span>
          </div>
          <div
            style={{
              borderTop: `1px solid ${T.divider}`,
              paddingTop: T.xs,
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 700,
            }}
          >
            <span>Total</span>
            <span>{fmt(subtotal + shipping)}</span>
          </div>
        </div>

        {/* Delivery chip */}
        <div style={{ marginBottom: T.m }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 999,
              backgroundColor: delivery.sameDay
                ? T.warningLight
                : T.successLight,
              color: delivery.sameDay ? "#C75000" : T.success,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {delivery.sameDay ? "⚡" : "🚚"} {delivery.label}
          </span>
        </div>

        {isWinner && (
          <button
            className="btn btn--primary btn--full"
            style={{ fontSize: 14, borderRadius: T.rM, padding: "13px" }}
          >
            Send Cart to {store} → ({matched} items pre-filled)
          </button>
        )}

        {upsell && (
          <div
            style={{
              marginTop: T.s,
              padding: `${T.xs} ${T.s}`,
              borderRadius: T.rM,
              backgroundColor: T.warningLight,
              border: `1px solid ${T.warning}66`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: T.s,
            }}
          >
            <span style={{ fontSize: 12, color: "#7A4000" }}>
              ⚡ Get it <strong>today</strong> from {upsell.store} for{" "}
              <strong>+{fmt(upsell.extra)}</strong>
            </span>
            <button
              className="btn btn--sm"
              style={{
                backgroundColor: T.warning,
                color: T.white,
                border: "none",
                borderRadius: T.rS,
                flexShrink: 0,
              }}
            >
              Switch
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Alert Sheet (multi-select) ───────────────────────────────────────────────
function AlertSheet({ deal, onClose }) {
  const [selected, setSelected] = useState(["deal"]);
  const [threshold, setThreshold] = useState("");
  const [saved, setSaved] = useState(false);
  const [tfFocused, setTfFocused] = useState(false);

  const toggle = (id) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleActivate = () => {
    setSaved(true);
    setTimeout(onClose, 1400);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: T.white,
          borderRadius: "16px 16px 0 0",
          width: "100%",
          maxWidth: 480,
          padding: `${T.l} ${T.l} 40px`,
          boxShadow: "0 -8px 40px rgba(0,0,0,0.12)",
          animation: "slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div
          style={{
            width: 36,
            height: 4,
            backgroundColor: T.divider,
            borderRadius: 99,
            margin: `0 auto ${T.m}`,
          }}
        />

        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: T.s,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 700,
                color: T.black,
                marginBottom: 4,
              }}
            >
              Set Alerts
            </div>
            <div
              style={{
                fontSize: 13,
                color: T.gray,
                maxWidth: 300,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {deal?.productName}
            </div>
          </div>
          {selected.length > 0 && (
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                backgroundColor: T.blue,
                color: T.white,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {selected.length}
            </div>
          )}
        </div>

        {/* Hint */}
        <div
          style={{
            backgroundColor: T.fillGray,
            borderRadius: T.rM,
            padding: "8px 12px",
            marginBottom: T.m,
            fontSize: 12,
            color: T.gray,
            display: "flex",
            alignItems: "center",
            gap: T.xs,
          }}
        >
          <span>💡</span>
          <span>
            Select one or more — you'll be notified for each separately.
          </span>
        </div>

        {/* Type grid – multi-select */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: T.xs,
            marginBottom: T.m,
          }}
        >
          {ALERT_TYPES.map((t) => {
            const active = selected.includes(t.id);
            return (
              <div
                key={t.id}
                onClick={() => toggle(t.id)}
                style={{
                  padding: T.m,
                  borderRadius: T.rL,
                  cursor: "pointer",
                  border: `1.5px solid ${active ? T.blue : T.divider}`,
                  backgroundColor: active ? T.blueLight : T.white,
                  boxShadow: active ? `0 0 0 3px ${T.blue}18` : T.shSm,
                  position: "relative",
                  userSelect: "none",
                  transition: "all 0.14s ease",
                }}
              >
                {/* Checkbox */}
                <div
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    border: `2px solid ${active ? T.blue : T.divider}`,
                    backgroundColor: active ? T.blue : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.14s",
                  }}
                >
                  {active && (
                    <span
                      style={{
                        color: T.white,
                        fontSize: 9,
                        fontWeight: 900,
                        lineHeight: 1,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 22, marginBottom: T.xs }}>{t.icon}</div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: active ? T.blue : T.black,
                    marginBottom: 3,
                  }}
                >
                  {t.label}
                </div>
                <div style={{ fontSize: 11, color: T.gray, lineHeight: 1.4 }}>
                  {t.desc}
                </div>
              </div>
            );
          })}
        </div>

        {/* Price threshold – conditional */}
        {selected.includes("price") && (
          <div
            style={{
              marginBottom: T.m,
              padding: T.m,
              borderRadius: T.rM,
              backgroundColor: T.fillGray,
              border: `1px solid ${T.blue}22`,
            }}
          >
            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 700,
                color: T.blue,
                marginBottom: T.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Alert when price drops below (€)
            </label>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={
                deal ? `Current: ${fmt(deal.salePrice)}` : "e.g. 2.50"
              }
              type="number"
              step="0.01"
              style={{
                ...inputBase,
                ...(tfFocused ? focusStyle : blurStyle),
                backgroundColor: T.white,
              }}
              onFocus={() => setTfFocused(true)}
              onBlur={() => setTfFocused(false)}
            />
          </div>
        )}

        {/* CTA */}
        {!saved ? (
          <button
            className="btn btn--primary btn--full"
            onClick={handleActivate}
            disabled={selected.length === 0}
            style={{
              fontSize: 15,
              borderRadius: T.rM,
              padding: "14px",
              opacity: selected.length === 0 ? 0.5 : 1,
            }}
          >
            {selected.length === 0
              ? "Select at least one alert type"
              : `🔔 Activate ${selected.length} Alert${selected.length > 1 ? "s" : ""}`}
          </button>
        ) : (
          <div
            style={{
              padding: "14px",
              borderRadius: T.rM,
              textAlign: "center",
              backgroundColor: T.successLight,
              color: T.success,
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            ✓ {selected.length} Alert{selected.length > 1 ? "s" : ""} Activated!
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function Nav({ page, setPage, searchQuery, setSearchQuery }) {
  const NAV = [
    { id: "deals", label: "Deals" },
    { id: "stores", label: "Stores" },
    { id: "list", label: "My List" },
  ];
  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 100,
        backgroundColor: "rgba(255,255,255,0.88)",
        backdropFilter: "blur(16px) saturate(180%)",
        borderBottom: `1px solid ${T.divider}`,
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: `0 ${T.l}`,
          display: "flex",
          alignItems: "center",
          gap: T.m,
          height: 60,
        }}
      >
        {/* Logo */}
        <div
          onClick={() => setPage("home")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: T.xs,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: T.rM,
              backgroundColor: T.blue,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 17,
              boxShadow: T.shSm,
            }}
          >
            🌶️
          </div>
          <div style={{ lineHeight: 1 }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: T.black,
                letterSpacing: "-0.01em",
              }}
            >
              DesiDeals<span style={{ color: T.blue }}>24</span>
            </div>
            <div
              style={{
                fontSize: 9,
                color: T.gray,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                marginTop: 2,
              }}
            >
              Germany
            </div>
          </div>
        </div>

        {/* Search */}
        <div style={{ flex: 1, maxWidth: 440 }}>
          <SearchBar value={searchQuery} onChange={setSearchQuery} />
        </div>

        {/* Nav links */}
        <div style={{ display: "flex", gap: 2 }}>
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className="btn btn--tertiary btn--sm"
              style={{
                borderRadius: T.rM,
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: page === item.id ? T.blueLight : "transparent",
                color: page === item.id ? T.blue : T.gray,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          className="btn btn--secondary btn--sm"
          style={{ borderRadius: T.rM, flexShrink: 0, fontSize: 13 }}
        >
          Sign In
        </button>
      </div>

      {/* Freshness banner */}
      <div
        style={{
          backgroundColor: T.successLight,
          borderTop: `1px solid ${T.divider}`,
          padding: "5px 24px",
          textAlign: "center",
          fontSize: 11,
          color: T.success,
          fontWeight: 500,
        }}
      >
        Data refreshes every 24 hours ·{" "}
        <strong>Last updated 3 hours ago</strong> · 27 stores active
      </div>
    </nav>
  );
}

// ─── Store Card ───────────────────────────────────────────────────────────────
function StoreCard({ store }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        padding: T.m,
        borderRadius: T.rL,
        cursor: "pointer",
        border: `1px solid ${hov ? T.blue : T.divider}`,
        backgroundColor: T.white,
        boxShadow: hov ? `${T.shMd}, 0 0 0 3px ${T.blue}10` : T.shSm,
        transform: hov ? "translateY(-1px)" : "none",
        transition: "all 0.15s",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: T.black,
          marginBottom: 3,
        }}
      >
        {store.name}
      </div>
      <div style={{ fontSize: 11, color: T.gray, marginBottom: T.s }}>
        {store.url}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 11, color: T.success, fontWeight: 600 }}>
          {store.deals} deals
        </span>
        {store.sameDay && <SameDayBadge small />}
      </div>
    </div>
  );
}

// ─── Home Page ────────────────────────────────────────────────────────────────
function HomePage({ onAlert }) {
  const featured = DEALS.filter((d) => d.discount >= 30).slice(0, 4);
  return (
    <div>
      {/* Hero */}
      <div
        style={{
          background: `linear-gradient(160deg, ${T.black} 0%, #2C2C2E 100%)`,
          padding: `${T.xxl} ${T.l}`,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative rings using action-blue */}
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              borderRadius: "50%",
              border: `1px solid rgba(0,122,255,${0.14 - i * 0.03})`,
              width: 220 + i * 110,
              height: 220 + i * 110,
              top: "50%",
              left: "58%",
              transform: "translate(-50%,-50%)",
              pointerEvents: "none",
            }}
          />
        ))}

        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ maxWidth: 560 }}>
            <Badge color={T.blue} style={{ marginBottom: T.m, fontSize: 11 }}>
              🇩🇪 27 Desi Grocery Stores · Germany
            </Badge>

            <h1
              style={{
                fontSize: "clamp(30px,5vw,52px)",
                fontWeight: 700,
                color: T.white,
                lineHeight: 1.15,
                letterSpacing: "-0.03em",
                marginBottom: T.m,
              }}
            >
              Best deals on
              <br />
              <span style={{ color: T.blue }}>Desi groceries</span>
              <br />
              across Germany
            </h1>

            <p
              style={{
                color: "#98989D",
                fontSize: 16,
                lineHeight: 1.6,
                marginBottom: T.xl,
                maxWidth: 460,
              }}
            >
              Build your shopping list — we find the best price including
              delivery, with one-click cart transfer.
            </p>

            <div style={{ display: "flex", gap: T.s, flexWrap: "wrap" }}>
              <button
                className="btn btn--primary"
                style={{
                  fontSize: 15,
                  borderRadius: T.rM,
                  padding: "13px 28px",
                }}
              >
                Start My List 📋
              </button>
              <button
                className="btn btn--secondary"
                style={{
                  fontSize: 15,
                  borderRadius: T.rM,
                  padding: "13px 28px",
                }}
              >
                Browse Deals →
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            maxWidth: 1280,
            margin: `${T.xl} auto 0`,
            position: "relative",
            zIndex: 1,
            display: "flex",
            gap: T.xl,
            flexWrap: "wrap",
            padding: `0 ${T.xs}`,
          }}
        >
          {[
            ["1,200+", "Active Deals"],
            ["27", "Stores"],
            ["16", "Categories"],
            ["2", "Same-Day Cities"],
          ].map(([v, l]) => (
            <div key={l}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: T.blue,
                  letterSpacing: "-0.02em",
                }}
              >
                {v}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "#636366",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginTop: 2,
                }}
              >
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        style={{ maxWidth: 1280, margin: "0 auto", padding: `${T.xxl} ${T.l}` }}
      >
        {/* Top deals */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: T.l,
          }}
        >
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: T.black,
              letterSpacing: "-0.02em",
            }}
          >
            🔥 Top Deals Today
          </h2>
          <button
            className="btn btn--tertiary btn--sm"
            style={{ fontSize: 13 }}
          >
            See all →
          </button>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
            gap: T.m,
          }}
        >
          {featured.map((d) => (
            <DealCard key={d.id} deal={d} onAlert={onAlert} />
          ))}
        </div>

        {/* Categories */}
        <div style={{ marginTop: T.xxl }}>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: T.black,
              marginBottom: T.m,
            }}
          >
            Browse by Category
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: T.xs }}>
            {CATEGORIES.slice(1).map((cat) => (
              <button
                key={cat}
                className="btn btn--secondary btn--sm"
                style={{ borderRadius: 999, fontSize: 13 }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Stores */}
        <div style={{ marginTop: T.xxl }}>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: T.black,
              marginBottom: T.m,
            }}
          >
            Shops Delivering to You
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
              gap: T.s,
            }}
          >
            {STORES.map((s) => (
              <StoreCard key={s.id} store={s} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Deals Page ───────────────────────────────────────────────────────────────
function DealsPage({ searchQuery, onAlert }) {
  const [selectedCat, setSelectedCat] = useState("All");
  const [minDiscount, setMinDiscount] = useState(0);
  const [sortBy, setSortBy] = useState("discount_desc");
  const [inStockOnly, setInStockOnly] = useState(true);

  const filtered = DEALS.filter(
    (d) => selectedCat === "All" || d.category === selectedCat,
  )
    .filter((d) => d.discount >= minDiscount)
    .filter((d) => !inStockOnly || d.availability === "in_stock")
    .filter(
      (d) =>
        !searchQuery ||
        d.productName.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) =>
      sortBy === "price_asc"
        ? a.salePrice - b.salePrice
        : sortBy === "price_desc"
          ? b.salePrice - a.salePrice
          : b.discount - a.discount,
    );

  return (
    <div
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        padding: `${T.xl} ${T.l}`,
        display: "flex",
        gap: T.xl,
      }}
    >
      {/* Sidebar */}
      <aside style={{ width: 200, flexShrink: 0 }}>
        <div
          style={{
            backgroundColor: T.white,
            borderRadius: T.rL,
            border: `1px solid ${T.divider}`,
            padding: T.m,
            position: "sticky",
            top: 100,
            boxShadow: T.shSm,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: T.gray,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              marginBottom: T.m,
            }}
          >
            Filters
          </div>

          {/* Category */}
          <div style={{ marginBottom: T.m }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.gray,
                marginBottom: T.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Category
            </div>
            {CATEGORIES.map((cat) => (
              <div
                key={cat}
                onClick={() => setSelectedCat(cat)}
                style={{
                  padding: "6px 10px",
                  borderRadius: T.rM,
                  cursor: "pointer",
                  marginBottom: 2,
                  fontSize: 13,
                  fontWeight: selectedCat === cat ? 600 : 400,
                  backgroundColor:
                    selectedCat === cat ? T.blueLight : "transparent",
                  color: selectedCat === cat ? T.blue : T.black,
                  transition: "all 0.1s",
                }}
              >
                {cat}
              </div>
            ))}
          </div>

          {/* Discount */}
          <div style={{ marginBottom: T.m }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.gray,
                marginBottom: T.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Min. Discount
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: T.xxs }}>
              {[0, 10, 20, 30, 50].map((pct) => (
                <div
                  key={pct}
                  onClick={() => setMinDiscount(pct)}
                  style={{
                    padding: "4px 10px",
                    borderRadius: T.rS,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    backgroundColor: minDiscount === pct ? T.blue : T.fillGray,
                    color: minDiscount === pct ? T.white : T.gray,
                    transition: "all 0.1s",
                  }}
                >
                  {pct === 0 ? "Any" : `${pct}%+`}
                </div>
              ))}
            </div>
          </div>

          {/* Toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: T.m,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 500, color: T.black }}>
              In Stock Only
            </span>
            <div
              onClick={() => setInStockOnly((p) => !p)}
              style={{
                width: 38,
                height: 22,
                borderRadius: 99,
                cursor: "pointer",
                backgroundColor: inStockOnly ? T.success : T.divider,
                transition: "background 0.2s",
                position: "relative",
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 2,
                  left: inStockOnly ? 18 : 2,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  backgroundColor: T.white,
                  boxShadow: T.shSm,
                  transition: "left 0.2s",
                }}
              />
            </div>
          </div>

          {/* Sort */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: T.gray,
                marginBottom: T.xs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Sort
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: T.rM,
                border: `1px solid ${T.divider}`,
                fontSize: 13,
                backgroundColor: T.white,
                color: T.black,
                fontFamily: T.font,
                outline: "none",
                cursor: "pointer",
              }}
            >
              <option value="discount_desc">Best Discount</option>
              <option value="price_asc">Price: Low → High</option>
              <option value="price_desc">Price: High → Low</option>
            </select>
          </div>
        </div>
      </aside>

      {/* Grid */}
      <main style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: T.l,
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: T.black,
                letterSpacing: "-0.02em",
              }}
            >
              All Deals
            </h1>
            <div style={{ fontSize: 13, color: T.gray, marginTop: 4 }}>
              {filtered.length} deals found
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div
            style={{ textAlign: "center", padding: "80px 0", color: T.gray }}
          >
            <div style={{ fontSize: 44, marginBottom: T.m }}>🔍</div>
            <div
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: T.black,
                marginBottom: T.xs,
              }}
            >
              No deals found
            </div>
            <div style={{ fontSize: 14 }}>Try adjusting your filters</div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
              gap: T.m,
            }}
          >
            {filtered.map((d) => (
              <DealCard key={d.id} deal={d} onAlert={onAlert} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Shopping List Page ────────────────────────────────────────────────────────
function ListPage() {
  const [inputText, setInputText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [deliveryPref, setDeliveryPref] = useState("cheapest");
  const [postcode, setPostcode] = useState("80331");
  const [showResult, setShowResult] = useState(false);
  const [taFocused, setTaFocused] = useState(false);
  const [pcFocused, setPcFocused] = useState(false);

  const handleSubmit = () => {
    if (!inputText.trim()) return;
    setSubmitted(true);
    setTimeout(() => setShowResult(true), 1400);
  };

  const STATUS_COLOR = {
    resolved: T.success,
    ambiguous: T.warning,
    unresolvable: T.error,
  };
  const STATUS_ICON = { resolved: "✓", ambiguous: "?", unresolvable: "✗" };

  return (
    <div
      style={{ maxWidth: 940, margin: "0 auto", padding: `${T.xxl} ${T.l}` }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: T.black,
          letterSpacing: "-0.02em",
          marginBottom: T.xs,
        }}
      >
        Smart Shopping List
      </h1>
      <p style={{ color: T.gray, marginBottom: T.xl, fontSize: 15 }}>
        Type your list — we find the cheapest store including delivery, then
        transfer your cart in one click.
      </p>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: T.xl }}
      >
        {/* Input column */}
        <div>
          <div
            style={{
              backgroundColor: T.white,
              borderRadius: T.rL,
              border: `1px solid ${T.divider}`,
              padding: T.l,
              marginBottom: T.m,
              boxShadow: T.shSm,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: T.gray,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                marginBottom: T.s,
              }}
            >
              Your List
            </div>
            <textarea
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                setSubmitted(false);
                setShowResult(false);
              }}
              placeholder={
                "e.g.\n2 kilo basmati rice\ntoor dal\nEverest garam masala\ncurry leaves\nAmul ghee"
              }
              rows={8}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: T.rM,
                border: `1.5px solid ${taFocused ? T.blue : T.divider}`,
                fontSize: 14,
                fontFamily: T.font,
                resize: "vertical",
                outline: "none",
                color: T.black,
                boxSizing: "border-box",
                lineHeight: 1.6,
                backgroundColor: T.fillGray,
                boxShadow: taFocused ? `0 0 0 3px ${T.blue}18` : "none",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
              onFocus={() => setTaFocused(true)}
              onBlur={() => setTaFocused(false)}
            />
            <div style={{ display: "flex", gap: T.xs, marginTop: T.s }}>
              <button
                className="btn btn--secondary btn--sm"
                style={{ flex: 1, borderRadius: T.rM }}
              >
                🎤 Speak List
              </button>
              <button
                className="btn btn--tertiary btn--sm"
                style={{ flex: 1, borderRadius: T.rM }}
                onClick={() => {
                  setInputText(
                    "2 kg basmati rice\ntoor dal\nEverest garam masala\ncurry leaves\nhing powder",
                  );
                }}
              >
                Try Example
              </button>
            </div>
          </div>

          {/* Delivery preference */}
          <div
            style={{
              backgroundColor: T.white,
              borderRadius: T.rL,
              border: `1px solid ${T.divider}`,
              padding: T.m,
              marginBottom: T.m,
              boxShadow: T.shSm,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: T.gray,
                letterSpacing: "0.07em",
                textTransform: "uppercase",
                marginBottom: T.s,
              }}
            >
              Delivery Preference
            </div>
            <div style={{ display: "flex", gap: T.xs, marginBottom: T.m }}>
              {[
                ["cheapest", "Cheapest 💰"],
                ["fastest", "Fastest 🚀"],
                ["same_day", "Same Day ⚡"],
              ].map(([id, label]) => (
                <div
                  key={id}
                  onClick={() => setDeliveryPref(id)}
                  style={{
                    flex: 1,
                    padding: "9px 6px",
                    borderRadius: T.rM,
                    textAlign: "center",
                    cursor: "pointer",
                    border: `1.5px solid ${deliveryPref === id ? T.blue : T.divider}`,
                    backgroundColor:
                      deliveryPref === id ? T.blueLight : T.white,
                    color: deliveryPref === id ? T.blue : T.gray,
                    fontSize: 12,
                    fontWeight: 600,
                    boxShadow:
                      deliveryPref === id ? `0 0 0 3px ${T.blue}12` : "none",
                    transition: "all 0.13s",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>

            <label
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 600,
                color: T.gray,
                marginBottom: T.xxs,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Your Postcode
            </label>
            <input
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              placeholder="e.g. 80331"
              style={{
                ...inputBase,
                ...(pcFocused ? focusStyle : blurStyle),
              }}
              onFocus={() => setPcFocused(true)}
              onBlur={() => setPcFocused(false)}
            />
          </div>

          <button
            className="btn btn--primary btn--full"
            onClick={handleSubmit}
            style={{ fontSize: 15, borderRadius: T.rM, padding: "14px" }}
          >
            Find Best Price 🎯
          </button>
        </div>

        {/* Result column */}
        <div>
          {submitted && !showResult && (
            <div
              style={{
                backgroundColor: T.white,
                borderRadius: T.rL,
                border: `1px solid ${T.divider}`,
                padding: `${T.xxl} ${T.l}`,
                textAlign: "center",
                boxShadow: T.shSm,
              }}
            >
              <div
                style={{
                  fontSize: 36,
                  marginBottom: T.m,
                  animation: "spin 1.5s linear infinite",
                  display: "inline-block",
                }}
              >
                ⚙️
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: T.black,
                  marginBottom: T.xxs,
                }}
              >
                Analysing your list…
              </div>
              <div style={{ fontSize: 13, color: T.gray }}>
                Checking prices across 27 stores
              </div>
            </div>
          )}

          {showResult && (
            <div style={{ display: "flex", flexDirection: "column", gap: T.m }}>
              {/* Parsed items */}
              <div
                style={{
                  backgroundColor: T.white,
                  borderRadius: T.rL,
                  border: `1px solid ${T.divider}`,
                  padding: T.m,
                  boxShadow: T.shSm,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: T.gray,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    marginBottom: T.s,
                  }}
                >
                  Resolved Items
                </div>
                {PARSED_ITEMS.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: T.s,
                      padding: `${T.xs} 0`,
                      borderBottom:
                        i < PARSED_ITEMS.length - 1
                          ? `1px solid ${T.divider}`
                          : "none",
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        flexShrink: 0,
                        backgroundColor: STATUS_COLOR[item.status] + "18",
                        color: STATUS_COLOR[item.status],
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 10,
                        fontWeight: 900,
                      }}
                    >
                      {STATUS_ICON[item.status]}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: T.black,
                        }}
                      >
                        {item.text}
                      </div>
                      {item.canonical && (
                        <div style={{ fontSize: 11, color: T.gray }}>
                          → {item.canonical}
                        </div>
                      )}
                      {item.status === "unresolvable" && (
                        <div style={{ fontSize: 11, color: T.error }}>
                          Not found — try searching manually
                        </div>
                      )}
                    </div>
                    {item.status === "ambiguous" && (
                      <button
                        className="btn btn--secondary btn--sm"
                        style={{ borderRadius: T.rS, fontSize: 11 }}
                      >
                        Clarify
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <RecommendationCard
                rank="winner"
                store="Jamoona"
                matched={4}
                total={5}
                subtotal={28.95}
                shipping={0}
                delivery={{ label: "Standard · 3 days", sameDay: false }}
                upsell={{ store: "Grocera", extra: 4.8 }}
              />
              <RecommendationCard
                rank="runner"
                store="Dookan"
                matched={4}
                total={5}
                subtotal={31.2}
                shipping={3.9}
                delivery={{ label: "Standard · 2 days", sameDay: false }}
              />
            </div>
          )}

          {!submitted && (
            <div
              style={{
                backgroundColor: T.white,
                borderRadius: T.rL,
                border: `1px dashed ${T.divider}`,
                padding: `${T.xxl} ${T.l}`,
                textAlign: "center",
                boxShadow: T.shSm,
              }}
            >
              <div style={{ fontSize: 44, marginBottom: T.m }}>🛒</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.gray }}>
                Your recommendation will appear here
              </div>
              <div style={{ fontSize: 13, color: T.divider, marginTop: T.xs }}>
                Enter your list and tap "Find Best Price"
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stores Page ──────────────────────────────────────────────────────────────
function StoresPage() {
  return (
    <div
      style={{ maxWidth: 1280, margin: "0 auto", padding: `${T.xxl} ${T.l}` }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: T.black,
          letterSpacing: "-0.02em",
          marginBottom: T.xs,
        }}
      >
        All Stores
      </h1>
      <p style={{ color: T.gray, marginBottom: T.xl, fontSize: 15 }}>
        27 Desi grocery stores delivering to Germany.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
          gap: T.m,
        }}
      >
        {STORES.map((store) => {
          const [hov, setHov] = useState(false); // eslint-disable-line
          return (
            <div
              key={store.id}
              onMouseEnter={() => setHov(true)}
              onMouseLeave={() => setHov(false)}
              style={{
                backgroundColor: T.white,
                borderRadius: T.rL,
                border: `1px solid ${hov ? T.blue : T.divider}`,
                padding: T.l,
                boxShadow: hov ? `${T.shMd}, 0 0 0 3px ${T.blue}10` : T.shSm,
                transform: hov ? "translateY(-2px)" : "none",
                transition: "all 0.15s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  marginBottom: T.s,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      color: T.black,
                      marginBottom: 3,
                    }}
                  >
                    {store.name}
                  </div>
                  <div style={{ fontSize: 12, color: T.gray }}>{store.url}</div>
                </div>
                <div
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: T.rM,
                    backgroundColor: T.fillGray,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                  }}
                >
                  🏪
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: T.xxs,
                  marginBottom: T.m,
                  flexWrap: "wrap",
                }}
              >
                {store.sameDay && <SameDayBadge />}
                <Badge color={T.success}>{store.deals} deals</Badge>
                {store.city && <Badge color={T.gray}>{store.city}</Badge>}
              </div>
              <div style={{ display: "flex", gap: T.xs }}>
                <button
                  className="btn btn--primary"
                  style={{
                    flex: 1,
                    fontSize: 13,
                    borderRadius: T.rM,
                    padding: "8px 12px",
                  }}
                >
                  View Deals
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  style={{ borderRadius: T.rM, padding: "8px 12px" }}
                >
                  🌐
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [alertDeal, setAlertDeal] = useState(null);

  useEffect(() => {
    // Inject Aura CSS once
    if (!document.getElementById("dd24-aura")) {
      const el = document.createElement("style");
      el.id = "dd24-aura";
      el.textContent = AURA_CSS;
      document.head.appendChild(el);
    }
  }, []);

  useEffect(() => {
    if (searchQuery) setPage("deals");
  }, [searchQuery]);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: T.fillGray,
        fontFamily: T.font,
      }}
    >
      <Nav
        page={page}
        setPage={setPage}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {page === "home" && <HomePage onAlert={setAlertDeal} />}
      {page === "deals" && (
        <DealsPage searchQuery={searchQuery} onAlert={setAlertDeal} />
      )}
      {page === "list" && <ListPage />}
      {page === "stores" && <StoresPage />}

      <footer
        style={{
          backgroundColor: T.black,
          color: "#636366",
          padding: `${T.xl} ${T.l}`,
          marginTop: T.xxl,
          textAlign: "center",
          fontSize: 13,
        }}
      >
        <div
          style={{
            marginBottom: T.xxs,
            color: T.white,
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          🌶️ DesiDeals<span style={{ color: T.blue }}>24</span>
        </div>
        <div>
          Best Desi grocery deals across 27 stores in Germany · Data refreshes
          every 24h
        </div>
        <div style={{ marginTop: T.xs, fontSize: 11, color: "#48484A" }}>
          Prototype · v2.4 · Not affiliated with any store
        </div>
      </footer>

      {alertDeal && (
        <AlertSheet deal={alertDeal} onClose={() => setAlertDeal(null)} />
      )}
    </div>
  );
}
