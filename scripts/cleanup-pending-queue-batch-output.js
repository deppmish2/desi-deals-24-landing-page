"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INPUT_DEFAULT = path.resolve(
  __dirname,
  "../logs/openai-pending-queue-batches/batch_69e213c0cf588190af42bc1e2e086292.combined.csv",
);

const OUTPUT_HEADER = [
  "canonical_name",
  "brand",
  "product_type",
  "variant",
  "category",
  "weight_kg",
  "weight_unit",
  "aliases",
  "ai_confidence",
  "needs_review",
  "review_note",
  "raw_names_matched",
];

const CATEGORY_LIST = [
  "Lentils & Pulses",
  "Rice & Grains",
  "Flour & Semolina",
  "Spices & Masalas",
  "Oils & Ghee",
  "Pickles & Chutneys",
  "Snacks & Namkeen",
  "Sweets & Mithai",
  "Dairy & Paneer",
  "Frozen Foods",
  "Ready Meals & Mixes",
  "Fresh Produce",
  "Condiments & Sauces",
  "Pooja & Incense",
  "Other",
];

const CATEGORY_SET = new Set(CATEGORY_LIST);

const CATEGORY_ALIASES = new Map([
  ["flours & baking", "Flour & Semolina"],
  ["sauces & pastes", "Condiments & Sauces"],
  ["beverages", "Other"],
  ["beverages & drinks", "Other"],
  ["household", "Other"],
  ["personal care", "Other"],
  ["canned & packaged", "Ready Meals & Mixes"],
  ["noodles & pasta", "Ready Meals & Mixes"],
  ["snacks & sweets", "Snacks & Namkeen"],
  ["dairy", "Dairy & Paneer"],
  ["pooja", "Pooja & Incense"],
  ["", "Other"],
  ["null", "Other"],
]);

const VARIANT_TERMS = [
  "double cream",
  "freeze dried",
  "extra fine",
  "dehulled",
  "hulled",
  "washed",
  "polished",
  "roasted",
  "puffed",
  "pressed",
  "popped",
  "flaked",
  "beaten",
  "organic",
  "aged",
  "smoked",
  "cooked",
  "dried",
  "coarse",
  "medium",
  "whole",
  "split",
  "light",
  "dark",
  "mild",
  "fine",
  "raw",
  "strong",
];

const CONFIDENCE_ORDER = {
  low: 1,
  medium: 2,
  high: 3,
};

const CATEGORY_KEYWORDS = [
  ["Pooja & Incense", ["agarbatti", "incense", "pooja", "puja", "toran", "diya", "camphor", "kumkum", "rakhi", "sticker", "rangoli", "decoration"]],
  ["Oils & Ghee", ["ghee", "oil", "vanaspati", "butter oil"]],
  ["Pickles & Chutneys", ["pickle", "achar", "chutney", "thokku"]],
  ["Condiments & Sauces", ["sauce", "paste", "ketchup", "vinegar", "mayo", "mayonnaise", "hoisin", "citric acid"]],
  ["Spices & Masalas", ["masala", "powder", "podi", "chilli", "chili", "pepper", "turmeric", "cumin", "coriander", "garam", "jeera", "dhania", "fenugreek", "methi", "cardamom", "clove", "cinnamon", "bay leaves", "asafoetida"]],
  ["Lentils & Pulses", ["dal", "dhal", "lentil", "lentils", "chana", "chickpea", "kabuli", "rajma", "moong", "mung", "urad", "urid", "toor", "tuvar", "arhar", "peas", "pea", "beans", "bean", "vatana"]],
  ["Flour & Semolina", ["flour", "atta", "maida", "besan", "semolina", "rava", "sooji", "suji", "sooji", "gram flour", "corn flour"]],
  ["Rice & Grains", ["rice", "basmati", "poha", "mamra", "murmura", "puffed rice", "flattened rice", "barley", "millet", "quinoa", "seviyan", "vermicelli", "sabudana", "sago", "lapsi", "broken wheat"]],
  ["Ready Meals & Mixes", ["mix", "ready to eat", "ready meal", "instant noodles", "noodles", "soup", "khaman", "dhokla", "idli", "uttapam", "vada", "haleem"]],
  ["Frozen Foods", ["frozen", "paratha", "naan", "kulcha", "chapati", "roti", "samosa", "spring roll"]],
  ["Fresh Produce", ["onion", "tomato", "potato", "ginger", "garlic", "okra", "lady finger", "brinjal", "aubergine", "banana", "mango", "fresh produce", "fresh"]],
  ["Dairy & Paneer", ["paneer", "milk", "curd", "yogurt", "yoghurt", "cheese", "cream", "lassi", "khoya", "mawa", "buttermilk"]],
  ["Sweets & Mithai", ["mithai", "sweet", "papdi", "soan", "halwa", "ladoo", "laddu", "gulab", "jamun", "barfi", "burfi", "jalebi", "mysore pak", "chikki", "rasgulla", "peda"]],
  ["Snacks & Namkeen", ["bhujia", "namkeen", "snack", "chips", "mixture", "papad", "murukku", "chakli", "sev", "banana chips", "khari", "puff", "cracker", "biscuit", "wafers", "balls"]],
];

function getArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function toCsvCell(value) {
  const text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function nullish(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return ["null", "undefined", '""', "''"].includes(text.toLowerCase());
}

function cleanText(value) {
  if (nullish(value)) return "";
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeKey(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitPipe(value) {
  const text = cleanText(value);
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split("|")
        .map((part) => cleanText(part))
        .filter(Boolean),
    ),
  );
}

function titleCase(value) {
  return cleanText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.toUpperCase() === part && part.length <= 4) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizeVariant(value) {
  const text = normalizeKey(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const found = VARIANT_TERMS.find((variant) => normalizeKey(variant) === text);
  return found ? titleCase(found) : "";
}

function normalizeCategory(value) {
  const text = cleanText(value);
  if (!text) return "";
  if (CATEGORY_SET.has(text)) return text;
  const key = normalizeKey(text);
  if (CATEGORY_SET.has(titleCase(text))) return titleCase(text);
  return CATEGORY_ALIASES.get(key) || "";
}

function inferCategory(...values) {
  const text = values
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) return category;
  }
  return "Other";
}

function stripNoise(value) {
  return cleanText(value)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:bundle|only berlin delivery)[^)]*\)/gi, " ")
    .replace(/\b(?:only berlin delivery|best before|exp|expiry|expires?)\b.*$/i, " ")
    .replace(/\b(bundle of\s+\d+\s*x\s*\d+(?:[.,]\d+)?\s*(?:kg|g|gm|mg|ml|cl|l|ltr|litre|liter))\b/gi, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|gm|mg|ml|cl|l|ltr|litre|liter)\b/gi, " ")
    .replace(/\b\d+\s*(?:pcs|pc|pieces|piece)\b/gi, " ")
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBrandPrefix(value, brand) {
  const text = cleanText(value);
  const brandText = cleanText(brand);
  if (!text || !brandText) return text;
  const escaped = brandText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`^${escaped}\\s*:?\\s*`, "i"), "")
    .trim();
}

function removeVariantFromEnd(value, variant) {
  const text = cleanText(value);
  const variantText = cleanText(variant);
  if (!text || !variantText) return text;
  const escaped = variantText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`\\b${escaped}\\b$`, "i"), "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveProductType(row, canonicalName, brand, variant) {
  let productType = cleanText(row.product_type);
  if (CATEGORY_SET.has(productType) || normalizeKey(productType) === "other") {
    productType = "";
  }

  const rawNames = splitPipe(row.raw_names_matched);
  const candidates = [
    removeVariantFromEnd(stripBrandPrefix(stripNoise(canonicalName), brand), variant),
    removeVariantFromEnd(stripBrandPrefix(stripNoise(rawNames[0] || ""), brand), variant),
    removeVariantFromEnd(stripBrandPrefix(stripNoise(row.canonical_name), brand), variant),
  ].filter(Boolean);

  if (!productType) {
    productType = candidates[0] || "";
  }

  productType = cleanText(productType)
    .replace(/\s+/g, " ")
    .trim();

  if (!productType) {
    productType = cleanText(canonicalName);
  }

  return productType;
}

function normalizeConfidence(value) {
  const text = normalizeKey(value);
  if (text === "low" || text === "medium" || text === "high") return text;
  return "medium";
}

function normalizeNeedsReview(value) {
  const text = normalizeKey(value);
  if (text === "1" || text === "true" || text === "yes") return "1";
  return "0";
}

function extractWeightFromRawName(rawName) {
  const text = cleanText(rawName);
  if (!text) return null;

  const bundleMatch = text.match(
    /bundle of\s+\d+\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gm|mg|ml|cl|l|ltr|litre|liter)\b/i,
  );
  if (bundleMatch) {
    return normalizeWeightCandidate(bundleMatch[1], bundleMatch[2]);
  }

  const matches = Array.from(
    text.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|gm|mg|ml|cl|l|ltr|litre|liter)\b/gi),
  );
  if (matches.length === 0) return null;
  const match = matches[matches.length - 1];
  return normalizeWeightCandidate(match[1], match[2]);
}

function normalizeWeightCandidate(amountRaw, unitRaw) {
  const amount = Number(String(amountRaw).replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = String(unitRaw).toLowerCase();
  if (["kg"].includes(unit)) return { value: amount, unit: "kg" };
  if (["g", "gm"].includes(unit)) return { value: amount / 1000, unit: "kg" };
  if (unit === "mg") return { value: amount / 1000000, unit: "kg" };
  if (["l", "ltr", "litre", "liter"].includes(unit)) return { value: amount, unit: "l" };
  if (unit === "ml") return { value: amount / 1000, unit: "l" };
  if (unit === "cl") return { value: amount / 100, unit: "l" };
  return null;
}

function chooseCommonWeight(rawNames) {
  const candidates = rawNames
    .map((name) => extractWeightFromRawName(name))
    .filter(Boolean);

  if (candidates.length === 0) return { weight_kg: "", weight_unit: "" };

  const counts = new Map();
  for (const candidate of candidates) {
    const rounded = Number(candidate.value.toFixed(3));
    const key = `${candidate.unit}:${rounded}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const ranked = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return { weight_kg: "", weight_unit: "" };
  }

  const [key, count] = ranked[0];
  if (count === 1 && ranked.length >= 3) {
    return { weight_kg: "", weight_unit: "" };
  }

  const [unit, valueRaw] = key.split(":");
  return {
    weight_kg: String(Number(valueRaw)),
    weight_unit: unit,
  };
}

function normalizeAliases(value, canonicalName, productType) {
  const seen = new Set();
  const canonicalKey = normalizeKey(canonicalName);
  const productTypeKey = normalizeKey(productType);
  const out = [];

  for (const alias of splitPipe(value)) {
    const key = normalizeKey(alias);
    if (!key || key === canonicalKey || key === productTypeKey || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(alias);
  }

  return out;
}

function sanitizeCanonicalName(name, brand) {
  let canonicalName = stripNoise(name);
  const brandText = cleanText(brand);
  if (!canonicalName) canonicalName = brandText;
  if (brandText) {
    const canonKey = normalizeKey(canonicalName);
    const brandKey = normalizeKey(brandText);
    if (!canonKey.startsWith(brandKey)) {
      canonicalName = `${brandText} ${canonicalName}`.trim();
    }
  }
  return canonicalName.replace(/\s+/g, " ").trim();
}

function mergeConfidence(values) {
  let best = "high";
  for (const value of values) {
    const normalized = normalizeConfidence(value);
    if (CONFIDENCE_ORDER[normalized] < CONFIDENCE_ORDER[best]) best = normalized;
  }
  return best;
}

function parseCsvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error(`CSV has no data rows: ${filePath}`);
  }

  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = values[index] == null ? "" : values[index];
    }
    return row;
  });

  return rows;
}

function cleanupRows(rows) {
  const stats = {
    input_rows: rows.length,
    product_type_rederived: 0,
    category_rederived: 0,
    canonical_name_prefixed_with_brand: 0,
    weight_recomputed: 0,
    merged_duplicates: 0,
    blank_model_rows_split: 0,
    empty_model_rows_dropped: 0,
    remaining_needs_review: 0,
  };

  const merged = new Map();

  for (const sourceRow of rows) {
    const sourceCanonical = cleanText(sourceRow.canonical_name);
    const sourceBrand = cleanText(sourceRow.brand);
    const sourceProductType = cleanText(sourceRow.product_type);
    const sourceRawNames = splitPipe(sourceRow.raw_names_matched);

    if (!sourceCanonical && !sourceBrand && !sourceProductType && sourceRawNames.length === 0) {
      stats.empty_model_rows_dropped += 1;
      continue;
    }

    if (!sourceCanonical && !sourceBrand && !sourceProductType && sourceRawNames.length > 0) {
      for (const rawName of sourceRawNames) {
        const canonicalName = stripNoise(rawName) || rawName;
        const cleaned = {
          canonical_name: canonicalName,
          brand: "",
          product_type: canonicalName,
          variant: "",
          category: inferCategory(rawName),
          weight_kg: "",
          weight_unit: "",
          aliases: [],
          ai_confidence: "low",
          needs_review: "1",
          review_note:
            cleanText(sourceRow.review_note) || "Batch output missing canonical fields",
          raw_names_matched: [rawName],
        };
        const mergeKey = `raw|${normalizeKey(rawName)}`;
        if (!merged.has(mergeKey)) {
          merged.set(mergeKey, cleaned);
        }
        stats.blank_model_rows_split += 1;
      }
      continue;
    }

    const brand = cleanText(sourceRow.brand);
    const variant = normalizeVariant(sourceRow.variant);

    let canonicalName = sanitizeCanonicalName(sourceRow.canonical_name, brand);
    if (brand && !normalizeKey(cleanText(sourceRow.canonical_name)).startsWith(normalizeKey(brand))) {
      stats.canonical_name_prefixed_with_brand += 1;
    }

    let productType = deriveProductType(sourceRow, canonicalName, brand, variant);
    if (productType !== cleanText(sourceRow.product_type)) {
      stats.product_type_rederived += 1;
    }

    let category = normalizeCategory(sourceRow.category);
    const inferredCategory = inferCategory(
      canonicalName,
      productType,
      sourceRow.aliases,
      sourceRow.raw_names_matched,
    );

    if (!category || category === "Other") {
      if (inferredCategory !== category) stats.category_rederived += 1;
      category = inferredCategory;
    }

    if (!category) {
      category = "Other";
      stats.category_rederived += 1;
    }

    const aliases = normalizeAliases(sourceRow.aliases, canonicalName, productType);
    const rawNames = sourceRawNames;
    const commonWeight = chooseCommonWeight(rawNames);
    if (commonWeight.weight_kg || commonWeight.weight_unit) {
      stats.weight_recomputed += 1;
    }

    const reviewNote = cleanText(sourceRow.review_note);
    const cleaned = {
      canonical_name: canonicalName,
      brand,
      product_type: productType,
      variant,
      category,
      weight_kg: commonWeight.weight_kg,
      weight_unit: commonWeight.weight_unit,
      aliases,
      ai_confidence: normalizeConfidence(sourceRow.ai_confidence),
      needs_review: normalizeNeedsReview(sourceRow.needs_review),
      review_note: normalizeNeedsReview(sourceRow.needs_review) === "1" ? reviewNote : "",
      raw_names_matched: rawNames,
    };

    const mergeKey = [
      normalizeKey(cleaned.canonical_name),
      normalizeKey(cleaned.brand),
    ].join("|");

    if (!merged.has(mergeKey)) {
      merged.set(mergeKey, cleaned);
      continue;
    }

    const existing = merged.get(mergeKey);
    existing.aliases = Array.from(new Set([...existing.aliases, ...cleaned.aliases]));
    existing.raw_names_matched = Array.from(
      new Set([...existing.raw_names_matched, ...cleaned.raw_names_matched]),
    );
    existing.ai_confidence = mergeConfidence([existing.ai_confidence, cleaned.ai_confidence]);
    existing.needs_review =
      existing.needs_review === "1" || cleaned.needs_review === "1" ? "1" : "0";
    existing.review_note = Array.from(
      new Set([existing.review_note, cleaned.review_note].filter(Boolean)),
    ).join(" | ");
    existing.category = existing.category === "Other" ? cleaned.category : existing.category;
    existing.weight_kg = existing.weight_kg || cleaned.weight_kg;
    existing.weight_unit = existing.weight_unit || cleaned.weight_unit;
    stats.merged_duplicates += 1;
  }

  const cleanedRows = Array.from(merged.values())
    .map((row) => {
      const commonWeight = chooseCommonWeight(row.raw_names_matched);
      row.weight_kg = commonWeight.weight_kg;
      row.weight_unit = commonWeight.weight_unit;
      if (row.needs_review === "1") stats.remaining_needs_review += 1;
      return row;
    })
    .sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

  return { cleanedRows, stats };
}

function buildReviewRows(rows) {
  return rows.filter((row) => {
    if (row.needs_review === "1") return true;
    if (!row.category || !CATEGORY_SET.has(row.category)) return true;
    if (!row.product_type || CATEGORY_SET.has(row.product_type)) return true;
    return false;
  });
}

function writeCsv(filePath, rows) {
  const lines = [OUTPUT_HEADER.join(",")];
  for (const row of rows) {
    const values = [
      row.canonical_name,
      row.brand,
      row.product_type,
      row.variant,
      row.category,
      row.weight_kg,
      row.weight_unit,
      Array.isArray(row.aliases) ? row.aliases.join("|") : row.aliases,
      row.ai_confidence,
      row.needs_review,
      row.review_note,
      Array.isArray(row.raw_names_matched)
        ? row.raw_names_matched.join("|")
        : row.raw_names_matched,
    ];
    lines.push(values.map(toCsvCell).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const inputPath = path.resolve(getArg("--input", INPUT_DEFAULT));
  const outputPath = path.resolve(
    getArg(
      "--output",
      inputPath.replace(/\.csv$/i, ".cleaned.csv"),
    ),
  );
  const reviewPath = path.resolve(
    getArg(
      "--review-output",
      inputPath.replace(/\.csv$/i, ".review.csv"),
    ),
  );
  const reportPath = path.resolve(
    getArg(
      "--report-output",
      inputPath.replace(/\.csv$/i, ".cleanup-report.json"),
    ),
  );

  const rows = parseCsvFile(inputPath);
  const { cleanedRows, stats } = cleanupRows(rows);
  const reviewRows = buildReviewRows(cleanedRows);

  writeCsv(outputPath, cleanedRows);
  writeCsv(reviewPath, reviewRows);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...stats,
        output_rows: cleanedRows.length,
        review_rows: reviewRows.length,
        output_path: outputPath,
        review_path: reviewPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Input rows: ${stats.input_rows}`);
  console.log(`Output rows: ${cleanedRows.length}`);
  console.log(`Review rows: ${reviewRows.length}`);
  console.log(`Cleaned CSV: ${outputPath}`);
  console.log(`Review CSV: ${reviewPath}`);
  console.log(`Report: ${reportPath}`);
}

main();
