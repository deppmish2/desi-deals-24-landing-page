"use strict";

// Multi-word snack phrases that must be checked before the single-word lentil/spice keywords
// (first-match-wins). "Moong Dal Masala" and "Chana Dal Masala" are fried snacks, not raw lentils.
const SNACK_PHRASES = [
  "moong dal masala",
  "moong dal plain",
  "mung dal masala",
  "mung dal plain",
];

const CATEGORIES = [
  [
    "Rice & Grains",
    [
      "rice",
      "basmati",
      "poha",
      "semolina",
      "rava",
      "sooji",
      "oats",
      "quinoa",
      "millet",
    ],
  ],
  [
    "Flours & Baking",
    ["atta", "maida", "besan", "cornflour", "bread", "flour", "baking"],
  ],
  [
    "Lentils & Pulses",
    [
      "dal",
      "dhal",
      "lentil",
      "chana",
      "moong",
      "urad",
      "rajma",
      "toor",
      "masoor",
      "chickpea",
      "pea",
      "bean",
      "beans",
      "legume",
      "kidney",
      "lobiya",
      "haslama",
    ],
  ],
  [
    "Spices & Masalas",
    [
      "masala",
      "spice",
      "haldi",
      "turmeric",
      "cumin",
      "coriander",
      "chilli",
      "chili",
      "pepper",
      "cardamom",
      "cinnamon",
      "clove",
      "garam",
      "jeera",
      "dhania",
      "methi",
      "fenugreek",
    ],
  ],
  ["Oils & Ghee", ["oil", "ghee"]],
  [
    "Sauces & Pastes",
    ["chutney", "pickle", "achar", "sauce", "paste", "ketchup", "vinegar", "chicken"],
  ],
  [
    "Snacks & Sweets",
    [
      "bhujia",
      "mixture",
      "ladoo",
      "halwa",
      "biscuit",
      "cookie",
      "cookies",
      "namkeen",
      "chakli",
      "murukku",
      "chips",
      "snack",
      "sweet",
      "mithai",
      "chocolate",
      "candy",
      "wafer",
    ],
  ],
  [
    "Beverages",
    [
      "tea",
      "chai",
      "coffee",
      "lassi",
      "juice",
      "drink",
      "beverage",
      "water",
      "soda",
      "syrup",
      "sharbat",
    ],
  ],
  [
    "Dairy & Paneer",
    [
      "paneer",
      "yogurt",
      "yoghurt",
      "curd",
      "milk",
      "cream",
      "khoya",
      "mawa",
      "cheese",
    ],
  ],
  ["Frozen Foods", ["paratha", "naan", "samosa", "frozen", "roti"]],
  [
    "Fresh Produce",
    [
      "vegetable",
      "fruit",
      "herb",
      "fresh",
      "green",
      "onion",
      "tomato",
      "ginger",
      "garlic",
    ],
  ],
  [
    "Noodles & Pasta",
    ["noodle", "vermicelli", "pasta", "sewai", "maggi", "instant"],
  ],
  [
    "Canned & Packaged",
    ["canned", "tin", "ready meal", "ready-meal", "ready to eat", "packaged"],
  ],
  [
    "Personal Care",
    ["soap", "shampoo", "hair oil", "cosmetic", "lotion", "cream", "skincare", "shea"],
  ],
  ["Household", ["incense", "agarbatti", "pooja", "diya", "puja", "lamp"]],
];

/**
 * Map a product name to a category from the PRD taxonomy.
 * Returns the first matching category, or 'Other'.
 */
function mapCategory(productName) {
  if (!productName) return "Other";
  const lower = productName.toLowerCase();
  if (SNACK_PHRASES.some((phrase) => lower.includes(phrase))) return "Snacks & Sweets";
  for (const [category, keywords] of CATEGORIES) {
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower))) return category;
  }
  return "Other";
}

module.exports = { mapCategory };
