#!/usr/bin/env node
/**
 * 03-verify-against-enhancement-ingest.js
 *
 * Runs the enhancement-product backend's own Excel reader over the flat sheet,
 * so "it will load" is a result rather than a prediction. Shells out to the
 * backend venv, because that reader is Python (openpyxl + pandas) and its
 * header rule silently drops any column pandas names "Unnamed: N".
 *
 * Usage:
 *   node aep-catalog-v9/scripts/03-verify-against-enhancement-ingest.js
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const XLSX = require('xlsx');
const SCHEMA = require('./schema');

const BACKEND = '/Users/alcatraz627/Code/Versable/enhancement-product/backend';
const PYTHON = path.join(BACKEND, '.venv/bin/python');
const TARGET = path.resolve(__dirname, '../output/AEP-Catalog-V9-Flat.xlsx');
const HARNESS = path.resolve(__dirname, '_ingest_probe.py');
const SRC = '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx';

// Derived from the source, so a new drop changes the expectation rather than
// failing for the right reason with the wrong number in the message.
const srcWb = XLSX.readFile(SRC, { cellDates: false });
const rd = (n) => XLSX.utils.sheet_to_json(srcWb.Sheets[n], { defval: null, raw: false, blankrows: false });
const trim = (v) => (v == null ? '' : String(v).trim());
const expectedRows = rd('Catalog').filter((r) => trim(r.Status) !== SCHEMA.SECTION_MARKER).length;
const expectedReasons = rd('Not Found').length;

// execFileSync throws on a non-zero exit and the probe's FAIL lines are on the
// throw's stdout, so without this catch a failure shows a Node stack trace and
// hides the diagnostic that says what actually broke.
try {
  process.stdout.write(execFileSync(PYTHON, [HARNESS, TARGET, String(expectedRows), String(expectedReasons)], { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (e) {
  if (e.stdout) process.stdout.write(e.stdout);
  if (e.stderr) process.stderr.write(e.stderr);
  console.error(`\ningest probe failed (exit ${e.status ?? 'unknown'})`);
  process.exit(e.status || 1);
}
