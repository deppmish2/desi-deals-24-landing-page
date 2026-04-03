"use strict";

const { createShopifyDealsAdapter } = require("../utils/shopify-deals-factory");

module.exports = createShopifyDealsAdapter({
  storeId: "bajwa-shop",
  storeName: "Bajwa Shop",
  storeUrl: "https://bajwa-shop.com",
  defaultHandles: ["all"],
});
