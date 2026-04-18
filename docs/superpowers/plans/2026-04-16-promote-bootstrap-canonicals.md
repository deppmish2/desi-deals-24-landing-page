# Promote Bootstrap Canonicals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review 450 flagged staging rows, wipe all old heuristic canonical data, and repopulate `canonical_products` + `deal_mappings` + `deals.canonical_id` from the 2,347 AI-bootstrapped canonicals.

**Architecture:** Three scripts share a `--db-file <path>` flag. When passed, they operate against a local SQLite file (`data/prod_local.db`) via libsql `file:` URL — no Turso connection needed. When omitted, they connect to production Turso. Workflow: run all scripts locally first to verify, then re-run against Turso. Each script defaults to dry-run; pass `--execute` to apply changes.

**Tech Stack:** Node.js CommonJS, `@libsql/client` (supports both `file:` and `libsql://` URLs), `better-sqlite3` (for initial file copy only).

---

## Current State

| Table | Rows | Action |
|---|---|---|
| `canonical_products` | 1,510 | WIPE (heuristic, bad quality) |
| `deal_mappings` | 3,893 | WIPE (derived from bad canonicals) |
| `entity_resolution_queue` | 11,888 | WIPE + rebuild (suggested_canonical_ids point to old canonicals) |
| `deals.canonical_id` | many non-NULL | NULL all out |
| `list_items.canonical_id` | some set | NULL all out |
| `price_alerts.canonical_id` | 2 rows | NULL all out |
| `product_groups` | 2,059 | LEAVE (no FK to canonical_products) |
| `canonical_bootstrap_staging` | 2,347 | SOURCE — promote needs_review=0 rows |
| `canonical_bootstrap_source_products` | 3,167 | SOURCE — link to deal_mappings |

**Staging breakdown:**
- `needs_review=0`: 1,897 rows (ready — high:1896, medium:1)
- `needs_review=1`: 450 rows (must review first — high:150, medium:248, low:52)

**Backup:** `data/prod.db` — full local snapshot taken 2026-04-16.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `scripts/review-bootstrap-staging.js` | Create | Export 450 flagged rows to `data/bootstrap-review.html` |
| `scripts/wipe-old-canonicals.js` | Create | Clear canonical data in FK-safe order; dry-run by default |
| `scripts/promote-bootstrap-staging.js` | Create | Insert staging → canonical_products, source_products → deal_mappings, update deals.canonical_id |

All three scripts share the same DB connection helper:
- `--db-file ./data/prod_local.db` → connects via `file:` URL (local SQLite)
- no flag → connects to production Turso via env vars

---

## Shared DB Connection Pattern

Every script resolves its DB connection the same way. Copy this block into each script:

```js
function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = require("path").resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error("ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set or not turso.io");
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}
```

---

## Task 1: Set up prod_local.db

- [ ] **Step 1: Copy prod.db to prod_local.db**

```bash
cp data/prod.db data/prod_local.db
```

- [ ] **Step 2: Verify it has the bootstrap staging data**

```bash
node -e "
const { createClient } = require('@libsql/client');
const c = createClient({ url: 'file:' + require('path').resolve('./data/prod_local.db') });
async function check() {
  const s = await c.execute('SELECT COUNT(*) as n FROM canonical_bootstrap_staging');
  const sp = await c.execute('SELECT COUNT(*) as n FROM canonical_bootstrap_source_products');
  const cp = await c.execute('SELECT COUNT(*) as n FROM canonical_products');
  console.log('staging:', s.rows[0].n, '(expect 2347)');
  console.log('source_products:', sp.rows[0].n, '(expect 3167)');
  console.log('canonical_products:', cp.rows[0].n, '(expect 1510)');
}
check().catch(e => console.error(e.message));
" 2>&1 | grep -v punycode | grep -v Deprecation | grep -v trace
```

Expected:
```
staging: 2347 (expect 2347)
source_products: 3167 (expect 3167)
canonical_products: 1510 (expect 1510)
```

---

## Task 2: Review script — export flagged staging rows

**Files:**
- Create: `scripts/review-bootstrap-staging.js`
- Output: `data/bootstrap-review.html`

- [ ] **Step 1: Create the script**

```js
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const fs = require("fs");
const path = require("path");

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = path.resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error("ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set.");
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  const client = getClient();

  const rows = await client.execute(`
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
  `);

  const total = rows.rows.length;
  const outPath = path.resolve("./data/bootstrap-review.html");

  const tableRows = rows.rows.map((r, i) => `
    <tr class="${r.ai_confidence}">
      <td>${i + 1}</td>
      <td><code>${r.id}</code></td>
      <td><strong>${escHtml(r.canonical_name)}</strong></td>
      <td>${escHtml(r.brand || "—")}</td>
      <td>${escHtml(r.product_type)}</td>
      <td>${escHtml(r.variant || "—")}</td>
      <td>${escHtml(r.category)}</td>
      <td>${r.weight_kg != null ? r.weight_kg + " " + (r.weight_unit || "") : "—"}</td>
      <td><span class="conf ${r.ai_confidence}">${r.ai_confidence}</span></td>
      <td>${escHtml(r.review_note || "—")}</td>
      <td class="sources">${escHtml((r.raw_names || "").replace(/\|/g, "\n"))}</td>
      <td>${escHtml(r.stores || "—")}</td>
      <td>${r.source_count}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Bootstrap Staging Review — ${total} flagged rows</title>
<style>
  body { font-family: system-ui; font-size: 13px; padding: 20px; }
  h1 { font-size: 18px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: #f5f5f5; position: sticky; top: 0; }
  tr.high { background: #f0fff0; }
  tr.medium { background: #fffbe6; }
  tr.low { background: #fff0f0; }
  .conf.high { color: green; font-weight: bold; }
  .conf.medium { color: orange; font-weight: bold; }
  .conf.low { color: red; font-weight: bold; }
  .sources { white-space: pre-wrap; max-width: 300px; font-size: 11px; }
  code { font-size: 11px; background: #eee; padding: 1px 3px; }
</style>
</head><body>
<h1>Bootstrap Staging Review — ${total} flagged rows</h1>
<p>Edit <code>data/prod_local.db</code> directly in DB Browser, or run SQL via:<br>
<code>node -e "require('./scripts/_db-exec.js')('UPDATE canonical_bootstrap_staging SET needs_review = 0 WHERE id = X')"</code></p>
<table>
<thead><tr>
  <th>#</th><th>ID</th><th>Canonical Name</th><th>Brand</th><th>Product Type</th>
  <th>Variant</th><th>Category</th><th>Weight</th><th>Conf</th>
  <th>Review Note</th><th>Raw Names</th><th>Stores</th><th>Srcs</th>
</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body></html>`;

  fs.writeFileSync(outPath, html);
  console.log(`✓ Saved: ${outPath} (${total} rows)`);
  console.log("  Open in browser, edit prod_local.db in DB Browser to approve/fix/delete rows.");
  console.log("  When done: node scripts/wipe-old-canonicals.js --db-file data/prod_local.db --dry-run");
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
```

- [ ] **Step 2: Run against prod_local.db**

```bash
node scripts/review-bootstrap-staging.js --db-file data/prod_local.db
```

- [ ] **Step 3: Open report and review in browser**

```bash
open data/bootstrap-review.html
```

Review each of the 450 flagged rows. Use DB Browser (open `data/prod_local.db`) to:
- **Approve**: set `needs_review = 0`
- **Delete**: delete the row
- **Edit**: fix `canonical_name`, `brand`, `category` directly

- [ ] **Step 4: Verify all flagged rows resolved in prod_local.db**

```bash
node -e "
const { createClient } = require('@libsql/client');
const c = createClient({ url: 'file:' + require('path').resolve('./data/prod_local.db') });
c.execute('SELECT COUNT(*) as n FROM canonical_bootstrap_staging WHERE needs_review = 1 AND promoted = 0')
  .then(r => console.log('Remaining flagged:', r.rows[0].n, '(expect 0)'))
  .catch(e => console.error(e.message));
" 2>&1 | grep -v punycode | grep -v Deprecation | grep -v trace
```

---

## Task 3: Wipe script

**Files:**
- Create: `scripts/wipe-old-canonicals.js`

- [ ] **Step 1: Create the script**

```js
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const path = require("path");

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = path.resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error("ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set.");
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

const isDryRun = !process.argv.includes("--execute");

async function main() {
  const client = getClient();
  console.log(`Mode: ${isDryRun ? "DRY RUN (add --execute to apply)" : "LIVE"}\n`);

  const n = async (sql) => (await client.execute(sql)).rows[0].c;

  const counts = {
    canonicals:   await n("SELECT COUNT(*) as c FROM canonical_products"),
    mappings:     await n("SELECT COUNT(*) as c FROM deal_mappings"),
    erq:          await n("SELECT COUNT(*) as c FROM entity_resolution_queue"),
    dealsLinked:  await n("SELECT COUNT(*) as c FROM deals WHERE canonical_id IS NOT NULL"),
    listLinked:   await n("SELECT COUNT(*) as c FROM list_items WHERE canonical_id IS NOT NULL"),
    alertsLinked: await n("SELECT COUNT(*) as c FROM price_alerts WHERE canonical_id IS NOT NULL"),
  };

  console.log("WILL WIPE:");
  console.log("  canonical_products:                ", counts.canonicals);
  console.log("  deal_mappings:                     ", counts.mappings);
  console.log("  entity_resolution_queue:           ", counts.erq);
  console.log("  deals with canonical_id set:       ", counts.dealsLinked);
  console.log("  list_items with canonical_id set:  ", counts.listLinked);
  console.log("  price_alerts with canonical_id set:", counts.alertsLinked);

  if (isDryRun) {
    console.log("\nDry run complete. Add --execute to apply.");
    return;
  }

  // Confirm only when targeting Turso (not local file)
  if (!process.argv.includes("--db-file")) {
    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(resolve => rl.question("\nType YES to wipe PRODUCTION canonical data: ", ans => {
      rl.close();
      if (ans.trim() !== "YES") { console.log("Aborted."); process.exit(0); }
      resolve();
    }));
  }

  console.log("\nWiping...");
  await client.execute("UPDATE list_items SET canonical_id = NULL WHERE canonical_id IS NOT NULL");
  console.log("  ✓ list_items.canonical_id NULLed");
  await client.execute("UPDATE price_alerts SET canonical_id = NULL WHERE canonical_id IS NOT NULL");
  console.log("  ✓ price_alerts.canonical_id NULLed");
  await client.execute("UPDATE deals SET canonical_id = NULL WHERE canonical_id IS NOT NULL");
  console.log("  ✓ deals.canonical_id NULLed");
  await client.execute("UPDATE entity_resolution_queue SET suggested_canonical_id = NULL WHERE suggested_canonical_id IS NOT NULL");
  await client.execute("DELETE FROM entity_resolution_queue");
  console.log("  ✓ entity_resolution_queue cleared");
  await client.execute("DELETE FROM deal_mappings");
  console.log("  ✓ deal_mappings cleared");
  await client.execute("DELETE FROM canonical_products");
  console.log("  ✓ canonical_products cleared");

  const afterCp = await n("SELECT COUNT(*) as c FROM canonical_products");
  const afterDm = await n("SELECT COUNT(*) as c FROM deal_mappings");
  console.log("\nVerification:");
  console.log("  canonical_products:", afterCp, "(expect 0)");
  console.log("  deal_mappings:", afterDm, "(expect 0)");
  console.log("\n✓ Wipe complete. Next: node scripts/promote-bootstrap-staging.js --db-file data/prod_local.db --dry-run");
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
```

- [ ] **Step 2: Dry-run against prod_local.db**

```bash
node scripts/wipe-old-canonicals.js --db-file data/prod_local.db --dry-run
```

Expected: shows 1,510 canonicals, 3,893 mappings, 11,888 ERQ rows.

---

## Task 4: Promote script

**Files:**
- Create: `scripts/promote-bootstrap-staging.js`

- [ ] **Step 1: Create the script**

```js
"use strict";

require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: true });

const path = require("path");

function getClient() {
  const fileArg = process.argv.indexOf("--db-file");
  if (fileArg !== -1) {
    const filePath = process.argv[fileArg + 1];
    if (!filePath) { console.error("--db-file requires a path"); process.exit(1); }
    const abs = path.resolve(filePath);
    console.log(`DB: local file ${abs}`);
    return require("@libsql/client").createClient({ url: `file:${abs}` });
  }
  const url = process.env.DESI_DEALS_DB_TURSO_DATABASE_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url || !url.includes("turso.io")) {
    console.error("ABORT: No --db-file given and DESI_DEALS_DB_TURSO_DATABASE_URL not set.");
    process.exit(1);
  }
  console.log(`DB: Turso ${url}`);
  return require("@libsql/client").createClient({ url, authToken });
}

const isDryRun = !process.argv.includes("--execute");

function slugify(value) {
  const base = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "item";
}

function confidenceToScore(conf) {
  if (conf === "high")   return 1.0;
  if (conf === "medium") return 0.92;
  return 0.80;
}

async function main() {
  const client = getClient();
  console.log(`Mode: ${isDryRun ? "DRY RUN (add --execute to apply)" : "LIVE"}\n`);

  // Guard: canonical_products must be empty
  const existing = await client.execute("SELECT COUNT(*) as c FROM canonical_products");
  if (existing.rows[0].c > 0) {
    console.error(`ABORT: canonical_products has ${existing.rows[0].c} rows. Run wipe script first.`);
    process.exit(1);
  }

  const stagingRows = await client.execute(`
    SELECT id, canonical_name, brand, product_type, variant, category,
           weight_kg, weight_unit, aliases, ai_confidence
    FROM canonical_bootstrap_staging
    WHERE needs_review = 0 AND promoted = 0
    ORDER BY id
  `);

  const sourceRows = await client.execute(`
    SELECT sp.staging_id, sp.deal_id
    FROM canonical_bootstrap_source_products sp
    JOIN canonical_bootstrap_staging s ON s.id = sp.staging_id
    WHERE s.needs_review = 0 AND s.promoted = 0
  `);

  // staging_id → deal_id[]
  const dealsByStaging = new Map();
  for (const sp of sourceRows.rows) {
    if (!dealsByStaging.has(sp.staging_id)) dealsByStaging.set(sp.staging_id, []);
    dealsByStaging.get(sp.staging_id).push(sp.deal_id);
  }

  console.log(`Staging rows to promote: ${stagingRows.rows.length}`);

  const usedIds = new Set();
  let canonicalsInserted = 0;
  let mappingsInserted = 0;
  let dealsUpdated = 0;

  for (const row of stagingRows.rows) {
    const baseId = slugify(row.canonical_name);
    let canonicalId = baseId;
    let suffix = 2;
    while (usedIds.has(canonicalId)) { canonicalId = `${baseId}-${suffix++}`; }
    usedIds.add(canonicalId);

    const aliases = (() => { try { return JSON.parse(row.aliases || "[]"); } catch { return []; } })();
    const matchConfidence = confidenceToScore(row.ai_confidence);
    const now = new Date().toISOString();
    // brand_slots: [[word], [word]] per decomposeCanonical format
    const brandSlots = row.brand
      ? row.brand.split(/\s+/).filter(Boolean).map(w => [w])
      : null;

    canonicalsInserted++;
    const dealLinks = dealsByStaging.get(row.id) || [];
    mappingsInserted += dealLinks.length;
    dealsUpdated += dealLinks.length;

    if (!isDryRun) {
      await client.execute({
        sql: `INSERT INTO canonical_products
                (id, canonical_name, category, common_aliases, verified, created_at, brand_slots)
              VALUES (?, ?, ?, ?, 1, ?, ?)`,
        args: [canonicalId, row.canonical_name, row.category || null,
               JSON.stringify(aliases), now, brandSlots ? JSON.stringify(brandSlots) : null],
      });

      for (const dealId of dealLinks) {
        await client.execute({
          sql: `INSERT INTO deal_mappings (deal_id, canonical_id, match_method, match_confidence, verified_at)
                VALUES (?, ?, 'bootstrap', ?, ?)
                ON CONFLICT(deal_id, canonical_id) DO NOTHING`,
          args: [dealId, canonicalId, matchConfidence, now],
        });
        await client.execute({
          sql: `UPDATE deals SET canonical_id = ? WHERE id = ? AND canonical_id IS NULL`,
          args: [canonicalId, dealId],
        });
      }

      await client.execute({
        sql: `UPDATE canonical_bootstrap_staging SET promoted = 1, promoted_canonical_id = ? WHERE id = ?`,
        args: [canonicalId, row.id],
      });
    }
  }

  console.log(`\n${isDryRun ? "[DRY RUN] Would:" : "Done:"}`);
  console.log(`  canonical_products inserted: ${canonicalsInserted}`);
  console.log(`  deal_mappings inserted:      ${mappingsInserted}`);
  console.log(`  deals.canonical_id updated:  ${dealsUpdated}`);

  if (!isDryRun) {
    const totalActive = await client.execute("SELECT COUNT(*) as c FROM deals WHERE is_active = 1");
    const linked      = await client.execute("SELECT COUNT(*) as c FROM deals WHERE is_active = 1 AND canonical_id IS NOT NULL");
    const pct = ((linked.rows[0].c / totalActive.rows[0].c) * 100).toFixed(1);
    console.log(`\nCoverage: ${linked.rows[0].c}/${totalActive.rows[0].c} active deals linked (${pct}%)`);
  }
}

main().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
```

- [ ] **Step 2: Dry-run against prod_local.db**

```bash
node scripts/promote-bootstrap-staging.js --db-file data/prod_local.db --dry-run
```

Expected:
```
Staging rows to promote: 2347
[DRY RUN] Would:
  canonical_products inserted: 2347
  deal_mappings inserted:      ~3167
  deals.canonical_id updated:  ~3167
```

---

## Task 5: Run full pipeline locally on prod_local.db

- [ ] **Step 1: Wipe prod_local.db**

```bash
node scripts/wipe-old-canonicals.js --db-file data/prod_local.db --execute
```

Expected: all canonical tables zeroed, no YES prompt (local file mode skips it).

- [ ] **Step 2: Promote to prod_local.db**

```bash
node scripts/promote-bootstrap-staging.js --db-file data/prod_local.db --execute
```

- [ ] **Step 3: Verify in prod_local.db**

```bash
node -e "
const { createClient } = require('@libsql/client');
const c = createClient({ url: 'file:' + require('path').resolve('./data/prod_local.db') });
async function check() {
  const cp  = await c.execute('SELECT COUNT(*) as n FROM canonical_products');
  const dm  = await c.execute('SELECT COUNT(*) as n FROM deal_mappings');
  const dl  = await c.execute('SELECT COUNT(*) as n FROM deals WHERE is_active=1 AND canonical_id IS NOT NULL');
  const tot = await c.execute('SELECT COUNT(*) as n FROM deals WHERE is_active=1');
  console.log('canonical_products:', cp.rows[0].n, '(expect ~2347)');
  console.log('deal_mappings:     ', dm.rows[0].n, '(expect ~3167)');
  console.log('deals linked:      ', dl.rows[0].n + '/' + tot.rows[0].n);
  // Spot-check a canonical
  const sample = await c.execute('SELECT id, canonical_name, category, brand_slots FROM canonical_products LIMIT 3');
  console.log('Sample rows:', JSON.stringify(sample.rows, null, 2));
}
check().catch(e => console.error(e.message));
" 2>&1 | grep -v punycode | grep -v Deprecation | grep -v trace
```

- [ ] **Step 4: Open prod_local.db in DB Browser and visually verify**

Check:
- `canonical_products` has ~2,347 rows with correct names, categories, brand_slots
- `deal_mappings` has rows with `match_method = 'bootstrap'`
- `deals` sample rows have `canonical_id` set
- Old heuristic canonicals (short slug IDs like `rice-5kg`) are gone

- [ ] **Step 5: Commit scripts**

```bash
git add scripts/review-bootstrap-staging.js scripts/wipe-old-canonicals.js scripts/promote-bootstrap-staging.js
git commit -m "feat(bootstrap): add review, wipe, and promote scripts for canonical migration"
```

---

## Task 6: Apply to production Turso

Only after Task 5 is verified clean.

- [ ] **Step 1: Wipe production Turso**

```bash
node scripts/wipe-old-canonicals.js --execute
```

Type `YES` when prompted.

- [ ] **Step 2: Promote to production Turso**

```bash
node scripts/promote-bootstrap-staging.js --execute
```

- [ ] **Step 3: Verify production**

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@libsql/client');
const c = createClient({ url: process.env.DESI_DEALS_DB_TURSO_DATABASE_URL, authToken: process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN });
async function check() {
  const cp  = await c.execute('SELECT COUNT(*) as n FROM canonical_products');
  const dm  = await c.execute('SELECT COUNT(*) as n FROM deal_mappings');
  const dl  = await c.execute('SELECT COUNT(*) as n FROM deals WHERE is_active=1 AND canonical_id IS NOT NULL');
  const tot = await c.execute('SELECT COUNT(*) as n FROM deals WHERE is_active=1');
  console.log('canonical_products:', cp.rows[0].n);
  console.log('deal_mappings:     ', dm.rows[0].n);
  console.log('deals linked:      ', dl.rows[0].n + '/' + tot.rows[0].n);
}
check().catch(e => console.error(e.message));
" 2>&1 | grep -v punycode | grep -v Deprecation | grep -v trace
```

- [ ] **Step 4: Refresh local prod.db snapshot**

```bash
node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const fs = require('fs');
const client = createClient({ url: process.env.DESI_DEALS_DB_TURSO_DATABASE_URL, authToken: process.env.DESI_DEALS_DB_TURSO_AUTH_TOKEN });
async function dump() {
  const out = './data/prod.db';
  if (fs.existsSync(out)) fs.unlinkSync(out);
  const local = new Database(out);
  local.pragma('foreign_keys = OFF');
  local.pragma('journal_mode = WAL');
  const schemas = await client.execute(\"SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL ORDER BY name\");
  for (const { name, sql } of schemas.rows) {
    process.stdout.write('Copying ' + name + '...');
    try { local.exec(sql); } catch(e) { console.log(' skip'); continue; }
    const rows = await client.execute('SELECT * FROM \"' + name + '\"');
    if (!rows.rows.length) { console.log(' 0'); continue; }
    const cols = rows.columns.map(c => '\"'+c+'\"').join(',');
    const ph = rows.columns.map(() => '?').join(',');
    const ins = local.prepare('INSERT OR IGNORE INTO \"'+name+'\" ('+cols+') VALUES ('+ph+')');
    local.transaction(arr => { for (const r of arr) ins.run(rows.columns.map(c => r[c])); })(rows.rows);
    console.log(' ' + rows.rows.length);
  }
  local.close();
  console.log('Done:', out);
}
dump().catch(e => { console.error(e.message); process.exit(1); });
" 2>&1 | grep -v punycode | grep -v Deprecation | grep -v trace
```

---

## Notes

**FK wipe order:** `list_items` and `price_alerts` have no enforced FK on `canonical_id` (nullable TEXT). `deals.canonical_id` is nullable. NULL these first, then delete `deal_mappings`, `entity_resolution_queue`, then `canonical_products` last.

**No YES prompt for local file mode:** The wipe script skips the interactive confirmation when `--db-file` is passed — safe to run non-interactively against local files.

**brand_slots format:** `[[word], [word]]` per `decomposeCanonical` — each word in the brand name becomes its own slot array. e.g. `"Shan Foods"` → `[["Shan"], ["Foods"]]`.

**product_groups:** Not touched — no FK to `canonical_products`.

**Entity resolver:** After promotion, unmatched active deals (`canonical_id IS NULL`) feed into the existing entity resolution pipeline on the next crawl cycle. No action needed in this plan.
