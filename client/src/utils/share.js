function readMetaContent(selector) {
  if (typeof document === "undefined") return "";
  const node = document.querySelector(selector);
  return String(node?.getAttribute("content") || "").trim();
}

function getPublicSiteOrigin() {
  if (typeof window === "undefined") return "https://desideals24.com";

  const runtimeOrigin = String(window.location.origin || "").trim();
  const hostname = String(window.location.hostname || "")
    .trim()
    .toLowerCase();
  const metaUrl = readMetaContent('meta[property="og:url"]');

  if (metaUrl) {
    try {
      const parsed = new URL(metaUrl);
      if (
        parsed.hostname &&
        parsed.hostname !== "localhost" &&
        parsed.hostname !== "127.0.0.1"
      ) {
        return parsed.origin;
      }
    } catch {}
  }

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local")
  ) {
    return "https://desideals24.com";
  }

  return runtimeOrigin || "https://desideals24.com";
}

export function buildDealSharePath(dealId) {
  const safeId = String(dealId || "").trim();
  if (!safeId) return "/";
  return `/share/deal/${encodeURIComponent(safeId)}`;
}

export function buildDealPagePath(dealId) {
  const safeId = String(dealId || "").trim();
  if (!safeId) return "/";
  return `/deal/${encodeURIComponent(safeId)}`;
}

export function buildDealPageUrl(dealId) {
  const path = buildDealPagePath(dealId);
  return new URL(path, getPublicSiteOrigin()).toString();
}

export function buildDealShareUrl(dealId) {
  const path = buildDealSharePath(dealId);
  return new URL(path, getPublicSiteOrigin()).toString();
}

function normalizeInlineText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildWhatsAppShareUrl(text) {
  return `https://wa.me/?text=${encodeURIComponent(String(text || "").trim())}`;
}

export function buildWhatsAppDealShareText({
  dealId,
  productName,
  priceText,
  originalPriceText,
  storeName,
} = {}) {
  const shareUrl = buildDealShareUrl(dealId);
  const cleanName =
    normalizeInlineText(productName) || "this desi grocery deal";
  const cleanPrice = normalizeInlineText(priceText);
  const cleanOriginalPrice = normalizeInlineText(originalPriceText);
  const cleanStore = normalizeInlineText(storeName);

  const priceParts = [];
  if (cleanPrice) priceParts.push(`Now ${cleanPrice}`);
  if (cleanOriginalPrice) priceParts.push(`Was ${cleanOriginalPrice}`);
  const priceDetail = priceParts.join(" | ");

  const firstLine = `Found on DesiDeals24: ${cleanName}${priceDetail ? ` ${priceDetail}` : ""}`;

  return [firstLine, shareUrl].filter(Boolean).join("\n");
}

export function buildWhatsAppDealShareUrl(payload) {
  return buildWhatsAppShareUrl(buildWhatsAppDealShareText(payload));
}
