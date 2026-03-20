"use strict";

const { fetchWithRetry } = require("./fetch-with-retry");
const { isFullCatalogEnabled } = require("./crawl-scope");

function dedupe(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function discoverCollectionHandles({ storeId, storeUrl, ua }) {
  try {
    const res = await fetchWithRetry(
      `${storeUrl}/collections.json?limit=250`,
      { headers: { "User-Agent": ua }, timeout: 30000 },
      { label: `[${storeId}] collections.json` },
    );

    if (!res.ok) {
      console.warn(
        `[${storeId}] collections.json discovery failed: HTTP ${res.status}`,
      );
      return [];
    }

    const json = await res.json();
    const handles = dedupe(
      (json.collections || []).map((collection) => collection.handle),
    );

    return handles;
  } catch (error) {
    console.warn(
      `[${storeId}] collections.json discovery failed: ${error.message}`,
    );
    return [];
  }
}

async function fetchCollectionProducts({ storeId, storeUrl, ua, handle }) {
  const allProducts = [];
  let page = 1;

  while (true) {
    const url = `${storeUrl}/collections/${handle}/products.json?limit=250&page=${page}`;
    const res = await fetchWithRetry(
      url,
      { headers: { "User-Agent": ua }, timeout: 30000 },
      { label: `[${storeId}] ${handle} p${page}` },
    );

    if (!res.ok) {
      if (page === 1) {
        console.warn(`[${storeId}] ${handle} p${page} -> HTTP ${res.status}`);
        return null;
      }
      break;
    }

    const json = await res.json();
    const products = json.products || [];
    allProducts.push(...products);

    if (products.length < 250) break;

    page += 1;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }

  return allProducts;
}

async function resolveCollectionHandles({
  storeId,
  storeUrl,
  ua,
  defaultHandles = [],
  fallbackHandles = [],
}) {
  if (!isFullCatalogEnabled()) {
    return dedupe(defaultHandles);
  }

  const discovered = await discoverCollectionHandles({ storeId, storeUrl, ua });
  if (discovered.length > 0) {
    console.log(
      `[${storeId}] Full catalog mode: crawling ${discovered.length} collections`,
    );
    return discovered;
  }

  const merged = dedupe(["all", ...defaultHandles, ...fallbackHandles]);
  console.warn(
    `[${storeId}] Full catalog mode fallback: using ${merged.length} static handles`,
  );
  return merged;
}

module.exports = {
  fetchCollectionProducts,
  resolveCollectionHandles,
};
