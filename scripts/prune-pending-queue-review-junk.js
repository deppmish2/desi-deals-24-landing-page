"use strict";

const fs = require("node:fs");
const path = require("node:path");

const INPUT_DEFAULT = path.resolve(
  __dirname,
  "../logs/openai-pending-queue-batches/batch_69e213c0cf588190af42bc1e2e086292.combined.cleaned.csv",
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

const PRUNE_RULES = [
  {
    reason: "electronics_accessories",
    patterns: [
      "keyboard",
      "camera",
      "speaker",
      "charger",
      "smart watch",
      "watch",
      "phone holder",
      "carplay",
      "data cable",
      "usb",
      "headset",
      "bluetooth",
      "portable storage bag",
      "backpack",
      "crossbody",
      "bracelet",
      "durag",
      "diaper bag",
    ],
  },
  {
    reason: "home_decor_art",
    patterns: [
      "sculpture",
      "canvas",
      "wall art",
      "painting",
      "art work",
      "cusion cover",
      "cushion cover",
      "decorative posters",
      "deer head",
      "resin leopard statue",
      "statue decor",
      "book nook",
    ],
  },
  {
    reason: "toys_sports_tools",
    patterns: [
      "building blocks",
      "puzzle toy",
      "cricket bat",
      "camping stove",
      "wheel tires",
      "car racer",
    ],
  },
  {
    reason: "voucher_or_placeholder",
    patterns: [
      "gutschein",
      "eco friendly other",
      "charmfixer other",
    ],
  },
  {
    reason: "western_makeup_marketplace",
    patterns: [
      "eyeliner",
      "eyeshadow",
      "eye brow pencil",
      "brow creator",
      "palette",
      "style queen",
      "matte signature",
      "nyx",
      "l'oreal",
      "positivi tea",
      "pflegelack",
    ],
  },
];

const KEEP_KEYWORDS = [
  "pooja",
  "puja",
  "diya",
  "toran",
  "ganesha",
  "ganesh",
  "kalash",
  "hanuman chalisa",
  "shivling",
  "nandi",
  "incense",
  "agarbatti",
  "murti",
  "mitti diya",
  "rakhi",
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

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    for (let index = 0; index < header.length; index += 1) {
      row[header[index]] = values[index] || "";
    }
    return row;
  });
}

function writeCsv(filePath, rows) {
  const lines = [HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      HEADER.map((column) => toCsvCell(row[column] || "")).join(","),
    );
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function classifyPrune(row) {
  if (String(row.needs_review || "") !== "1") return null;

  const haystack = [
    row.canonical_name,
    row.brand,
    row.product_type,
    row.review_note,
    row.raw_names_matched,
  ]
    .join(" ")
    .toLowerCase();

  if (KEEP_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
    return null;
  }

  for (const rule of PRUNE_RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      return rule.reason;
    }
  }

  return null;
}

function main() {
  const inputPath = path.resolve(getArg("--input", INPUT_DEFAULT));
  const outputPath = path.resolve(
    getArg("--output", inputPath.replace(/\.csv$/i, ".pruned.csv")),
  );
  const rejectedPath = path.resolve(
    getArg("--rejected-output", inputPath.replace(/\.csv$/i, ".rejected-junk.csv")),
  );
  const reportPath = path.resolve(
    getArg("--report-output", inputPath.replace(/\.csv$/i, ".prune-report.json")),
  );

  const rows = readCsv(inputPath);
  const kept = [];
  const rejected = [];
  const reasons = {};

  for (const row of rows) {
    const reason = classifyPrune(row);
    if (!reason) {
      kept.push(row);
      continue;
    }

    rejected.push({
      ...row,
      review_note: row.review_note
        ? `${row.review_note} | pruned_reason=${reason}`
        : `pruned_reason=${reason}`,
    });
    reasons[reason] = (reasons[reason] || 0) + 1;
  }

  writeCsv(outputPath, kept);
  writeCsv(rejectedPath, rejected);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        input_rows: rows.length,
        kept_rows: kept.length,
        rejected_rows: rejected.length,
        rejected_breakdown: reasons,
        output_path: outputPath,
        rejected_path: rejectedPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Input rows: ${rows.length}`);
  console.log(`Kept rows: ${kept.length}`);
  console.log(`Rejected junk rows: ${rejected.length}`);
  console.log(`Pruned CSV: ${outputPath}`);
  console.log(`Rejected CSV: ${rejectedPath}`);
  console.log(`Report: ${reportPath}`);
}

main();
