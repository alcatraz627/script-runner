#!/usr/bin/env node
/**
 * 99-consolidate.js — concatenate per-brand xlsx files into a single combined
 * xlsx for Walmart Q2 Phase 1 submission.
 *
 * Per R2.1 (full explosion, no collapse): straight concat in brand order, no
 * dedup. The per-brand required-col gates already happened upstream; combined
 * is purely a join of trusted inputs.
 *
 * Output:
 *   output/walmart-loadsheet-combined-q2p1-{version}.xlsx
 *   data/_combined-manifest.json  (row-by-row provenance: srcBrand, srcRow → dstRow)
 */
'use strict';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONSOLIDATOR_VERSION = '1.0.0';
const BRANDS = require('./brands.config.js');
const TEMPLATE = 'walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx';
const OUTDIR   = 'walmart-q2-phase1/output';
const DATADIR  = 'walmart-q2-phase1/data';

const args = process.argv.slice(2);
const versionTag = (args.indexOf('--version') === -1) ? 'v1' : args[args.indexOf('--version')+1];
const sha256File = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function stripDefinedNamesInPlace(xlsxPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(xlsxPath));
  const wf = zip.file('xl/workbook.xml');
  let xml = await wf.async('string');
  const before = xml;
  xml = xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/g, '');
  if (xml !== before) {
    zip.file('xl/workbook.xml', xml);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(xlsxPath, buf);
  }
}

(async () => {
  // Start with template clone (preserves styling/dropdowns) and strip defined names
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  if (wb.definedNames && Array.isArray(wb.definedNames.model)) wb.definedNames.model.length = 0;
  if (wb.model && Array.isArray(wb.model.definedNames)) wb.model.definedNames.length = 0;
  const ws = wb.getWorksheet('Phase 1');

  const manifest = { generatedAt: new Date().toISOString(), versionTag, brands: {}, totalDataRows: 0 };
  let dstRow = 4;

  for (const brand of Object.keys(BRANDS)) {
    const srcXlsxPath = path.join(OUTDIR, `walmart-loadsheet-${brand}-q2p1-${versionTag}.xlsx`);
    if (!fs.existsSync(srcXlsxPath)) { console.warn(`[${brand}] missing source xlsx`); continue; }
    const srcWb = new ExcelJS.Workbook();
    await srcWb.xlsx.readFile(srcXlsxPath);
    const srcWs = srcWb.getWorksheet('Phase 1');

    const brandInfo = { src: srcXlsxPath, srcSha256: sha256File(srcXlsxPath), srcRowStart: 4, dstRowStart: dstRow, rowCount: 0 };
    for (let r = 4; r <= srcWs.actualRowCount; r++) {
      const srcRow = srcWs.getRow(r);
      const dstRowObj = ws.getRow(dstRow);
      for (let c = 1; c <= 21; c++) {
        const v = srcRow.getCell(c).value;
        dstRowObj.getCell(c).value = v == null ? '' : (typeof v === 'object' && v.text != null ? v.text : v);
      }
      dstRowObj.commit();
      brandInfo.rowCount++;
      dstRow++;
    }
    brandInfo.dstRowEnd = dstRow - 1;
    manifest.brands[brand] = brandInfo;
    manifest.totalDataRows += brandInfo.rowCount;
    console.log(`[${brand}] copied rows 4..${4 + brandInfo.rowCount - 1} → combined ${brandInfo.dstRowStart}..${brandInfo.dstRowEnd}  (${brandInfo.rowCount} rows)`);
  }

  const outPath = path.join(OUTDIR, `walmart-loadsheet-combined-q2p1-${versionTag}.xlsx`);
  await wb.xlsx.writeFile(outPath);
  await stripDefinedNamesInPlace(outPath);

  manifest.combined = { path: outPath, sha256: sha256File(outPath), bytes: fs.statSync(outPath).size };
  manifest.consolidator = { script: '99-consolidate.js', version: CONSOLIDATOR_VERSION };
  fs.writeFileSync(path.join(DATADIR, '_combined-manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nCombined: ${manifest.totalDataRows} rows → ${outPath} (${(manifest.combined.bytes/1024/1024).toFixed(1)}MB)`);
})().catch(e => { console.error(e); process.exit(1); });
