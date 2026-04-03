export function parsePageParam(value) {
  const parsed = parseInt(String(value || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function readDealsViewState(searchParams) {
  return {
    searchQuery: String(searchParams.get("q") || "").trim(),
    sortValue: String(searchParams.get("sort") || "").trim(),
    page: parsePageParam(searchParams.get("page")),
    filterStore: String(searchParams.get("store") || "").trim(),
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
  if (nextState.filterStore) nextParams.set("store", nextState.filterStore);
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
