#!/usr/bin/env node
/**
 * upsert-images.js
 *
 * Patches image data for specific SKUs. Use this to backfill images
 * for items that had no product photos (e.g. shared-listing dupes).
 *
 * Usage:
 *   node upsert-images.js <patches.json> [--dataset <id>] [--run-dir <path>]
 *
 * patches.json format:
 *   { "555-92123": ["https://url1.jpg", "https://url2.jpg"], ... }
 *   or simply:
 *   { "555-92123": "https://single-url.jpg", ... }
 *
 * What it patches:
 *   1. datasets/<id>/data.json  — image selector dataset (_imgs, _imgs_all, image_count)
 *   2. <run-dir>/data/raw.json  — "Images (pipe-separated)" and "Main Image" fields
 *   3. datasets/<id>/changes.json — if exists, sets mainImage to first new image
 *
 * Example:
 *   node upsert-images.js image-patches.json --dataset jegs-final-images --run-dir ../runs/jegs-ebay-final
 */

const fs   = require('fs');
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const patchFile  = process.argv[2];
const datasetId  = getArg('--dataset') || 'jegs-final-images';
const runDir     = getArg('--run-dir') || null;

if (!patchFile) {
  console.error('Usage: node upsert-images.js <patches.json> [--dataset <id>] [--run-dir <path>]');
  process.exit(1);
}

const patchPath = path.resolve(patchFile);
if (!fs.existsSync(patchPath)) { console.error('Patch file not found:', patchPath); process.exit(1); }

const patches = JSON.parse(fs.readFileSync(patchPath, 'utf8'));

// Normalize: string values → array
for (const sku of Object.keys(patches)) {
  if (typeof patches[sku] === 'string') patches[sku] = [patches[sku]];
}

const skus = Object.keys(patches);
console.log(`\nPatching ${skus.length} SKUs...\n`);

// 1. Patch dataset data.json
const dataPath = path.join(__dirname, 'datasets', datasetId, 'data.json');
let dataPatched = 0;
if (fs.existsSync(dataPath)) {
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (const item of data) {
    if (patches[item.sku]) {
      const newImgs = patches[item.sku];
      item._imgs = newImgs;
      item._imgs_all = newImgs;
      item.image_count = newImgs.length;
      dataPatched++;
    }
  }
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  console.log(`  datasets/${datasetId}/data.json: ${dataPatched} items patched`);
} else {
  console.log(`  datasets/${datasetId}/data.json: not found, skipping`);
}

// 2. Patch changes.json (dashboard state)
const changesPath = path.join(__dirname, 'datasets', datasetId.replace('jegs-final-images', 'attr-gaps-final'), 'changes.json');
let changesPatched = 0;
if (fs.existsSync(changesPath)) {
  const changes = JSON.parse(fs.readFileSync(changesPath, 'utf8'));
  for (const sku of skus) {
    if (changes[sku]) {
      changes[sku].mainImage = patches[sku][0];
      changesPatched++;
    }
  }
  fs.writeFileSync(changesPath, JSON.stringify(changes, null, 2));
  console.log(`  changes.json: ${changesPatched} items patched`);
}

// 3. Patch raw.json
if (runDir) {
  const rawPath = path.resolve(__dirname, runDir, 'data', 'raw.json');
  let rawPatched = 0;
  if (fs.existsSync(rawPath)) {
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    for (const row of raw) {
      if (patches[row.SKU]) {
        const newImgs = patches[row.SKU];
        row['Images (pipe-separated)'] = newImgs.join(' | ');
        row['Main Image'] = newImgs[0];
        rawPatched++;
      }
    }
    fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    console.log(`  raw.json: ${rawPatched} items patched`);
  } else {
    console.log(`  raw.json: not found at ${rawPath}, skipping`);
  }
}

console.log(`\nDone. Rebuild dashboard with:`);
console.log(`  node generate-combined-dashboard.js --pre-approved datasets/attr-gaps/approved.json\n`);
