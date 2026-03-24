#!/usr/bin/env node
/**
 * fix-junk-attrs.js
 * Strips known junk eBay attribute keys from normalize.json and raw.json.
 *
 * Patches both files in place for a given run.
 * Usage: node image-selector/fix-junk-attrs.js [run-id]
 */

const fs = require('fs');
const path = require('path');

const runId = process.argv[2] || 'jegs-ebay-final';
const runDir = path.resolve(__dirname, `../runs/${runId}/data`);

const NORMALIZE_PATH = path.join(runDir, 'normalize.json');
const RAW_PATH       = path.join(runDir, 'raw.json');

// Keys to unconditionally remove (per original bulk-cleanup plan)
const REMOVE_KEYS = new Set([
  'eBay Product ID (ePID)',
  'Manufacturer Part Number',
  'Prop 65',
  'Brand',
  'Country of Origin',
  'Item Width',
  'Item Length',
  'Item Diameter',
  'Type',
  'Made in USA',
  'Dimensions',
  'Sub Type',
  // Notes: remove only if value starts with "Description--" (eBay boilerplate)
]);

// Notes values that are eBay boilerplate
const BOILERPLATE_NOTES_RE = /^(Description--|Set Description--)/i;

function shouldRemoveAttr([key, value]) {
  if (key === 'Notes' && BOILERPLATE_NOTES_RE.test(value || '')) return true;
  return REMOVE_KEYS.has(key);
}

// ─── Fix normalize.json (Attributes Small + Attributes Full arrays) ──────────

console.log(`\nRun: ${runId}`);
console.log(`─────────────────────────────────────`);

if (!fs.existsSync(NORMALIZE_PATH)) {
  console.error(`Not found: ${NORMALIZE_PATH}`);
  process.exit(1);
}

const normalize = JSON.parse(fs.readFileSync(NORMALIZE_PATH, 'utf8'));

let normAffected = 0, normRemoved = 0;
for (const item of normalize) {
  let changed = false;
  for (const field of ['Attributes Small', 'Attributes Full']) {
    const before = item[field] || [];
    const after  = before.filter(pair => !shouldRemoveAttr(pair));
    if (after.length !== before.length) {
      normRemoved += before.length - after.length;
      item[field] = after;
      changed = true;
    }
  }
  if (changed) normAffected++;
}

fs.writeFileSync(NORMALIZE_PATH, JSON.stringify(normalize, null, 2));
console.log(`normalize.json  →  ${normAffected} items patched, ${normRemoved} attr entries removed`);

// ─── Fix raw.json (Item Specifics (JSON) string field) ───────────────────────

if (!fs.existsSync(RAW_PATH)) {
  console.warn(`raw.json not found — skipping: ${RAW_PATH}`);
  process.exit(0);
}

const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));

let rawAffected = 0, rawRemoved = 0;
for (const item of raw) {
  const raw_specs = item['Item Specifics (JSON)'];
  if (!raw_specs || raw_specs === 'null') continue;

  let parsed;
  try {
    parsed = JSON.parse(raw_specs);
  } catch {
    continue; // malformed — leave alone
  }

  // raw.json stores attrs as { key: value } object
  const before = Object.keys(parsed).length;
  for (const key of Object.keys(parsed)) {
    if (shouldRemoveAttr([key, parsed[key]])) {
      delete parsed[key];
    }
  }
  const after = Object.keys(parsed).length;

  if (after !== before) {
    item['Item Specifics (JSON)'] = JSON.stringify(parsed);
    rawAffected++;
    rawRemoved += before - after;
  }
}

fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2));
console.log(`raw.json        →  ${rawAffected} items patched, ${rawRemoved} attr entries removed`);
console.log(`\nDone.\n`);
