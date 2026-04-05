import test from "node:test";
import assert from "node:assert/strict";
import dealSearch from "../../server/services/deal-search.js";

const {
  compactSearchValue,
  filterAndRankDealsByQuery,
  getSearchMatchScore,
  normalizeSearchValue,
} = dealSearch;

test("normalizeSearchValue removes punctuation noise and possessives", () => {
  assert.equal(normalizeSearchValue("Haldiram's All-In-One"), "haldiram all in one");
  assert.equal(normalizeSearchValue("Bhel-Puri & Sev"), "bhel puri and sev");
});

test("getSearchMatchScore keeps apostrophe and typo variants together", () => {
  const haystack = "Haldiram's All In One 200g Snacks & Sweets";
  const exactScore = getSearchMatchScore(haystack, "haldiram");
  const typoScore = getSearchMatchScore(haystack, "haldirm");
  const pluralScore = getSearchMatchScore(haystack, "haldirams");

  assert.ok(exactScore > 0);
  assert.ok(typoScore > 0);
  assert.ok(pluralScore > 0);
});

test("getSearchMatchScore supports compacted multi-word matches", () => {
  const haystack = "Haldiram's Bhel Puri Family Pack";
  assert.ok(getSearchMatchScore(haystack, "bhelpuri") > 0);
  assert.equal(compactSearchValue("bhel puri"), "bhelpuri");
});

test("filterAndRankDealsByQuery keeps all close Haldiram variants", () => {
  const deals = [
    {
      id: "1",
      product_name: "Haldiram's All In One 200g",
      product_category: "Snacks & Sweets",
      discount_percent: 20,
      store: { name: "Store A" },
    },
    {
      id: "2",
      product_name: "Haldirams Moong Dal 200g",
      product_category: "Snacks & Sweets",
      discount_percent: 15,
      store: { name: "Store B" },
    },
    {
      id: "3",
      product_name: "Aashirvaad Atta 5kg",
      product_category: "Flours & Baking",
      discount_percent: 30,
      store: { name: "Store C" },
    },
  ];

  const getHaystack = (deal) =>
    `${deal.product_name} ${deal.store.name} ${deal.product_category}`;

  const exact = filterAndRankDealsByQuery(deals, "haldiram", getHaystack);
  const typo = filterAndRankDealsByQuery(deals, "haldirm", getHaystack);

  assert.deepEqual(
    exact.map((deal) => deal.id),
    ["1", "2"],
  );
  assert.deepEqual(
    typo.map((deal) => deal.id),
    ["1", "2"],
  );
});
