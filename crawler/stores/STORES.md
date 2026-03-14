# Store Adapters

Each file in this directory is a self-contained adapter for one grocery store.

## Implemented (5 stores)

| File              | Store        | URL            | Method                | Avg Deals |
| ----------------- | ------------ | -------------- | --------------------- | --------- |
| `jamoona.js`      | Jamoona      | jamoona.com    | Shopify JSON API      | ~91       |
| `dookan.js`       | Dookan       | eu.dookan.com  | Shopify JSON API      | ~93       |
| `namma-markt.js`  | Namma Markt  | nammamarkt.com | Shopify JSON API      | ~228      |
| `little-india.js` | Little India | littleindia.de | WooCommerce + Cheerio | ~10       |
| `grocera.js`      | Grocera      | grocera.de     | Custom HTMX + Cheerio | ~1–3      |

## Adapter Interface

Every adapter must export:

```js
module.exports = {
  storeId: "store-slug", // matches stores.id in DB
  storeName: "Store Name",
  storeUrl: "https://...",
  async scrape() {
    return [
      /* array of deal objects */
    ];
  },
};
```

### Required fields per deal object

| Field              | Type         | Notes                                 |
| ------------------ | ------------ | ------------------------------------- |
| `store_id`         | string       | Must match `storeId`                  |
| `store_name`       | string       | Human-readable                        |
| `store_url`        | string       | Homepage URL                          |
| `product_name`     | string       | Full name as listed                   |
| `product_category` | string       | Use `mapCategory()` from utils        |
| `product_url`      | string       | Direct product page URL               |
| `image_url`        | string\|null | Highest-res available                 |
| `weight_raw`       | string\|null | Raw string e.g. `"500g"`              |
| `weight_value`     | number\|null | Numeric part                          |
| `weight_unit`      | string\|null | `g`, `kg`, `ml`, `l`                  |
| `sale_price`       | number       | Current price in EUR                  |
| `original_price`   | number\|null | Struck-out price, only if > sale      |
| `discount_percent` | number\|null | Use `calcDiscount()` from utils       |
| `price_per_kg`     | number\|null | Use `calcPricePerKg()` from utils     |
| `price_per_unit`   | null         | Not yet used                          |
| `currency`         | string       | Always `'EUR'`                        |
| `availability`     | string       | `in_stock`, `out_of_stock`, `unknown` |
| `bulk_pricing`     | null         | Not yet used                          |

### Utility helpers

```js
const {
  parsePrice,
  calcDiscount,
  calcPricePerKg,
} = require("../utils/price-parser");
const { parseWeight } = require("../utils/weight-parser");
const { mapCategory } = require("../utils/category-mapper");
```

## Shopify stores (easiest to add)

If a store runs on Shopify, check:

1. `https://<store-url>/collections.json` — lists all collections
2. Look for a handle containing `sale`, `angebot`, `deal`, `offer`, `outlet`
3. Fetch `https://<store-url>/collections/<handle>/products.json?limit=250`
4. Each product has `variants[0].price` and `variants[0].compare_at_price`

Copy `jamoona.js` and update `STORE_ID`, `STORE_NAME`, `STORE_URL`, and `COLLECTIONS`.

## WooCommerce stores

Copy `little-india.js`. Key selectors:

- Products: `li.product`
- Name: `.woocommerce-loop-product__title`
- Sale price: `.price ins .woocommerce-Price-amount bdi`
- Original price: `.price del .woocommerce-Price-amount bdi`
- Pagination: `a.next.page-numbers`
- URL pattern: `/page/2/`, `/page/3/`, etc.

## Pending stores from PRD (22 remaining)

See `DesiDeals24_PRD.md` §3 for the full list. Priority candidates:

| Store             | URL                 | Likely platform       |
| ----------------- | ------------------- | --------------------- |
| Desigros          | desigros.com        | Unknown               |
| Spice Village     | spicevillage.eu     | Unknown               |
| Indian Supermarkt | indiansupermarkt.de | WooCommerce (likely)  |
| Indian Food Store | indianfoodstore.de  | Bricks Builder custom |
| Swadesh           | swadesh.eu          | Unknown               |
| Spicelands        | spicelands.de       | WooCommerce           |
