"use strict";

const { createShopifyDealsAdapter } = require("../utils/shopify-product-factory");

module.exports = createShopifyDealsAdapter({
  storeId: "transfoodlev",
  storeName: "Transfood Lebensmittelvertrieb",
  storeUrl: "https://transfoodlev.com",
  defaultHandles: ["all"],
});
