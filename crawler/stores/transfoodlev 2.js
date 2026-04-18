"use strict";

const { createShopifyDealsAdapter } = require("../utils/shopify-deals-factory");

module.exports = createShopifyDealsAdapter({
  storeId: "transfoodlev",
  storeName: "Transfood Lebensmittelvertrieb",
  storeUrl: "https://transfoodlev.com",
  defaultHandles: ["all"],
});
