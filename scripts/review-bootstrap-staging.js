"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath || filePath.startsWith("--")) {
      console.error("--db-file requires a path, e.g. --db-file ./data/prod_local.db");
      process.exit(1);
    }
    const abs = path.resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url =
    process.env.DESI_DEALS_DB_TURSO_DATABASE_URL ||
    process.env.TURSO_DATABASE_URL;
  const authToken =
    process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN ||
    process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error(
      "ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set."
    );
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getConfidenceColor(confidence) {
  if (confidence === null || confidence === undefined)
    return "rgba(200, 200, 200, 0.3)";
  if (confidence >= 0.9) return "rgba(144, 238, 144, 0.4)"; // green
  if (confidence >= 0.7) return "rgba(255, 255, 0, 0.3)"; // yellow
  return "rgba(255, 99, 71, 0.3)"; // red
}

function getConfidenceLabel(confidence) {
  if (confidence === null || confidence === undefined) return "unknown";
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

async function main() {
  const client = getClient();

  try {
    const sql = `
SELECT
  s.id, s.canonical_name, s.brand, s.product_type, s.variant,
  s.category, s.weight_kg, s.weight_unit, s.aliases,
  s.ai_confidence, s.review_note,
  GROUP_CONCAT(sp.raw_product_name, ' | ') AS raw_names,
  GROUP_CONCAT(sp.store_name, ' | ') AS stores,
  COUNT(sp.id) AS source_count
FROM canonical_bootstrap_staging s
LEFT JOIN canonical_bootstrap_source_products sp ON sp.staging_id = s.id
WHERE s.needs_review = 1 AND s.promoted = 0
GROUP BY s.id
ORDER BY s.ai_confidence ASC, s.category, s.canonical_name
    `;

    const response = await client.execute(sql);
    const rows = response.rows || [];

    if (rows.length === 0) {
      console.log("No flagged rows to review. All staging rows have needs_review = 0.");
      process.exit(0);
    }

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bootstrap Staging Review</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 100%;
      background: white;
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }
    h1 {
      margin-bottom: 10px;
      color: #333;
    }
    .instructions {
      background: #f9f9f9;
      border-left: 4px solid #0066cc;
      padding: 15px;
      margin: 20px 0;
      font-size: 14px;
      line-height: 1.6;
    }
    .instructions code {
      background: #e0e0e0;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: "Monaco", "Courier New", monospace;
    }
    .instructions h3 {
      margin-top: 10px;
      margin-bottom: 5px;
      color: #0066cc;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      font-size: 13px;
    }
    th {
      background: #333;
      color: white;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      border: 1px solid #ddd;
    }
    td {
      padding: 12px;
      border: 1px solid #ddd;
      vertical-align: top;
    }
    tr:hover {
      background: #f0f0f0;
    }
    .confidence-label {
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 3px;
      display: inline-block;
    }
    .confidence-label.high { background: rgba(34, 139, 34, 0.3); color: #228b22; }
    .confidence-label.medium { background: rgba(184, 134, 11, 0.3); color: #b8860b; }
    .confidence-label.low { background: rgba(178, 34, 34, 0.3); color: #b22222; }
    .stats {
      margin: 20px 0;
      font-size: 14px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bootstrap Staging Review</h1>
    <p>Generated: ${new Date().toISOString()}</p>

    <div class="instructions">
      <h3>Instructions</h3>
      <p><strong>To approve a row:</strong> Set <code>needs_review = 0</code> in the database</p>
      <p style="margin-top: 8px;">Example: <code>UPDATE canonical_bootstrap_staging SET needs_review = 0 WHERE id = 123;</code></p>

      <p style="margin-top: 8px;"><strong>To delete a row:</strong> Delete from both staging and source_products tables</p>
      <p style="margin-top: 8px;">Example:
        <div style="margin-top: 4px; margin-left: 16px; background: #e8e8e8; padding: 8px; border-radius: 3px;">
          DELETE FROM canonical_bootstrap_source_products WHERE staging_id = 123;<br>
          DELETE FROM canonical_bootstrap_staging WHERE id = 123;
        </div>
      </p>

      <p style="margin-top: 8px;"><strong>Color coding:</strong> Green = high confidence (≥0.90), Yellow = medium (0.70–0.89), Red = low (&lt;0.70)</p>
    </div>

    <div class="stats">
      <strong>Total flagged rows:</strong> ${rows.length}
    </div>

    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Canonical Name</th>
          <th>Brand</th>
          <th>Product Type</th>
          <th>Variant</th>
          <th>Category</th>
          <th>Weight</th>
          <th>Confidence</th>
          <th>Aliases</th>
          <th>Review Note</th>
          <th>Raw Names (Sources)</th>
          <th>Stores</th>
          <th>Source Count</th>
        </tr>
      </thead>
      <tbody>
`;

    rows.forEach((row) => {
      let confidence = null;
      if (row.ai_confidence !== null && row.ai_confidence !== undefined) {
        const val = parseFloat(row.ai_confidence);
        if (!isNaN(val)) {
          confidence = val;
        }
      }
      const confidenceLabel = getConfidenceLabel(confidence);
      const bgColor = getConfidenceColor(confidence);
      const weight = row.weight_kg
        ? `${row.weight_kg}${row.weight_unit || ""}`
        : "";

      html += `        <tr style="background-color: ${bgColor};">
          <td>${escapeHtml(row.id)}</td>
          <td><strong>${escapeHtml(row.canonical_name)}</strong></td>
          <td>${escapeHtml(row.brand)}</td>
          <td>${escapeHtml(row.product_type)}</td>
          <td>${escapeHtml(row.variant)}</td>
          <td>${escapeHtml(row.category)}</td>
          <td>${escapeHtml(weight)}</td>
          <td>
            <span class="confidence-label ${confidenceLabel}">
              ${confidence !== null ? confidence.toFixed(2) : "N/A"} (${confidenceLabel})
            </span>
          </td>
          <td>${escapeHtml(row.aliases)}</td>
          <td>${escapeHtml(row.review_note)}</td>
          <td>${escapeHtml(row.raw_names)}</td>
          <td>${escapeHtml(row.stores)}</td>
          <td>${escapeHtml(row.source_count)}</td>
        </tr>
`;
    });

    html += `      </tbody>
    </table>
  </div>
</body>
</html>
`;

    const outputPath = path.resolve("data/bootstrap-review.html");
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, html, "utf-8");

    console.log(`✓ Saved: data/bootstrap-review.html (${rows.length} rows)`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
