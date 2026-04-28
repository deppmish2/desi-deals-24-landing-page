"use strict";

const { createShopifyDealsAdapter } = require("../utils/shopify-product-factory");

module.exports = createShopifyDealsAdapter({
  storeId: "villagefoods",
  storeName: "Village Foods",
  storeUrl: "https://villagefoods.de",
  defaultHandles: ["all"],
});
