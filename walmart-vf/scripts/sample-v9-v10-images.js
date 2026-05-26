#!/usr/bin/env node
/**
 * sample-v9-v10-images.js
 * Inspect col 17 (mainImageUrl) and col 19 (productSecondaryImageURL) across v9 and v10.
 * Print:
 *   - exact added/changed/removed counts
 *   - source-host distribution (eBay vs Walmart vs Summit vs other) for both files
 *   - 10 example rows showing v9 vs v10 side-by-side
 *
 * Read-only, no JSON written.
 */
'use strict';
const ExcelJS = require('exceljs');
const path    = require('path');

const SCRIPTS_ROOT = path.join(__dirname, '..', '..');
const V9  = path.join(SCRIPTS_ROOT, 'walmart-loadsheet-filled-v9.xlsx');
const V10 = path.join(SCRIPTS_ROOT, 'walmart-loadsheet-filled-v10.xlsx');
const SHEET = 'Product Content And Site Exp';
const COL_MAIN = 17, COL_SEC = 19, DATA_START = 6;

async function readImageCols(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET);
  const rows = [];
  for (let r = DATA_START; r <= ws.rowCount; r++) {
    const main = ws.getRow(r).getCell(COL_MAIN).value;
    const sec  = ws.getRow(r).getCell(COL_SEC).value;
    rows.push({
      r,
      main: main == null ? '' : (main.text != null ? main.text : String(main)),
      sec:  sec  == null ? '' : (sec.text  != null ? sec.text  : String(sec))
    });
  }
  return rows;
}

const host = u => {
  try { return new URL(u).hostname.replace('www.', ''); }
  catch { return u ? '<INVALID>' : '<EMPTY>'; }
};

(async () => {
  const a = await readImageCols(V9);
  const b = await readImageCols(V10);
  const N = Math.max(a.length, b.length);

  // Distributions
  const dist = (rows, field) => {
    const m = {};
    rows.forEach(r => { const h = host(r[field]); m[h] = (m[h]||0)+1; });
    return m;
  };
  const printDist = (label, m) => {
    console.log(`  ${label}:`);
    Object.entries(m).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => console.log(`    ${String(v).padStart(6)} ${k}`));
  };

  console.log('═══ mainImageUrl host distribution ═══');
  console.log('v9:'); printDist('host', dist(a, 'main'));
  console.log('v10:'); printDist('host', dist(b, 'main'));

  console.log('\n═══ productSecondaryImageURL host distribution ═══');
  console.log('v9:'); printDist('host', dist(a, 'sec'));
  console.log('v10:'); printDist('host', dist(b, 'sec'));

  // counts again, scoped to each col
  const counts = (field) => {
    let added=0, removed=0, same=0, changed=0;
    for (let i = 0; i < N; i++) {
      const av = (a[i] || {})[field] || '';
      const bv = (b[i] || {})[field] || '';
      if (!av && bv)        added++;
      else if (av && !bv)   removed++;
      else if (av === bv)   same++;
      else                  changed++;
    }
    return { added, removed, same, changed };
  };
  console.log('\n═══ counts ═══');
  console.log(`mainImageUrl              ${JSON.stringify(counts('main'))}`);
  console.log(`productSecondaryImageURL  ${JSON.stringify(counts('sec'))}`);

  // 10 sample CHANGED rows for mainImageUrl
  console.log('\n═══ 10 mainImageUrl CHANGED examples (v9 → v10) ═══');
  let shown = 0;
  for (let i = 0; i < N && shown < 10; i++) {
    const av = (a[i] || {}).main || '', bv = (b[i] || {}).main || '';
    if (av && bv && av !== bv) {
      console.log(`row ${a[i].r}:`);
      console.log(`  v9 :  ${av.slice(0, 110)}`);
      console.log(`  v10:  ${bv.slice(0, 110)}`);
      shown++;
    }
  }

  console.log('\n═══ 5 productSecondaryImageURL ADDED examples (v9 empty → v10 has) ═══');
  shown = 0;
  for (let i = 0; i < N && shown < 5; i++) {
    const av = (a[i] || {}).sec || '', bv = (b[i] || {}).sec || '';
    if (!av && bv) {
      console.log(`row ${b[i].r}:`);
      console.log(`  v10:  ${bv.slice(0, 140)}`);
      shown++;
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
