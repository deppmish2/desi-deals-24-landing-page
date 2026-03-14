"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCartTransfer } = require("../../server/services/cart-transfer");

test("buildCartTransfer generates Shopify permalink with all variant IDs", async () => {
  const result = await buildCartTransfer(
    { platform: "shopify", url: "https://shop.example" },
    [
      { product_url: "https://shop.example/products/a?variant=111" },
      { product_url: "https://shop.example/products/b?variant=222" },
      { product_url: "https://shop.example/products/c?variant=333" },
    ],
  );

  assert.equal(result.method, "shopify_permalink");
  assert.equal(result.cart_url, "https://shop.example/cart/111:1,222:1,333:1");
});

test("buildCartTransfer generates WooCommerce multi add-to-cart URL", async () => {
  const result = await buildCartTransfer(
    { platform: "woocommerce", url: "https://woo.example" },
    [
      { product_url: "https://woo.example/product/a/?add-to-cart=11" },
      { product_url: "https://woo.example/product/b/?add-to-cart=22" },
    ],
  );

  assert.equal(result.method, "woocommerce_add_to_cart_multi");
  assert.equal(
    result.cart_url,
    "https://woo.example/?add-to-cart=11,22&quantity=1,1",
  );
});

test("buildCartTransfer returns unsupported when platform cannot auto-cart all items", async () => {
  const items = Array.from({ length: 15 }).map((_, idx) => ({
    product_url: `https://custom.example/p/${idx + 1}`,
  }));

  const result = await buildCartTransfer(
    { platform: "custom", url: "https://custom.example" },
    items,
  );

  assert.equal(result.method, "unsupported_auto_cart");
  assert.equal(result.cart_url, null);
});

test("buildCartTransfer infers Shopify cart permalink when platform metadata is missing", async () => {
  const result = await buildCartTransfer(
    { platform: "custom", url: "https://shop.example" },
    [
      { product_url: "https://shop.example/products/a?variant=111" },
      { product_url: "https://shop.example/products/b?variant=222" },
    ],
  );

  assert.equal(result.method, "shopify_permalink_inferred");
  assert.equal(result.cart_url, "https://shop.example/cart/111:1,222:1");
});

test("buildCartTransfer expands mixed-pack combinations into cart quantities", async () => {
  const result = await buildCartTransfer(
    { platform: "shopify", url: "https://shop.example" },
    [
      {
        product_url: "https://shop.example/products/toor?variant=999",
        packs_needed: 3,
        combination: [
          {
            product_url: "https://shop.example/products/toor-500?variant=111",
            count: 2,
          },
          {
            product_url: "https://shop.example/products/toor-1000?variant=222",
            count: 1,
          },
        ],
      },
    ],
  );

  assert.equal(result.method, "shopify_permalink");
  assert.equal(result.cart_url, "https://shop.example/cart/111:2,222:1");
});
