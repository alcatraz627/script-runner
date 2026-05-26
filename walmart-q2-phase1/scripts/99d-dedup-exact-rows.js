#!/usr/bin/env node
/**
 * 99d-dedup-exact-rows.js — collapse exact-duplicate rows (R2.11).
 *
 * Reads the v5 consolidated xlsx, drops rows whose 21 ship cols are
 * byte-identical to a previously-seen row, writes deduped xlsx.
 * Order-preserving: keeps the first occurrence of each fingerprint.
 *
 * Why it's safe: per R2.1 we ship "one xlsx row per VCdb input row" — that
 * rule was to prevent collapsing distinct VEHICLE FITMENTS. Two rows with
 * byte-identical 21-col content are not distinct fitments by any consumer's
 * definition; their underlying VCdb-rows differed only in sub-config dimensions
 * (BrakeConfig / SpringTypeConfig / etc.) we don't ship.
 *
 * Output: same path + .xlsx but with v5-dedup suffix:
 *   output/walmart-loadsheet-combined-q2p1-v5-dedup.xlsx
 *   data/_dedup-stats-v5.json
 */
'use strict';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATE = 'walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx';
const OUTDIR = 'walmart-q2-phase1/output';
const DATADIR = 'walmart-q2-phase1/data';

const args = process.argv.slice(2);
const inVersion = (args.indexOf('--in-version') !== -1) ? args[args.indexOf('--in-version') + 1] : 'v5';
const outVersion = (args.indexOf('--out-version') !== -1) ? args[args.indexOf('--out-version') + 1] : `${inVersion}-dedup`;

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
  const inPath = path.join(OUTDIR, `walmart-loadsheet-combined-q2p1-${inVersion}.xlsx`);
  const outPath = path.join(OUTDIR, `walmart-loadsheet-combined-q2p1-${outVersion}.xlsx`);
  if (!fs.existsSync(inPath)) { console.error(`Input not found: ${inPath}`); process.exit(1); }

  // Pass 1: stream input, build fingerprint set, decide which rows to keep
  const seen = new Set();
  const keepRowNums = new Set();
  let totalRows = 0, keptRows = 0, dupRows = 0;
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(inPath, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });
  for await (const ws of reader) {
    for await (const row of ws) {
      if (row.number < 4) continue;
      totalRows++;
      const vals = row.values;
      const fp = [];
      for (let c = 1; c <= 21; c++) {
        const v = vals[c];
        fp.push(v == null ? '' : (typeof v === 'object' && v.text != null ? v.text : String(v)));
      }
      const key = fp.join('|');
      if (!seen.has(key)) { seen.add(key); keepRowNums.add(row.number); keptRows++; }
      else dupRows++;
    }
  }
  console.log(`Pass 1 done: scanned ${totalRows} rows · kept ${keptRows} · dropped ${dupRows} exact dups (${(dupRows/totalRows*100).toFixed(1)}%)`);

  // Pass 2: clone template, copy only kept rows
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  if (wb.definedNames && Array.isArray(wb.definedNames.model)) wb.definedNames.model.length = 0;
  if (wb.model && Array.isArray(wb.model.definedNames)) wb.model.definedNames.length = 0;
  const ws = wb.getWorksheet('Phase 1');

  const reader2 = new ExcelJS.stream.xlsx.WorkbookReader(inPath, {
    sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore', worksheets: 'emit',
  });
  let dstRow = 4;
  let writtenCount = 0;
  for await (const wsIn of reader2) {
    for await (const row of wsIn) {
      if (!keepRowNums.has(row.number)) continue;
      const vals = row.values;
      const dst = ws.getRow(dstRow);
      for (let c = 1; c <= 21; c++) {
        const v = vals[c];
        dst.getCell(c).value = v == null ? '' : (typeof v === 'object' && v.text != null ? v.text : v);
      }
      dst.commit();
      dstRow++;
      writtenCount++;
      if (writtenCount % 20000 === 0) process.stdout.write(`\r[written ${writtenCount}]`);
    }
  }
  await wb.xlsx.writeFile(outPath);
  await stripDefinedNames(outPath);

  const stats = {
    generatedAt: new Date().toISOString(),
    durationSeconds: ((Date.now() - t0) / 1000),
    inPath, outPath,
    totalRows, keptRows, dupRows, dedupRate: +(dupRows/totalRows*100).toFixed(2),
    outBytes: fs.statSync(outPath).size,
    outSha256: crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex'),
  };
  fs.writeFileSync(path.join(DATADIR, `_dedup-stats-${outVersion}.json`), JSON.stringify(stats, null, 2));
  console.log(`\nDedup done in ${stats.durationSeconds.toFixed(1)}s`);
  console.log(`  ${inPath}  →  ${outPath}`);
  console.log(`  ${totalRows} → ${keptRows} rows  (${stats.dedupRate}% dropped)`);
})().catch(e => { console.error(e); process.exit(1); });
