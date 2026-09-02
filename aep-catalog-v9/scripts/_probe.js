#!/usr/bin/env node
// Probe the AEP workbook: sheet names, dims, first rows raw (no header assumption).
const XLSX = require('xlsx');
const SRC = '/Users/alcatraz627/Downloads/AEP Catalog V9 - Fitment Data.xlsx';

const wb = XLSX.readFile(SRC, { cellDates: true });
console.log('SHEETS:', JSON.stringify(wb.SheetNames));
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  const range = XLSX.utils.decode_range(ref);
  console.log(`\n=== ${name} === ref=${ref} rows=${range.e.r + 1} cols=${range.e.c + 1}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r = (rows[i] || []).map(v => (v === null || v === undefined ? '' : String(v).slice(0, 40)));
    console.log(`  r${i}: [${r.length}] ${JSON.stringify(r)}`);
  }
  console.log('  merges:', (ws['!merges'] || []).length);
}
