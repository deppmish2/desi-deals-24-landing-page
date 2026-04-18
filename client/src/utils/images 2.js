function resolveAbsoluteImageUrl(imageUrl, storeBaseUrl) {
  const raw = String(imageUrl || "").trim();
  if (!raw) return null;
  if (/^data:/i.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("//")) return `https:${raw}`;

  const base = String(storeBaseUrl || "").trim();
  if (!base) return raw;

  try {
    return new URL(raw, base.endsWith("/") ? base : `${base}/`).toString();
  } catch {
    return raw;
  }
}

export function proxyDealImageUrl(deal) {
  const absoluteUrl = resolveAbsoluteImageUrl(
    deal?.image_url,
    deal?.store?.url,
  );
  if (!absoluteUrl) return null;

  if (/cdn\.shopify\.com/i.test(absoluteUrl)) {
    const sep = absoluteUrl.includes("?") ? "&" : "?";
    return `${absoluteUrl}${sep}width=400`;
  }

  return `/api/v1/admin/proxy/image?url=${encodeURIComponent(absoluteUrl)}`;
}

export { resolveAbsoluteImageUrl };
