#!/usr/bin/env node

/**
 * Transplant approved attributes into a pipeline run's raw.json.
 *
 * Usage: node transplant-attributes.js [run-dir] [approved-json-path] [--force]
 *   run-dir            defaults to ../runs/jegs-ebay-mar-20-03
 *   approved-json-path defaults to datasets/attr-gaps/approved.json
 *   --force            overwrite existing Item Specifics (don't skip non-empty rows)
 *
 * Reads: approved.json
 *        { "555-78468": [["Material","Steel"], ...], ... }
 *
 * Patches: <run-dir>/data/raw.json
 *   Sets "Item Specifics (JSON)" for each matched SKU
 */

const fs = require("fs");
const path = require("path");

const FORCE = process.argv.includes("--force");
const positionalArgs = process.argv.slice(2).filter(a => !a.startsWith("--"));
const runDir = positionalArgs[0] || path.join(__dirname, "../runs/jegs-ebay-mar-20-03");
const approvedFile = positionalArgs[1]
  ? path.resolve(positionalArgs[1])
  : path.join(__dirname, "datasets/attr-gaps/approved.json");
const rawFile = path.join(path.resolve(runDir), "data", "raw.json");

if (!fs.existsSync(approvedFile)) {
  console.error(`Approved file not found: ${approvedFile}`);
  console.error("Run extract-attributes.js first, then approve the results.");
  process.exit(1);
}
if (!fs.existsSync(rawFile)) {
  console.error(`Raw data file not found: ${rawFile}`);
  process.exit(1);
}

// Load approved: { SKU: [[name, value], ...] }
const approved = JSON.parse(fs.readFileSync(approvedFile, "utf8"));
const approvedCount = Object.keys(approved).length;

if (approvedCount === 0) {
  console.error("No approved attributes found.");
  process.exit(1);
}

// Load raw.json (handle NaN values)
let rawContent = fs.readFileSync(rawFile, "utf8");
rawContent = rawContent.replace(/:\s*NaN\s*([,\}])/g, ": null$1");
const rows = JSON.parse(rawContent);

let patched = 0;
let skippedHasAttrs = 0;
const notFound = [];

for (const [sku, attrs] of Object.entries(approved)) {
  const row = rows.find((r) => r.SKU === sku);
  if (!row) {
    notFound.push(sku);
    continue;
  }

  // Skip if row already has non-empty Item Specifics (unless --force)
  if (!FORCE) {
    const existing = row["Item Specifics (JSON)"];
    if (existing && existing !== "{}" && existing !== "null" && existing !== "") {
      const parsed = typeof existing === "string" ? JSON.parse(existing) : existing;
      if (Object.keys(parsed).length > 0) {
        skippedHasAttrs++;
        continue;
      }
    }
  }

  // Convert [[name, value], ...] → { name: value, ... } JSON string
  const specificsObj = {};
  for (const [name, value] of attrs) {
    specificsObj[name] = value;
  }
  row["Item Specifics (JSON)"] = JSON.stringify(specificsObj);
  patched++;
}

// Count items still with empty Item Specifics
const stillEmpty = rows.filter((r) => {
  const spec = r["Item Specifics (JSON)"];
  if (!spec || spec === "{}" || spec === "null" || spec === "") return true;
  try {
    return Object.keys(JSON.parse(spec)).length === 0;
  } catch {
    return false;
  }
}).length;

// Write back
fs.writeFileSync(rawFile, JSON.stringify(rows, null, 2));

console.log(`\n  Attribute Transplant Complete`);
console.log(`  ─────────────────────────────`);
console.log(`  Approved SKUs:       ${approvedCount}`);
console.log(`  Patched:             ${patched}`);
console.log(`  Skipped (has attrs): ${skippedHasAttrs}`);
console.log(`  Not in raw.json:     ${notFound.length}${notFound.length ? " (" + notFound.join(", ") + ")" : ""}`);
console.log(`  Still empty:         ${stillEmpty} of ${rows.length} rows`);
console.log(`  Output:              ${rawFile}\n`);

if (patched > 0) {
  console.log("  Next: re-run the pipeline from split-desc to propagate changes.");
  console.log('  curl -X POST http://localhost:3460/api/runs/jegs-ebay-mar-20-03/execute \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log("    -d '{\"fromStep\": \"split-desc\"}'\n");
}
