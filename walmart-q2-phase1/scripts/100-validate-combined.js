#!/usr/bin/env node
/**
 * 100-validate-combined.js — cell-level cross-reference validator per R1.2.
 *
 * Reads _combined-manifest.json + the combined xlsx + every per-brand xlsx,
 * walks the manifest, and confirms every cell in combined matches the
 * corresponding source brand cell. 0 mismatches required for ship.
 *
 * Output: data/_audit-validate-combined.json
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const OUTDIR  = 'walmart-q2-phase1/output';
const DATADIR = 'walmart-q2-phase1/data';

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object' && v.text != null) return String(v.text);
  return String(v);
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(DATADIR, '_combined-manifest.json')));
  const combinedWb = new ExcelJS.Workbook();
  await combinedWb.xlsx.readFile(manifest.combined.path);
  const combinedWs = combinedWb.getWorksheet('Phase 1');

  let cellsCompared = 0, mismatches = 0;
  const mismatchSamples = [];

  for (const [brand, info] of Object.entries(manifest.brands)) {
    const srcWb = new ExcelJS.Workbook();
    await srcWb.xlsx.readFile(info.src);
    const srcWs = srcWb.getWorksheet('Phase 1');

    let srcRow = info.srcRowStart;
    let dstRow = info.dstRowStart;
    for (let i = 0; i < info.rowCount; i++) {
      for (let c = 1; c <= 21; c++) {
        const srcVal = cellText(srcWs.getRow(srcRow).getCell(c).value);
        const dstVal = cellText(combinedWs.getRow(dstRow).getCell(c).value);
        cellsCompared++;
        if (srcVal !== dstVal) {
          mismatches++;
          if (mismatchSamples.length < 20) mismatchSamples.push({ brand, srcRow, dstRow, col: c, srcVal, dstVal });
        }
      }
      srcRow++;
      dstRow++;
    }
    console.log(`[${brand}] verified ${info.rowCount} rows (${info.rowCount * 21} cells)`);
  }

  const audit = {
    validatedAt: new Date().toISOString(),
    combinedPath: manifest.combined.path,
    cellsCompared,
    mismatches,
    mismatchSamples,
    pass: mismatches === 0,
  };
  fs.writeFileSync(path.join(DATADIR, '_audit-validate-combined.json'), JSON.stringify(audit, null, 2));

  console.log(`\n${audit.pass ? '✓' : '✗'} Combined cross-reference: ${cellsCompared} cells compared, ${mismatches} mismatches`);
  process.exit(audit.pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
