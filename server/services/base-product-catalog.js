"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CSV_PATH = path.resolve(
  __dirname,
  "../../data/Most Popular Indian Groceries - indian_grocery_1000_items.csv",
);

const TOKEN_NOISE = new Set([
  "kg",
  "g",
  "gm",
  "gram",
  "grams",
  "ml",
  "l",
  "ltr",
  "litre",
  "liter",
  "pack",
  "packs",
  "packet",
  "packets",
  "pc",
  "pcs",
  "piece",
  "pieces",
  "x",
  "of",
  "and",
  "the",
  "a",
  "an",
]);

const TOKEN_CANONICAL_MAP = new Map([
  ["daal", "dal"],
  ["dhal", "dal"],
  ["arhar", "toor"],
  ["tuvar", "toor"],
  ["tur", "toor"],
  ["basmathi", "basmati"],
  ["bismati", "basmati"],
]);

let catalogCache = null;

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalizeToken(token) {
  const normalized = String(token || "").trim().toLowerCase();
  if (!normalized) return "";
  return TOKEN_CANONICAL_MAP.get(normalized) || normalized;
}

function tokenize(value) {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => canonicalizeToken(token))
    .filter(Boolean)
    .filter((token) => token.length >= 2)
    .filter((token) => !TOKEN_NOISE.has(token))
    .filter((token) => !/\d/.test(token));
}

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((cell) => cell.trim());
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function withParenStripped(values) {
  const out = new Set(values);
  for (const value of values) {
    const stripped = String(value || "")
      .replace(/\([^)]*\)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (stripped) out.add(stripped);
  }
  return Array.from(out);
}

function buildCatalog() {
  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return {
      entries: [],
      byBaseKey: new Map(),
    };
  }

  const entries = [];
  const byBaseKey = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 6) continue;

    const baseProduct = String(cells[1] || "").trim();
    if (!baseProduct) continue;
    const baseKey = normalizeText(baseProduct);
    if (!baseKey) continue;

    const aliasesRaw = withParenStripped(
      [
        baseProduct,
        ...splitList(cells[4]), // Search Variations
        ...splitList(cells[5]), // Misspellings/Regional
      ].filter(Boolean),
    );

    const aliases = aliasesRaw
      .map((alias) => normalizeText(alias))
      .filter(Boolean)
      .map((alias) => ({
        text: alias,
        tokens: tokenize(alias),
      }));

    const brands = splitList(cells[3]);
    const entry = {
      id: String(cells[0] || "").trim() || null,
      base_product: baseProduct,
      base_key: baseKey,
      category: String(cells[2] || "").trim() || null,
      brands,
      aliases,
    };

    if (!byBaseKey.has(baseKey)) {
      byBaseKey.set(baseKey, entry);
      entries.push(entry);
      continue;
    }

    const prev = byBaseKey.get(baseKey);
    const mergedAliases = [
      ...prev.aliases.map((a) => a.text),
      ...entry.aliases.map((a) => a.text),
    ];
    const mergedBrands = [...prev.brands, ...entry.brands];
    const merged = {
      ...prev,
      brands: Array.from(
        new Set(mergedBrands.map((b) => normalizeText(b)).filter(Boolean)),
      ).map((norm) => {
        const original =
          mergedBrands.find((candidate) => normalizeText(candidate) === norm) ||
          norm;
        return original;
      }),
      aliases: Array.from(new Set(mergedAliases)).map((alias) => ({
        text: alias,
        tokens: tokenize(alias),
      })),
    };
    byBaseKey.set(baseKey, merged);
  }

  return { entries, byBaseKey };
}

function getCatalog() {
  if (!catalogCache) {
    catalogCache = buildCatalog();
  }
  return catalogCache;
}

function getCatalogCategories() {
  const { entries } = getCatalog();
  return Array.from(
    new Set(
      entries
        .map((entry) => String(entry?.category || "").trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function scoreAlias(textNorm, textTokensSet, alias) {
  if (!alias?.text) return 0;
  if (textNorm === alias.text) return 120 + alias.tokens.length;
  if (textNorm.includes(alias.text)) return 100 + alias.tokens.length;
  if (alias.text.includes(textNorm) && textNorm.length >= 4) {
    return 90 + alias.tokens.length;
  }
  if (!alias.tokens || alias.tokens.length === 0) return 0;

  let overlap = 0;
  for (const token of alias.tokens) {
    if (textTokensSet.has(token)) overlap += 1;
  }
  if (overlap === alias.tokens.length) return 80 + overlap;
  if (overlap >= 2) return 60 + overlap;
  if (overlap === 1 && alias.tokens.length === 1) return 50;
  return 0;
}

function resolveBaseProduct(text) {
  const textNorm = normalizeText(text);
  if (!textNorm) return null;

  const textTokens = tokenize(textNorm);
  const textTokensSet = new Set(textTokens);
  if (textTokensSet.size === 0) return null;

  const { entries } = getCatalog();
  let best = null;

  for (const entry of entries) {
    let bestAliasScore = 0;
    for (const alias of entry.aliases) {
      const score = scoreAlias(textNorm, textTokensSet, alias);
      if (score > bestAliasScore) bestAliasScore = score;
    }
    if (bestAliasScore <= 0) continue;

    if (
      !best ||
      bestAliasScore > best.score ||
      (bestAliasScore === best.score &&
        entry.base_product.length > best.base_product.length)
    ) {
      best = {
        base_key: entry.base_key,
        base_product: entry.base_product,
        category: entry.category,
        brands: entry.brands,
        score: bestAliasScore,
      };
    }
  }

  if (!best) return null;
  // Guard against loose accidental hits.
  if (best.score < 70) return null;
  return best;
}

function hasWholePhrase(textNorm, phraseNorm) {
  const source = ` ${String(textNorm || "").trim()} `;
  const target = String(phraseNorm || "").trim();
  if (!target) return false;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
  return re.test(source);
}

function detectBrandForBase(text, baseKey) {
  const textNorm = normalizeText(text);
  if (!textNorm) return null;

  const { byBaseKey } = getCatalog();
  const entry = byBaseKey.get(String(baseKey || "").trim().toLowerCase());
  if (!entry || !Array.isArray(entry.brands) || entry.brands.length === 0) {
    return null;
  }

  const candidates = [...entry.brands]
    .map((brand) => String(brand || "").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    const norm = normalizeText(candidate);
    if (!norm) continue;
    if (hasWholePhrase(textNorm, norm)) return candidate;
  }
  return null;
}

module.exports = {
  CSV_PATH,
  resolveBaseProduct,
  detectBrandForBase,
  getCatalogCategories,
  normalizeCatalogText: normalizeText,
};
