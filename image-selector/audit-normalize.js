#!/usr/bin/env node
/**
 * audit-normalize.js
 * Comprehensive quality audit of normalize.json for a given run.
 * Usage: node image-selector/audit-normalize.js [run-id]
 */

const path = require('path');
const fs = require('fs');

const runId = process.argv[2] || 'jegs-ebay-final';
const dataPath = path.resolve(__dirname, `../runs/${runId}/data/normalize.json`);

if (!fs.existsSync(dataPath)) {
  console.error(`File not found: ${dataPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const total = data.length;

console.log(`\n═══════════════════════════════════════════════════`);
console.log(`  Normalize Audit — ${runId}  (${total} items)`);
console.log(`═══════════════════════════════════════════════════\n`);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const isEmpty = (v) =>
  v === null || v === undefined || v === '' ||
  (Array.isArray(v) && v.length === 0);

const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 47 - title.length))}`);
}

// ─── 1. Field presence / missing counts ──────────────────────────────────────

section('1. Field Presence');

const scalarFields = ['Part Number', 'Part Type', 'Description', 'Title', 'Brand', 'Fitment', 'Images'];
const arrayFields  = ['Attributes Small', 'Attributes Full', 'Features & Benefits'];

const missingCounts = {};
for (const field of [...scalarFields, ...arrayFields]) {
  missingCounts[field] = data.filter(item => isEmpty(item[field])).length;
}

for (const field of scalarFields) {
  const n = missingCounts[field];
  const ok = n === 0 ? '✓' : '✗';
  console.log(`  ${ok}  ${field.padEnd(20)}  missing: ${String(n).padStart(3)}  (${pct(n)})`);
}

for (const field of arrayFields) {
  const n = missingCounts[field];
  const ok = n === 0 ? '✓' : '✗';
  console.log(`  ${ok}  ${field.padEnd(20)}  empty:   ${String(n).padStart(3)}  (${pct(n)})`);
}

// ─── 2. Images detail ────────────────────────────────────────────────────────

section('2. Images Detail');

// Known stock/placeholder eBay image base paths
const BLOCKED_IMG_BASES = new Set([
  'https://i.ebayimg.com/00/s/MTIzM1gxNjAw/z/l94AAeSwhLdo2FOA/$_1',
  'https://i.ebayimg.com/images/g/1VEAAOSwBahVcLz8/s-l1600',
  'https://i.ebayimg.com/images/g/DOcAAOSw8NplLtwK/s-l1600',
  'https://i.ebayimg.com/images/g/DnkAAeSwAKtpgwkt/s-l1600',
  'https://i.ebayimg.com/images/g/Eq8AAeSwWthplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/gm8AAeSwQgBplcJ8/s-l1600',
  'https://i.ebayimg.com/images/g/rBQAAeSwlJVplcJ8/s-l1600',
  'pics.ebaystatic.com/aw/pics/nextGenVit/imgNoImg',
]);
const stripImgExt = u => u.replace(/\.[^.?]+(\?.*)?$/, '');
const isBlockedImg = u => u && BLOCKED_IMG_BASES.has(stripImgExt(u));

const missingImages   = data.filter(item => isEmpty(item['Images']));
const blockedImages   = data.filter(item => isBlockedImg(item['Images'] || ''));
const multipleImages  = data.filter(item => typeof item['Images'] === 'string' && item['Images'].split('\n').filter(Boolean).length > 1);
const singleImage     = data.filter(item => typeof item['Images'] === 'string' && item['Images'].trim() !== '' && item['Images'].split('\n').filter(Boolean).length === 1);

console.log(`  Missing images:    ${missingImages.length} (${pct(missingImages.length)})`);
console.log(`  Blocked/stock URL: ${blockedImages.length} (${pct(blockedImages.length)})`);
console.log(`  Single image:      ${singleImage.length} (${pct(singleImage.length)})`);
console.log(`  Multiple images:   ${multipleImages.length} (${pct(multipleImages.length)})`);
if (missingImages.length > 0) {
  console.log(`\n  Sample missing (first 5 Part Numbers):`);
  missingImages.slice(0, 5).forEach(i => console.log(`    - ${i['Part Number']} | ${i['Part Type'] || '(no type)'}`));
}
if (blockedImages.length > 0) {
  console.log(`\n  ⚠ Blocked URLs still present (first 5):`);
  blockedImages.slice(0, 5).forEach(i => console.log(`    - ${i['Part Number']}: ${i['Images']}`));
}

// ─── 3. Duplicate values per column ──────────────────────────────────────────

section('3. Duplicate Values Per Column');

const dupFields = ['Part Number', 'Title', 'Description', 'Part Type', 'Brand', 'Images'];
for (const field of dupFields) {
  const valueCounts = {};
  for (const item of data) {
    const v = (item[field] || '').toString().trim();
    if (v) valueCounts[v] = (valueCounts[v] || 0) + 1;
  }
  const dups = Object.entries(valueCounts).filter(([, c]) => c > 1);
  const dupItemCount = dups.reduce((sum, [, c]) => sum + c, 0);
  console.log(`  ${field.padEnd(20)}  ${dups.length} duplicate values, affecting ${dupItemCount} items`);
  if (field === 'Part Number' && dups.length > 0) {
    console.log(`    ⚠ DUPLICATE PART NUMBERS:`);
    dups.slice(0, 10).forEach(([v, c]) => console.log(`      "${v}" × ${c}`));
  }
  if (field === 'Title' && dups.length > 0) {
    console.log(`    Sample duplicated titles (first 3):`);
    dups.slice(0, 3).forEach(([v, c]) => console.log(`      "${v.slice(0, 80)}..." × ${c}`));
  }
}

// ─── 4. Attributes stats ─────────────────────────────────────────────────────

section('4. Attributes Stats');

const attrCounts = data.map(item => (item['Attributes Small'] || []).length);
const zeroAttr = attrCounts.filter(n => n === 0).length;
const avgAttr  = (attrCounts.reduce((a, b) => a + b, 0) / total).toFixed(1);
const minAttr  = Math.min(...attrCounts);
const maxAttr  = Math.max(...attrCounts);

console.log(`  Items with 0 attributes:     ${zeroAttr} (${pct(zeroAttr)})`);
console.log(`  Avg attributes per item:     ${avgAttr}`);
console.log(`  Min / Max:                   ${minAttr} / ${maxAttr}`);

// Distribution buckets
const buckets = { '0': 0, '1-3': 0, '4-6': 0, '7-10': 0, '11+': 0 };
for (const n of attrCounts) {
  if (n === 0) buckets['0']++;
  else if (n <= 3) buckets['1-3']++;
  else if (n <= 6) buckets['4-6']++;
  else if (n <= 10) buckets['7-10']++;
  else buckets['11+']++;
}
console.log(`  Distribution:  0=${buckets['0']}  1-3=${buckets['1-3']}  4-6=${buckets['4-6']}  7-10=${buckets['7-10']}  11+=${buckets['11+']}`);

// Junk attribute key detector
const JUNK_KEYS = new Set([
  'eBay Product ID (ePID)', 'Manufacturer Part Number', 'Prop 65',
  'Country of Origin', 'Notes', 'Item Width', 'Item Length', 'Item Diameter',
  'Type', 'Made in USA', 'Dimensions', 'Sub Type',
]);
const FITMENT_KEYS = new Set(['Engine Type', 'Transmission Type', 'Transmission', 'Axle Type', 'Side', 'Brake Type', 'Lug Pattern']);

let itemsWithJunk = 0, totalJunkAttrs = 0;
let itemsWithFitment = 0, totalFitmentAttrs = 0;

for (const item of data) {
  const attrs = item['Attributes Small'] || [];
  const junk = attrs.filter(([k]) => JUNK_KEYS.has(k));
  const fit  = attrs.filter(([k]) => FITMENT_KEYS.has(k));
  if (junk.length > 0) { itemsWithJunk++; totalJunkAttrs += junk.length; }
  if (fit.length > 0)  { itemsWithFitment++; totalFitmentAttrs += fit.length; }
}

console.log(`\n  Junk eBay attrs still present:  ${itemsWithJunk} items, ${totalJunkAttrs} total attr entries`);
console.log(`  Fitment attrs in Small/Full:    ${itemsWithFitment} items, ${totalFitmentAttrs} total attr entries`);

// ─── 5. Features & Benefits stats ────────────────────────────────────────────

section('5. Features & Benefits');

const fabCounts = data.map(item => (item['Features & Benefits'] || []).length);
const zeroFab  = fabCounts.filter(n => n === 0).length;
const avgFab   = (fabCounts.reduce((a, b) => a + b, 0) / total).toFixed(1);
console.log(`  Items with 0 FAB:    ${zeroFab} (${pct(zeroFab)})`);
console.log(`  Avg FAB per item:    ${avgFab}`);
console.log(`  Min / Max:           ${Math.min(...fabCounts)} / ${Math.max(...fabCounts)}`);

// ─── 6. Description quality ───────────────────────────────────────────────────

section('6. Description Quality');

const SHORT_DESC = 80;
const shortDescs = data.filter(item => {
  const d = item['Description'] || '';
  return d.length > 0 && d.length < SHORT_DESC;
});
const emptyDescs = data.filter(item => isEmpty(item['Description']));
const descLengths = data.map(item => (item['Description'] || '').length);
const avgDescLen = (descLengths.reduce((a, b) => a + b, 0) / total).toFixed(0);
const minDescLen = Math.min(...descLengths);
const maxDescLen = Math.max(...descLengths);

console.log(`  Missing descriptions:          ${emptyDescs.length} (${pct(emptyDescs.length)})`);
console.log(`  Short descriptions (<${SHORT_DESC} chars):  ${shortDescs.length}`);
console.log(`  Avg / Min / Max length:        ${avgDescLen} / ${minDescLen} / ${maxDescLen} chars`);

// Detect descriptions still containing scraped boilerplate
const BOILERPLATE_SIGNALS = ['|', 'eBay', 'listing', 'See description'];
const boilerplateDescs = data.filter(item => {
  const d = item['Description'] || '';
  return BOILERPLATE_SIGNALS.some(sig => d.includes(sig));
});
console.log(`  Possible boilerplate remaining: ${boilerplateDescs.length}`);
if (boilerplateDescs.length > 0) {
  boilerplateDescs.slice(0, 3).forEach(item => {
    console.log(`    - ${item['Part Number']}: "${item['Description'].slice(0, 100)}..."`);
  });
}

// ─── 7. Part Type stats ───────────────────────────────────────────────────────

section('7. Part Type');

const partTypeCounts = {};
for (const item of data) {
  const pt = (item['Part Type'] || '').trim();
  partTypeCounts[pt] = (partTypeCounts[pt] || 0) + 1;
}

const uniquePartTypes = Object.keys(partTypeCounts).filter(k => k !== '');
const missing = partTypeCounts[''] || 0;

// Detect eBay breadcrumb Part Types
const breadcrumbPTs = Object.entries(partTypeCounts)
  .filter(([k]) => k.includes('>') || k.toLowerCase().includes('ebay motors'));

console.log(`  Missing Part Types:    ${missing} (${pct(missing)})`);
console.log(`  Unique Part Types:     ${uniquePartTypes.length}`);
console.log(`  eBay breadcrumb PTs:   ${breadcrumbPTs.length}`);
if (breadcrumbPTs.length > 0) {
  breadcrumbPTs.slice(0, 3).forEach(([k, c]) => console.log(`    "${k}" × ${c}`));
}

// Top 10 most common part types
const topPTs = Object.entries(partTypeCounts)
  .filter(([k]) => k)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 10);
console.log(`\n  Top 10 Part Types:`);
topPTs.forEach(([k, c]) => console.log(`    ${String(c).padStart(3)}  ${k}`));

// ─── 8. Brand stats ───────────────────────────────────────────────────────────

section('8. Brand');

const brandCounts = {};
for (const item of data) {
  const b = (item['Brand'] || '').trim() || '(empty)';
  brandCounts[b] = (brandCounts[b] || 0) + 1;
}

Object.entries(brandCounts)
  .sort(([, a], [, b]) => b - a)
  .forEach(([k, c]) => console.log(`  ${String(c).padStart(4)}  ${k}`));

// ─── 9. Title vs Part Number mismatch ─────────────────────────────────────────

section('9. Title / Part Number Check');

// Detect titles that contain a different JEGS part number than the Part Number field
const mismatchedTitles = data.filter(item => {
  const pn = (item['Part Number'] || '').replace('555-', '');
  const title = item['Title'] || '';
  const titleNumMatch = title.match(/JEGS\s+(\d+)/);
  if (!titleNumMatch) return false;
  return titleNumMatch[1] !== pn;
});
console.log(`  Titles with different JEGS# than Part Number: ${mismatchedTitles.length}`);
if (mismatchedTitles.length > 0) {
  mismatchedTitles.slice(0, 5).forEach(item => {
    console.log(`    PN: ${item['Part Number']} | Title: ${item['Title'].slice(0, 80)}`);
  });
}

// ─── 10. Fitment stats ────────────────────────────────────────────────────────

section('10. Fitment');

const withFitment    = data.filter(item => !isEmpty(item['Fitment']));
const withoutFitment = data.filter(item => isEmpty(item['Fitment']));
console.log(`  With fitment data:     ${withFitment.length} (${pct(withFitment.length)})`);
console.log(`  Without fitment data:  ${withoutFitment.length} (${pct(withoutFitment.length)})`);

// ─── Summary ─────────────────────────────────────────────────────────────────

section('Summary');

const issues = [];
if (missingCounts['Images'] > 0)       issues.push(`${missingCounts['Images']} items missing images`);
if (blockedImages.length > 0)          issues.push(`${blockedImages.length} items with blocked/stock image URLs`);
if (missingCounts['Description'] > 0)  issues.push(`${missingCounts['Description']} items missing descriptions`);
if (missingCounts['Part Type'] > 0)    issues.push(`${missingCounts['Part Type']} items missing Part Type`);
if (zeroAttr > 0)                      issues.push(`${zeroAttr} items with 0 attributes`);
if (zeroFab > 0)                       issues.push(`${zeroFab} items with 0 Features & Benefits`);
if (breadcrumbPTs.length > 0)          issues.push(`${breadcrumbPTs.length} eBay breadcrumb Part Types remain`);
if (itemsWithJunk > 0)                 issues.push(`${itemsWithJunk} items with junk eBay attributes`);
if (mismatchedTitles.length > 0)       issues.push(`${mismatchedTitles.length} title/PN mismatches`);

if (issues.length === 0) {
  console.log('  ✓ No issues found!');
} else {
  issues.forEach(i => console.log(`  ✗  ${i}`));
}

console.log(`\n═══════════════════════════════════════════════════\n`);
