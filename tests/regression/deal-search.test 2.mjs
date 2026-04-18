import test from "node:test";
import assert from "node:assert/strict";
import dealSearch from "../../server/services/deal-search.js";
import { expandQueryWord } from "../../server/services/search-synonyms.js";
import { phoneticMatchScore } from "../../server/services/phonetic-search.js";

const { getSearchMatchScore, normalizeSearchValue, compactSearchValue, filterAndRankDealsByQuery } = dealSearch;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Assert query matches product (score > 0). */
function assertMatch(product, query, msg) {
  const score = getSearchMatchScore(product, query);
  assert.ok(score > 0, `SHOULD match | query="${query}" product="${product}" score=${score}${msg ? " | " + msg : ""}`);
}

/** Assert query does NOT match product (score === 0). */
function assertNoMatch(product, query, msg) {
  const score = getSearchMatchScore(product, query);
  assert.equal(score, 0, `SHOULD NOT match | query="${query}" product="${product}" score=${score}${msg ? " | " + msg : ""}`);
}

// ─── Normalisation ───────────────────────────────────────────────────────────

test("normalizeSearchValue strips possessives, punctuation, and diacritics", () => {
  assert.equal(normalizeSearchValue("Haldiram's All-In-One"), "haldiram all in one");
  assert.equal(normalizeSearchValue("Bhel-Puri & Sev"), "bhel puri and sev");
  assert.equal(normalizeSearchValue("P&D Shrimps"), "p and d shrimps");
});

test("compactSearchValue removes all spaces", () => {
  assert.equal(compactSearchValue("bhel puri"), "bhelpuri");
});

// ─── Exact & fuzzy matching ──────────────────────────────────────────────────

test("exact word match scores highest", () => {
  assert.ok(getSearchMatchScore("Aachi Turmeric Powder 50g", "turmeric") > 0);
});

test("typo within tolerance matches (haldirams -> haldiram's)", () => {
  assertMatch("Haldiram's All In One 200g Store A", "haldirm");
  assertMatch("Haldirams Moong Dal 200g Store B", "haldiram");
});

test("compacted multi-word matches (bhelpuri -> bhel puri)", () => {
  assertMatch("Haldiram's Bhel Puri Family Pack", "bhelpuri");
});

// ─── Min-token-length guards (regression: P&D shrimp false positive) ─────────

test("short tokens from punctuation do not cause false matches", () => {
  // 'P&D' normalises to 'p and d'; single-char token 'd' must not match 'daawat'
  assertNoMatch("Frozen Asian Choice Vannamei Shrimps P&D 500g", "daawat");
  assertNoMatch("Frozen Asian Choice Vannamei Shrimps P&D 500g", "dal");
});

// ─── Category NOT in haystack (regression: semolina matched 'rice') ──────────

test("product category must not be passed as part of haystack", () => {
  // Haystack = product_name + store_name only. Category is a separate filter.
  // Before fix, 'Semolina Coarse' scored 400 for 'rice' because 'Rice & Grains'
  // was concatenated into the string.
  assertNoMatch("Semolina Coarse 500g SomeStore", "rice");
  assertNoMatch("Haldiram Motichur Ladoo 500g SomeStore", "snack");
  assertNoMatch("Kabuli Chana 1kg SomeStore", "lentil");
  assertNoMatch("Amul Mango Lassi 200ml SomeStore", "beverage");
  assertNoMatch("Ashoka Aloo Paratha 4pcs SomeStore", "frozen");
});

// ─── Synonym expansion ───────────────────────────────────────────────────────

test("synonym: tur / toor / arhar / tuvar are interchangeable", () => {
  // regression: 'tur' was incorrectly blocked by a phonetic guard — it belongs in synonyms
  assertMatch("Lovely Toor Dal 500g Zora", "tur");
  assertMatch("Schani Toor Dal 500g Zora", "tur");
  assertMatch("Arhar Dal 1kg Store", "toor");
  assertMatch("Toor Dal 1kg Store", "tuvar");
});

test("synonym: dal / dhal / lentil", () => {
  assertMatch("Toor Lentil 500g Store", "dal");
  assertMatch("Toor Dal 500g Store", "lentil");
  assertMatch("Red Lentils 1kg Store", "dhal");
});

test("synonym: haldi / turmeric", () => {
  assertMatch("Turmeric Powder 100g Store", "haldi");
  assertMatch("Haldi Powder 100g Store", "turmeric");
});

test("synonym: chai / tea", () => {
  assertMatch("Masala Tea 250g Store", "chai");
  assertMatch("Chai Masala 100g Store", "tea");
});

test("synonym: sooji / semolina / rava / suji", () => {
  assertMatch("Fine Semolina 1kg Store", "sooji");
  assertMatch("Sooji Halwa Mix 500g Store", "semolina");
  assertMatch("Semolina Coarse 500g Store", "rava");
});

test("synonym: besan / gram / chickpea", () => {
  assertMatch("Chickpea Flour 1kg Store", "besan");
  assertMatch("Besan 500g Store", "chickpea");
});

test("synonym: jeera / cumin", () => {
  assertMatch("Cumin Seeds 200g Store", "jeera");
  assertMatch("Jeera Powder 100g Store", "cumin");
});

test("synonym: methi / fenugreek", () => {
  assertMatch("Fenugreek Seeds 200g Store", "methi");
  assertMatch("Methi Seeds 100g Store", "fenugreek");
});

test("synonym: ajwain / carom", () => {
  assertMatch("TRS Ajwain Lovage Seeds 100g Store", "carom");
  assertMatch("Carom Seeds 50g Store", "ajwain");
});

test("synonym: soonf / saunf / fennel", () => {
  assertMatch("TRS Fennel Seeds Saunf 100g Store", "soonf");
  assertMatch("Soonf 100g Store", "fennel");
});

test("synonym: elaichi / cardamom", () => {
  assertMatch("Cardamom Pods 50g Store", "elaichi");
  assertMatch("Elaichi 50g Store", "cardamom");
});

test("synonym: laung / clove", () => {
  assertMatch("TRS Cloves Laung 50g Store", "laung");
  assertMatch("Laung Whole 20g Store", "clove");
});

test("synonym: imli / tamarind", () => {
  assertMatch("Tamarind Paste 320g Store", "imli");
  assertMatch("Imli Chutney 250g Store", "tamarind");
});

test("synonym: sarson / mustard", () => {
  assertMatch("Mustard Oil 1L Store", "sarson");
  assertMatch("Sarson Ka Saag 400g Store", "mustard");
});

test("synonym: sesame / til / gingelly", () => {
  assertMatch("Gingelly Oil 1L Store", "sesame");
  assertMatch("Sesame Seeds 100g Store", "til");
  assertMatch("Til Chikki 200g Store", "gingelly");
});

test("synonym: urad / urid", () => {
  assertMatch("Urid Dal Washed 1kg Store", "urad");
  assertMatch("Urad Dal Whole 1kg Store", "urid");
});

test("synonym: masoor / red lentil", () => {
  // "masoor" finds products with "Red Lentils" in name
  assertMatch("Red Lentils Masoor Split 1kg Store", "masoor");
  // "red lentil" (two tokens) finds products that have both "red" AND a lentil-synonym word
  assertMatch("Red Lentils Masoor Split 1kg Store", "red lentil");
  // "Masoor Dal" has no "red" token so "red lentil" correctly returns no match
  assertNoMatch("Masoor Dal 1kg Store", "red lentil");
});

test("synonym: ragi / nachni", () => {
  assertMatch("Ragi Flour 1kg Store", "nachni");
  assertMatch("Nachni Sweet 200g Store", "ragi");
});

test("synonym: jowar / sorghum", () => {
  assertMatch("Jowar Flour 1kg Store", "sorghum");
  assertMatch("Sorghum Millet 500g Store", "jowar");
});

test("synonym: makki / corn / maize", () => {
  assertMatch("Makki Roti 500g Store", "corn");
  assertMatch("Corn Flour 500g Store", "makki");
});

test("synonym: jaggery / gur", () => {
  assertMatch("Jaggery Palm Crystal 500g Store", "gur");
  assertMatch("Gur Chikki 200g Store", "jaggery");
});

test("synonym: vermicelli / seviyan / sewai / semai", () => {
  assertMatch("Anil Rice Vermicelli 500g Store", "seviyan");
  assertMatch("Fried Vermicelli Semai 150g Store", "sewai");
  assertMatch("Seviyan Kheer Mix 150g Store", "vermicelli");
});

test("synonym: achar / pickle", () => {
  assertMatch("Mango Pickle Hot 500g Store", "achar");
  assertMatch("Achar Mix 300g Store", "pickle");
});

test("synonym: groundnut / peanut", () => {
  assertMatch("Peanut Chutney 100g Store", "groundnut");
  assertMatch("Groundnut Oil 1L Store", "peanut");
});

test("synonym: kaju / cashew", () => {
  assertMatch("Cashew Biscuits 400g Store", "kaju");
  assertMatch("Kaju Katli 300g Store", "cashew");
});

test("synonym: badam / almond", () => {
  assertMatch("Almond Cookies 250g Store", "badam");
  assertMatch("Badam Drink Mix 500g Store", "almond");
});

test("synonym: palak / spinach", () => {
  assertMatch("Palak Paneer 300g Store", "spinach");
  assertMatch("Spinach Dal 400g Store", "palak");
});

// ─── Transliteration ─────────────────────────────────────────────────────────

test("transliteration: daawat <-> dawat", () => {
  assertMatch("Daawat Basmati Rice 5kg Store", "dawat");
  assertMatch("Dawat Basmati Rice 5kg Store", "daawat");
});

test("transliteration: haldiram's / haldirams are equivalent", () => {
  assertMatch("Haldiram's Bhujia 200g Store", "haldirams");
  assertMatch("Haldirams Bhujia 200g Store", "haldiram");
});

// ─── Phonetic fallback ───────────────────────────────────────────────────────

test("phonetic: tumeric matches Turmeric (1-edit misspelling)", () => {
  assert.ok(phoneticMatchScore("Turmeric Powder", "tumeric") > 0);
});

test("phonetic: corriander matches Coriander (extra r)", () => {
  assert.ok(phoneticMatchScore("Coriander Powder", "corriander") > 0);
});

test("phonetic: musterd matches Mustard (vowel swap)", () => {
  assert.ok(phoneticMatchScore("Mustard Seeds", "musterd") > 0);
});

test("phonetic: short query (<5 chars) does not trigger fallback", () => {
  // 'tur' is a synonym (handled by synonym map), not a phonetic fallback case
  assert.equal(phoneticMatchScore("Toor Dal", "tur"), 0, "phonetic should not match 'tur' — use synonym map instead");
});

test("phonetic: no false positive — Trio Rice does not match 'tur'", () => {
  // regression: skeleton 'tr' matched both 'toor' and 'trio' before guards were added
  assert.equal(phoneticMatchScore("Sawat D Trio Brown Red Glutinous Rice", "tur"), 0);
});

test("phonetic: Finger Millet does not match fenugrik", () => {
  // full-word distance gate prevents consonant-skeleton collision
  assert.equal(phoneticMatchScore("Finger Millet", "fenugrik"), 0);
});

// ─── filterAndRankDealsByQuery integration ───────────────────────────────────

test("filterAndRankDealsByQuery: haystack is product_name + store only (no category)", () => {
  const hay = (d) => `${d.product_name} ${d.store.name}`;
  const deals = [
    { id: "1", product_name: "Semolina Coarse 500g", product_category: "Rice & Grains", discount_percent: 0, store: { name: "Store" } },
    { id: "2", product_name: "Basmati Rice 5kg",     product_category: "Rice & Grains", discount_percent: 10, store: { name: "Store" } },
  ];
  const results = filterAndRankDealsByQuery(deals, "rice", hay);
  assert.deepEqual(results.map((d) => d.id), ["2"], "Semolina must not appear for 'rice' search");
});

test("filterAndRankDealsByQuery: synonym expansion finds toor dal via 'tur'", () => {
  const hay = (d) => `${d.product_name} ${d.store.name}`;
  const deals = [
    { id: "1", product_name: "Lovely Toor Dal 500g",      discount_percent: 10, store: { name: "Zora" } },
    { id: "2", product_name: "Sawat D Trio Rice 1kg",     discount_percent: 5,  store: { name: "Zora" } },
    { id: "3", product_name: "Aashirvaad Basmati Rice 5kg", discount_percent: 8, store: { name: "Zora" } },
  ];
  const results = filterAndRankDealsByQuery(deals, "tur", hay);
  assert.deepEqual(results.map((d) => d.id), ["1"], "Only toor dal should match 'tur'");
});
