"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildWooProductRow } = require("../../crawler/woocommerce-full-catalog");

describe("buildWooProductRow", () => {
  it("maps WooCommerce store/v1 product to row — divides minor-unit prices", () => {
    const product = {
      id: 777,
      name: "Aashirvaad Atta 1kg",
      permalink: "https://namma.de/product/aashirvaad-atta-1kg",
      images: [{ src: "https://namma.de/wp-content/atta.jpg" }],
      prices: {
        price: "299",
        regular_price: "349",
        sale_price: "299",
        currency_minor_unit: 2,
      },
    };
    const row = buildWooProductRow("namma-markt", product);
    assert.equal(row.store_id, "namma-markt");
    assert.equal(row.sale_price, 2.99);
    assert.equal(row.original_price, 3.49);
    assert.equal(row.is_on_deal, 1);
    assert.equal(row.crawl_mode, "catalog");
    assert.equal(row.external_product_id, "777");
  });

  it("is_on_deal=0 when sale_price equals regular_price", () => {
    const product = {
      id: 778,
      name: "Rice 1kg",
      permalink: "https://namma.de/product/rice-1kg",
      images: [],
      prices: {
        price: "199",
        regular_price: "199",
        sale_price: "199",
        currency_minor_unit: 2,
      },
    };
    const row = buildWooProductRow("namma-markt", product);
    assert.equal(row.is_on_deal, 0);
    assert.equal(row.sale_price, 1.99);
  });
});
