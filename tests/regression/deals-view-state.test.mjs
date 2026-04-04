import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDealsSearchParams,
  parsePageParam,
  readDealsViewState,
} from "../../client/src/utils/dealsViewState.mjs";

test("parsePageParam falls back to page 1 for invalid values", () => {
  assert.equal(parsePageParam(""), 1);
  assert.equal(parsePageParam("0"), 1);
  assert.equal(parsePageParam("-4"), 1);
  assert.equal(parsePageParam("abc"), 1);
  assert.equal(parsePageParam("3"), 3);
});

test("readDealsViewState parses applied deals state from URL params", () => {
  const params = new URLSearchParams({
    q: "toor dal",
    sort: "discount",
    page: "4",
    store: "Zora Supermarkt",
    category: "Lentils & Pulses",
    min_discount: "25",
    price_min: "2",
    price_max: "5",
    hide_expired: "1",
  });

  assert.deepEqual(readDealsViewState(params), {
    searchQuery: "toor dal",
    sortValue: "discount",
    page: 4,
    filterStore: "Zora Supermarkt",
    filterCategory: "Lentils & Pulses",
    filterMinDiscount: "25",
    filterPriceMin: "2",
    filterPriceMax: "5",
    filterHideExpired: true,
  });
});

test("buildDealsSearchParams keeps non-default state and preserves highlighted deal query", () => {
  const currentParams = new URLSearchParams({ deal: "deal-123" });
  const nextParams = buildDealsSearchParams(
    currentParams,
    {
      searchQuery: "ghee",
      sortValue: "price",
      page: 2,
      filterStore: "MD Store",
      filterCategory: "",
      filterMinDiscount: "10",
      filterPriceMin: "",
      filterPriceMax: "7",
      filterHideExpired: true,
    },
    null,
  );

  assert.equal(
    nextParams.toString(),
    [
      "deal=deal-123",
      "q=ghee",
      "sort=price",
      "page=2",
      "store=MD+Store",
      "min_discount=10",
      "price_max=7",
      "hide_expired=1",
    ].join("&"),
  );
});

test("buildDealsSearchParams drops default values and route-level deal ids do not duplicate query deal ids", () => {
  const currentParams = new URLSearchParams({ deal: "deal-123", q: "rice" });
  const nextParams = buildDealsSearchParams(
    currentParams,
    {
      searchQuery: "",
      sortValue: "",
      page: 1,
      filterStore: "",
      filterCategory: "",
      filterMinDiscount: "",
      filterPriceMin: "",
      filterPriceMax: "",
      filterHideExpired: false,
    },
    "deal-123",
  );

  assert.equal(nextParams.toString(), "");
});
