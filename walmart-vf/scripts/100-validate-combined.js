#!/usr/bin/env node
/**
 * 100-validate-combined.js — cross-reference the combined xlsx against the per-brand
 * source xlsx files used to build it. For every row in the combined file:
 *   1. Look up its provenance in the manifest (which brand file + which source row)
 *   2. Read the same row from the source brand file
 *   3. Compare every cell value byte-for-byte
 *   4. Report any mismatches with row/col coordinates and side-by-side values
 *
 * Also reports:
 *   - row count integrity (combined.rows == sum of manifest.kept entries)
 *   - dropped-row sanity (every dropped row had empty col 11 in source)
 *   - per-brand survival vs manifest
 *
 * Output: stdout report + data/_combined-validation-vN.json
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const OUTDIR = path.join(__dirname, '..', 'output');
const DATA_DIR = path.join(__dirname, '..', 'data');
const SHEET = 'Product Content And Site Exp';
const DATA_START = 6;
const NUM_COLS = 94;

// Find latest combined version
const args = process.argv.slice(2);
const versionArg = args[args.indexOf('--version') + 1];
const versionRx = /^walmart-loadsheet-combined-vf-v(\d+)\.xlsx$/;
const allVersions = fs.readdirSync(OUTDIR)
  .map(f => { const m = f.match(versionRx); return m ? { f, n: parseInt(m[1]) } : null; })
  .filter(Boolean).sort((a, b) => b.n - a.n);
if (!allVersions.length) { console.error('No combined xlsx found.'); process.exit(1); }
const VERSION = versionArg || allVersions[0].n;
const COMBINED_FILE = path.join(OUTDIR, `walmart-loadsheet-combined-vf-v${VERSION}.xlsx`);
const MANIFEST_FILE = path.join(DATA_DIR, `_combined-manifest-v${VERSION}.json`);

if (!fs.existsSync(COMBINED_FILE)) { console.error(`Combined file missing: ${COMBINED_FILE}`); process.exit(1); }
if (!fs.existsSync(MANIFEST_FILE)) { console.error(`Manifest missing: ${MANIFEST_FILE}`); process.exit(1); }

const cellStr = c => c == null ? '' : (c.text != null ? c.text : (typeof c === 'object' ? JSON.stringify(c) : String(c)));

async function readRowsByRowIndex(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet(SHEET);
  const out = {};
  for (let r = DATA_START; r <= ws.rowCount; r++) {
    const cells = [];
    for (let c = 1; c <= NUM_COLS; c++) cells.push(cellStr(ws.getRow(r).getCell(c).value));
    if (cells.some(v => v)) out[r] = cells;
  }
  return out;
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const combinedRows = await readRowsByRowIndex(COMBINED_FILE);
  const combinedRowCount = Object.keys(combinedRows).length;

  console.log(`╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║  Combined Validation Report — v${VERSION}`.padEnd(65) + `║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝`);
  console.log(`Combined file:     ${COMBINED_FILE}`);
  console.log(`Manifest:          ${MANIFEST_FILE}`);
  console.log(`Combined rows:     ${combinedRowCount}`);
  console.log(`Manifest kept:     ${manifest.kept.length}`);
  console.log(`Manifest dropped:  ${manifest.dropped.length}`);
  console.log(``);

  // 1. Row-count integrity
  const integrityOK = combinedRowCount === manifest.kept.length;
  console.log(`[1] Row-count integrity:  ${integrityOK ? '✅ PASS' : '🔴 FAIL'}`);
  if (!integrityOK) console.log(`    expected ${manifest.kept.length}, got ${combinedRowCount}`);

  // 2. Per-brand survival check
  console.log(`\n[2] Per-brand survival (combined vs manifest):`);
  const perBrand = {};
  for (const k of manifest.kept) {
    perBrand[k.brand] = (perBrand[k.brand] || 0) + 1;
  }
  const droppedPerBrand = {};
  for (const d of manifest.dropped) droppedPerBrand[d.brand] = (droppedPerBrand[d.brand] || 0) + 1;
  for (const [b, n] of Object.entries(perBrand)) {
    console.log(`    ${b.padEnd(8)}  kept=${n}  dropped=${droppedPerBrand[b] || 0}`);
  }

  // 3. Cell-level cross-reference
  console.log(`\n[3] Cell-level cross-reference (${manifest.kept.length} rows × ${NUM_COLS} cells = ${manifest.kept.length * NUM_COLS} cells):`);

  // Pre-load each brand's source file once
  const sourceCache = {};
  for (const k of manifest.kept) {
    if (!sourceCache[k.sourceFile]) {
      sourceCache[k.sourceFile] = await readRowsByRowIndex(path.join(OUTDIR, k.sourceFile));
    }
  }

  const mismatches = [];
  let cellsCompared = 0, perfectRows = 0;
  for (const k of manifest.kept) {
    const combinedRow = combinedRows[k.targetRow];
    const sourceRow = sourceCache[k.sourceFile][k.sourceRow];
    if (!combinedRow) { mismatches.push({ type: 'missing_combined_row', ...k }); continue; }
    if (!sourceRow)   { mismatches.push({ type: 'missing_source_row', ...k }); continue; }
    let rowMismatchCount = 0;
    for (let c = 0; c < NUM_COLS; c++) {
      cellsCompared++;
      if (combinedRow[c] !== sourceRow[c]) {
        rowMismatchCount++;
        if (mismatches.length < 50) mismatches.push({
          type: 'cell_mismatch', brand: k.brand, mpn: k.mpn,
          combinedRow: k.targetRow, sourceFile: k.sourceFile, sourceRow: k.sourceRow,
          col: c + 1,
          combined: String(combinedRow[c]).slice(0, 60),
          source: String(sourceRow[c]).slice(0, 60),
        });
      }
    }
    if (rowMismatchCount === 0) perfectRows++;
  }
  console.log(`    Cells compared:     ${cellsCompared}`);
  console.log(`    Perfect rows:       ${perfectRows} / ${manifest.kept.length}`);
  console.log(`    Cell mismatches:    ${mismatches.length}  ${mismatches.length === 0 ? '✅' : '🔴'}`);
  if (mismatches.length) {
    console.log(`\n    First 10 mismatches:`);
    for (const m of mismatches.slice(0, 10)) {
      if (m.type === 'cell_mismatch') {
        console.log(`      ${m.brand}/${m.mpn} combinedRow=${m.combinedRow} col=${m.col}: combined="${m.combined}" source="${m.source}"`);
      } else {
        console.log(`      ${m.type}: ${JSON.stringify(m)}`);
      }
    }
  }

  // 4. Dropped-row sanity (each dropped row should have empty shipping_weight in its source)
  console.log(`\n[4] Dropped-row sanity (verify col 11 was actually empty for dropped rows):`);
  let droppedSanityFails = 0;
  const droppedFails = [];
  for (const d of manifest.dropped) {
    const sourceRow = sourceCache[d.sourceFile]?.[d.sourceRow];
    if (!sourceRow) {
      // Try loading; could be a brand file we didn't load (because no rows kept from it)
      if (!sourceCache[d.sourceFile]) sourceCache[d.sourceFile] = await readRowsByRowIndex(path.join(OUTDIR, d.sourceFile));
    }
    const sr = sourceCache[d.sourceFile]?.[d.sourceRow];
    if (!sr) { droppedSanityFails++; droppedFails.push({ ...d, reason: 'source row missing' }); continue; }
    const sw = String(sr[10]).trim();   // col 11 = index 10
    if (sw !== '') {
      droppedSanityFails++;
      droppedFails.push({ ...d, sourceShippingWeight: sw, reason: 'shipping_weight WAS present in source' });
    }
  }
  console.log(`    Dropped rows checked:  ${manifest.dropped.length}`);
  console.log(`    Sanity violations:     ${droppedSanityFails}  ${droppedSanityFails === 0 ? '✅' : '🔴'}`);
  if (droppedFails.length) {
    console.log(`\n    Violations (first 10):`);
    droppedFails.slice(0, 10).forEach(f => console.log(`      ${f.brand}/${f.mpn} (file ${f.sourceFile} row ${f.sourceRow}): ${f.reason}${f.sourceShippingWeight ? ' shipping_weight="'+f.sourceShippingWeight+'"' : ''}`));
  }

  // 5. Required-to-sell coverage in combined
  console.log(`\n[5] Required-to-sell coverage in combined (cols 5-11):`);
  const requiredLabels = ['Spec Product Type', 'Product ID Type', 'Product ID', 'Product Name', 'Brand Name', 'Selling Price', 'Shipping Weight (lbs)'];
  for (let c = 5; c <= 11; c++) {
    let filled = 0;
    for (const r of Object.values(combinedRows)) if (String(r[c-1]).trim()) filled++;
    const status = filled === combinedRowCount ? '✅' : (filled === 0 ? '⚪' : '🟡');
    console.log(`    col ${c} ${requiredLabels[c-5].padEnd(28)}: ${filled}/${combinedRowCount}  ${status}`);
  }

  // Persist report
  const out = {
    version: VERSION, integrity: integrityOK,
    combinedRowCount, manifestKept: manifest.kept.length, manifestDropped: manifest.dropped.length,
    cellsCompared, perfectRows, mismatches,
    droppedSanityFails, droppedFails: droppedFails.slice(0, 50),
  };
  const outPath = path.join(DATA_DIR, `_combined-validation-v${VERSION}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote → ${outPath}`);

  const overallPass = integrityOK && mismatches.length === 0 && droppedSanityFails === 0;
  console.log(`\n${overallPass ? '✅ OVERALL PASS' : '🔴 OVERALL FAIL'}`);
  process.exit(overallPass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
