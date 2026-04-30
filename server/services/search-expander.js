"use strict";

const { GROCERY_SYNONYMS } = require("./grocery-synonyms");

// ── Bidirectional synonym map for search expansion ────────────────────────────
// These are SEARCH-ONLY — not applied during crawl normalisation.
// Covers Hindi/regional names and common phonetic variants for Indian grocery terms.
// The base map is merged with GROCERY_SYNONYMS (derived from the top-1000 most-ordered
// Indian groceries CSV) so any search variation or regional misspelling resolves correctly.
const BASE_SYNONYMS = {
  // Cumin / Jeera variants
  jeera: ["cumin", "jira", "jirra", "zeera", "zira"],
  cumin: ["jeera", "jira", "zeera"],
  jira: ["jeera", "cumin"],
  jirra: ["jeera", "cumin"],
  zeera: ["jeera", "cumin"],
  zira: ["jeera", "cumin"],

  // Turmeric / Haldi variants
  haldi: ["turmeric", "haldee", "haldey"],
  turmeric: ["haldi", "haldee"],
  haldee: ["haldi", "turmeric"],
  haldey: ["haldi", "turmeric"],

  // Dal / Lentil
  dal: ["dhal", "daal", "lentil"],
  dhal: ["dal", "daal"],
  daal: ["dal", "dhal"],
  lentil: ["dal", "dhal"],

  // Toor / Pigeon pea
  toor: ["arhar", "tuvar", "pigeon pea"],
  arhar: ["toor"],
  tuvar: ["toor"],

  // Chana / Chickpea
  chana: ["chickpea", "gram"],
  chickpea: ["chana", "gram"],
  gram: ["chana", "chickpea"],

  // Rajma / Kidney bean
  rajma: ["kidney bean", "kidney beans"],

  // Moong / Mung
  moong: ["mung", "mung bean"],
  mung: ["moong"],

  // Urad / Black lentil
  urad: ["black lentil", "urid", "black gram"],
  urid: ["urad"],

  // Masoor / Red lentil
  masoor: ["red lentil"],

  // Atta / Wheat flour
  atta: ["wheat flour", "ata"],
  ata: ["atta", "wheat flour"],
  "wheat flour": ["atta", "ata"],
  chakki: ["atta", "wheat flour"],
  multigrain: ["multigrain atta", "atta"],
  "multigrain atta": ["multigrain", "atta", "wheat flour"],

  // Besan / Gram flour
  besan: ["gram flour", "chickpea flour"],
  "gram flour": ["besan"],
  "chickpea flour": ["besan"],

  // Semolina / Sooji / Rava variants
  sooji: ["semolina", "rava", "suji", "rawa"],
  rava: ["semolina", "sooji", "rawa"],
  suji: ["semolina", "sooji"],
  rawa: ["semolina", "sooji", "rava"],
  semolina: ["sooji", "rava", "suji", "rawa"],

  // Coriander / Dhania
  dhania: ["coriander", "dhaniya", "dhaniyah"],
  dhaniya: ["coriander", "dhania"],
  dhaniyah: ["coriander", "dhania"],
  coriander: ["dhania", "dhaniya"],

  // Fenugreek / Methi
  methi: ["fenugreek"],
  fenugreek: ["methi"],

  // Asafoetida / Hing
  hing: ["asafoetida", "heeng"],
  heeng: ["hing", "asafoetida"],
  asafoetida: ["hing", "heeng"],

  // Carom / Ajwain
  ajwain: ["carom seeds", "carom"],
  "carom seeds": ["ajwain"],
  carom: ["ajwain"],

  // Cardamom / Elaichi
  elaichi: ["cardamom", "ilaychi", "elachi"],
  ilaychi: ["cardamom", "elaichi"],
  elachi: ["cardamom", "elaichi"],
  cardamom: ["elaichi", "ilaychi"],

  // Fennel / Saunf
  saunf: ["fennel"],
  fennel: ["saunf"],

  // Nigella / Kalonji
  kalonji: ["nigella", "onion seeds", "black seeds"],
  nigella: ["kalonji"],

  // Mustard / Rai / Sarson
  rai: ["mustard"],
  sarson: ["mustard"],
  mustard: ["rai", "sarson"],

  // Vegetables
  bhindi: ["okra", "lady finger", "ladyfinger"],
  okra: ["bhindi"],
  karela: ["bitter gourd"],
  lauki: ["bottle gourd", "dudhi"],
  dudhi: ["lauki", "bottle gourd"],
  "shimla mirch": ["capsicum", "bell pepper"],
  capsicum: ["shimla mirch"],

  // Staples
  basmati: ["basmathi", "basmatti"],
  basmathi: ["basmati"],
  basmatti: ["basmati"],
  poha: ["flattened rice", "beaten rice"],
  "flattened rice": ["poha"],
  "beaten rice": ["poha"],

  // Drinks / Chai
  chai: ["tea"],
  tea: ["chai"],

  // Condiments
  achar: ["pickle"],
  pickle: ["achar"],
  ghee: ["clarified butter"],
  "clarified butter": ["ghee"],

  // Rice
  chawal: ["rice"],

  // Brand spelling variants (common typos / alternate spellings)
  daawat: ["dawaat", "dawat"],
  dawaat: ["daawat", "dawat"],
  dawat: ["daawat", "dawaat"],
  aashirvaad: ["ashirvad", "ashirvaad", "aashirvad"],
  ashirvad: ["aashirvaad", "ashirvaad"],
  ashirvaad: ["aashirvaad", "ashirvad"],
  haldirams: ["haldiram", "halddirams"],
  haldiram: ["haldirams"],
  kohinoor: ["kohinor", "kohinur"],
  kohinor: ["kohinoor"],
  bikanervala: ["bikanervalla", "bikaner"],
  bikaner: ["bikanervala"],
};

// Merge BASE_SYNONYMS with GROCERY_SYNONYMS.
// BASE_SYNONYMS entries take precedence for keys that exist in both.
const SYNONYMS = Object.assign({}, GROCERY_SYNONYMS, BASE_SYNONYMS);
// For shared keys, union the arrays so no variants are lost.
for (const key of Object.keys(BASE_SYNONYMS)) {
  if (GROCERY_SYNONYMS[key]) {
    const merged = new Set([...BASE_SYNONYMS[key], ...GROCERY_SYNONYMS[key]]);
    SYNONYMS[key] = Array.from(merged);
  }
}

// ── Phonetic normalisation for Indian food terms ──────────────────────────────

/**
 * Apply phonetic normalisation rules common to Indian/South Asian food terms.
 * Handles double vowels, double consonants, and common sound substitutions
 * so that "jirra"→"jira", "haldee"→"haldi", "baasmati"→"basmati".
 */
function phoneticNormalise(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ee+/g, "i") // haldee→haldi, tee→ti
    .replace(/aa+/g, "a") // baasmati→basmati
    .replace(/oo+/g, "u") // doosra→dusra
    .replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, "$1") // jirra→jira, basmtti→basmti
    .replace(/([aeiou])\1+/g, "$1") // any remaining double vowels
    .replace(/ph/g, "f") // phulka→fulka
    .replace(/\s+/g, " ")
    .trim();
}

// ── Query expansion ───────────────────────────────────────────────────────────

/**
 * Expand a search query into all synonym and phonetic variants.
 * Returns a deduplicated array of lowercase terms — all are then searched
 * so that "jirra" finds "jeera" products and "haldee" finds "turmeric" products.
 *
 * @param {string} query - raw user input
 * @returns {string[]}
 */
function expandQuery(query) {
  const q = String(query || "")
    .toLowerCase()
    .trim();
  if (!q) return [q];

  const terms = new Set([q]);

  // Add phonetically normalised form of the full query
  const phonetic = phoneticNormalise(q);
  if (phonetic && phonetic !== q) terms.add(phonetic);

  // Expand each individual word with synonyms (including their phonetic forms)
  const words = q.split(/\s+/).filter(Boolean);
  for (const word of words) {
    // synonyms of original word
    for (const v of SYNONYMS[word] || []) terms.add(v);

    // phonetically normalised word + its synonyms
    const normWord = phoneticNormalise(word);
    if (normWord && normWord !== word) {
      terms.add(normWord);
      for (const v of SYNONYMS[normWord] || []) terms.add(v);
    }
  }

  // Expand the full phrase as a unit
  for (const v of SYNONYMS[q] || []) terms.add(v);
  if (phonetic) {
    for (const v of SYNONYMS[phonetic] || []) terms.add(v);
  }

  return Array.from(terms).filter(Boolean);
}

module.exports = { expandQuery, phoneticNormalise };
