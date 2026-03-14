export const REFRESH_TIME_ZONE = "Europe/Berlin";
export const REFRESH_HOUR = 7;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getZonedParts(date, timeZone = REFRESH_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getOffsetMinutesAtUtc(utcMs, timeZone = REFRESH_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const tzName = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function zonedTimeToUtcMs(parts, timeZone = REFRESH_TIME_ZONE) {
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second || 0,
  );
  const offset1 = getOffsetMinutesAtUtc(localAsUtc, timeZone);
  const utcGuess1 = localAsUtc - offset1 * 60_000;
  const offset2 = getOffsetMinutesAtUtc(utcGuess1, timeZone);
  return localAsUtc - offset2 * 60_000;
}

function shiftZonedDate(parts, deltaDays, timeZone = REFRESH_TIME_ZONE) {
  const noonUtcMs = zonedTimeToUtcMs(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: 12,
      minute: 0,
      second: 0,
    },
    timeZone,
  );
  const shiftedUtcMs = noonUtcMs + Number(deltaDays || 0) * 24 * 60 * 60_000;
  return getZonedParts(new Date(shiftedUtcMs), timeZone);
}

export function getCurrentPoolDateSeed(nowMs = Date.now()) {
  const nowParts = getZonedParts(new Date(nowMs), REFRESH_TIME_ZONE);
  const effectiveParts =
    nowParts.hour >= REFRESH_HOUR
      ? nowParts
      : shiftZonedDate(nowParts, -1, REFRESH_TIME_ZONE);

  return `${effectiveParts.year}-${pad2(effectiveParts.month)}-${pad2(effectiveParts.day)}`;
}

export function computeNextRefreshUtcMs(nowMs = Date.now()) {
  const nowParts = getZonedParts(new Date(nowMs), REFRESH_TIME_ZONE);
  const targetParts =
    nowParts.hour < REFRESH_HOUR
      ? {
          year: nowParts.year,
          month: nowParts.month,
          day: nowParts.day,
          hour: REFRESH_HOUR,
          minute: 0,
          second: 0,
        }
      : (() => {
          const nextDay = shiftZonedDate(nowParts, 1, REFRESH_TIME_ZONE);
          return {
            year: nextDay.year,
            month: nextDay.month,
            day: nextDay.day,
            hour: REFRESH_HOUR,
            minute: 0,
            second: 0,
          };
        })();

  return zonedTimeToUtcMs(targetParts, REFRESH_TIME_ZONE);
}

export function formatRefreshCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(remainingMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}
