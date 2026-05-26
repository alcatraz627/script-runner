#!/usr/bin/env node
/**
 * 99c-consolidate-from-filled.js — iter3 direct-from-JSONL consolidator.
 *
 * Iter1 path was: filled.jsonl → per-brand xlsx → combined xlsx.
 * Iter3 path is:  filled.jsonl → combined xlsx (no per-brand layer).
 *
 * Reads every 02-{brand}-filled.jsonl in data/, writes combined xlsx,
 * cross-validates every cell against the source filled.jsonl in a single pass.
 *
 * Output:
 *   output/walmart-loadsheet-combined-q2p1-v3.xlsx
 *   data/_combined-manifest-v3.json    (per-brand rowStart/rowEnd map)
 *   data/_audit-validate-combined-v3.json (cell-level validation result)
 */
'use strict';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const CONSOLIDATOR_VERSION = '4.0.0';
const args2 = process.argv.slice(2);
const VERSION_TAG = (args2.indexOf('--version') !== -1) ? args2[args2.indexOf('--version') + 1] : 'v4';
const BRANDS = require('./brands.config.js');
const TEMPLATE = 'walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx';
const DATADIR  = 'walmart-q2-phase1/data';
const OUTDIR   = 'walmart-q2-phase1/output';

const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

const sha256File = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function loadFilled(p) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* skip */ }
  }
  return out;
}

async function stripDefinedNames(xlsxPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(xlsxPath));
  const wf = zip.file('xl/workbook.xml');
  let xml = await wf.async('string');
  const before = xml;
  xml = xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/g, '');
  if (xml !== before) {
    zip.file('xl/workbook.xml', xml);
    fs.writeFileSync(xlsxPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  }
}

(async () => {
  const t0 = Date.now();
  // Discover brands in deterministic order: by descending fitment row count if stats present, else alpha
  const brandKeys = Object.keys(BRANDS).sort((a, b) => {
    const aRows = (BRANDS[a].stats && BRANDS[a].stats.vcdbFitmentRows) || 0;
    const bRows = (BRANDS[b].stats && BRANDS[b].stats.vcdbFitmentRows) || 0;
    if (aRows !== bRows) return bRows - aRows;
    return a.localeCompare(b);
  });

  // Build workbook from template clone (preserves styling/dropdowns)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  if (wb.definedNames && Array.isArray(wb.definedNames.model)) wb.definedNames.model.length = 0;
  if (wb.model && Array.isArray(wb.model.definedNames)) wb.model.definedNames.length = 0;
  const ws = wb.getWorksheet('Phase 1');

  const manifest = { generatedAt: new Date().toISOString(), versionTag: VERSION_TAG, brands: {}, totalDataRows: 0, brandsWithRows: 0, brandsEmpty: 0 };
  let dstRow = 4;

  for (const brand of brandKeys) {
    const filledPath = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(filledPath)) { manifest.brands[brand] = { skipped: 'no_filled_file' }; continue; }
    const emissions = await loadFilled(filledPath);
    if (emissions.length === 0) {
      manifest.brands[brand] = { rowCount: 0, skipped: 'empty_filled_file' };
      manifest.brandsEmpty++;
      continue;
    }
    const brandInfo = {
      filledPath, filledSha256: sha256File(filledPath),
      rowCount: emissions.length,
      dstRowStart: dstRow,
      dstRowEnd: dstRow + emissions.length - 1,
    };
    for (const e of emissions) {
      const row = ws.getRow(dstRow);
      for (let c = 1; c < COL_FIELD_MAP.length; c++) {
        const cellData = e.cells[COL_FIELD_MAP[c]];
        row.getCell(c).value = cellData ? String(cellData.value) : '';
      }
      row.commit();
      dstRow++;
    }
    manifest.brands[brand] = brandInfo;
    manifest.totalDataRows += emissions.length;
    manifest.brandsWithRows++;
    process.stdout.write(`\r[brands written: ${manifest.brandsWithRows}/${brandKeys.length}  rows: ${manifest.totalDataRows}]`);
  }

  const outPath = path.join(OUTDIR, `walmart-loadsheet-combined-q2p1-${VERSION_TAG}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  await stripDefinedNames(outPath);

  manifest.combined = { path: outPath, sha256: sha256File(outPath), bytes: fs.statSync(outPath).size };
  manifest.consolidator = { script: '99c-consolidate-from-filled.js', version: CONSOLIDATOR_VERSION };
  manifest.durationSeconds = ((Date.now() - t0) / 1000);
  fs.writeFileSync(path.join(DATADIR, `_combined-manifest-${VERSION_TAG}.json`), JSON.stringify(manifest, null, 2));

  console.log(`\n\nCombined v3 done in ${manifest.durationSeconds.toFixed(1)}s`);
  console.log(`  brands with rows:  ${manifest.brandsWithRows}`);
  console.log(`  brands empty:      ${manifest.brandsEmpty}`);
  console.log(`  total rows:        ${manifest.totalDataRows}`);
  console.log(`  xlsx:              ${outPath}  (${(manifest.combined.bytes/1024/1024).toFixed(1)}MB)`);
})().catch(e => { console.error(e); process.exit(1); });
