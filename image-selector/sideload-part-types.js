#!/usr/bin/env node
/**
 * sideload-part-types.js
 *
 * Patches "Part Type" in the new run's normalize.json (and raw.json)
 * by pulling clean Part Type values from the old run.
 * For unmatched SKUs, derives Part Type from the title heuristic.
 *
 * Usage:
 *   node sideload-part-types.js <old-run-dir> <new-run-dir>
 *
 * Example:
 *   node sideload-part-types.js ../runs/jegs-ebay-mar-20-03 ../runs/jegs-ebay-final
 */

const fs   = require('fs');
const path = require('path');

const oldRunDir = process.argv[2];
const newRunDir = process.argv[3];

if (!oldRunDir || !newRunDir) {
  console.error('Usage: node sideload-part-types.js <old-run-dir> <new-run-dir>');
  process.exit(1);
}

// Load old run normalize.json for Part Type map
const oldNormPath = path.resolve(__dirname, oldRunDir, 'data', 'normalize.json');
if (!fs.existsSync(oldNormPath)) { console.error('Old normalize.json not found:', oldNormPath); process.exit(1); }
const oldData = JSON.parse(fs.readFileSync(oldNormPath, 'utf8'));
const partTypeMap = new Map();
for (const item of oldData) {
  if (item['Part Number'] && item['Part Type']) {
    partTypeMap.set(item['Part Number'], item['Part Type']);
  }
}
console.log(`Loaded ${partTypeMap.size} Part Types from old run`);

/**
 * Derive Part Type from title for unmatched SKUs.
 * Title format: "JEGS 12345 Some Part Type Description For Vehicle..."
 * Strategy: strip "JEGS {number}" prefix, take first meaningful phrase
 */
function derivePartType(title, sku) {
  if (!title) return '';
  // Strip "JEGS " prefix and part number
  let clean = title.replace(/^JEGS\s+\d+[-\w]*\s*/i, '');
  // Remove trailing fitment/vehicle info after common prepositions
  clean = clean.replace(/\s+(for|fits|compatible|1\d{3}|19\d{2}|20\d{2}).*/i, '');
  // Remove trailing part number references
  clean = clean.replace(/\s*[-–]\s*555-\d+.*$/, '');
  // Trim and cap length
  clean = clean.trim();
  if (clean.length > 60) clean = clean.slice(0, 60).replace(/\s+\S*$/, '');
  return clean || '';
}

// Patch normalize.json
const newNormPath = path.resolve(__dirname, newRunDir, 'data', 'normalize.json');
if (!fs.existsSync(newNormPath)) { console.error('New normalize.json not found:', newNormPath); process.exit(1); }
const newNormData = JSON.parse(fs.readFileSync(newNormPath, 'utf8'));

let fromOld = 0, fromHeuristic = 0, noMatch = 0;
const heuristicResults = [];

for (const item of newNormData) {
  const sku = item['Part Number'];
  if (partTypeMap.has(sku)) {
    item['Part Type'] = partTypeMap.get(sku);
    fromOld++;
  } else {
    const derived = derivePartType(item['Title'] || '', sku);
    if (derived) {
      item['Part Type'] = derived;
      fromHeuristic++;
      heuristicResults.push({ sku, partType: derived, title: (item['Title'] || '').slice(0, 80) });
    } else {
      noMatch++;
    }
  }
}

fs.writeFileSync(newNormPath, JSON.stringify(newNormData, null, 2));

// Also patch raw.json Category Hierarchy so re-runs stay clean
const rawPath = path.resolve(__dirname, newRunDir, 'data', 'raw.json');
if (fs.existsSync(rawPath)) {
  let rawContent = fs.readFileSync(rawPath, 'utf8');
  rawContent = rawContent.replace(/:\s*NaN\s*([,\}])/g, ': null$1');
  const rawData = JSON.parse(rawContent);
  let rawPatched = 0;
  for (const row of rawData) {
    const sku = row.SKU;
    const normItem = newNormData.find(n => n['Part Number'] === sku);
    if (normItem && normItem['Part Type']) {
      row['Part Type'] = normItem['Part Type'];
      rawPatched++;
    }
  }
  fs.writeFileSync(rawPath, JSON.stringify(rawData, null, 2));
  console.log(`raw.json: ${rawPatched} rows patched with Part Type field`);
}

console.log(`\n=== Part Type Sideload ===`);
console.log(`From old run:     ${fromOld}`);
console.log(`From heuristic:   ${fromHeuristic}`);
console.log(`No match:         ${noMatch}`);
console.log(`Total:            ${newNormData.length}`);
console.log(`Output:           ${newNormPath}`);

if (heuristicResults.length > 0) {
  console.log(`\nHeuristic-derived Part Types:`);
  for (const r of heuristicResults) {
    console.log(`  ${r.sku}: "${r.partType}"`);
    console.log(`    Title: ${r.title}`);
  }
}
