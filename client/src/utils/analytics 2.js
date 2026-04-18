const GA_MEASUREMENT_ID = String(
  import.meta.env.VITE_GA_MEASUREMENT_ID || "",
).trim();

let initialized = false;

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function cleanEventParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === "number" && Number.isNaN(value)) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      return true;
    }),
  );
}

function ensureAnalytics() {
  if (!isBrowser() || !GA_MEASUREMENT_ID) return false;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  if (!document.querySelector(`script[data-dd24-ga="${GA_MEASUREMENT_ID}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    script.dataset.dd24Ga = GA_MEASUREMENT_ID;
    document.head.appendChild(script);
  }

  if (!initialized) {
    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID, {
      send_page_view: false,
      anonymize_ip: true,
    });
    initialized = true;
  }

  return true;
}

function normalizeEventName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function initGoogleAnalytics() {
  return ensureAnalytics();
}

export function trackAnalyticsEvent(name, params = {}) {
  const eventName = normalizeEventName(name);
  if (!eventName || !ensureAnalytics()) return false;
  window.gtag("event", eventName, cleanEventParams(params));
  return true;
}

export function trackPageView(path, title = "") {
  if (!ensureAnalytics()) return false;

  const pagePath =
    String(path || "").trim() ||
    `${window.location.pathname}${window.location.search}${window.location.hash}`;

  window.gtag(
    "event",
    "page_view",
    cleanEventParams({
      page_title: title || document.title,
      page_path: pagePath,
      page_location: window.location.href,
    }),
  );
  return true;
}

export function isGoogleAnalyticsEnabled() {
  return Boolean(GA_MEASUREMENT_ID);
}
