#!/usr/bin/env node
/**
 * 100c-validate-from-filled.js — cell-level cross-check for the iter3
 * combined xlsx. Uses _combined-manifest-v3.json to walk each brand's
 * dstRow range, re-reads its 02-{brand}-filled.jsonl, and compares every
 * cell against the combined xlsx output.
 *
 * 0 mismatches required per R1.2.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATADIR = 'walmart-q2-phase1/data';

const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text != null) return String(v.text);
  return String(v);
}

async function loadFilled(p) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
  for await (const line of rl) { if (!line) continue; try { out.push(JSON.parse(line)); } catch (e) {} }
  return out;
}

(async () => {
  const t0 = Date.now();
  const args = process.argv.slice(2);
  const VERSION_TAG = (args.indexOf('--version') !== -1) ? args[args.indexOf('--version')+1] : 'v4';
  const manifest = JSON.parse(fs.readFileSync(path.join(DATADIR, `_combined-manifest-${VERSION_TAG}.json`)));
  // ExcelJS can't read 26MB+ workbook into the default heap; we already use --max-old-space-size.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(manifest.combined.path);
  const ws = wb.getWorksheet('Phase 1');

  let cellsCompared = 0, mismatches = 0;
  const mismatchSamples = [];
  let brandsValidated = 0;

  for (const [brand, info] of Object.entries(manifest.brands)) {
    if (!info.filledPath) continue;
    const emissions = await loadFilled(info.filledPath);
    if (emissions.length !== info.rowCount) {
      console.warn(`[${brand}] row count drift: manifest ${info.rowCount} vs filled ${emissions.length}`);
    }
    let dst = info.dstRowStart;
    for (const e of emissions) {
      const row = ws.getRow(dst);
      for (let c = 1; c < COL_FIELD_MAP.length; c++) {
        const expVal = e.cells[COL_FIELD_MAP[c]] ? String(e.cells[COL_FIELD_MAP[c]].value) : '';
        const gotVal = cellText(row.getCell(c).value);
        cellsCompared++;
        if (expVal !== gotVal) {
          mismatches++;
          if (mismatchSamples.length < 20) mismatchSamples.push({ brand, dst, col: c, field: COL_FIELD_MAP[c], expected: expVal, got: gotVal });
        }
      }
      dst++;
    }
    brandsValidated++;
    if (brandsValidated % 10 === 0) process.stdout.write(`\r[brands validated: ${brandsValidated}  cells: ${cellsCompared}  mismatches: ${mismatches}]`);
  }

  const audit = {
    validatedAt: new Date().toISOString(),
    combinedPath: manifest.combined.path,
    combinedSha256: manifest.combined.sha256,
    brandsValidated,
    cellsCompared,
    mismatches,
    mismatchSamples,
    pass: mismatches === 0,
    durationSeconds: ((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(path.join(DATADIR, `_audit-validate-combined-${VERSION_TAG}.json`), JSON.stringify(audit, null, 2));
  console.log(`\n\n${audit.pass ? '✓' : '✗'} brands=${brandsValidated}  cells=${cellsCompared}  mismatches=${mismatches}  in ${audit.durationSeconds.toFixed(1)}s`);
  process.exit(audit.pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
