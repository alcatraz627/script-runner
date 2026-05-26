#!/usr/bin/env node
/**
 * Read Walmart Loadsheet template and dump column header rows for mapping.
 */
'use strict';
const ExcelJS = require('exceljs');

const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';
const SHEET = 'Product Content And Site Exp';

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  const ws = wb.getWorksheet(SHEET);
  console.log(`Sheet "${SHEET}" cols=${ws.columnCount} rows=${ws.rowCount}`);
  // Dump rows 1-5 (template header zone) to find the canonical name row
  for (let r = 1; r <= 5; r++) {
    const vals = ws.getRow(r).values.slice(1).map(v => v == null ? '' : (v.text != null ? v.text : String(v)));
    console.log(`\nRow ${r} [${vals.length} cells]:`);
    vals.forEach((v, i) => {
      if (v) console.log(`  col ${String(i+1).padStart(2)}: ${String(v).slice(0,80)}`);
    });
  }
})().catch(e => { console.error(e); process.exit(1); });
