function normalizeUnit(value) {
  const unit = String(value || "").trim().toLowerCase();
  if (!unit) return "";
  if (unit === "gm" || unit === "gms" || unit === "gram" || unit === "grams") {
    return "g";
  }
  if (
    unit === "litre" ||
    unit === "litres" ||
    unit === "liter" ||
    unit === "liters"
  ) {
    return "l";
  }
  return unit;
}

function toBaseQuantity(value, unit) {
  const quantity = Number(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(quantity) || quantity <= 0 || !normalizedUnit) {
    return null;
  }
  if (normalizedUnit === "kg") return { value: quantity * 1000, unit: "g" };
  if (normalizedUnit === "g") return { value: quantity, unit: "g" };
  if (normalizedUnit === "l") return { value: quantity * 1000, unit: "ml" };
  if (normalizedUnit === "ml") return { value: quantity, unit: "ml" };
  return { value: quantity, unit: normalizedUnit };
}

function fromBaseQuantity(value, unit) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || !unit) return null;
  if (unit === "g") {
    if (quantity % 1000 === 0) return { value: quantity / 1000, unit: "kg" };
    return { value: quantity, unit: "g" };
  }
  if (unit === "ml") {
    if (quantity % 1000 === 0) return { value: quantity / 1000, unit: "l" };
    return { value: quantity, unit: "ml" };
  }
  return { value: quantity, unit };
}

function formatQuantity(value, unit) {
  const quantity = Number(value);
  const normalizedUnit = normalizeUnit(unit);
  if (!Number.isFinite(quantity) || quantity <= 0 || !normalizedUnit) return "";
  if (normalizedUnit === "g" || normalizedUnit === "ml") {
    return `${Number(quantity.toFixed(0))}${normalizedUnit}`;
  }
  return `${Number(quantity.toFixed(3))}${normalizedUnit}`;
}

export function getDealUnitSize(row) {
  const name = String(row?.product_name || "").trim();
  const bundleMatch = name.match(
    /(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i,
  );
  if (bundleMatch) {
    const bundleCount = Number(bundleMatch[1]);
    const packSize = Number(String(bundleMatch[2]).replace(",", "."));
    const base = toBaseQuantity(packSize, bundleMatch[3]);
    if (Number.isFinite(bundleCount) && bundleCount > 0 && base) {
      return fromBaseQuantity(base.value * bundleCount, base.unit);
    }
  }
  return fromBaseQuantity(row?.weight_value, row?.weight_unit);
}

export function formatCombinationSummary(combination) {
  if (!Array.isArray(combination) || combination.length === 0) return "";
  return combination
    .map((row) => {
      const count = Number(row?.count || 0);
      const unitSize = getDealUnitSize(row);
      if (count <= 0) return null;
      return `${unitSize ? formatQuantity(unitSize.value, unitSize.unit) : "pack"} x ${count}`;
    })
    .filter(Boolean)
    .join(" + ");
}

export function getCombinationTotal(combination) {
  if (!Array.isArray(combination) || combination.length === 0) return null;
  let totalBase = 0;
  let baseUnit = null;
  for (const row of combination) {
    const count = Number(row?.count || 0);
    const unitSize = getDealUnitSize(row);
    if (count <= 0 || !unitSize) continue;
    const base = toBaseQuantity(unitSize.value, unitSize.unit);
    if (!base) continue;
    if (!baseUnit) baseUnit = base.unit;
    if (base.unit !== baseUnit) return null;
    totalBase += base.value * count;
  }
  if (!baseUnit || totalBase <= 0) return null;
  return fromBaseQuantity(totalBase, baseUnit);
}

export function formatMatchedTotalQuantity(quantity, unit) {
  return formatQuantity(quantity, unit);
}

export function formatCombinationPriceSummary(combination, formatPrice) {
  if (!Array.isArray(combination) || combination.length === 0) return "";
  return combination
    .map((row) => {
      const count = Number(row?.count || 0);
      const salePrice = Number(row?.sale_price || 0);
      if (count <= 0 || !Number.isFinite(salePrice) || salePrice <= 0) {
        return null;
      }
      return `${count} x ${formatPrice(salePrice)}`;
    })
    .filter(Boolean)
    .join(" + ");
}
