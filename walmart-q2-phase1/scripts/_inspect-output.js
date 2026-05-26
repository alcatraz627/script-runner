#!/usr/bin/env node
/**
 * Quick visual inspection of an assembled xlsx. Not part of the pipeline —
 * a debug helper.
 */
'use strict';
const ExcelJS = require('exceljs');

const SRC = process.argv[2] || 'walmart-q2-phase1/output/walmart-loadsheet-acdelco-q2p1-v1.xlsx';

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);

  console.log(`\n=== File: ${SRC} ===\n`);
  console.log(`Sheets: ${wb.worksheets.map(w => w.name).join(', ')}`);

  const ws = wb.getWorksheet('Phase 1');
  console.log(`Sheet "Phase 1": ${ws.actualRowCount} rows × ${ws.columnCount} cols`);

  // Header rows (1-3) — confirm preserved
  console.log('\n--- Row 1 (Required/Optional flags) ---');
  console.log(ws.getRow(1).values.slice(1).slice(0, 7).map(v => v || '').join(' | '));
  console.log('\n--- Row 3 (column headers) ---');
  ws.getRow(3).values.slice(1).forEach((v, i) => {
    console.log(`  col ${String(i+1).padStart(2)}: ${v || ''}`);
  });

  // Data rows 4-8 (5 sample data rows)
  console.log('\n--- Data rows 4-8 (first 5) ---');
  const headers = ws.getRow(3).values.slice(1);
  for (let r = 4; r <= 8; r++) {
    const row = ws.getRow(r);
    console.log(`\nRow ${r}:`);
    for (let c = 1; c <= ws.columnCount; c++) {
      const v = row.getCell(c).value;
      const h = headers[c-1];
      console.log(`  ${String(c).padStart(2)} ${String(h).padEnd(34)} = ${v === null || v === '' ? '(blank)' : JSON.stringify(v)}`);
    }
  }

  // Last data row to confirm full population
  const lastRow = 4 + 56; // 57 emissions → rows 4..60
  console.log(`\n--- Last data row ${lastRow} ---`);
  const lastVals = ws.getRow(lastRow).values.slice(1);
  lastVals.forEach((v, i) => console.log(`  ${String(i+1).padStart(2)} ${String(headers[i]).padEnd(34)} = ${v === null || v === '' ? '(blank)' : JSON.stringify(v)}`));

  // Sanity: row after data should be empty
  const emptyRow = ws.getRow(lastRow + 1).values.slice(1);
  const hasContent = emptyRow.some(v => v !== null && v !== '');
  console.log(`\nRow ${lastRow + 1} empty? ${!hasContent ? '✓ yes' : '✗ NO — has content: ' + JSON.stringify(emptyRow)}`);

  // Total row count check
  console.log(`\nactualRowCount: ${ws.actualRowCount}  (expect ~${3 + 57} = 60)`);

  // Spot-check: does row 3 (headers) match the original template?
  const expectedHeaders = ['Action(A or D)','Manufacturer Part Number (MPN)','BrandAAIAD','Year(YYYY)/Year Range (YYYY-YYYY)','Make','Model','Part Terminology Id','Part Terminology Name','SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType','Bed Length','BodyType','BodyNumDoors','Notes'];
  const headersOK = headers.every((h, i) => String(h) === expectedHeaders[i]);
  console.log(`\nHeaders preserved? ${headersOK ? '✓ yes' : '✗ NO'}`);

  // Merged cells preserved?
  const merges = ws.model && ws.model.merges ? ws.model.merges : [];
  console.log(`Merged cell ranges preserved: ${merges.length} (expect 3 from template: S1:T1, B1:G1, H1:R1)`);
  merges.forEach(m => console.log(`  ${m}`));
})().catch(e => { console.error(e); process.exit(1); });
