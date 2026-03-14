const DEALS_NAV_SELECTED_KEY = "dd24_deals_nav_selected_v1";
const DEALS_NAV_EVENT = "dd24-deals-nav-selection-changed";

export function isDealsNavSelected() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DEALS_NAV_SELECTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDealsNavSelected(selected) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DEALS_NAV_SELECTED_KEY, selected ? "1" : "0");
  } catch {
    // no-op
  }
  window.dispatchEvent(new Event(DEALS_NAV_EVENT));
}

export function dealsNavSelectionEventName() {
  return DEALS_NAV_EVENT;
}
