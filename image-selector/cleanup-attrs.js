#!/usr/bin/env node
/**
 * cleanup-attrs.js
 *
 * Cleans attribute values in changes.json:
 *   1. Capitalize first letter of each value
 *   2. Remove non-ASCII characters
 *   3. Standardize measurement units
 *
 * Preserves: approved, rejected, mainImage, feedback, fitOverrides
 *
 * Usage:
 *   node cleanup-attrs.js [--state <path>] [--dry-run]
 */

const fs   = require('fs');
const path = require('path');

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const dryRun    = process.argv.includes('--dry-run');
const statePath = path.resolve(getArg('--state') || path.join(__dirname, 'datasets/attr-gaps-final/changes.json'));

if (!fs.existsSync(statePath)) { console.error('State file not found:', statePath); process.exit(1); }

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

// --- Unit standardization map ---
// Pattern → replacement (applied in order, word-boundary aware)
const UNIT_RULES = [
  // Length
  [/\binches\b/gi, 'in.'],
  [/\binch\b/gi, 'in.'],
  [/\bin\.\./g, 'in.'],       // fix double dot
  [/\bin\b(?![\.\w])/g, 'in.'], // bare "in" without dot (but not "in-line" etc)
  [/\bfeet\b/gi, 'ft.'],
  [/\bfoot\b/gi, 'ft.'],
  [/\bft\b(?![\.\w])/g, 'ft.'],
  [/\byards?\b/gi, 'yd.'],
  // Weight
  [/\bpounds?\b/gi, 'lb.'],
  [/\blbs\b\.?/gi, 'lb.'],
  [/\blb\b(?![\.\w])/g, 'lb.'],
  [/\bounces?\b/gi, 'oz.'],
  [/\bozs?\b(?![\.\w])/gi, 'oz.'],
  // Volume
  [/\bgallons?\b/gi, 'gal.'],
  [/\bquarts?\b/gi, 'qt.'],
  // Temperature
  [/\bdegrees?\s*fahrenheit\b/gi, 'F'],
  [/\bdegrees?\s*celsius\b/gi, 'C'],
  // Electrical
  [/\bvolts?\b/gi, 'V'],
  [/\bamps?\b(?![\.\w])/gi, 'A'],
  [/\bamperes?\b/gi, 'A'],
  [/\bwatts?\b/gi, 'W'],
  [/\bohms?\b/gi, 'ohm'],
  // Metric
  [/\bmillimeters?\b/gi, 'mm'],
  [/\bcentimeters?\b/gi, 'cm'],
  [/\bmeters?\b(?![\.\w])/gi, 'm'],
  [/\bkilograms?\b/gi, 'kg'],
  [/\bgrams?\b(?![\.\w])/gi, 'g'],
  [/\bmillilit(?:er|re)s?\b/gi, 'mL'],
  [/\blit(?:er|re)s?\b/gi, 'L'],
];

function stripNonAscii(str) {
  return str.replace(/[^\x20-\x7E]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function capitalizeFirst(str) {
  if (!str) return str;
  // Don't capitalize if starts with a number or is already uppercase abbreviation
  if (/^[0-9]/.test(str)) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function standardizeUnits(str) {
  let result = str;
  for (const [pattern, replacement] of UNIT_RULES) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function cleanValue(val) {
  let v = String(val);
  v = stripNonAscii(v);
  v = standardizeUnits(v);
  v = capitalizeFirst(v);
  return v;
}

function cleanName(name) {
  let n = String(name);
  n = stripNonAscii(n);
  n = capitalizeFirst(n);
  return n;
}

// --- Apply ---
let totalAttrs = 0, changedValues = 0, changedNames = 0, nonAsciiStripped = 0;
const examples = [];

for (const sku of Object.keys(state)) {
  const s = state[sku];
  if (!s.attrs || !Array.isArray(s.attrs)) continue;

  for (const attr of s.attrs) {
    totalAttrs++;
    const origName = attr[0];
    const origVal  = attr[1];

    const newName = cleanName(origName);
    const newVal  = cleanValue(origVal);

    if (newName !== origName) {
      changedNames++;
      if (examples.length < 20) examples.push({ sku, field: 'name', from: origName, to: newName });
      attr[0] = newName;
    }
    if (newVal !== origVal) {
      changedValues++;
      if (/[^\x20-\x7E]/.test(origVal)) nonAsciiStripped++;
      if (examples.length < 20) examples.push({ sku, field: 'value', from: origVal, to: newVal });
      attr[1] = newVal;
    }
  }
}

console.log('\n=== Attribute Cleanup ===');
console.log(`Total attributes:    ${totalAttrs}`);
console.log(`Values changed:      ${changedValues}`);
console.log(`Names changed:       ${changedNames}`);
console.log(`Non-ASCII stripped:  ${nonAsciiStripped}`);
console.log(`\nSample changes:`);
for (const ex of examples.slice(0, 15)) {
  console.log(`  [${ex.sku}] ${ex.field}: "${ex.from}" → "${ex.to}"`);
}

if (dryRun) {
  console.log('\n--dry-run: no files written');
} else {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log(`\nWritten: ${statePath}`);
}
