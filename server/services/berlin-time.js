"use strict";

const BERLIN_TIME_ZONE = "Europe/Berlin";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function getZonedParts(date, timeZone = BERLIN_TIME_ZONE) {
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

function getOffsetMinutesAtUtc(utcMs, timeZone = BERLIN_TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const tzName =
    parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function zonedTimeToUtcMs(parts, timeZone = BERLIN_TIME_ZONE) {
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

function formatBerlinDateKey(date = new Date()) {
  const parts = getZonedParts(date, BERLIN_TIME_ZONE);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function getBerlinHour(date = new Date()) {
  return getZonedParts(date, BERLIN_TIME_ZONE).hour;
}

function getBerlinUtcIso(dateKey, hour, minute = 0, second = 0) {
  const [year, month, day] = String(dateKey || "")
    .split("-")
    .map((value) => Number(value));

  if (!year || !month || !day) {
    throw new Error(`Invalid Berlin date key: ${dateKey}`);
  }

  return new Date(
    zonedTimeToUtcMs(
      {
        year,
        month,
        day,
        hour: Number(hour || 0),
        minute: Number(minute || 0),
        second: Number(second || 0),
      },
      BERLIN_TIME_ZONE,
    ),
  ).toISOString();
}

module.exports = {
  BERLIN_TIME_ZONE,
  formatBerlinDateKey,
  getBerlinHour,
  getBerlinUtcIso,
  getZonedParts,
  zonedTimeToUtcMs,
};
