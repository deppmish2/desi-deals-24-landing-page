"use strict";

const fs = require("fs");
const path = require("path");

const defs = [
  { expected: "toor dal", aliases: ["arhar dal", "tuvar dhal"] },
  { expected: "chana dal", aliases: [] },
  { expected: "moong dal", aliases: [] },
  { expected: "urad dal", aliases: [] },
  { expected: "masoor dal", aliases: [] },
  { expected: "basmati rice", aliases: [] },
  { expected: "sona masoori rice", aliases: [] },
  { expected: "poha", aliases: [] },
  { expected: "chickpea flour", aliases: ["besan", "gram flour"] },
  { expected: "semolina", aliases: ["rava", "sooji", "suji"] },
  { expected: "wheat atta", aliases: [] },
  { expected: "rice flour", aliases: [] },
  { expected: "maida flour", aliases: [] },
  { expected: "ragi flour", aliases: [] },
  { expected: "jowar flour", aliases: [] },
  { expected: "turmeric powder", aliases: ["haldi powder"] },
  { expected: "cumin seeds", aliases: ["jeera seeds"] },
  { expected: "coriander powder", aliases: ["dhania powder"] },
  { expected: "red chilli powder", aliases: [] },
  { expected: "garam masala", aliases: [] },
  { expected: "mustard seeds", aliases: [] },
  { expected: "fennel seeds", aliases: [] },
  { expected: "asafoetida", aliases: ["hing"] },
  { expected: "fenugreek seeds", aliases: ["methi seeds"] },
  { expected: "ajwain seeds", aliases: [] },
  { expected: "cinnamon sticks", aliases: [] },
  { expected: "cardamom pods", aliases: [] },
  { expected: "cloves", aliases: [] },
  { expected: "black pepper", aliases: [] },
  { expected: "bottle gourd", aliases: ["lauki"] },
  { expected: "okra", aliases: ["bhindi"] },
  { expected: "bitter gourd", aliases: ["karela"] },
  { expected: "capsicum", aliases: ["shimla mirch"] },
  { expected: "pumpkin", aliases: ["kaddu"] },
  { expected: "eggplant", aliases: [] },
  { expected: "spinach", aliases: [] },
  { expected: "cauliflower", aliases: [] },
  { expected: "potato", aliases: [] },
  { expected: "onion", aliases: [] },
  { expected: "tomato", aliases: [] },
];

if (defs.length !== 40) {
  throw new Error(`Expected 40 canonical definitions, got ${defs.length}`);
}

const entries = [];
for (const def of defs) {
  const termA = def.aliases[0] || def.expected;
  const termB = def.aliases[1] || def.expected;

  entries.push(
    { raw_name: termA, expected_normalized: def.expected },
    {
      raw_name: `premium ${termA} 1kg pack`,
      expected_normalized: def.expected,
    },
    { raw_name: `${termB} organic bag`, expected_normalized: def.expected },
    { raw_name: `${termA} special pouch`, expected_normalized: def.expected },
    { raw_name: `${termB} 500 g`, expected_normalized: def.expected },
  );
}

if (entries.length !== 200) {
  throw new Error(`Expected 200 fixture rows, got ${entries.length}`);
}

const outPath = path.join(
  __dirname,
  "../crawler/entity-resolution/fixtures/top200.fixture.json",
);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(entries, null, 2));
console.log(`Wrote ${entries.length} rows: ${outPath}`);
