#!/usr/bin/env node
/**
 * review-all-attributes.js
 *
 * Collects ALL items' attributes (from Excel Item Specifics + LLM extraction),
 * runs quality checks, and outputs a unified flagged dataset for HTML review.
 *
 * Usage:
 *   node review-all-attributes.js <run-dir> [--extracted <path>]
 *
 * Example:
 *   node review-all-attributes.js ../runs/jegs-ebay-final --extracted datasets/attr-gaps-final/extracted.json
 *
 * Output (in same dir as --extracted, or datasets/attr-gaps-final/):
 *   all-attributes.json — unified { sku, partType, attrs, source, flags[] }
 */

const fs   = require('fs');
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const runDir = process.argv[2];
if (!runDir) {
  console.error('Usage: node review-all-attributes.js <run-dir> [--extracted <path>]');
  process.exit(1);
}

const rawPath = path.resolve(__dirname, runDir, 'data', 'raw.json');
const extractedPath = getArg('--extracted')
  ? path.resolve(__dirname, getArg('--extracted'))
  : path.join(__dirname, 'datasets/attr-gaps-final/extracted.json');

const outputDir = path.dirname(extractedPath);

if (!fs.existsSync(rawPath)) { console.error('raw.json not found:', rawPath); process.exit(1); }

const rawRows = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

// Load extracted attributes if available
let extractedItems = [];
if (fs.existsSync(extractedPath)) {
  extractedItems = JSON.parse(fs.readFileSync(extractedPath, 'utf8'));
  console.log(`Loaded ${extractedItems.length} extracted items from ${extractedPath}`);
} else {
  console.log(`No extracted.json found at ${extractedPath} — only Excel attributes will be used.`);
}

const extractedBySku = new Map();
for (const item of extractedItems) {
  extractedBySku.set(item.sku, item);
}

// eBay metadata / non-spec attribute names — not useful for product posters
// Only physical/technical specs are valid (Material, Finish, Length, Voltage, etc.)
const EBAY_METADATA_NAMES = new Set([
  'eBay Product ID (ePID)',
  'Manufacturer Part Number',
  'California Prop 65 Warning',
  'Brand',
  'UPC',
  'MPN',
  'Sub Type',
  'Part Type',
  'Notes',
  'Part Category',
  'Part Fitment',
  'Product Line',
  'Package Depth',
  'Package Height',
  'Package Width',
  'Shipping Weight',
  'Country of Origin',
  'Item Width',
  'Item Length',
  'Item Diameter',
  'Type',
  'Made in USA',
  'Dimensions',
]);

// Quality check functions
const QUALITY_CHECKS = [
  {
    test: (name, value) => /[a-z][A-Z]/.test(value) && value.length > 25,
    reason: 'concatenated nonsense (camelCase in long value)',
  },
  {
    test: (name, value) => typeof value === 'string' && value.length > 50,
    reason: 'value too long (>50 chars)',
  },
  {
    test: (name, value) => /^\d{3,}[-\d]*$/.test(value),
    reason: 'looks like part number',
  },
  // eBay metadata names are already stripped before quality checks run
  {
    test: (name, value) => typeof value === 'string' && /\s{3,}/.test(value),
    reason: 'excessive whitespace in value',
  },
];

function flagAttrs(attrs) {
  const flags = [];
  for (const [name, value] of attrs) {
    for (const check of QUALITY_CHECKS) {
      if (check.test(name, value)) {
        flags.push({ name, value, reason: check.reason });
      }
    }
  }
  return flags;
}

function parseItemSpecifics(json) {
  if (!json || json === 'null') return [];
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (Array.isArray(parsed)) {
      // Already [[name, value], ...] or [{name, value}, ...]
      if (parsed.length === 0) return [];
      if (Array.isArray(parsed[0])) return parsed;
      if (parsed[0].name !== undefined) return parsed.map(p => [p.name, p.value]);
    }
    if (typeof parsed === 'object') {
      return Object.entries(parsed);
    }
  } catch (e) { /* ignore parse errors */ }
  return [];
}

// Process all items
const allAttributes = [];
let fromExcel = 0, fromExtracted = 0, noAttrs = 0;

// Extract last meaningful segment from eBay category breadcrumb
function cleanPartType(cat) {
  if (!cat) return '';
  // "eBay Motors > Parts > ... > See more Foo Bar" → last segment before "See more", or last segment
  const parts = cat.split('>').map(s => s.trim());
  // Find last segment that isn't a "See more..." suffix
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!parts[i].startsWith('See more')) return parts[i];
  }
  return parts[parts.length - 1] || '';
}

for (const row of rawRows) {
  const sku = row.SKU;
  const partType = cleanPartType(row['Category Hierarchy'] || '');
  const specs = row['Item Specifics (JSON)'];
  const excelAttrs = parseItemSpecifics(specs);
  const extracted = extractedBySku.get(sku);

  let attrs, source;

  if (excelAttrs.length > 0) {
    attrs = excelAttrs.filter(([name]) => !EBAY_METADATA_NAMES.has(name));
    source = 'excel';
    fromExcel++;
  } else if (extracted && extracted.attrs && extracted.attrs.length > 0) {
    attrs = extracted.attrs.filter(([name]) => !EBAY_METADATA_NAMES.has(name));
    source = 'extracted';
    fromExtracted++;
  } else {
    attrs = [];
    source = 'none';
    noAttrs++;
  }

  const flags = flagAttrs(attrs);

  // Collect description bullets (Features and Benefits)
  const fab = row['Features and Benefits'] || [];
  const descSnippet = (row.Description || '').slice(0, 200);

  allAttributes.push({
    sku,
    partType,
    title: row['Original Title'] || row['eBay Listing Title'] || '',
    brand: 'JEGS',
    partNumber: row.SKU,
    description: descSnippet,
    features: Array.isArray(fab) ? fab : [],
    attrs,
    source,
    flags,
    flagCount: flags.length,
  });
}

// Sort: flagged first, then by source priority (excel > extracted > none)
const sourcePriority = { none: 0, extracted: 1, excel: 2 };
allAttributes.sort((a, b) => {
  if (b.flagCount !== a.flagCount) return b.flagCount - a.flagCount;
  return sourcePriority[a.source] - sourcePriority[b.source];
});

// Write output
fs.mkdirSync(outputDir, { recursive: true });
const outPath = path.join(outputDir, 'all-attributes.json');
fs.writeFileSync(outPath, JSON.stringify(allAttributes, null, 2));

const flaggedCount = allAttributes.filter(a => a.flagCount > 0).length;
const totalAttrPairs = allAttributes.reduce((sum, a) => sum + a.attrs.length, 0);

console.log('\n=== Attribute Review Summary ===');
console.log(`Total items:        ${allAttributes.length}`);
console.log(`From Excel:         ${fromExcel}`);
console.log(`From LLM extraction:${fromExtracted}`);
console.log(`No attributes:      ${noAttrs}`);
console.log(`Total attr pairs:   ${totalAttrPairs}`);
console.log(`Items with flags:   ${flaggedCount}`);
console.log(`Clean items:        ${allAttributes.length - flaggedCount - noAttrs}`);
console.log(`\nOutput: ${outPath}`);
console.log(`\nNext: node generate-attribute-review.js --input ${outPath}`);
