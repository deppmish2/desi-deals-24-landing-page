const DEFAULT_DEALS_CACHE_PREFIX = "dd24-default-deals:";
const DEFAULT_DEALS_CACHE_MAX_AGE_MS = 36 * 60 * 60 * 1000;

function getStorage() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage || null;
  } catch {
    return null;
  }
}

export function getBerlinDateKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getDefaultDealsCacheKey(date = new Date()) {
  return `${DEFAULT_DEALS_CACHE_PREFIX}${getBerlinDateKey(date)}`;
}

export function isDefaultDealsRequest(filters = {}) {
  const safe = filters || {};
  return (
    Number(safe.page || 1) === 1 &&
    Number(safe.limit || 20) === 20 &&
    String(safe.in_stock || "") === "1" &&
    !safe.deal_id &&
    !safe.q &&
    !safe.track_search &&
    !safe.sort &&
    !safe.store &&
    !safe.category &&
    !safe.min_discount &&
    !safe.price_min &&
    !safe.price_max &&
    !safe.hide_expired
  );
}

export function readCachedDefaultDeals() {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(getDefaultDealsCacheKey());
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.data) ||
      !parsed.pagination ||
      typeof parsed.cachedAt !== "number"
    ) {
      return null;
    }

    if (Date.now() - parsed.cachedAt > DEFAULT_DEALS_CACHE_MAX_AGE_MS) {
      storage.removeItem(getDefaultDealsCacheKey());
      return null;
    }

    return {
      data: parsed.data,
      pagination: parsed.pagination,
      meta: parsed.meta || null,
    };
  } catch {
    return null;
  }
}

export function writeCachedDefaultDeals(payload) {
  const storage = getStorage();
  if (
    !storage ||
    !payload ||
    !Array.isArray(payload.data) ||
    !payload.pagination
  ) {
    return;
  }

  try {
    storage.setItem(
      getDefaultDealsCacheKey(),
      JSON.stringify({
        data: payload.data,
        pagination: payload.pagination,
        meta: payload.meta || null,
        cachedAt: Date.now(),
      }),
    );
  } catch {
    // Ignore storage quota / privacy mode issues.
  }
}
