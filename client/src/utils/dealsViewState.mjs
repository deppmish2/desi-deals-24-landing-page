export function parsePageParam(value) {
  const parsed = parseInt(String(value || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseCsvParam(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readDealsViewState(searchParams) {
  const filterStores = parseCsvParam(
    searchParams.get("stores") || searchParams.get("store") || "",
  );

  return {
    searchQuery: String(searchParams.get("q") || "").trim(),
    sortValue: String(searchParams.get("sort") || "").trim(),
    page: parsePageParam(searchParams.get("page")),
    filterStores,
    filterCategory: String(searchParams.get("category") || "").trim(),
    filterMinDiscount: String(searchParams.get("min_discount") || "").trim(),
    filterPriceMin: String(searchParams.get("price_min") || "").trim(),
    filterPriceMax: String(searchParams.get("price_max") || "").trim(),
    filterHideExpired: searchParams.get("hide_expired") === "1",
  };
}

export function buildDealsSearchParams(searchParams, nextState, routeDealId) {
  const nextParams = new URLSearchParams();
  const highlightedDeal = !routeDealId
    ? String(searchParams.get("deal") || "").trim()
    : "";

  if (highlightedDeal) nextParams.set("deal", highlightedDeal);
  if (nextState.searchQuery) nextParams.set("q", nextState.searchQuery);
  if (nextState.sortValue) nextParams.set("sort", nextState.sortValue);
  if (nextState.page > 1) nextParams.set("page", String(nextState.page));
  if (
    Array.isArray(nextState.filterStores) &&
    nextState.filterStores.length > 0
  ) {
    nextParams.set("store", nextState.filterStores.join(","));
  }
  if (nextState.filterCategory) {
    nextParams.set("category", nextState.filterCategory);
  }
  if (nextState.filterMinDiscount) {
    nextParams.set("min_discount", nextState.filterMinDiscount);
  }
  if (nextState.filterPriceMin) {
    nextParams.set("price_min", nextState.filterPriceMin);
  }
  if (nextState.filterPriceMax) {
    nextParams.set("price_max", nextState.filterPriceMax);
  }
  if (nextState.filterHideExpired) nextParams.set("hide_expired", "1");

  return nextParams;
}
