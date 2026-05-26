#!/usr/bin/env node
/**
 * inspect-walmart-excel.js
 * Quick structural inspection of a large Excel file via streaming ExcelJS.
 * Prints: sheet names, row count, column headers, and 3 sample rows per sheet.
 */

const ExcelJS = require('exceljs');
const path = require('path');

const FILE = process.argv[2] || path.join(process.env.HOME, 'Downloads', 'export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx');

async function inspect() {
  console.log(`Inspecting: ${FILE}\n`);

  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(FILE, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
  });

  for await (const ws of workbook) {
    console.log(`\n━━━ Sheet: "${ws.name}" (id: ${ws.id}) ━━━`);

    let rowCount = 0;
    let headers = null;
    const samples = [];

    for await (const row of ws) {
      const vals = row.values.slice(1); // drop leading undefined at index 0

      if (rowCount === 0) {
        headers = vals.map(v => (v && typeof v === 'object' && v.text) ? v.text : String(v ?? ''));
        console.log(`Columns (${headers.length}):`, headers);
      } else if (samples.length < 3) {
        const obj = {};
        headers.forEach((h, i) => {
          let v = vals[i];
          if (v && typeof v === 'object' && v.text) v = v.text;
          if (v && typeof v === 'object' && v.result !== undefined) v = v.result;
          obj[h] = v ?? null;
        });
        samples.push(obj);
      }
      rowCount++;
    }

    console.log(`Total rows (excl. header): ${rowCount - 1}`);
    console.log('\nSample rows:');
    samples.forEach((s, i) => {
      console.log(`\n  Row ${i + 1}:`);
      Object.entries(s).forEach(([k, v]) => {
        const display = v === null ? '(null)' : String(v).slice(0, 120);
        console.log(`    ${k}: ${display}`);
      });
    });
  }

  console.log('\n✓ Done');
}

inspect().catch(err => { console.error(err); process.exit(1); });
