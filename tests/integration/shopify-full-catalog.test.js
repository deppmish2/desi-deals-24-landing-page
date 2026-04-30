"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildShopifyProductRow } = require("../../crawler/shopify-full-catalog");

describe("buildShopifyProductRow", () => {
  it("maps Shopify product to store_products row", () => {
    const product = {
      id: 12345,
      title: "TRS Toor Dal 500g",
      handle: "trs-toor-dal-500g",
      variants: [{ id: 99001, price: "3.29", compare_at_price: "3.99" }],
      images: [{ src: "https://cdn.shopify.com/trs-toor.jpg" }],
    };
    const row = buildShopifyProductRow("jamoona", "https://jamoona.de", product);
    assert.equal(row.store_id, "jamoona");
    assert.equal(row.sale_price, 3.29);
    assert.equal(row.original_price, 3.99);
    assert.equal(row.is_on_deal, 1);
    assert.equal(row.crawl_mode, "catalog");
    assert.equal(row.external_product_id, "12345");
    assert.ok(row.product_url.includes("trs-toor-dal-500g"));
  });

  it("is_on_deal=0 when no compare_at_price", () => {
    const product = {
      id: 12346,
      title: "Rice 1kg",
      handle: "rice-1kg",
      variants: [{ id: 99002, price: "2.00", compare_at_price: null }],
      images: [],
    };
    const row = buildShopifyProductRow("jamoona", "https://jamoona.de", product);
    assert.equal(row.is_on_deal, 0);
    assert.equal(row.sale_price, 2.00);
    assert.equal(row.original_price, null);
  });
});
