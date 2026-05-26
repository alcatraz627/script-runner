#!/usr/bin/env node
/**
 * Diff walmart-loadsheet-filled-v9.xlsx vs walmart-loadsheet-filled-v10.xlsx
 * For each of the 94 columns, report:
 *   - rows filled in v10 but blank in v9  (newly added)
 *   - rows filled in v9 but blank in v10  (regression — should be 0)
 *   - rows where value changed
 *   - first 3 examples of each
 */
'use strict';
const ExcelJS = require('exceljs');
const path    = require('path');

const V9 = path.join(__dirname, '..', '..', 'walmart-loadsheet-filled-v9.xlsx');
const V10 = path.join(__dirname, '..', '..', 'walmart-loadsheet-filled-v10.xlsx');
const SHEET = 'Product Content And Site Exp';
const DATA_START_ROW = 6;

async function readSheet(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Sheet not found in ${file}`);
  // Header row 5 (per template convention, label row)
  const header = ws.getRow(5).values.slice(1).map(v => (v && v.text) || (v == null ? '' : String(v)));
  const rows = [];
  for (let r = DATA_START_ROW; r <= ws.rowCount; r++) {
    const row = ws.getRow(r).values.slice(1)
      .map(v => v == null ? '' : (v.text != null ? v.text : (typeof v === 'object' ? JSON.stringify(v) : String(v))));
    rows.push(row);
  }
  return { header, rows };
}

(async () => {
  const a = await readSheet(V9);
  const b = await readSheet(V10);
  const N = Math.max(a.rows.length, b.rows.length);
  const C = Math.max(a.header.length, b.header.length);
  console.log(`v9 rows=${a.rows.length}  v10 rows=${b.rows.length}  cols=${C}\n`);

  const colReports = [];
  for (let c = 0; c < C; c++) {
    const name = b.header[c] || a.header[c] || `col${c+1}`;
    let added = 0, removed = 0, changed = 0;
    const ex = { added: [], removed: [], changed: [] };
    for (let r = 0; r < N; r++) {
      const av = (a.rows[r] && a.rows[r][c]) || '';
      const bv = (b.rows[r] && b.rows[r][c]) || '';
      if (!av && bv)  { added++;   if (ex.added.length<2)   ex.added.push({ row: r+DATA_START_ROW, v: String(bv).slice(0,80) }); }
      else if (av && !bv) { removed++; if (ex.removed.length<2) ex.removed.push({ row: r+DATA_START_ROW, v: String(av).slice(0,80) }); }
      else if (av !== bv) { changed++; if (ex.changed.length<2) ex.changed.push({ row: r+DATA_START_ROW, a: String(av).slice(0,40), b: String(bv).slice(0,40) }); }
    }
    if (added || removed || changed) colReports.push({ c: c+1, name, added, removed, changed, ex });
  }

  console.log(`Columns with any diff: ${colReports.length} of ${C}\n`);
  for (const r of colReports) {
    console.log(`Col ${r.c} "${r.name}": +${r.added}  -${r.removed}  ~${r.changed}`);
    if (r.ex.added.length)   console.log(`   ADDED ex:   ${JSON.stringify(r.ex.added)}`);
    if (r.ex.removed.length) console.log(`   REMOVED ex: ${JSON.stringify(r.ex.removed)}`);
    if (r.ex.changed.length) console.log(`   CHANGED ex: ${JSON.stringify(r.ex.changed)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
