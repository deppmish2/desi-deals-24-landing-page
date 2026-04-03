"use strict";

const { createShopifyDealsAdapter } = require("../utils/shopify-deals-factory");

module.exports = createShopifyDealsAdapter({
  storeId: "indianspicebasket",
  storeName: "Indian Spice Basket",
  storeUrl: "https://indianspicebasket.be",
  defaultHandles: ["discounted-products"],
  fallbackHandles: ["all"],
});
