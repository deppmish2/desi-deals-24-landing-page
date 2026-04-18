"use strict";

function timestamp() {
  return new Date().toISOString();
}

function write(level, scope, message, details) {
  const payload = details ? ` ${JSON.stringify(details)}` : "";
  const line = `[crawl][${timestamp()}][${scope}] ${message}${payload}`;

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

function logInfo(scope, message, details) {
  write("info", scope, message, details);
}

function logWarn(scope, message, details) {
  write("warn", scope, message, details);
}

function logError(scope, message, details) {
  write("error", scope, message, details);
}

module.exports = {
  logInfo,
  logWarn,
  logError,
};
