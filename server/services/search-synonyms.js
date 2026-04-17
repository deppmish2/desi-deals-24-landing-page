"use strict";

// Bidirectional synonym clusters for Indian grocery search.
// Words in the same cluster are interchangeable when scoring.
// Expanding query words allows "dal" to find "Lentil" products and vice-versa.
const CLUSTERS = [
  // Lentils & Pulses
  ["dal", "dhal", "lentil", "lentils"],
  ["toor", "arhar", "tuvar"],
  ["moong", "mung"],
  ["rajma", "kidney"],
  ["chana", "chickpea"],
  ["lobiya", "cowpea"],

  // Spices
  ["haldi", "turmeric"],
  ["jeera", "cumin"],
  ["dhania", "coriander"],
  ["methi", "fenugreek"],
  ["hing", "asafoetida"],
  ["mirch", "chilli", "chili"],

  // Grains & Flours
  ["sooji", "semolina", "rava", "suji"],
  ["besan", "gram", "chickpea"],
  ["atta", "wheat"],
  ["poha", "flattened", "beaten"],

  // Beverages
  ["chai", "tea"],

  // Dairy
  ["paneer", "cottage"],

  // Vegetables
  ["bhindi", "okra"],
  ["karela", "gourd"],
  ["lauki", "bottle"],
  ["kaddu", "pumpkin"],
  ["shimla", "capsicum", "bell"],
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
