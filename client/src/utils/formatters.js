export function formatPrice(price, currency = "EUR") {
  if (price == null) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

export function formatDiscount(pct) {
  if (pct == null || pct < 1) return null;
  return `-${Math.round(pct)}%`;
}

export function formatWeight(value, unit) {
  if (!value || !unit) return null;
  return `${value}${unit}`;
}

export function formatTimeAgo(isoString) {
  if (!isoString) return null;
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatPricePerKg(ppkg) {
  if (!ppkg) return null;
  return `${formatPrice(ppkg)}/kg`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatBestBefore(yyyyMm) {
  if (!yyyyMm) return null;
  const [year, month] = yyyyMm.split("-");
  const m = MONTH_NAMES[parseInt(month, 10) - 1];
  if (!m) return null;
  return `Best before ${m} ${year}`;
}
