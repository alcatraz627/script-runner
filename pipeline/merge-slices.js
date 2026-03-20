#!/usr/bin/env node
/**
 * pipeline/merge-slices.js — Merge agent-processed slice files back into a step output
 *
 * Usage:
 *   node pipeline/merge-slices.js <run-folder> <step-id>
 *
 * Expects cleaned slice files at:
 *   /tmp/<step-id>-slice-<offset>-cleaned.json
 *
 * Reads the original (pre-step) data from data/<prev-step>.json,
 * patches in cleaned attribute fields by partNumber, and saves data/<step-id>.json.
 *
 * The cleaned files must be arrays of objects with at minimum:
 *   { partNumber, attrsSmall, attrsFull }
 * Any extra fields are merged back onto the original row.
 */

const fs   = require('fs');
const path = require('path');
const io   = require('./io');

const args      = process.argv.slice(2);
const runFolder = args[0];
const stepId    = args[1];

if (!runFolder || !stepId) {
  console.error('Usage: node pipeline/merge-slices.js <run-folder> <step-id>');
  process.exit(1);
}

const runDir    = path.resolve(runFolder);
const configPath = path.join(runDir, 'run.config.js');
const config    = require(configPath);
const dataDir   = path.join(runDir, 'data');

// ── Find all cleaned slice files ──────────────────────────────────────────────
const slicePattern = new RegExp(`^${stepId}-slice-(\\d+)-cleaned\\.json$`);
const sliceFiles = fs.readdirSync('/tmp')
  .filter(f => slicePattern.test(f))
  .sort((a, b) => {
    const offsetA = parseInt(a.match(slicePattern)[1]);
    const offsetB = parseInt(b.match(slicePattern)[1]);
    return offsetA - offsetB;
  });

if (!sliceFiles.length) {
  console.error(`No cleaned slice files found in /tmp/ matching: ${stepId}-slice-*-cleaned.json`);
  console.error('Run the pipeline with --agent-slices first, then have agents process each slice.');
  process.exit(1);
}

console.log(`\nFound ${sliceFiles.length} cleaned slice(s):`);
sliceFiles.forEach(f => console.log(`  /tmp/${f}`));

// ── Load all cleaned rows ─────────────────────────────────────────────────────
const cleanedMap = new Map(); // partNumber → cleaned fields
let totalCleaned = 0;

for (const file of sliceFiles) {
  const rows = io.readFile(path.join('/tmp', file));
  for (const r of rows) {
    if (r.partNumber) cleanedMap.set(r.partNumber, r);
  }
  totalCleaned += rows.length;
}
console.log(`  ${totalCleaned} cleaned rows loaded`);

// ── Find the step's input (previous step output) ──────────────────────────────
const allSteps  = config.steps || [];
const stepIdx   = allSteps.findIndex(s => s.id === stepId);
const prevStepId = stepIdx <= 0 ? 'raw' : allSteps[stepIdx - 1].id;

const originalRows = io.readFile(path.join(dataDir, `${prevStepId}.json`));
console.log(`  ${originalRows.length} original rows from data/${prevStepId}.json`);

// ── Patch cleaned fields onto original rows ───────────────────────────────────
// Match by Part Number and overwrite only the attribute fields. This preserves
// all original data while applying the LLM-cleaned attribute values.
let patched = 0;
let missing = 0;

const merged = originalRows.map(row => {
  const pn = row['Part Number'];
  const cleaned = cleanedMap.get(pn);
  if (!cleaned) { missing++; return row; }
  patched++;
  return {
    ...row,
    'Attributes Small': cleaned.attrsSmall ?? row['Attributes Small'],
    'Attributes Full':  cleaned.attrsFull  ?? row['Attributes Full'],
  };
});

console.log(`  ✓ Patched: ${patched}  |  Missing from cleaned: ${missing}`);

// ── Save ──────────────────────────────────────────────────────────────────────
const outFile = path.join(dataDir, `${stepId}.json`);
io.writeFile(merged, outFile);
console.log(`  ✓ Saved → data/${stepId}.json`);

// Update final.json alias
fs.copyFileSync(outFile, path.join(dataDir, 'final.json'));
console.log(`  ✓ Updated data/final.json\n`);
