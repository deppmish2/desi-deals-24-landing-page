"use strict";

const fetch = require("node-fetch");

function safeUrl(value, base) {
  try {
    if (base) return new URL(value, base);
    return new URL(value);
  } catch {
    return null;
  }
}

function extractShopifyVariantId(productUrl, storeUrl) {
  const url = safeUrl(productUrl, storeUrl);
  if (!url) return null;
  const variant = url.searchParams.get("variant");
  if (!variant) return null;
  return /^\d+$/.test(variant) ? variant : null;
}

function extractWooProductId(productUrl, storeUrl) {
  const url = safeUrl(productUrl, storeUrl);
  if (!url) return null;
  const id = url.searchParams.get("add-to-cart");
  if (!id) return null;
  return /^\d+$/.test(id) ? id : null;
}

function asBaseStoreUrl(storeUrl) {
  const url = safeUrl(storeUrl);
  if (!url) return null;
  return `${url.protocol}//${url.host}`;
}

// Returns true for Shopify product-handle URLs like /products/my-product-handle
// (no ?variant= param, just the clean product path)
function isShopifyHandleUrl(productUrl, storeUrl) {
  const url = safeUrl(productUrl, storeUrl);
  if (!url) return false;
  return (
    /^\/products\/[^/?#]+\/?$/.test(url.pathname) &&
    !url.searchParams.has("variant")
  );
}

// Fetches the first variant ID from the Shopify product JSON API.
async function fetchShopifyVariantId(productUrl, storeUrl) {
  try {
    const url = safeUrl(productUrl, storeUrl);
    if (!url) return null;

    const cleanPath = url.pathname.replace(/\/$/, "");
    const jsonUrl = `${url.protocol}//${url.host}${cleanPath}.json`;

    const res = await fetch(jsonUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      timeout: 8000,
    });
    if (!res.ok) return null;

    const data = await res.json();
    const variantId = data?.product?.variants?.[0]?.id;
    return variantId ? String(variantId) : null;
  } catch {
    return null;
  }
}

function expandMatchedItems(matchedItems) {
  const expanded = [];
  for (const item of matchedItems || []) {
    const comboRows = Array.isArray(item?.combination) ? item.combination : [];
    if (comboRows.length > 0) {
      for (const comboRow of comboRows) {
        const qty = Number(comboRow?.count);
        expanded.push({
          product_url: comboRow?.product_url,
          packs_needed: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
        });
      }
      continue;
    }

    const qty = Number(item?.packs_needed);
    expanded.push({
      product_url: item?.product_url,
      packs_needed: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
    });
  }
  return expanded.filter((row) => String(row?.product_url || "").trim());
}

function buildShopifyPermalink(store, matchedItems) {
  const lines = expandMatchedItems(matchedItems);
  const variantIds = lines.map((i) =>
    extractShopifyVariantId(i.product_url, store.url),
  );
  if (variantIds.some((id) => !id)) return null;

  const base = asBaseStoreUrl(store.url);
  if (!base) return null;

  const pairs = variantIds.map((id, i) => `${id}:${lines[i].packs_needed || 1}`).join(",");
  return `${base}/cart/${pairs}`;
}

function buildWooAddToCart(store, matchedItems) {
  const lines = expandMatchedItems(matchedItems);
  const ids = lines.map((i) =>
    extractWooProductId(i.product_url, store.url),
  );
  if (ids.length === 0 || ids.some((id) => !id)) return null;

  const base = asBaseStoreUrl(store.url);
  if (!base) return null;

  // WooCommerce supports comma-separated product IDs for a single add-to-cart URL.
  const quantities = lines.map((i) => String(i.packs_needed || 1)).join(",");
  return `${base}/?add-to-cart=${ids.join(",")}&quantity=${quantities}`;
}

async function buildCartTransfer(store, matchedItems) {
  const platform = String(store.platform || "").toLowerCase();

  if (platform === "shopify") {
    const cartUrl = buildShopifyPermalink(store, matchedItems);
    if (cartUrl) {
      return { method: "shopify_permalink", cart_url: cartUrl };
    }
  }

  if (platform === "woocommerce") {
    const cartUrl = buildWooAddToCart(store, matchedItems);
    if (cartUrl) {
      return { method: "woocommerce_add_to_cart_multi", cart_url: cartUrl };
    }
  }

  // Heuristic fallback for stores with incorrect/missing platform metadata.
  const inferredShopify = buildShopifyPermalink(store, matchedItems);
  if (inferredShopify) {
    return { method: "shopify_permalink_inferred", cart_url: inferredShopify };
  }

  const inferredWoo = buildWooAddToCart(store, matchedItems);
  if (inferredWoo) {
    return {
      method: "woocommerce_add_to_cart_multi_inferred",
      cart_url: inferredWoo,
    };
  }

  // For Shopify /products/{handle} URLs, fetch variant IDs from the product JSON API.
  const expandedLines = expandMatchedItems(matchedItems);
  if (
    expandedLines.length > 0 &&
    expandedLines.every((i) => isShopifyHandleUrl(i.product_url, store.url))
  ) {
    const base = asBaseStoreUrl(store.url);
    if (base) {
      const variantIds = await Promise.all(
        expandedLines.map((i) => fetchShopifyVariantId(i.product_url, store.url)),
      );
      if (variantIds.every((id) => id)) {
        const pairs = variantIds
          .map((id, i) => `${id}:${expandedLines[i].packs_needed || 1}`)
          .join(",");
        return {
          method: "shopify_variant_fetched",
          cart_url: `${base}/cart/${pairs}`,
        };
      }
    }
  }

  return { method: "unsupported_auto_cart", cart_url: null };
}

module.exports = {
  buildCartTransfer,
};
