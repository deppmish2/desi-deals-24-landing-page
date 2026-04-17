"use strict";

// Bidirectional synonym clusters for Indian grocery search.
// Words in the same cluster are interchangeable when scoring.
// Expanding query words allows "dal" to find "Lentil" products and vice-versa.
const CLUSTERS = [
  // ── Lentils & Pulses ────────────────────────────────────────────────────────
  ["dal", "dhal", "lentil", "lentils"],
  ["toor", "arhar", "tuvar"],
  ["moong", "mung"],
  ["urad", "urid"],                          // urad dal = black gram
  ["masoor", "red lentil"],                  // masoor dal = red/split lentils
  ["rajma", "kidney"],
  ["chana", "chickpea"],
  ["kala chana", "black chickpea"],
  ["lobiya", "cowpea"],
  ["moth", "matki"],                         // moth beans

  // ── Spices & Masalas ────────────────────────────────────────────────────────
  ["haldi", "turmeric"],
  ["jeera", "cumin"],
  ["dhania", "coriander"],
  ["methi", "fenugreek"],
  ["hing", "asafoetida"],
  ["mirch", "chilli", "chili"],
  ["ajwain", "carom"],                       // carom/lovage seeds
  ["kalonji", "nigella"],                    // nigella / black onion seeds
  ["soonf", "saunf", "fennel"],             // fennel seeds
  ["elaichi", "cardamom"],
  ["laung", "clove"],
  ["dalchini", "cinnamon"],
  ["kesar", "saffron"],
  ["amchur", "mango powder"],               // dried mango powder
  ["imli", "tamarind"],
  ["sarson", "mustard"],                    // mustard seeds / mustard oil
  ["sesame", "til", "gingelly"],            // sesame oil = gingelly oil

  // ── Grains & Flours ─────────────────────────────────────────────────────────
  ["sooji", "semolina", "rava", "suji"],
  ["besan", "gram", "chickpea"],
  ["atta", "wheat"],
  ["maida", "refined flour"],               // all-purpose / refined flour
  ["poha", "powa", "flattened", "beaten"],  // flattened/beaten rice
  ["ragi", "nachni"],
  ["jowar", "sorghum"],
  ["makki", "corn", "maize"],               // makki atta / corn flour

  // ── Noodles & Pasta ─────────────────────────────────────────────────────────
  ["vermicelli", "seviyan", "sewai", "semai"],

  // ── Beverages ───────────────────────────────────────────────────────────────
  ["chai", "tea"],

  // ── Dairy ───────────────────────────────────────────────────────────────────
  ["paneer", "cottage"],
  ["ghee"],
  ["khoya", "mawa"],                        // reduced milk solid
  ["coconut", "nariyal"],

  // ── Sweeteners & Staples ────────────────────────────────────────────────────
  ["jaggery", "gur"],                       // unrefined cane/palm sugar
  ["sabudana", "sabudhana", "sago"],        // sago pearls / tapioca pearls
  ["mumra", "murmura", "puffed rice"],
  ["makhana"],                               // fox nuts / lotus seeds — no safe single-word English alias

  // ── Nuts ────────────────────────────────────────────────────────────────────
  ["groundnut", "peanut"],
  ["kaju", "cashew"],
  ["badam", "almond"],

  // ── Vegetables ──────────────────────────────────────────────────────────────
  ["bhindi", "okra"],
  ["karela", "bitter gourd"],
  ["lauki", "bottle gourd"],
  ["kaddu", "pumpkin"],
  ["shimla", "capsicum", "bell"],
  ["palak", "spinach"],
  ["aloo", "potato"],

  // ── Pickles & Condiments ────────────────────────────────────────────────────
  ["achar", "pickle"],
];

// Build map: word → all other words in its cluster (merged across multiple clusters)
const SYNONYM_MAP = new Map();
for (const cluster of CLUSTERS) {
  for (const word of cluster) {
    const others = cluster.filter((w) => w !== word);
    if (others.length > 0) {
      const existing = SYNONYM_MAP.get(word) ?? [];
      SYNONYM_MAP.set(word, [...new Set([...existing, ...others])]);
    }
  }
}

function getSynonyms(word) {
  return SYNONYM_MAP.get(word) ?? [];
}

function expandQueryWord(word) {
  const synonyms = getSynonyms(word);
  return synonyms.length > 0 ? [word, ...synonyms] : [word];
}

module.exports = { getSynonyms, expandQueryWord };
