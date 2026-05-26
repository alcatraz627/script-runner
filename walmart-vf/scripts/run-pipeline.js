#!/usr/bin/env node
/**
 * run-pipeline.js — run the full pipeline for one or all brands.
 *
 *   node run-pipeline.js --brand <brandKey>
 *   node run-pipeline.js --brand all
 *
 * Stages (each script may be skipped via flag):
 *   --skip-scrape           skip building per-brand fullscrape index
 *   --skip-shared-indices   skip universal indices (brand/enhanced/taxonomy/defs)
 *   --skip-proposal         skip regenerating measure-unit-proposals CSV (if you've edited it)
 *
 * Universal indices are built once (idempotent) before any brand runs.
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const brandArg = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const targets = brandArg === 'all'
  ? Object.keys(BRANDS)
  : (BRANDS[brandArg] ? [brandArg] : null);

if (!targets) {
  console.error(`Usage: run-pipeline.js --brand <key|all>   (known: ${Object.keys(BRANDS).join(', ')})`);
  process.exit(1);
}

const SCRIPTS = __dirname;
const skipScrape         = args.includes('--skip-scrape');
const skipSharedIndices  = args.includes('--skip-shared-indices');
const skipProposal       = args.includes('--skip-proposal');

function run(cmd) {
  console.log(`\n$ ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit' });
}

// Universal stage (once)
if (!skipSharedIndices) {
  run(`node ${path.join(SCRIPTS, 'dump-data-definitions.js')}`);
  run(`node ${path.join(SCRIPTS, '11-build-indices.js')}`);
}

for (const brandKey of targets) {
  const cfg = BRANDS[brandKey];
  console.log(`\n══════════════════════════════════════════════════════════════════════════════\n  Brand: ${cfg.outputBrandString} (${brandKey})\n══════════════════════════════════════════════════════════════════════════════`);
  if (!skipScrape) {
    run(`node ${path.join(SCRIPTS, 'build-fullscrape-by-mpn.js')} --brand "${cfg.outputBrandString}"`);
  }
  run(`node ${path.join(SCRIPTS, '10-extract.js')} --brand ${brandKey}`);
  run(`node ${path.join(SCRIPTS, 'build-attribute-inventory.js')} --brand ${brandKey}`);
  if (!skipProposal) {
    run(`node ${path.join(SCRIPTS, 'propose-measure-unit.js')} --brand ${brandKey}`);
  }
  run(`node ${path.join(SCRIPTS, '20-fill.js')} --brand ${brandKey}`);
  run(`node ${path.join(SCRIPTS, '30-assemble.js')} --brand ${brandKey}`);
  run(`node ${path.join(SCRIPTS, '40-verify.js')} --brand ${brandKey}`);
}

console.log(`\n✓ Pipeline complete for: ${targets.map(b => BRANDS[b].outputBrandString).join(', ')}`);
