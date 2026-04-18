"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_INPUT = path.resolve(__dirname, "../data/pending-queue.csv");
const OUTPUT_DIR = path.resolve(__dirname, "../logs/openai-pending-queue-batches");
const BATCH_SIZE = 25;
const MODEL = "gpt-4o-mini";
const API_BASE_URL = "https://api.openai.com/v1";
const COMPLETION_WINDOW = "24h";

const OUTPUT_HEADER =
  "canonical_name,brand,product_type,variant,category,weight_kg,weight_unit,aliases,ai_confidence,needs_review,review_note,raw_names_matched";

const SYSTEM_PROMPT = `You are a grocery product catalogue expert specialising in Indian grocery products sold in Germany. Your task is to extract structured canonical product records from raw product names scraped from Indian grocery store websites.

════════════════════════════════════════
IDENTITY RULES — non-negotiable
════════════════════════════════════════

RULE 1 — BRAND: Different brands are ALWAYS different canonical products.
"MDH Toor Dal" and "TRS Toor Dal" MUST NEVER be merged into one canonical.
"Heera" and "TRS" and "East End" are different brands even if the product type is identical. If no brand is detectable, set brand to null — do not invent one.

RULE 2 — VARIANT: The following words define a genuinely distinct product.
Never strip them, never treat them as mere qualifiers:
  whole, split, hulled, dehulled, washed, polished, roasted, puffed, pressed,
  popped, flaked, beaten, organic, aged, smoked, raw, cooked, dried, freeze-dried,
  extra-fine, coarse, medium, fine, strong, mild, light, dark, double-cream
"Whole Urad Dal" and "Split Urad Dal" are two different canonical products.
"Fine Semolina" and "Coarse Semolina" are two different canonical products.

RULE 3 — WEIGHT IS NOT IDENTITY: A 500g and a 1kg pack of the same product are the SAME canonical. Weight is a packaging variant, not product identity.
Set weight_kg to the most common weight seen in the input for that product, or leave empty if weights vary widely. Do not create separate canonicals per weight.

RULE 4 — PACKAGING IS NOT IDENTITY: pouch, bag, box, tin, can, jar, bottle, sachet, carton, tub — ignore these entirely when determining identity.

RULE 5 — ALIASES: Capture every spelling variant, transliteration and common English synonym you are confident about. Be generous — aliases directly improve matching quality. Examples:
  "Toor Dal" → Arhar Dal|Tuvar Dal|Toovar Dal|Tuar Dal|Pigeon Pea Lentils|Yellow Pigeon Peas
  "Besan"    → Gram Flour|Chickpea Flour|Chana Flour|Bengal Gram Flour
  "Rava"     → Sooji|Suji|Semolina
Do NOT hallucinate aliases you are not confident about. Accuracy over coverage.

RULE 6 — ALL PRODUCTS: Assign every product to the best-fitting category regardless of cuisine origin. German staples, European brands, cleaning products, cosmetics — pick the most accurate category from the list. Use "Other" only when genuinely no other category fits.

════════════════════════════════════════
CONFIDENCE & REVIEW RULES
════════════════════════════════════════

Set ai_confidence to:
  high   — brand clearly identifiable AND product type unambiguous
  medium — brand detectable but uncertain, OR product type has some ambiguity
  low    — brand unclear OR product name heavily transliterated OR
           product type ambiguous OR name contains unrecognised words

Set needs_review to 1 ONLY if ANY of:
  - Brand is unrecognisable as any known grocery brand
  - Product name is in non-Latin script (Devanagari, Bengali, etc.)
  - Product name is so heavily transliterated you are uncertain of the product
  - The name contains words you genuinely do not recognise
Otherwise needs_review = 0.

Do NOT set needs_review=1 for:
  - Category choice (always pick the best fit)
  - Non-Indian or non-Asian products (assign best category, no review needed)

════════════════════════════════════════
CATEGORY — assign the single best fit
════════════════════════════════════════

Always assign a category. If ambiguous between two, pick the most likely one.
Use "Other" only when genuinely no other category fits.

  Lentils & Pulses
  Rice & Grains
  Flour & Semolina
  Spices & Masalas
  Oils & Ghee
  Pickles & Chutneys
  Snacks & Namkeen
  Sweets & Mithai
  Dairy & Paneer
  Frozen Foods
  Ready Meals & Mixes
  Fresh Produce
  Condiments & Sauces
  Pooja & Incense
  Other

════════════════════════════════════════
OUTPUT FORMAT — critical
════════════════════════════════════════

Return ONLY valid CSV. No markdown, no backticks, no prose, no explanation.
First line MUST be this exact header row:
${OUTPUT_HEADER}

One row per canonical product. Rules:
- Fields containing commas or quotes MUST be wrapped in double-quotes
- A double-quote inside a quoted field is escaped as two double-quotes ("")
- Empty/null fields = empty string (nothing between the commas)
- aliases: pipe-separated list of alternate names, e.g. Arhar Dal|Tuvar Dal
- raw_names_matched: pipe-separated list of EXACT input lines that map to this canonical
- needs_review: 0 or 1 (integer)
- weight_kg: decimal number or empty

GROUPING RULE: Multiple input lines may map to the same canonical. Group them — one output row per canonical product. List all matched input lines in raw_names_matched.
Do NOT produce one row per input line.
Do NOT produce separate rows for the same product at different weights.`;

function ensureOutputDir() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function usage() {
  console.log(`Usage:
  node scripts/process-pending-queue-openai-batch.js prepare [--input path]
  node scripts/process-pending-queue-openai-batch.js submit [--input path]
  node scripts/process-pending-queue-openai-batch.js status --batch-id batch_...
  node scripts/process-pending-queue-openai-batch.js download --batch-id batch_...
  node scripts/process-pending-queue-openai-batch.js wait --batch-id batch_... [--interval-sec 60]
`);
}

function getArg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function requireApiKey() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing. Add it to your environment or .env.local.");
  }
  return apiKey;
}

function parseCsvLine(line) {
  const cells = [];
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
      cells.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  cells.push(current);
  return cells;
}

function readPendingQueue(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error(`Input CSV is empty: ${inputPath}`);
  }

  const header = parseCsvLine(lines[0]);
  const productNameIndex = header.indexOf("product_name");
  if (productNameIndex === -1) {
    throw new Error("Input CSV must contain a product_name column.");
  }

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return {
      product_name: String(cells[productNameIndex] || "").trim(),
    };
  }).filter((row) => row.product_name);
}

function normalizeClusterKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\bexp\b.*$/g, " ")
    .replace(/\bbest before\b.*$/g, " ")
    .replace(/\b(use by|expiry|expires?)\b.*$/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(\d+\s?(?:kg|g|gm|ml|l|ltr|litre|liter)|exp|best before)[^)]*\)/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\s?(?:kg|g|gm|mg|ml|cl|l|ltr|litre|liter)\b/g, " ")
    .replace(/\b\d+\s?(?:pcs|pc|piece|pieces)\b/g, " ")
    .replace(/[–—-]\s*$/g, " ")
    .replace(/[^\p{L}\p{N}\s/&()+-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clusterRows(rows) {
  const clusters = new Map();
  for (const row of rows) {
    const key = normalizeClusterKey(row.product_name) || row.product_name.toLowerCase();
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(row.product_name);
  }

  return Array.from(clusters.entries())
    .map(([key, names]) => ({
      key,
      names: Array.from(new Set(names)).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => {
      if (b.names.length !== a.names.length) return b.names.length - a.names.length;
      return a.key.localeCompare(b.key);
    });
}

function buildBatches(rows) {
  const clusters = clusterRows(rows);
  const batches = [];
  let current = [];
  let runningCount = 0;

  for (const cluster of clusters) {
    if (cluster.names.length > BATCH_SIZE) {
      for (let i = 0; i < cluster.names.length; i += BATCH_SIZE) {
        const slice = cluster.names.slice(i, i + BATCH_SIZE);
        if (current.length > 0) {
          batches.push(current.flatMap((entry) => entry.names));
          current = [];
          runningCount = 0;
        }
        batches.push(slice);
      }
      continue;
    }

    if (runningCount + cluster.names.length > BATCH_SIZE && current.length > 0) {
      batches.push(current.flatMap((entry) => entry.names));
      current = [];
      runningCount = 0;
    }

    current.push(cluster);
    runningCount += cluster.names.length;
  }

  if (current.length > 0) {
    batches.push(current.flatMap((entry) => entry.names));
  }

  return batches;
}

function buildUserPrompt(batchNames) {
  return [
    `Process the following ${batchNames.length} raw product names from pending-queue.csv.`,
    "Group equivalent weight or pack-size variants together when they refer to the same canonical product.",
    "Preserve exact raw input spellings in raw_names_matched.",
    "",
    "Input lines:",
    ...batchNames.map((name) => `- ${name}`),
  ].join("\n");
}

function preparePayload(inputPath) {
  ensureOutputDir();

  const rows = readPendingQueue(inputPath);
  const batches = buildBatches(rows);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const jsonlPath = path.join(OUTPUT_DIR, `pending-queue-${timestamp}.jsonl`);
  const manifestPath = path.join(OUTPUT_DIR, `pending-queue-${timestamp}.manifest.json`);

  const requests = batches.map((batchNames, index) => {
    const customId = `pending-queue-${dateStamp}-batch${String(index + 1).padStart(4, "0")}`;
    return {
      custom_id: customId,
      method: "POST",
      url: "/v1/chat/completions",
      body: {
        model: MODEL,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(batchNames) },
        ],
      },
    };
  });

  fs.writeFileSync(
    jsonlPath,
    requests.map((request) => JSON.stringify(request)).join("\n") + "\n",
    "utf8",
  );

  const manifest = {
    created_at: new Date().toISOString(),
    input_csv: inputPath,
    batch_size: BATCH_SIZE,
    model: MODEL,
    endpoint: "/v1/chat/completions",
    request_count: requests.length,
    product_count: rows.length,
    jsonl_path: jsonlPath,
    requests: requests.map((request, index) => ({
      custom_id: request.custom_id,
      item_count: batches[index].length,
      raw_names: batches[index],
    })),
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  return { rows, batches, requests, jsonlPath, manifestPath, manifest };
}

async function apiFetch(urlPath, options = {}) {
  const apiKey = requireApiKey();
  const response = await fetch(`${API_BASE_URL}${urlPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API ${urlPath} failed (${response.status}): ${errorText}`);
  }

  return response;
}

async function uploadBatchFile(jsonlPath) {
  const fileBuffer = fs.readFileSync(jsonlPath);
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([fileBuffer], { type: "application/jsonl" }), path.basename(jsonlPath));

  const response = await apiFetch("/files", {
    method: "POST",
    body: form,
  });

  return response.json();
}

async function createBatch(inputFileId) {
  const response = await apiFetch("/batches", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: "/v1/chat/completions",
      completion_window: COMPLETION_WINDOW,
      metadata: {
        source: "pending-queue.csv",
        model: MODEL,
        batch_size: String(BATCH_SIZE),
      },
    }),
  });

  return response.json();
}

function updateManifest(manifestPath, patch) {
  const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const next = { ...current, ...patch };
  fs.writeFileSync(manifestPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function getManifestPathForBatch(batchId) {
  const files = fs.existsSync(OUTPUT_DIR) ? fs.readdirSync(OUTPUT_DIR) : [];
  for (const file of files) {
    if (!file.endsWith(".manifest.json")) continue;
    const manifestPath = path.join(OUTPUT_DIR, file);
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (manifest.batch_id === batchId) return manifestPath;
    } catch (_) {
      // Ignore malformed manifests while scanning.
    }
  }
  return null;
}

async function getBatch(batchId) {
  const response = await apiFetch(`/batches/${batchId}`, { method: "GET" });
  return response.json();
}

async function downloadFile(fileId, targetPath) {
  const response = await apiFetch(`/files/${fileId}/content`, { method: "GET" });
  const text = await response.text();
  fs.writeFileSync(targetPath, text, "utf8");
  return targetPath;
}

function parseBatchOutputFile(outputPath) {
  const raw = fs.readFileSync(outputPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .filter(Boolean);

  return lines.map((line) => JSON.parse(line));
}

function extractAssistantText(result) {
  const choices = result?.response?.body?.choices;
  if (Array.isArray(choices) && choices[0]?.message?.content) {
    return String(choices[0].message.content).trim();
  }

  if (result?.response?.body?.output_text) {
    return String(result.response.body.output_text).trim();
  }

  return "";
}

function combineCsvOutputs(results) {
  const chunks = [];

  for (const result of results) {
    if (result.error) continue;
    const text = extractAssistantText(result);
    if (!text) continue;

    const lines = text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) continue;
    if (lines[0].trim() === OUTPUT_HEADER) {
      chunks.push(lines.slice(1).join("\n"));
    } else {
      chunks.push(lines.join("\n"));
    }
  }

  return `${OUTPUT_HEADER}\n${chunks.filter(Boolean).join("\n")}\n`;
}

async function commandPrepare() {
  const inputPath = path.resolve(getArg("--input", DEFAULT_INPUT));
  const prepared = preparePayload(inputPath);
  console.log(`Prepared ${prepared.rows.length} products into ${prepared.requests.length} batch requests.`);
  console.log(`JSONL: ${prepared.jsonlPath}`);
  console.log(`Manifest: ${prepared.manifestPath}`);
}

async function commandSubmit() {
  const inputPath = path.resolve(getArg("--input", DEFAULT_INPUT));
  const prepared = preparePayload(inputPath);
  const uploadedFile = await uploadBatchFile(prepared.jsonlPath);
  const batch = await createBatch(uploadedFile.id);
  const manifest = updateManifest(prepared.manifestPath, {
    input_file_id: uploadedFile.id,
    batch_id: batch.id,
    batch_status: batch.status,
    batch_response: batch,
  });

  console.log(`Prepared ${prepared.rows.length} products into ${prepared.requests.length} batch requests.`);
  console.log(`Input file ID: ${uploadedFile.id}`);
  console.log(`Batch ID: ${batch.id}`);
  console.log(`Status: ${batch.status}`);
  console.log(`Manifest: ${prepared.manifestPath}`);
  if (manifest.request_count !== prepared.requests.length) {
    throw new Error("Manifest request count mismatch after submission.");
  }
}

async function commandStatus() {
  const batchId = getArg("--batch-id");
  if (!batchId) throw new Error("--batch-id is required for status.");
  const batch = await getBatch(batchId);
  const manifestPath = getManifestPathForBatch(batchId);
  if (manifestPath) {
    updateManifest(manifestPath, {
      batch_status: batch.status,
      batch_response: batch,
      output_file_id: batch.output_file_id || null,
      error_file_id: batch.error_file_id || null,
    });
  }
  console.log(JSON.stringify(batch, null, 2));
}

async function commandDownload() {
  const batchId = getArg("--batch-id");
  if (!batchId) throw new Error("--batch-id is required for download.");

  ensureOutputDir();
  const batch = await getBatch(batchId);
  const manifestPath = getManifestPathForBatch(batchId);

  if (!batch.output_file_id) {
    throw new Error(`Batch ${batchId} does not have an output_file_id yet. Current status: ${batch.status}`);
  }

  const outputPath = path.join(OUTPUT_DIR, `${batchId}.output.jsonl`);
  const combinedCsvPath = path.join(OUTPUT_DIR, `${batchId}.combined.csv`);

  await downloadFile(batch.output_file_id, outputPath);

  const results = parseBatchOutputFile(outputPath);
  const combinedCsv = combineCsvOutputs(results);
  fs.writeFileSync(combinedCsvPath, combinedCsv, "utf8");

  if (manifestPath) {
    updateManifest(manifestPath, {
      batch_status: batch.status,
      batch_response: batch,
      output_file_id: batch.output_file_id,
      error_file_id: batch.error_file_id || null,
      output_jsonl_path: outputPath,
      combined_csv_path: combinedCsvPath,
    });
  }

  if (batch.error_file_id) {
    const errorPath = path.join(OUTPUT_DIR, `${batchId}.errors.jsonl`);
    await downloadFile(batch.error_file_id, errorPath);
    if (manifestPath) {
      updateManifest(manifestPath, {
        error_jsonl_path: errorPath,
      });
    }
    console.log(`Errors: ${errorPath}`);
  }

  console.log(`Output JSONL: ${outputPath}`);
  console.log(`Combined CSV: ${combinedCsvPath}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function commandWait() {
  const batchId = getArg("--batch-id");
  if (!batchId) throw new Error("--batch-id is required for wait.");
  const intervalSec = Number(getArg("--interval-sec", "60"));

  while (true) {
    const batch = await getBatch(batchId);
    const requestCounts = batch.request_counts || {};
    console.log(
      JSON.stringify({
        id: batch.id,
        status: batch.status,
        completed: requestCounts.completed || 0,
        failed: requestCounts.failed || 0,
        total: requestCounts.total || 0,
        output_file_id: batch.output_file_id || null,
        error_file_id: batch.error_file_id || null,
      }),
    );

    if (["completed", "failed", "expired", "cancelled"].includes(batch.status)) {
      break;
    }

    await sleep(intervalSec * 1000);
  }
}

async function main() {
  const command = process.argv[2];
  if (!command || ["-h", "--help", "help"].includes(command)) {
    usage();
    process.exit(0);
  }

  if (command === "prepare") {
    await commandPrepare();
    return;
  }

  if (command === "submit") {
    await commandSubmit();
    return;
  }

  if (command === "status") {
    await commandStatus();
    return;
  }

  if (command === "download") {
    await commandDownload();
    return;
  }

  if (command === "wait") {
    await commandWait();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
