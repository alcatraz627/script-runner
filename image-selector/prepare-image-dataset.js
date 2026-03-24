#!/usr/bin/env node
/**
 * prepare-image-dataset.js
 *
 * Generates an image-selector dataset from a run's raw.json.
 *
 * Usage:
 *   node prepare-image-dataset.js <run-dir> <dataset-id>
 *
 * Example:
 *   node prepare-image-dataset.js ../runs/jegs-ebay-final jegs-final-images
 */

const fs   = require('fs');
const path = require('path');

const runDir    = process.argv[2];
const datasetId = process.argv[3];

if (!runDir || !datasetId) {
  console.error('Usage: node prepare-image-dataset.js <run-dir> <dataset-id>');
  process.exit(1);
}

const rawPath = path.resolve(__dirname, runDir, 'data', 'raw.json');
if (!fs.existsSync(rawPath)) { console.error('raw.json not found:', rawPath); process.exit(1); }

const rows = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

// Static blacklist base paths (extension-agnostic)
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
function isStaticBlocked(url) { return BLOCKED_BASES.has(stripExt(url)); }

// First pass: collect all images to detect stock URLs (appearing in 4+ SKUs)
const allImgsByRow = rows.map(row => {
  const pipeStr = row['Images (pipe-separated)'] || '';
  return pipeStr.split(/\s*\|\s*/).map(s => s.trim()).filter(u => u && !u.includes('/thumbs/'));
});
const urlSkuCount = {};
for (const imgs of allImgsByRow) {
  for (const u of imgs) {
    if (!urlSkuCount[u]) urlSkuCount[u] = 0;
    urlSkuCount[u]++;
  }
}
const stockImages = new Set(Object.entries(urlSkuCount).filter(([, c]) => c >= 4).map(([u]) => u));
console.log(`Stock images detected (in 4+ SKUs): ${stockImages.size}`);

const dataset = rows.map((row, idx) => {
  const imgs = allImgsByRow[idx].filter(u => !isStaticBlocked(u) && !stockImages.has(u));
  const pipeStr = row['Images (pipe-separated)'] || '';

  return {
    sku:        row.SKU,
    title:      row['Original Title'] || '',
    ebay_title: row['eBay Listing Title'] || '',
    url:        row['eBay Item URL'] || '',
    images:     pipeStr,
    image_count: imgs.length,
    category:   row['Category Hierarchy'] || '',
    description: row.Description || '',
    fitment:    row['Fitment / Compatibility'] || null,
    item_specifics: row['Item Specifics (JSON)'] || null,
    _imgs:      imgs,
    _imgs_all:  imgs,
  };
});

const outDir = path.join(__dirname, 'datasets', datasetId);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(dataset, null, 2));
fs.writeFileSync(path.join(outDir, 'selections.json'), '{}');

console.log(`\n=== Image Dataset Prepared ===`);
console.log(`Dataset: ${datasetId}`);
console.log(`Items: ${dataset.length}`);
console.log(`With images: ${dataset.filter(d => d._imgs.length > 0).length}`);
console.log(`No images: ${dataset.filter(d => d._imgs.length === 0).length}`);
console.log(`Output: ${outDir}/`);
console.log(`\nStart dashboard: node image-selector/server.js`);
console.log(`Open: http://localhost:3458 → select dataset "${datasetId}"`);
