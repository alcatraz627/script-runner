#!/usr/bin/env node
/**
 * sideload-descriptions.js
 *
 * Copies clean Description + Features and Benefits from an old run's raw.json
 * into a new run's raw.json, matched by SKU.
 *
 * Usage:
 *   node sideload-descriptions.js <old-run-dir> <new-run-dir>
 *
 * Example:
 *   node sideload-descriptions.js ../runs/jegs-ebay-mar-20-03 ../runs/jegs-ebay-final
 */

const fs   = require('fs');
const path = require('path');

const oldRunDir = process.argv[2];
const newRunDir = process.argv[3];

if (!oldRunDir || !newRunDir) {
  console.error('Usage: node sideload-descriptions.js <old-run-dir> <new-run-dir>');
  process.exit(1);
}

const oldRawPath = path.resolve(__dirname, oldRunDir, 'data', 'raw.json');
const newRawPath = path.resolve(__dirname, newRunDir, 'data', 'raw.json');

if (!fs.existsSync(oldRawPath)) { console.error('Old raw.json not found:', oldRawPath); process.exit(1); }
if (!fs.existsSync(newRawPath)) { console.error('New raw.json not found:', newRawPath); process.exit(1); }

const oldRows = JSON.parse(fs.readFileSync(oldRawPath, 'utf8'));
const newRows = JSON.parse(fs.readFileSync(newRawPath, 'utf8'));

// Build lookup from old data
const oldBySku = new Map();
for (const row of oldRows) {
  oldBySku.set(row.SKU, {
    Description: row.Description || '',
    'Features and Benefits': row['Features and Benefits'] || [],
  });
}

let matched   = 0;
let unmatched = 0;
const unmatchedSkus = [];

for (const row of newRows) {
  const old = oldBySku.get(row.SKU);
  if (old) {
    row.Description = old.Description;
    row['Features and Benefits'] = old['Features and Benefits'];
    matched++;
  } else {
    // Best-effort: strip boilerplate from scraped description (take text before first |)
    const raw = row.Description || '';
    const cleaned = raw.split('|')[0].trim();
    row.Description = cleaned || '';
    row['Features and Benefits'] = [];
    row._needs_description = true;
    unmatchedSkus.push(row.SKU);
    unmatched++;
  }
}

// Check for old-only SKUs (dropped from new file)
const newSkus = new Set(newRows.map(r => r.SKU));
const oldOnly = oldRows.filter(r => !newSkus.has(r.SKU)).map(r => r.SKU);

fs.writeFileSync(newRawPath, JSON.stringify(newRows, null, 2));

console.log('\n=== Sideload Descriptions Report ===');
console.log(`Old run: ${oldRows.length} items`);
console.log(`New run: ${newRows.length} items`);
console.log(`Matched: ${matched}`);
console.log(`Unmatched (new SKUs, best-effort cleanup): ${unmatched}`);
if (unmatchedSkus.length) console.log(`  SKUs: ${unmatchedSkus.join(', ')}`);
if (oldOnly.length) console.log(`Old-only (dropped): ${oldOnly.length} — ${oldOnly.join(', ')}`);
console.log(`\nraw.json updated at ${newRawPath}`);
if (unmatched > 0) {
  console.log(`\n⚠ ${unmatched} items flagged with _needs_description=true (scraped text, no Features)`);
}
