"use strict";

const fetch = require("node-fetch");

/**
 * fetch() wrapper with exponential backoff retry.
 *
 * Retries on network errors and HTTP 5xx/429 responses.
 * Does NOT retry on 4xx (bad request, not found) — those are store-side data
 * errors that a retry will not fix.
 *
 * @param {string} url
 * @param {object} options - node-fetch RequestInit options
 * @param {object} retryOptions
 * @param {number} retryOptions.retries  - max retry attempts (default 2)
 * @param {number} retryOptions.baseDelayMs - initial backoff delay (default 5000ms)
 * @param {string} retryOptions.label - used in log messages
 * @returns {Promise<import('node-fetch').Response>}
 */
async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const retries = Number(retryOptions.retries ?? 2);
  const baseDelayMs = Number(retryOptions.baseDelayMs ?? 5000);
  const label = String(retryOptions.label || url);

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelayMs * attempt; // linear backoff: 5s, 10s
      console.warn(
        `[fetch-retry] ${label} — attempt ${attempt + 1}/${retries + 1} after ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const response = await fetch(url, options);

      // Retry on rate-limit or server errors
      if (response.status === 429 || response.status >= 500) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const serverDelay = retryAfterHeader
          ? Number(retryAfterHeader) * 1000
          : null;

        if (attempt < retries) {
          const delay = serverDelay ?? baseDelayMs * (attempt + 1);
          console.warn(
            `[fetch-retry] ${label} — HTTP ${response.status}, retrying in ${delay}ms`,
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }

      return response;
    } catch (err) {
      lastError = err;

      // AbortError means the caller set a timeout signal — don't retry
      if (err.name === "AbortError") throw err;

      if (attempt < retries) {
        continue; // will log at top of next iteration
      }
    }
  }

  throw lastError || new Error(`fetchWithRetry: all ${retries + 1} attempts failed for ${label}`);
}

module.exports = { fetchWithRetry };
