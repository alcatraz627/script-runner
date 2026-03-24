#!/usr/bin/env node
/**
 * fix-placeholder-images.js
 * Clears known stock/placeholder eBay image URLs from the "Main Image" field
 * in raw.json. Items cleared here will produce an empty Images field in
 * normalize.json after the next pipeline re-run.
 *
 * Usage: node image-selector/fix-placeholder-images.js [run-id]
 */

const fs   = require('fs');
const path = require('path');

const runId  = process.argv[2] || 'jegs-ebay-final';
const rawPath = path.resolve(__dirname, `../runs/${runId}/data/raw.json`);

if (!fs.existsSync(rawPath)) {
  console.error(`Not found: ${rawPath}`);
  process.exit(1);
}

// Keep in sync with jegs-export-normalize.js BLOCKED_IMAGE_BASES
const BLOCKED_BASES = new Set([
  'https://i.ebayimg.com/00/s/MTIzM1gxNjAw/z/l94AAeSwhLdo2FOA/$_1',
  'https://i.ebayimg.com/images/g/1VEAAOSwBahVcLz8/s-l1600',
  'https://i.ebayimg.com/images/g/DOcAAOSw8NplLtwK/s-l1600',
  'https://i.ebayimg.com/images/g/DnkAAeSwAKtpgwkt/s-l1600',
  'https://i.ebayimg.com/images/g/Eq8AAeSwWthplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/gm8AAeSwQgBplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/rBQAAeSwlJVplcJ8/s-l1600',
  'pics.ebaystatic.com/aw/pics/nextGenVit/imgNoImg',
]);

function stripExt(url) { return url.replace(/\.[^.?]+(\?.*)?$/, ''); }
function isBlocked(url) { return url && BLOCKED_BASES.has(stripExt(url)); }

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

let cleared = 0;
const clearedSKUs = [];

for (const item of raw) {
  const img = item['Main Image'] || '';
  if (isBlocked(img)) {
    item['Main Image'] = '';
    cleared++;
    clearedSKUs.push(item['SKU'] || item['Part Number']);
  }
}

fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));

console.log(`\nRun: ${runId}`);
console.log(`Blocked Main Images cleared: ${cleared}`);
if (clearedSKUs.length > 0) {
  console.log(`Sample SKUs (first 10): ${clearedSKUs.slice(0, 10).join(', ')}`);
}
console.log(`\nNext: re-run the normalize step so normalize.json reflects the cleared images.\n`);
