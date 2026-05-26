#!/usr/bin/env node
/**
 * Read the "Data Definitions" sheet from the Walmart Loadsheet template.
 * Write a JSON keyed by Attribute Name → { definition, examples, minChars, maxChars, productType }.
 *
 * Output: walmart-vf/data/_template-data-definitions.json
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';
const OUT = path.join(__dirname, '..', 'data', '_template-data-definitions.json');

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  const ws = wb.getWorksheet('Data Definitions');
  const out = {};
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = c => {
      const v = row.getCell(c).value;
      return v == null ? '' : (v.text != null ? v.text : String(v));
    };
    const name = get(1).trim();
    if (!name) continue;
    out[name] = {
      definition:  get(2).trim(),
      productType: get(3).trim(),
      examples:    get(4).trim(),
      minChars:    parseInt(get(5)) || null,
      maxChars:    parseInt(get(6)) || null,
    };
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Definitions captured: ${Object.keys(out).length}`);
  console.log(`Sample keys: ${Object.keys(out).slice(0, 12).join(' | ')}`);
})().catch(e => { console.error(e); process.exit(1); });
