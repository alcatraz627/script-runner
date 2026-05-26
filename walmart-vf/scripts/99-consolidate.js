#!/usr/bin/env node
/**
 * 99-consolidate.js — final consolidation step (different from main pipeline).
 *
 * Reads latest per-brand xlsx, drops rows where col 11 (Shipping Weight) is empty,
 * concatenates surviving rows into a single combined xlsx using the same template.
 *
 * Output: walmart-vf/output/walmart-loadsheet-combined-vf-v1.xlsx
 * Side output: data/_combined-manifest-v1.json (per-row provenance: which brand
 *              file + source row index, used by the cross-ref validator).
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';
const SHEET = 'Product Content And Site Exp';
const OUTDIR = path.join(__dirname, '..', 'output');
const DATA_DIR = path.join(__dirname, '..', 'data');
const BRANDS = require('./brands.config.js');

const SHIPPING_WEIGHT_COL = 11;
const DATA_START = 6;
const NUM_COLS = 94;

function nextCombinedVersion() {
  const rx = /^walmart-loadsheet-combined-vf-v(\d+)\.xlsx$/;
  const existing = fs.readdirSync(OUTDIR).map(f => { const m = f.match(rx); return m ? parseInt(m[1]) : 0; });
  return (existing.length ? Math.max(...existing) : 0) + 1;
}

function latestPerBrand() {
  const out = {};
  for (const b of Object.keys(BRANDS)) {
    const rx = new RegExp(`^walmart-loadsheet-${b}-vf-v(\\d+)\\.xlsx$`);
    const versions = fs.readdirSync(OUTDIR)
      .map(f => { const m = f.match(rx); return m ? { f, n: parseInt(m[1]) } : null; })
      .filter(Boolean).sort((a, b) => b.n - a.n);
    if (versions.length) out[b] = versions[0].f;
  }
  return out;
}

(async () => {
  const sources = latestPerBrand();
  console.log(`Source files (latest per brand):`);
  for (const [b, f] of Object.entries(sources)) console.log(`  ${b}: ${f}`);

  // Read each brand: collect rows where col 11 is non-empty
  const allRows = [];
  const manifest = { generated: new Date().toISOString(), source_files: sources, kept: [], dropped: [] };
  for (const [brandKey, fname] of Object.entries(sources)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path.join(OUTDIR, fname));
    const ws = wb.getWorksheet(SHEET);
    let kept = 0, dropped = 0;
    for (let r = DATA_START; r <= ws.rowCount; r++) {
      const sourceRow = ws.getRow(r);
      // Capture full row values + style (we only carry values; the template at write
      // time will provide the column widths & hidden state)
      const rowValues = [];
      for (let c = 1; c <= NUM_COLS; c++) {
        const v = sourceRow.getCell(c).value;
        rowValues.push(v == null ? '' : (v.text != null ? v.text : v));
      }
      const shippingWeight = String(rowValues[SHIPPING_WEIGHT_COL - 1] || '').trim();
      const mpn = String(rowValues[27 - 1] || '').trim();
      if (!shippingWeight) {
        dropped++;
        manifest.dropped.push({ brand: brandKey, sourceFile: fname, sourceRow: r, mpn, reason: 'shipping_weight_empty' });
        continue;
      }
      allRows.push({ brandKey, sourceFile: fname, sourceRow: r, mpn, values: rowValues });
      kept++;
    }
    console.log(`  ${brandKey}: ${kept} kept, ${dropped} dropped (no shipping weight)`);
  }
  console.log(`\nTotal kept: ${allRows.length}`);

  // Open template, splice template data rows, write our consolidated rows
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  const ws = wb.getWorksheet(SHEET);
  for (let r = ws.rowCount; r >= DATA_START; r--) ws.spliceRows(r, 1);

  // Match the same hide/unhide policy as 30-assemble.js v12
  const HIDE_AFTER_FILL = new Set([18, 19, 21, 22, 24, 25, 26]);
  // Identify which cols actually have any data across our rows
  const colsWithData = new Set();
  for (const row of allRows) {
    for (let c = 1; c <= NUM_COLS; c++) {
      if (String(row.values[c - 1] || '').trim()) colsWithData.add(c);
    }
  }
  for (const c of colsWithData) {
    ws.getColumn(c).hidden = HIDE_AFTER_FILL.has(c);
  }

  allRows.forEach((row, i) => {
    const target = ws.getRow(DATA_START + i);
    for (let c = 1; c <= NUM_COLS; c++) {
      target.getCell(c).value = row.values[c - 1] || null;
    }
    target.commit();
    manifest.kept.push({ targetRow: DATA_START + i, brand: row.brandKey, sourceFile: row.sourceFile, sourceRow: row.sourceRow, mpn: row.mpn });
  });

  const VERSION = nextCombinedVersion();
  const OUT = path.join(OUTDIR, `walmart-loadsheet-combined-vf-v${VERSION}.xlsx`);
  await wb.xlsx.writeFile(OUT);
  fs.writeFileSync(path.join(DATA_DIR, `_combined-manifest-v${VERSION}.json`), JSON.stringify(manifest, null, 2));

  console.log(`\nWrote → ${OUT}`);
  console.log(`Wrote → data/_combined-manifest-v${VERSION}.json`);
})().catch(e => { console.error(e); process.exit(1); });
