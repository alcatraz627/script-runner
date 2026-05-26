#!/usr/bin/env node
/**
 * Look for Data Definitions / examples in the template:
 *   - all sheets in the workbook
 *   - any cell comments (notes) on row 5 (header)
 *   - data validation rules per column (dropdown values)
 */
'use strict';
const ExcelJS = require('exceljs');
const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  console.log('All sheets:');
  wb.eachSheet(ws => console.log(`  "${ws.name}" (rows=${ws.rowCount} cols=${ws.columnCount})`));

  const ws = wb.getWorksheet('Product Content And Site Exp');

  // Look for ALL non-empty rows in 1-5 zone, plus check note/comment fields
  console.log('\n──── Cell notes (comments) on row 5 ────');
  for (let c = 1; c <= 94; c++) {
    const cell = ws.getRow(5).getCell(c);
    if (cell.note) {
      const t = typeof cell.note === 'string' ? cell.note : JSON.stringify(cell.note);
      console.log(`  col ${c}: ${t.slice(0,200)}`);
    }
  }

  // Look at data validations attached to col cells
  console.log('\n──── Data validations on row 6+ ────');
  for (let c = 1; c <= 94; c++) {
    const cell6 = ws.getRow(6).getCell(c);
    if (cell6.dataValidation) {
      console.log(`  col ${c}: ${JSON.stringify(cell6.dataValidation).slice(0, 300)}`);
    }
  }

  // Examine other sheets for "definitions" content
  console.log('\n──── Inspect any sheet whose name suggests definitions/help ────');
  for (const sheet of wb.worksheets) {
    if (/def|help|guide|legend|info|spec|valid/i.test(sheet.name)) {
      console.log(`\n--- Sheet: ${sheet.name} (rows=${sheet.rowCount}) ---`);
      for (let r = 1; r <= Math.min(20, sheet.rowCount); r++) {
        const vals = sheet.getRow(r).values.slice(1).map(v => v == null ? '' : (v.text != null ? v.text : String(v)));
        if (vals.some(v => v)) console.log(`  r${r}: ${vals.slice(0, 6).join(' | ').slice(0, 200)}`);
      }
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
