"use strict";

const { parseShoppingInput } = require("./list-parser-lite");

async function parseShoppingList(rawText) {
  const items = parseShoppingInput(rawText).map((item) => ({
    ...item,
    brand_pref: null,
  }));
  return { items, source: "regex-lite" };
}

module.exports = {
  parseShoppingList,
};
