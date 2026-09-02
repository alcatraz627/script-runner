#!/usr/bin/env node
/**
 * build-diff-excel.js
 *
 * Writes a side-by-side diff Excel for the 140 enriched rows.
 * Layout: blank | old | new | blank | old | new | …
 *
 * Colour scheme:
 *   Header row  — dark slate  (FF334155)
 *   Blank row   — white
 *   OLD row     — light amber (FFFFF3CD)
 *   NEW row     — light green (FFD4EDDA)
 *
 * Changed cells within a row are additionally bolded.
 *
 * Usage:
 *   node build-diff-excel.js
 *   node build-diff-excel.js --out runs/jegs-cc30-apr03-merged/output/diff.xlsx
 */

'use strict';

const fs      = require('fs');
const path    = require('path');
const ExcelJS = require('exceljs');

// ── Config ────────────────────────────────────────────────────────────────────

const MERGED_RUN  = path.resolve('runs/jegs-cc30-apr03-merged');
const NEW_DATA    = path.join(MERGED_RUN, 'data/sideload-enhanced-content.json');
const OLD_DATA    = path.resolve('runs/jegs-cc30-mar26-enhanced/data/raw.json');

const args    = process.argv.slice(2);
const getArg  = f => { const i = args.indexOf(f); return i >= 0 ? args[i+1] : null; };
const outPath = getArg('--out') ||
  path.join(MERGED_RUN, 'output', `diff-no-img-cc30-apr03-${new Date().toISOString().slice(0,10)}.xlsx`);

const EXCEL_CELL_LIMIT = 32000;

// ── Columns to include in diff (ordered) ─────────────────────────────────────

const COLUMNS = [
  '_row_label',    // synthetic: "OLD" / "NEW"
  '_changes',      // synthetic: change summary (NEW row only)
  'Part Number',
  'Part Type',
  'Brand',
  'Image',
  'Title',
  'Description',
  'Features & Benefits',
  'fit_type',
  'final_attributes',
  'raw_attributes',
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function flatten(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    if (typeof v[0] === 'object' && v[0] !== null) {
      // [{key,value}] or [[k,v]]
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

function cellVal(row, col, changeSummary = '') {
  if (col === '_row_label') return row.__label__ || '';
  if (col === '_changes')   return changeSummary;
  return trunc(flatten(row[col]));
}

function changed(oldRow, newRow, col) {
  if (col === '_row_label' || col === '_changes') return false;
  return String(cellVal(oldRow, col)) !== String(cellVal(newRow, col));
}

// ── Change summary (placed in NEW row _changes cell only) ─────────────────────

function attrKeys(attrArray) {
  if (!Array.isArray(attrArray)) return new Set();
  return new Set(attrArray.map(a => String(a.key ?? a.Key ?? '').trim().toLowerCase()).filter(Boolean));
}

function buildChangeSummary(oldRow, newRow) {
  const lines = [];

  // Image
  const oldImg = (oldRow['Image'] || '').trim();
  const newImg = (newRow['Image'] || '').trim();
  if (!oldImg && newImg)       lines.push('Image: Added');
  else if (oldImg && !newImg)  lines.push('Image: Removed');
  else if (oldImg !== newImg)  lines.push('Image: Updated');

  // final_attributes
  const oldKeys = attrKeys(oldRow.final_attributes);
  const newKeys = attrKeys(newRow.final_attributes);
  const oldCount = oldKeys.size, newCount = newKeys.size;
  if (oldCount === 0 && newCount === 0) {
    // both empty — no line
  } else if (oldCount !== newCount) {
    lines.push(`Attributes: ${oldCount} → ${newCount}`);
  } else {
    // same count — check for added/removed keys
    const added   = [...newKeys].filter(k => !oldKeys.has(k));
    const removed = [...oldKeys].filter(k => !newKeys.has(k));
    if (added.length === 0 && removed.length === 0) {
      // no change — omit
    } else {
      const parts = [];
      if (added.length)   parts.push(`+${added.join(', +')}`);
      if (removed.length) parts.push(`-${removed.join(', -')}`);
      lines.push(`Attributes: ${parts.join('  ')}`);
    }
  }

  // Title
  const oldTitle = (oldRow['Title'] || '').trim();
  const newTitle = (newRow['Title'] || '').trim();
  if (oldTitle !== newTitle) lines.push('Title: changed');

  return lines.join('\n');
}

// ── Load data ─────────────────────────────────────────────────────────────────

console.log('\nLoading data…');
const newAll = JSON.parse(fs.readFileSync(NEW_DATA, 'utf8'));
const oldAll = JSON.parse(fs.readFileSync(OLD_DATA, 'utf8'));

const newMap = new Map(newAll.map(r => [String(r['Part Number']||'').trim(), r]));
const oldMap = new Map(oldAll.map(r => [String(r['Part Number']||'').trim(), r]));

// Only the 140 enriched rows, in the order they appear in the new data
const enrichedPNs = newAll.filter(r => r._is_newer).map(r => String(r['Part Number']||'').trim());
console.log(`  ${enrichedPNs.length} enriched rows to diff`);

// ── Build workbook ────────────────────────────────────────────────────────────

const wb    = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('Diff');

// Header
const HEADER_LABELS = { _row_label: '', _changes: 'Changes' };
const headerRow = sheet.addRow(COLUMNS.map(c => HEADER_LABELS[c] ?? c));
headerRow.font   = { bold: true, color: { argb: 'FFFFFFFF' } };
headerRow.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
headerRow.height = 18;

// Track col widths (Changes col gets a fixed min of 32)
const colWidths = COLUMNS.map(c => c === '_changes' ? 32 : Math.min(Math.max(c.length, 8), 60));

let totalChanged = 0;

for (const pn of enrichedPNs) {
  const newRow = newMap.get(pn);
  const oldRow = oldMap.get(pn);

  if (!newRow) { console.warn(`  WARN: ${pn} not found in new data`); continue; }
  if (!oldRow) { console.warn(`  WARN: ${pn} not found in old data`); continue; }

  newRow.__label__ = 'NEW';
  oldRow.__label__ = 'OLD';

  const changeSummary = buildChangeSummary(oldRow, newRow);

  // Pre-compute which cols changed
  const changedCols = new Set(COLUMNS.filter(c => changed(oldRow, newRow, c)));
  if (changedCols.size > 0) totalChanged++;

  // ── Blank spacer row ───────────────────────────────────────────────────────
  const blank = sheet.addRow(COLUMNS.map(() => ''));
  blank.height = 6;

  // ── OLD row ────────────────────────────────────────────────────────────────
  const oldVals = COLUMNS.map(c => cellVal(oldRow, c, ''));  // no summary on old
  const oldSheetRow = sheet.addRow(oldVals);
  oldSheetRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
    const col = COLUMNS[colIdx - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };
    if (changedCols.has(col)) cell.font = { bold: true };
    const val = String(cell.value || '');
    if (val.length > colWidths[colIdx - 1]) colWidths[colIdx - 1] = Math.min(val.length, 60);
  });
  oldSheetRow.alignment = { wrapText: true, vertical: 'top' };

  // ── NEW row ────────────────────────────────────────────────────────────────
  const newVals = COLUMNS.map(c => cellVal(newRow, c, changeSummary));
  const newSheetRow = sheet.addRow(newVals);
  newSheetRow.eachCell({ includeEmpty: true }, (cell, colIdx) => {
    const col = COLUMNS[colIdx - 1];
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
    if (changedCols.has(col)) cell.font = { bold: true };
    const val = String(cell.value || '');
    if (val.length > colWidths[colIdx - 1]) colWidths[colIdx - 1] = Math.min(val.length, 60);
  });
  newSheetRow.alignment = { wrapText: true, vertical: 'top' };
}

// Apply column widths
sheet.columns = COLUMNS.map((c, i) => ({ key: c, width: colWidths[i] + 2 }));

// Freeze header
sheet.views = [{ state: 'frozen', ySplit: 1 }];

// ── Write ─────────────────────────────────────────────────────────────────────

fs.mkdirSync(path.dirname(outPath), { recursive: true });
wb.xlsx.writeFile(outPath).then(() => {
  console.log(`\n  Rows with ≥1 changed field: ${totalChanged}/${enrichedPNs.length}`);
  console.log(`  Output: ${outPath}\n`);
}).catch(err => { console.error(err); process.exit(1); });
