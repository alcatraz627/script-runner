#!/usr/bin/env node

/**
 * Transplant image selections from a dataset into a pipeline run's raw.json.
 *
 * Usage: node transplant-selections.js <dataset-id> <run-dir>
 * Example: node transplant-selections.js image-gaps ../runs/jegs-ebay-mar-20-03
 */

const fs   = require('fs');
const path = require('path');

const datasetId = process.argv[2];
const runDir    = process.argv[3];

if (!datasetId || !runDir) {
  console.error('Usage: node transplant-selections.js <dataset-id> <run-dir>');
  console.error('Example: node transplant-selections.js image-gaps ../runs/jegs-ebay-mar-20-03');
  process.exit(1);
}

const selFile = path.join(__dirname, 'datasets', datasetId, 'selections.json');
const rawFile = path.join(path.resolve(runDir), 'data', 'raw.json');

if (!fs.existsSync(selFile)) {
  console.error(`Selections file not found: ${selFile}`);
  process.exit(1);
}
if (!fs.existsSync(rawFile)) {
  console.error(`Raw data file not found: ${rawFile}`);
  process.exit(1);
}

// Load selections: { SKU: imageUrl }
const selections = JSON.parse(fs.readFileSync(selFile, 'utf8'));
const selCount = Object.keys(selections).length;

if (selCount === 0) {
  console.error('No selections found. Make your image selections in the dashboard first.');
  process.exit(1);
}

// Load raw.json (handle NaN values)
let rawContent = fs.readFileSync(rawFile, 'utf8');
rawContent = rawContent.replace(/:\s*NaN\s*([,\}])/g, ': null$1');
const rows = JSON.parse(rawContent);

let patched = 0;
let skipped = 0;
const notFound = [];

for (const [sku, imageUrl] of Object.entries(selections)) {
  const row = rows.find(r => r.SKU === sku);
  if (!row) {
    notFound.push(sku);
    continue;
  }
  row['Main Image'] = imageUrl;
  patched++;
}

// Count still-empty Main Image rows
const stillEmpty = rows.filter(r => !r['Main Image'] || r['Main Image'] === 'None').length;

// Write back
fs.writeFileSync(rawFile, JSON.stringify(rows, null, 2));

console.log(`\n  Transplant complete`);
console.log(`  ─────────────────────`);
console.log(`  Selections:    ${selCount}`);
console.log(`  Patched:       ${patched}`);
console.log(`  Not in raw:    ${notFound.length}${notFound.length ? ' (' + notFound.join(', ') + ')' : ''}`);
console.log(`  Still empty:   ${stillEmpty} of ${rows.length} rows`);
console.log(`  Output:        ${rawFile}\n`);

if (patched > 0) {
  console.log('  Next: re-run the pipeline from step 1 to propagate changes.');
  console.log('  curl -X POST http://localhost:3460/api/runs/jegs-ebay-mar-20-03/execute \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"fromStep": "split-desc"}\'\n');
}
