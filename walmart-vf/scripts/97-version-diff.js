#!/usr/bin/env node
/**
 * 97-version-diff.js — for each brand, compare the latest xlsx against
 * the previous 2 versions to detect any unintended drops in column coverage.
 *
 * Reports per-column delta of "rows with non-empty value" between versions.
 * A negative delta = something regressed.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const OUTDIR = path.join(__dirname, '..', 'output');
const SHEET = 'Product Content And Site Exp';
const DATA_START = 6;

async function readCells(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET);
  const rows = [];
  for (let r = DATA_START; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = [];
    for (let c = 1; c <= 94; c++) {
      const v = row.getCell(c).value;
      cells.push(v == null ? '' : (v.text != null ? v.text : String(v)));
    }
    rows.push(cells);
  }
  return rows;
}

function fillRate(rows) {
  const counts = new Array(94).fill(0);
  for (const r of rows) for (let c = 0; c < 94; c++) if (String(r[c]).trim()) counts[c]++;
  return counts;
}

(async () => {
  const brands = ['acdelco','dorman','holley','dayco'];
  for (const b of brands) {
    const rx = new RegExp(`^walmart-loadsheet-${b}-vf-v(\\d+)\\.xlsx$`);
    const versions = fs.readdirSync(OUTDIR)
      .map(f => { const m = f.match(rx); return m ? { f, n: parseInt(m[1]) } : null; })
      .filter(Boolean).sort((a, b) => b.n - a.n).slice(0, 3);
    if (versions.length < 2) { console.log(`${b}: only ${versions.length} versions found, skip`); continue; }

    console.log(`\n═══ ${b.toUpperCase()} — comparing v${versions[0].n} (latest) against v${versions[1].n}` + (versions[2] ? ` and v${versions[2].n}` : '') + ` ═══`);
    const cellsLatest = await readCells(path.join(OUTDIR, versions[0].f));
    const cellsPrev1  = await readCells(path.join(OUTDIR, versions[1].f));
    const cellsPrev2  = versions[2] ? await readCells(path.join(OUTDIR, versions[2].f)) : null;

    const rateLatest = fillRate(cellsLatest);
    const ratePrev1 = fillRate(cellsPrev1);
    const ratePrev2 = cellsPrev2 ? fillRate(cellsPrev2) : null;

    console.log(`  rows: latest=${cellsLatest.length}  prev1=${cellsPrev1.length}` + (cellsPrev2 ? `  prev2=${cellsPrev2.length}` : ''));
    let regressions = 0, gains = 0;
    for (let c = 0; c < 94; c++) {
      const latest = rateLatest[c];
      const prev1  = ratePrev1[c];
      const prev2  = ratePrev2 ? ratePrev2[c] : null;
      if (latest < prev1) {
        const dropPct = ((prev1 - latest) / Math.max(prev1, 1) * 100).toFixed(0);
        console.log(`  🔴 col ${String(c+1).padStart(2)}: latest=${latest} < prev1=${prev1} (-${prev1 - latest}, ${dropPct}%)`);
        regressions++;
      }
      if (prev2 != null && latest > prev1 && prev1 < prev2) {
        // possible recovery — note
      }
      if (latest > prev1) gains++;
    }
    if (!regressions) console.log(`  ✅ No regressions (gains in ${gains} cols)`);
  }
})().catch(e => { console.error(e); process.exit(1); });
