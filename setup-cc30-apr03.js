#!/usr/bin/env node
/**
 * setup-cc30-apr03.js
 *
 * Creates runs/jegs-cc30-apr03/ ready to run the cc30 pipeline with:
 *  - Same input as mar26 (original 556-product cc30 Excel)
 *  - Enriched image-overrides.json: existing 126 eBay images + new JEGS.com
 *    images for the 14 previously unmatched parts
 *  - part-type-overrides.json and product-patches.json copied unchanged from mar26
 *
 * Usage: node setup-cc30-apr03.js [--all-jegs]
 *   --all-jegs   Replace all 126 existing eBay images with JEGS.com images too
 *                (default: only fill the 14 gaps)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const xlsx = require('xlsx');

// ── Config ────────────────────────────────────────────────────────────────────

const NEW_EXCEL   = path.join(os.homedir(), 'Downloads', 'no-image-items_JEGS_EBAY_cc30.xlsx');
const SOURCE_RUN  = path.resolve(__dirname, 'runs/jegs-cc30-mar26');
const NEW_RUN     = path.resolve(__dirname, 'runs/jegs-cc30-apr03');
const SHEET_NAME  = 'Extracted Rows';
const ALL_JEGS    = process.argv.includes('--all-jegs');

// ── Step 1: Validate inputs ───────────────────────────────────────────────────

if (!fs.existsSync(NEW_EXCEL)) {
  console.error(`ERROR: New Excel not found: ${NEW_EXCEL}`);
  process.exit(1);
}

const requiredSourceFiles = ['run.config.js', 'part-type-overrides.json', 'product-patches.json', 'image-overrides.json'];
for (const f of requiredSourceFiles) {
  const p = path.join(SOURCE_RUN, f);
  if (!fs.existsSync(p)) {
    console.error(`ERROR: Source file missing: ${p}`);
    process.exit(1);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  CC30 Apr03 Run Setup');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── Step 2: Extract image_url per product from new Excel ──────────────────────

console.log(`Reading: ${NEW_EXCEL}`);
const wb = xlsx.readFile(NEW_EXCEL);
const ws = wb.Sheets[SHEET_NAME];
if (!ws) {
  console.error(`ERROR: Sheet "${SHEET_NAME}" not found in new Excel`);
  process.exit(1);
}
const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
console.log(`  ${rows.length} rows loaded`);

// Collect first image_url per mpn
const newImages = {};
for (const row of rows) {
  const mpn = String(row.mpn || '').trim();
  const key = String(row.key || '').trim();
  const val = String(row.value || '').trim();
  if (!mpn || key !== 'image_url' || !val) continue;
  if (!newImages[mpn]) {
    // Normalise to absolute URL
    const url = val.startsWith('http') ? val : 'https://www.jegs.com' + (val.startsWith('/') ? '' : '/') + val;
    newImages[mpn] = url;
  }
}

console.log(`  ${Object.keys(newImages).length} products with image_url extracted\n`);

// ── Step 3: Merge with existing image-overrides ───────────────────────────────

const existingOverrides = JSON.parse(fs.readFileSync(path.join(SOURCE_RUN, 'image-overrides.json'), 'utf8'));
const unmatched = existingOverrides._stats?.unmatched_pns || [];

console.log(`Merging image overrides:`);
console.log(`  Existing overrides: ${Object.keys(existingOverrides.overrides).length}`);
console.log(`  Previously unmatched: ${unmatched.length}`);
console.log(`  Mode: ${ALL_JEGS ? 'replace ALL with JEGS.com URLs' : 'fill gaps only (add unmatched parts)'}`);

const mergedOverrides = ALL_JEGS
  ? {} // start fresh, use all JEGS images
  : { ...existingOverrides.overrides }; // start from existing eBay images

let added = 0, replaced = 0, skipped = 0;

for (const [pn, url] of Object.entries(newImages)) {
  if (ALL_JEGS) {
    mergedOverrides[pn] = { image: url, source: 'no-image-items_JEGS_EBAY_cc30' };
    added++;
  } else {
    if (!mergedOverrides[pn]) {
      // Gap — add it
      mergedOverrides[pn] = { image: url, source: 'no-image-items_JEGS_EBAY_cc30' };
      added++;
    } else {
      skipped++;
    }
  }
}

console.log(`  Added new: ${added}`);
if (ALL_JEGS) console.log(`  Replaced: ${Object.keys(existingOverrides.overrides).length} eBay → JEGS`);
else console.log(`  Kept existing: ${skipped}`);
console.log(`  Total merged: ${Object.keys(mergedOverrides).length}\n`);

const newImageOverrides = {
  _comment: `Image overrides merged from mar26 run + no-image-items_JEGS_EBAY_cc30.xlsx. Mode: ${ALL_JEGS ? 'all-jegs' : 'fill-gaps'}.`,
  _generated: new Date().toISOString(),
  _source_runs: ['jegs-cc30-mar26', 'no-image-items_JEGS_EBAY_cc30'],
  _stats: {
    fromMar26: Object.keys(existingOverrides.overrides).length,
    addedFromNewFile: added,
    total: Object.keys(mergedOverrides).length,
  },
  overrides: mergedOverrides,
};

// ── Step 4: Create run directory ──────────────────────────────────────────────

if (!fs.existsSync(NEW_RUN)) {
  fs.mkdirSync(NEW_RUN, { recursive: true });
  console.log(`Created: ${NEW_RUN}`);
} else {
  console.log(`Run dir already exists: ${NEW_RUN}`);
}

// ── Step 5: Write run.config.js ───────────────────────────────────────────────

const runConfig = `/**
 * Jegs cc30 — Apr03 (Image-Enriched Re-run)
 *
 * Same source as jegs-cc30-mar26 (556 products).
 * Enriched image-overrides: all 140 no-image products now have JEGS.com images.
 * Part Type overrides and product patches carried over from mar26.
 */
module.exports = {
  name: 'Jegs cc30 — Apr03 Image-Enriched',
  description: '556 products re-run with all image gaps filled from no-image-items_JEGS_EBAY_cc30.xlsx',
  input: {
    file: '~/Downloads/Jegs eBay Test 2.16.26_JEGS_EBAY_cc30.xlsx',
    sheet: 'Extracted Rows',
  },
  steps: [
    {
      id: 'group-attributes',
      fn: 'cc30-group-attributes',
      name: 'Group Attributes by Product',
      description: 'Reshape flat rows into 556 products. Renames columns, discards metadata cols, builds original_attributes[] and raw_attributes[]',
      config: {
        columnMap: { productbrand: 'Brand', mpn: 'Part Number', site: 'brand_site' },
        discardColumns: ['confidence', 'match_mode', 'page_type', 'status'],
        groupBy: 'Input Row',
      },
    },
    {
      id: 'extract-columns',
      fn: 'cc30-extract-columns',
      name: 'Extract Columns from Attributes',
      description: 'Pull Part Type, Image, original_title, raw_fitment, fit_type, fitment_extracted into dedicated columns.',
    },
    {
      id: 'filter-attributes',
      fn: 'cc30-filter-attributes',
      name: 'Filter to Final Attributes',
      description: 'Blacklist: drop extracted/metadata/feature/fitment/regulatory keys, keep physical/technical specs',
    },
    {
      id: 'sideload-part-types',
      fn: 'cc30-sideload-part-types',
      name: 'Sideload Overrides',
      description: 'Apply Part Type overrides, image overrides, product patches. Promote fit_type into final_attributes.',
      config: {
        file: 'part-type-overrides.json',
        patchFile: 'product-patches.json',
        imageFile: 'image-overrides.json',
      },
    },
  ],
};
`;

fs.writeFileSync(path.join(NEW_RUN, 'run.config.js'), runConfig);
console.log('Wrote: run.config.js');

// ── Step 6: Write sideload files ──────────────────────────────────────────────

fs.writeFileSync(
  path.join(NEW_RUN, 'image-overrides.json'),
  JSON.stringify(newImageOverrides, null, 2)
);
console.log(`Wrote: image-overrides.json (${Object.keys(mergedOverrides).length} entries)`);

// Copy part-type-overrides.json unchanged
const ptOverrides = fs.readFileSync(path.join(SOURCE_RUN, 'part-type-overrides.json'), 'utf8');
fs.writeFileSync(path.join(NEW_RUN, 'part-type-overrides.json'), ptOverrides);
console.log('Copied: part-type-overrides.json');

// Copy product-patches.json unchanged
const patches = fs.readFileSync(path.join(SOURCE_RUN, 'product-patches.json'), 'utf8');
fs.writeFileSync(path.join(NEW_RUN, 'product-patches.json'), patches);
console.log('Copied: product-patches.json');

// ── Done ──────────────────────────────────────────────────────────────────────

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Setup complete. Next steps:

  1. Smoke test (3 rows):
     node pipeline/run.js runs/jegs-cc30-apr03 --limit 3

  2. Full run:
     node pipeline/run.js runs/jegs-cc30-apr03

  3. Test step outputs (20 random rows each):
     node test-cc30-steps.js runs/jegs-cc30-apr03
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
