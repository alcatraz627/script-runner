#!/usr/bin/env node
/**
 * build-full-export.js
 *
 * Exports all 556 rows from the jegs-cc30-apr03-merged final pipeline data
 * as a styled Excel file. The 140 "newer" (enriched) rows are highlighted.
 *
 * Usage:
 *   node build-full-export.js
 *   node build-full-export.js --out path/to/output.xlsx
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const ExcelJS = require('exceljs');

const RUN_DIR  = path.resolve('runs/jegs-cc30-apr03-merged');
const DATA     = path.join(RUN_DIR, 'data/sideload-enhanced-content.json');

const args    = process.argv.slice(2);
const getArg  = f => { const i = args.indexOf(f); return i >= 0 ? args[i+1] : null; };
const outPath = getArg('--out') ||
  path.join(RUN_DIR, 'output', `cc30-apr03-full-export-${new Date().toISOString().slice(0,10)}.xlsx`);

const EXCEL_CELL_LIMIT = 32000;

// ── Columns ───────────────────────────────────────────────────────────────────

const COLUMNS = [
  { key: '_is_newer',           header: 'Enriched?',           width: 12 },
  { key: 'Part Number',         header: 'Part Number',         width: 18 },
  { key: 'Brand',               header: 'Brand',               width: 12 },
  { key: 'Part Type',           header: 'Part Type',           width: 28 },
  { key: 'Image',               header: 'Image URL',           width: 60 },
  { key: 'Title',               header: 'Title',               width: 55 },
  { key: 'Description',         header: 'Description',         width: 60 },
  { key: 'Features & Benefits', header: 'Features & Benefits', width: 60 },
  { key: 'fit_type',            header: 'Fit Type',            width: 14 },
  { key: 'final_attributes',    header: 'Final Attributes',    width: 55 },
  { key: 'raw_attributes',      header: 'Raw Attributes',      width: 55 },
  { key: 'url',                 header: 'JEGS URL',            width: 60 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function flatten(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    if (typeof v[0] === 'object' && v[0] !== null) {
      if (Array.isArray(v[0])) return v.map(p => p.join(': ')).join('\n');
      return v.map(a => `${a.key ?? a.Key ?? '?'}: ${a.value ?? a.Value ?? ''}`).join('\n');
    }
    return v.join('\n');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function trunc(s) {
  if (typeof s === 'string' && s.length > EXCEL_CELL_LIMIT)
    return s.substring(0, EXCEL_CELL_LIMIT) + '… [TRUNCATED]';
  return s;
}

function cellVal(row, key) {
  if (key === '_is_newer') return row._is_newer ? 'YES' : '';
  return trunc(flatten(row[key]));
}

// ── Load ──────────────────────────────────────────────────────────────────────

console.log('\nLoading data…');
const rows = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const newer = rows.filter(r => r._is_newer).length;
console.log(`  ${rows.length} total rows, ${newer} enriched`);

// ── Build workbook ────────────────────────────────────────────────────────────

const wb    = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('CC30 Apr03 Full');

// Header row
sheet.columns = COLUMNS.map(c => ({ key: c.key, header: c.header, width: c.width }));
const headerRow = sheet.getRow(1);
headerRow.font   = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
headerRow.height = 18;
headerRow.alignment = { vertical: 'middle' };

// Data rows
for (const row of rows) {
  const vals = {};
  for (const col of COLUMNS) vals[col.key] = cellVal(row, col.key);

  const sheetRow = sheet.addRow(vals);
  sheetRow.alignment = { wrapText: true, vertical: 'top' };

  if (row._is_newer) {
    // Highlight enriched rows with a subtle teal tint
    sheetRow.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F4F1' } };
    });
  }
}

// Freeze header + first two columns (Enriched? + Part Number)
sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 1 }];

// ── Write ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(path.dirname(outPath), { recursive: true });
wb.xlsx.writeFile(outPath).then(() => {
  console.log(`\n  Output: ${outPath}\n`);
}).catch(err => { console.error(err); process.exit(1); });
