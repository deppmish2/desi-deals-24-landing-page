/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#16a34a", // Green — CTAs, links, all interactive elements
        "primary-dark": "#15803d", // Darker green — hover state
        "primary-light": "#dcfce7", // Light green — chip backgrounds, highlights
        secondary: "#F5F5F7", // Fill Gray — section BG, secondary button bg
        "secondary-dark": "#E9E9ED",
        "near-black": "#0f172a",
        background: "#FFFFFF",
        card: "#FFFFFF",
        "text-primary": "#0f172a",
        "text-secondary": "#64748b",
        border: "#e2e8f0",
        success: "#16a34a",
        error: "#dc2626",
        warning: "#f59e0b",
      },
      fontFamily: {
        sans: [
          "Plus Jakarta Sans",
          "Public Sans",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      // Design system typography scale (unchanged)
      fontSize: {
        display: [
          "4rem",
          { lineHeight: "1.2", letterSpacing: "-0.094rem", fontWeight: "900" },
        ],
        headline: [
          "2.5rem",
          { lineHeight: "1.25", letterSpacing: "-0.031rem", fontWeight: "700" },
        ],
        title: [
          "1.5rem",
          { lineHeight: "1.4", letterSpacing: "0", fontWeight: "700" },
        ],
        callout: ["1.125rem", { lineHeight: "1.5", letterSpacing: "0.013rem" }],
        subheadline: [
          "0.875rem",
          { lineHeight: "1.5", letterSpacing: "0.019rem" },
        ],
        footnote: ["0.75rem", { lineHeight: "1.5", letterSpacing: "0.025rem" }],
        caption2: [
          "0.625rem",
          { lineHeight: "1.5", letterSpacing: "0.031rem" },
        ],
      },
      // Aura shadow tokens — more subtle than Tailwind defaults
      boxShadow: {
        sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
        md: "0 4px 8px rgba(0, 0, 0, 0.08)",
        lg: "0 10px 20px rgba(0, 0, 0, 0.10)",
      },
      borderRadius: {
        sm: "4px", // aura-border-radius-small
        md: "8px", // aura-border-radius-medium (buttons)
        lg: "12px", // aura-border-radius-large (cards)
        xl: "12px", // map Tailwind xl → Aura large
        "2xl": "16px",
        full: "9999px",
      },
    },
  },
  plugins: [],
};
