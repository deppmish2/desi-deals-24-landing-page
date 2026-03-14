export const SMART_LIST_SESSION_KEY = "dd24_smart_list_state_v1";
export const MASS_VOLUME_UNITS = new Set(["kg", "g", "l", "ml"]);

export function normalizeUnit(value) {
  const unit = String(value || "")
    .trim()
    .toLowerCase();
  if (!unit) return "";
  if (
    unit === "piece" ||
    unit === "pieces" ||
    unit === "pc" ||
    unit === "pcs"
  ) {
    return "pcs";
  }
  if (unit === "kilo" || unit === "kilos") return "kg";
  if (unit === "gm" || unit === "gms") return "g";
  if (unit === "gram" || unit === "grams") return "g";
  if (
    unit === "litre" ||
    unit === "litres" ||
    unit === "liter" ||
    unit === "liters"
  ) {
    return "l";
  }
  if (unit === "milliliter" || unit === "milliliters") return "ml";
  if (unit === "packet" || unit === "packets" || unit === "packs") {
    return "pack";
  }
  return unit;
}

function toPositiveNumber(value) {
  if (value == null || value === "") return null;
  const normalized = Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
}

function roundQuantity(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Number.isInteger(value) ? value : Number(value.toFixed(3));
}

export function normalizeSmartListDraft(item) {
  const rawItemText = String(item?.raw_item_text || "").trim();
  const quantity = toPositiveNumber(item?.quantity);
  const quantityUnit = normalizeUnit(item?.quantity_unit) || null;
  const rawCount = Number(item?.item_count);
  const itemCount =
    Number.isFinite(rawCount) && rawCount >= 1 ? Math.round(rawCount) : 1;

  return {
    raw_item_text: rawItemText,
    quantity,
    quantity_unit: quantityUnit,
    item_count: itemCount,
  };
}

export function hasExplicitMassVolumeSize(item) {
  const quantity = toPositiveNumber(item?.quantity);
  const quantityUnit = normalizeUnit(item?.quantity_unit);
  return (
    Number.isFinite(quantity) &&
    quantity > 0 &&
    MASS_VOLUME_UNITS.has(quantityUnit)
  );
}

export function normalizeRequestedSmartListItem(item) {
  const normalized = normalizeSmartListDraft(item);
  if (!normalized.raw_item_text) return null;

  if (hasExplicitMassVolumeSize(normalized)) {
    return {
      ...normalized,
      quantity: roundQuantity(normalized.quantity * normalized.item_count),
      item_count: 1,
    };
  }

  return normalized;
}

export function normalizeRequestedSmartListItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeRequestedSmartListItem(item))
    .filter((item) => item?.raw_item_text);
}

export function readSmartListSessionDrafts() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(SMART_LIST_SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeSmartListDraft(item))
      .filter((item) => item.raw_item_text);
  } catch {
    return [];
  }
}

export function writeSmartListSessionDrafts(items) {
  if (typeof window === "undefined") return;
  try {
    const normalized = (Array.isArray(items) ? items : [])
      .map((item) => normalizeSmartListDraft(item))
      .filter((item) => item.raw_item_text);
    window.sessionStorage.setItem(
      SMART_LIST_SESSION_KEY,
      JSON.stringify(normalized),
    );
    window.dispatchEvent(new CustomEvent("dd24-list-changed"));
  } catch {
    // ignore session storage failures
  }
}

export function countSmartListItems(items) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, item) => sum + Math.max(1, Number(item?.item_count) || 1),
    0,
  );
}
