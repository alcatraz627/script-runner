#!/usr/bin/env node
/**
 * inspect-walmart-loadsheet.js
 * Inspects the Walmart loadsheet template — prints all sheets,
 * headers, and full data for small sheets (Data Definitions) +
 * first 3 rows for larger ones.
 */

const ExcelJS = require('exceljs');
const path = require('path');

const FILE = path.join(process.env.HOME, 'Downloads', 'Walmart Loadhseet Mar 30.xlsx');

async function inspect() {
  console.log(`Inspecting: ${FILE}\n`);

  // Use full workbook read (template is small)
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(FILE);

  for (const ws of workbook.worksheets) {
    console.log(`\n${'━'.repeat(70)}`);
    console.log(`Sheet: "${ws.name}" (id: ${ws.id}) — ${ws.rowCount} rows × ${ws.columnCount} cols`);
    console.log('━'.repeat(70));

    const maxRows = ws.name.includes('Definition') ? 200 : 5;

    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum > maxRows) {
        if (rowNum === maxRows + 1) console.log(`  … (truncated, ${ws.rowCount - maxRows} more rows)`);
        return;
      }
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const v = cell.value;
        let display = '';
        if (v === null || v === undefined) display = '(empty)';
        else if (typeof v === 'object' && v.richText) display = v.richText.map(r => r.text).join('');
        else if (typeof v === 'object' && v.text) display = v.text;
        else display = String(v);
        vals.push(`[${colNum}] ${display.slice(0, 80)}`);
      });
      console.log(`\n  Row ${rowNum}:`);
      vals.forEach(v => console.log(`    ${v}`));
    });
  }

  console.log('\n✓ Done');
}

inspect().catch(err => { console.error(err); process.exit(1); });
