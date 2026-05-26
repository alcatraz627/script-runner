#!/usr/bin/env node
/**
 * Exhaustively probe a Walmart loadsheet template.
 *
 * Captures: sheets, header rows (1-5), per-column hidden state, widths,
 * data-validation dropdowns / list references, sample row, merged cells.
 *
 * Usage:
 *   node 01-probe-template.js <path-to-xlsx> [out.json]
 *
 * Writes JSON + prints a human summary. Designed so the same script can
 * probe the new Q2 template and the old vf template for a clean diff.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '..', 'data', '_template-probe.json');

if (!SRC || !fs.existsSync(SRC)) {
  console.error('Usage: node 01-probe-template.js <path-to-xlsx> [out.json]');
  process.exit(1);
}

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.formula) return `=${v.formula}`;
    if (v.hyperlink) return String(v.hyperlink);
  }
  return String(v);
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);

  const report = {
    source: SRC,
    probedAt: new Date().toISOString(),
    sheets: [],
  };

  wb.eachSheet((ws, sheetId) => {
    const sheetInfo = {
      sheetId,
      name: ws.name,
      state: ws.state, // visible / hidden / veryHidden
      rowCount: ws.rowCount,
      columnCount: ws.columnCount,
      actualRowCount: ws.actualRowCount,
      actualColumnCount: ws.actualColumnCount,
      merges: ws.model && ws.model.merges ? ws.model.merges : [],
      headerRows: {},   // row 1..5 values per column
      columns: [],      // per-column metadata
      dataValidations: [], // dropdowns
      sampleRow: null,
    };

    // Header rows 1-5
    for (let r = 1; r <= Math.min(5, ws.actualRowCount); r++) {
      const row = ws.getRow(r);
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const cell = row.getCell(c);
        vals.push(cellText(cell.value));
      }
      sheetInfo.headerRows[`row${r}`] = vals;
    }

    // Per-column metadata
    for (let c = 1; c <= ws.columnCount; c++) {
      const col = ws.getColumn(c);
      sheetInfo.columns.push({
        index: c,
        letter: col.letter,
        key: col.key || null,
        width: col.width || null,
        hidden: !!col.hidden,
        outlineLevel: col.outlineLevel || 0,
      });
    }

    // Data validations (dropdowns / lists)
    // exceljs exposes per-cell via cell.dataValidation; iterate header zone + first data row
    const dvSeen = new Map();
    for (let r = 1; r <= Math.min(20, ws.actualRowCount); r++) {
      const row = ws.getRow(r);
      for (let c = 1; c <= ws.columnCount; c++) {
        const cell = row.getCell(c);
        if (cell.dataValidation) {
          const dv = cell.dataValidation;
          const sig = `${c}:${dv.type}:${(dv.formulae || []).join('|')}`;
          if (!dvSeen.has(sig)) {
            dvSeen.set(sig, true);
            sheetInfo.dataValidations.push({
              col: c,
              row: r,
              type: dv.type,
              allowBlank: dv.allowBlank,
              showDropDown: dv.showDropDown,
              formulae: dv.formulae,
              operator: dv.operator,
              prompt: dv.prompt,
              promptTitle: dv.promptTitle,
            });
          }
        }
      }
    }

    // Sample row: first row after header zone that has any data
    for (let r = 6; r <= Math.min(20, ws.actualRowCount); r++) {
      const row = ws.getRow(r);
      const vals = [];
      let nonEmpty = 0;
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = cellText(row.getCell(c).value);
        vals.push(v);
        if (v) nonEmpty++;
      }
      if (nonEmpty > 0) {
        sheetInfo.sampleRow = { row: r, nonEmptyCount: nonEmpty, values: vals };
        break;
      }
    }

    // Workbook-level defined names that reference this sheet (often used for dropdown lists)
    sheetInfo.definedNamesReferencing = [];

    report.sheets.push(sheetInfo);
  });

  // Workbook defined names
  report.definedNames = wb.definedNames && wb.definedNames.model ? wb.definedNames.model : [];

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  // Human summary to stdout
  console.log(`\n${'='.repeat(70)}\nProbe: ${SRC}\nWrote: ${OUT}\n${'='.repeat(70)}`);
  console.log(`Sheets: ${report.sheets.length}`);
  report.sheets.forEach(s => {
    console.log(`\n  Sheet: "${s.name}" (id=${s.sheetId}, state=${s.state})`);
    console.log(`    rows=${s.actualRowCount}/${s.rowCount}  cols=${s.actualColumnCount}/${s.columnCount}`);
    const hidden = s.columns.filter(c => c.hidden).map(c => c.index);
    console.log(`    hidden cols (${hidden.length}): ${hidden.slice(0, 30).join(',')}${hidden.length > 30 ? '...' : ''}`);
    console.log(`    data validations: ${s.dataValidations.length}`);
    console.log(`    merges: ${(s.merges || []).length}`);
  });
  console.log('');
})().catch(e => { console.error(e); process.exit(1); });
