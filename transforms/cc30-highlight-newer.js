/**
 * transforms/cc30-highlight-newer.js
 *
 * Side-effect transform: reads `_is_newer` flag on rows and writes a
 * second Excel file with those rows highlighted in light green.
 *
 * The normal pipeline output (JSON + plain Excel) is unaffected —
 * this transform returns rows unchanged and writes the styled file
 * as a side effect into <runDir>/output/.
 *
 * Uses exceljs for cell-level fill styling (SheetJS community doesn't support it).
 *
 * @config {string}  [label]      Reference label used in output filename (default: 'highlighted')
 * @config {string}  [fillColor]  ARGB hex fill for newer rows (default: FFD4EDDA — light green)
 * @config {boolean} [skipPrivate] Exclude fields starting with '_' from Excel output (default: true)
 */

'use strict';

const path = require('path');
const ExcelJS = require('exceljs');

const EXCEL_CELL_LIMIT = 32000;

function flattenValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    if (v.length === 0) return '';
    if (Array.isArray(v[0])) return v.map(pair => pair.join(': ')).join('\n');
    if (typeof v[0] === 'object' && v[0] !== null) return JSON.stringify(v);
    return v.join('\n');
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

function truncate(v) {
  if (typeof v === 'string' && v.length > EXCEL_CELL_LIMIT) {
    return v.substring(0, EXCEL_CELL_LIMIT) + '… [TRUNCATED]';
  }
  return v;
}

module.exports = async function cc30HighlightNewer(rows, config = {}, context = {}) {
  const emit     = context.onEvent || (() => {});
  const runDir   = context.runDir;
  if (!runDir) throw new Error('cc30-highlight-newer requires runDir in context');

  const label      = config.label || 'highlighted';
  const fillColor  = config.fillColor || 'FFD4EDDA';  // light green
  const skipPriv   = config.skipPrivate !== false;

  const newerRows    = rows.filter(r => r._is_newer);
  const newerCount   = newerRows.length;

  emit({ type: 'info', message: `Highlighting ${newerCount}/${rows.length} rows marked _is_newer` });

  if (newerCount === 0) {
    emit({ type: 'warn', message: 'No rows with _is_newer=true — highlight Excel will have no green rows' });
  }

  // ── Build column list (exclude private _ fields) ──────────────────────────

  const headers = Object.keys(rows[0] || {}).filter(k => !skipPriv || !k.startsWith('_'));

  // ── Write styled Excel with exceljs ──────────────────────────────────────

  const date     = new Date().toISOString().slice(0, 10);
  const filename = `${label}-${date}.xlsx`;
  const outDir   = path.join(runDir, 'output');
  const outPath  = path.join(outDir, filename);

  const workbook = new ExcelJS.Workbook();
  const sheet    = workbook.addWorksheet('Data');

  // Header row (bold)
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern', pattern: 'solid',
    fgColor: { argb: 'FFE2E8F0' },  // light grey header
  };

  // Auto-width hint: track max content length per column
  const colWidths = headers.map(h => Math.min(Math.max(h.length, 10), 60));

  // Data rows
  for (const row of rows) {
    const values = headers.map((h, i) => {
      const raw = flattenValue(row[h]);
      const cell = truncate(typeof raw === 'number' ? raw : String(raw));
      if (typeof cell === 'string' && cell.length > colWidths[i]) {
        colWidths[i] = Math.min(cell.length, 60);
      }
      return cell;
    });

    const sheetRow = sheet.addRow(values);

    if (row._is_newer) {
      sheetRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: fillColor },
        };
      });
    }
  }

  // Apply column widths
  sheet.columns = headers.map((h, i) => ({ key: h, width: colWidths[i] + 2 }));

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  await workbook.xlsx.writeFile(outPath);

  emit({ type: 'info', message: `Highlighted Excel written: output/${filename}  (${newerCount} green rows)` });

  // Return rows unchanged — this step is a side-effect writer only
  return rows;
};
