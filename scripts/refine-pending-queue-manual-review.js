"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INPUT_DEFAULT = path.resolve(
  __dirname,
  "../logs/openai-pending-queue-batches/batch_69e213c0cf588190af42bc1e2e086292.combined.cleaned.pruned.csv",
);

const HEADER = [
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

const CATEGORY_FIX_KEYWORDS = [
  ["Pooja & Incense", ["pooja", "puja", "diya", "toran", "rakhi", "ganesha", "ganesh", "hanuman", "kalash", "janoi", "janeu", "shivling", "nandi", "agarbatti", "sindoor", "chowki", "choki", "hawan", "chalisa", "thali", "samagri", "rangoli"]],
  ["Other", ["cream", "conditioner", "comb", "brush", "hair", "bag", "watch", "projector", "power bank", "device", "keyboard", "mouse", "organizer", "earphone", "phone", "desk", "humidifier"]],
  ["Ready Meals & Mixes", ["mixture", "mix", "roll"]],
  ["Snacks & Namkeen", ["cookies", "bhel", "papad", "biji"]],
  ["Condiments & Sauces", ["curry paste", "corned beef"]],
];

const SAFE_CLEAR_KEYWORDS = [
  "pooja",
  "puja",
  "diya",
  "toran",
  "rakhi",
  "ganesha",
  "ganesh",
  "hanuman",
  "kalash",
  "janoi",
  "janeu",
  "agarbatti",
  "sindoor",
  "chowki",
  "choki",
  "hawan",
  "chalisa",
  "thali",
  "samagri",
  "rangoli",
  "cookies",
  "bhel",
  "papad",
  "biji",
  "mixture",
  "curry paste",
  "corned beef",
  "conditioner",
  "cream",
  "balm",
  "beef",
  "roll",
  "thread",
  "agarbatti",
  "rice",
  "beans",
  "peas",
];

const REJECT_STILL_JUNK = [
  "gym bag",
  "hair brush",
  "hair comb",
  "hair straightener",
  "height adjustable desk",
  "humidifier",
  "luxe travel crib bag",
  "ludo",
  "dinner plates",
  "mouse wrist pad",
  "motorcycle hip leg bag",
  "organizer",
  "portable projector",
  "power bank",
  "device",
  "liquid thorn earphone case",
  "bag",
  "watch",
  "keyboard",
  "projector",
  "mouse pad",
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
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
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

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = values[i] || "";
    }
    return row;
  });
}

function writeCsv(filePath, rows) {
  const lines = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(HEADER.map((column) => toCsvCell(row[column] || "")).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function haystack(row) {
  return [
    row.canonical_name,
    row.brand,
    row.product_type,
    row.category,
    row.review_note,
    row.raw_names_matched,
  ]
    .join(" ")
    .toLowerCase();
}

function fixCategory(row) {
  const text = haystack(row);
  for (const [category, keywords] of CATEGORY_FIX_KEYWORDS) {
    if (keywords.some((keyword) => text.includes(keyword))) {
      row.category = category;
      return true;
    }
  }
  return false;
}

function noteIsBrandOnly(note) {
  const value = String(note || "").toLowerCase().trim();
  return [
    "brand is unrecognisable as any known grocery brand",
    "brand unclear",
    "brand unclear or unrecognizable",
    "unrecognizable brand",
  ].includes(value);
}

function shouldRejectAsJunk(row) {
  const text = haystack(row);
  return REJECT_STILL_JUNK.some((keyword) => text.includes(keyword));
}

function shouldAutoClear(row) {
  if (String(row.needs_review) !== "1") return false;
  const text = haystack(row);

  if (row.review_note === "Batch output missing canonical fields") {
    return false;
  }

  if (!noteIsBrandOnly(row.review_note)) {
    return false;
  }

  if (SAFE_CLEAR_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return true;
  }

  if (row.brand && row.brand.length >= 2 && row.canonical_name && row.product_type) {
    if (
      row.category !== "Other" &&
      !shouldRejectAsJunk(row)
    ) {
      return true;
    }
  }

  return false;
}

function main() {
  const inputPath = path.resolve(getArg("--input", INPUT_DEFAULT));
  const outputPath = path.resolve(
    getArg("--output", inputPath.replace(/\.csv$/i, ".refined.csv")),
  );
  const manualReviewPath = path.resolve(
    getArg("--manual-review-output", inputPath.replace(/\.csv$/i, ".manual-review.csv")),
  );
  const rejectedPath = path.resolve(
    getArg("--rejected-output", inputPath.replace(/\.csv$/i, ".refined-rejected.csv")),
  );
  const reportPath = path.resolve(
    getArg("--report-output", inputPath.replace(/\.csv$/i, ".refine-report.json")),
  );

  const rows = readCsv(inputPath);
  const refined = [];
  const manualReview = [];
  const rejected = [];
  const stats = {
    input_rows: rows.length,
    category_fixed: 0,
    auto_cleared_review: 0,
    rejected_as_junk: 0,
    manual_review_rows: 0,
  };

  for (const row of rows) {
    const next = { ...row };

    if (fixCategory(next)) {
      stats.category_fixed += 1;
    }

    if (shouldRejectAsJunk(next)) {
      next.review_note = next.review_note
        ? `${next.review_note} | refined_reject=junk`
        : "refined_reject=junk";
      rejected.push(next);
      stats.rejected_as_junk += 1;
      continue;
    }

    if (shouldAutoClear(next)) {
      next.needs_review = "0";
      next.review_note = "";
      stats.auto_cleared_review += 1;
    }

    refined.push(next);
    if (next.needs_review === "1") {
      manualReview.push(next);
    }
  }

  stats.output_rows = refined.length;
  stats.manual_review_rows = manualReview.length;

  writeCsv(outputPath, refined);
  writeCsv(manualReviewPath, manualReview);
  writeCsv(rejectedPath, rejected);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ...stats,
        output_path: outputPath,
        manual_review_path: manualReviewPath,
        rejected_path: rejectedPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Input rows: ${rows.length}`);
  console.log(`Output rows: ${refined.length}`);
  console.log(`Auto-cleared review rows: ${stats.auto_cleared_review}`);
  console.log(`Rejected as junk: ${stats.rejected_as_junk}`);
  console.log(`Manual review rows: ${manualReview.length}`);
  console.log(`Refined CSV: ${outputPath}`);
  console.log(`Manual review CSV: ${manualReviewPath}`);
  console.log(`Rejected CSV: ${rejectedPath}`);
  console.log(`Report: ${reportPath}`);
}

main();
