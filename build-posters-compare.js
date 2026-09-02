#!/usr/bin/env node
/**
 * build-posters-compare.js
 *
 * Creates _posters_compare/ inside a merged run directory by combining:
 *   - <runDir>/posters_diff/<sku>.png  →  _posters_compare/<sku>_new.png
 *   - <oldPostersDir>/<sku>.png        →  _posters_compare/<sku>_old.png
 *
 * Usage:
 *   node build-posters-compare.js <runDir> <oldPostersDir>
 *
 * Example:
 *   node build-posters-compare.js runs/jegs-cc30-apr03-merged \
 *       runs/jegs-cc30-mar26-enhanced/posters
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const [,, runDirArg, oldPostersArg] = process.argv;

if (!runDirArg || !oldPostersArg) {
  console.error('Usage: node build-posters-compare.js <runDir> <oldPostersDir>');
  process.exit(1);
}

const runDir      = path.resolve(runDirArg);
const newPostersDir = path.join(runDir, 'posters_diff');
const oldPostersDir = path.resolve(oldPostersArg);
const compareDir    = path.join(runDir, '_posters_compare');

// ── Validate inputs ───────────────────────────────────────────────────────────

if (!fs.existsSync(newPostersDir)) {
  console.error(`posters_diff/ not found in ${runDir}`);
  process.exit(1);
}
if (!fs.existsSync(oldPostersDir)) {
  console.error(`Old posters dir not found: ${oldPostersDir}`);
  process.exit(1);
}

// ── Recreate compare dir ──────────────────────────────────────────────────────

if (fs.existsSync(compareDir)) {
  fs.rmSync(compareDir, { recursive: true });
}
fs.mkdirSync(compareDir, { recursive: true });

// ── Process each new poster ───────────────────────────────────────────────────

const newFiles = fs.readdirSync(newPostersDir).filter(f => f.endsWith('.png'));
console.log(`\n  ${newFiles.length} posters in posters_diff/`);

let newCopied = 0, oldCopied = 0, oldMissing = [];

for (const file of newFiles) {
  const sku = path.basename(file, '.png');

  // Copy new poster as <sku>_new.png
  fs.copyFileSync(
    path.join(newPostersDir, file),
    path.join(compareDir, `${sku}_new.png`)
  );
  newCopied++;

  // Copy old poster as <sku>_old.png (if it exists)
  const oldFile = path.join(oldPostersDir, `${sku}.png`);
  if (fs.existsSync(oldFile)) {
    fs.copyFileSync(oldFile, path.join(compareDir, `${sku}_old.png`));
    oldCopied++;
  } else {
    oldMissing.push(sku);
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log(`  _new copied: ${newCopied}`);
console.log(`  _old copied: ${oldCopied}`);
if (oldMissing.length > 0) {
  console.log(`  _old missing (${oldMissing.length}): ${oldMissing.join(', ')}`);
}
console.log(`\n  Output: ${compareDir}`);
console.log(`  Total files: ${fs.readdirSync(compareDir).length}\n`);
