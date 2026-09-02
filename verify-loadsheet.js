#!/usr/bin/env node
/**
 * verify-loadsheet.js — reads the filled loadsheet and prints a spot-check
 * of N data rows (skipping the 5 header rows).
 */
'use strict';
const ExcelJS = require('exceljs');
const path    = require('path');

// Default to highest-numbered v* file
function latestFile() {
  const files = require('fs').readdirSync(__dirname)
    .filter(f => /^walmart-loadsheet-filled-v\d+\.xlsx$/.test(f))
    .sort((a, b) => {
      const n = f => parseInt(f.match(/v(\d+)/)[1]);
      return n(b) - n(a);
    });
  return files[0] ? path.join(__dirname, files[0]) : null;
}
const FILE = process.argv[2] || latestFile();
const N    = parseInt(process.argv[3] || '3');

async function verify() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet('Product Content And Site Exp');
  if (!ws) { console.error('Sheet not found'); process.exit(1); }

  // Row 4 = human-readable headers
  const headerRow = ws.getRow(4);
  const headers   = [];
  headerRow.eachCell({ includeEmpty: true }, (c, i) => { headers[i] = String(c.value || ''); });

  // Key columns to spot-check
  const CHECK_COLS = [
    2, 4, 8, 9, 10, 11, 12,
    13, 14, 15, 16, 17,
    23, 24, 25, 26, 27, 31, 33,
    34, 35, 36, 37, 38, 39, 40, 41,
    42, 43, 44, 45, 47, 48, 50, 51, 53,
    59, 63, 64, 65, 66, 67, 90,
  ];

  let count = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= 5 || count >= N) return;
    count++;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`Data row ${rowNum - 5} (sheet row ${rowNum}):`);
    CHECK_COLS.forEach(colNum => {
      const cell = row.getCell(colNum);
      let val = cell.value;
      if (val === null || val === undefined) val = '(empty)';
      const display = String(val).slice(0, 120);
      const label   = (headers[colNum] || `col${colNum}`).slice(0, 28).padEnd(28);
      console.log(`  [${String(colNum).padStart(2)}] ${label} → ${display}`);
    });
  });

  console.log(`\n✓ Verified ${count} data rows`);
}
verify().catch(err => { console.error(err); process.exit(1); });
