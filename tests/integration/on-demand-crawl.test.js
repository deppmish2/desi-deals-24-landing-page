"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildOnDemandSearchUrl } = require("../../crawler/on-demand-crawl");

describe("buildOnDemandSearchUrl", () => {
  it("builds Shopify suggest URL from base_key tokens", () => {
    const url = buildOnDemandSearchUrl("shopify", "https://jamoona.de", "toor dal");
    assert.ok(url.includes("/search/suggest.json"), "missing suggest.json");
    assert.ok(
      url.includes("toor%20dal") || url.includes("toor+dal") || url.includes("toor dal"),
      "missing query"
    );
  });

  it("builds WooCommerce search URL from base_key tokens", () => {
    const url = buildOnDemandSearchUrl("woocommerce", "https://namma.de", "basmati rice");
    assert.ok(url.includes("/wp-json/wc/store/v1/products"), "missing wc endpoint");
    assert.ok(url.includes("basmati"), "missing query");
  });
});
