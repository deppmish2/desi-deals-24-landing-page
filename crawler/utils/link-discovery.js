"use strict";

const { fetchWithRetry } = require("./fetch-with-retry");
const cheerio = require("cheerio");
const { isFullCatalogEnabled } = require("./crawl-scope");

function uniq(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function normalize(url) {
  const noHash = url.split("#")[0];
  const noQuery = noHash.split("?")[0];
  return `${noQuery.replace(/\/+$/, "")}/`;
}

function matchesAny(pathname, patterns) {
  return patterns.some((pattern) => pattern.test(pathname));
}

async function discoverLinksByPatterns({
  storeId,
  storeUrl,
  ua,
  patterns,
  fallback = [],
  extraSeedUrls = [],
}) {
  if (!isFullCatalogEnabled()) {
    return uniq(fallback.map(normalize));
  }

  const discovered = [];
  const seeds = uniq([storeUrl, ...extraSeedUrls]);

  for (const seed of seeds) {
    try {
      const res = await fetchWithRetry(
        seed,
        {
          headers: {
            "User-Agent": ua,
            Accept: "text/html,application/xhtml+xml",
          },
          timeout: 30000,
        },
        { label: `[${storeId}] link-discovery ${seed}` },
      );
      if (!res.ok) continue;

      const html = await res.text();
      const $ = cheerio.load(html);
      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;

        let absolute;
        try {
          absolute = new URL(href, storeUrl);
        } catch {
          return;
        }

        const baseHost = new URL(storeUrl).host.replace(/^www\./, "");
        const candidateHost = absolute.host.replace(/^www\./, "");
        if (candidateHost !== baseHost) return;

        if (!matchesAny(absolute.pathname, patterns)) return;

        discovered.push(normalize(absolute.toString()));
      });
    } catch (error) {
      console.warn(
        `[${storeId}] Link discovery failed on ${seed}: ${error.message}`,
      );
    }
  }

  const merged = uniq([...discovered, ...fallback.map(normalize)]);
  console.log(
    `[${storeId}] ${isFullCatalogEnabled() ? "Full catalog" : "Deals"} mode category bases: ${merged.length}`,
  );
  return merged;
}

module.exports = {
  discoverLinksByPatterns,
};
