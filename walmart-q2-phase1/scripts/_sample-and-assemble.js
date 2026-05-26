#!/usr/bin/env node
/**
 * Sample N random emissions per brand from 02-{brand}-filled.jsonl and
 * assemble into per-brand sample xlsx + a combined-sample xlsx.
 *
 * Usage:
 *   node _sample-and-assemble.js [--n 20] [--seed 12345]
 *
 * Random source: Mulberry32 PRNG seeded with --seed (default Date.now()).
 * Better than Math.random for reproducibility; not crypto-secure (per spec).
 *
 * Output:
 *   output/walmart-loadsheet-{brand}-q2p1-v1-sample{N}.xlsx (4 files)
 *   output/walmart-loadsheet-combined-q2p1-v1-sample{N}.xlsx (4N rows)
 *   output/_sample.meta.json (which rows were picked, seed used, sha256s)
 */
'use strict';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const BRANDS = require('./brands.config.js');
const TEMPLATE = 'walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx';
const DATADIR  = 'walmart-q2-phase1/data';
const OUTDIR   = 'walmart-q2-phase1/output';

const args = process.argv.slice(2);
const N = parseInt((args[args.indexOf('--n')+1] || '20'), 10);
const SEED_RAW = args.indexOf('--seed') === -1 ? Date.now() : args[args.indexOf('--seed')+1];
const SEED = typeof SEED_RAW === 'string' ? parseInt(SEED_RAW, 10) : SEED_RAW;

// Mulberry32 — small, fast, decent statistical quality for non-crypto sampling.
function makeRng(seed) {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Fisher-Yates partial shuffle: pick N from arr without bias.
function sampleN(arr, n, rng) {
  if (arr.length <= n) return arr.slice();
  const indices = arr.map((_, i) => i);
  const picked = [];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
    picked.push(arr[indices[i]]);
  }
  return picked;
}

const COL_FIELD_MAP = [
  null, 'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

async function readEmissions(jsonlPath) {
  const out = [];
  const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* skip malformed */ }
  }
  return out;
}

async function stripDefinedNamesInPlace(xlsxPath) {
  const buf = fs.readFileSync(xlsxPath);
  const zip = await JSZip.loadAsync(buf);
  const wf = zip.file('xl/workbook.xml');
  let xml = await wf.async('string');
  const before = xml;
  xml = xml.replace(/<definedNames>[\s\S]*?<\/definedNames>/g, '');
  if (xml !== before) {
    zip.file('xl/workbook.xml', xml);
    const newBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(xlsxPath, newBuf);
  }
}

async function writeXlsxFromEmissions(emissions, outPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
  // Clear defined names in-memory (belt-and-braces — post-process zip strip is the real fix)
  if (wb.definedNames && Array.isArray(wb.definedNames.model)) wb.definedNames.model.length = 0;
  if (wb.model && Array.isArray(wb.model.definedNames)) wb.model.definedNames.length = 0;
  const ws = wb.getWorksheet('Phase 1');
  let rowIdx = 4;
  for (const e of emissions) {
    const row = ws.getRow(rowIdx);
    for (let c = 1; c < COL_FIELD_MAP.length; c++) {
      const cellData = e.cells[COL_FIELD_MAP[c]];
      row.getCell(c).value = cellData ? String(cellData.value) : '';
    }
    row.commit();
    rowIdx++;
  }
  await wb.xlsx.writeFile(outPath);
  await stripDefinedNamesInPlace(outPath);
}

(async () => {
  const rng = makeRng(SEED);
  console.log(`Sampler: N=${N} per brand, seed=${SEED}`);

  const meta = { generatedAt: new Date().toISOString(), seed: SEED, N, brands: {} };
  const combinedSample = [];

  for (const brand of Object.keys(BRANDS)) {
    const filledPath = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(filledPath)) { console.warn(`[${brand}] no filled file`); continue; }
    const all = await readEmissions(filledPath);
    const sample = sampleN(all, N, rng);
    console.log(`[${brand}]  total=${all.length}  sampled=${sample.length}`);

    const outPath = path.join(OUTDIR, `walmart-loadsheet-${brand}-q2p1-v1-sample${N}.xlsx`);
    await writeXlsxFromEmissions(sample, outPath);
    console.log(`         → ${outPath}`);

    meta.brands[brand] = {
      totalEmissions: all.length,
      sampleSize: sample.length,
      sampleVcdbRows: sample.map(e => e.vcdbRow),
      sampleFormats: sample.reduce((m, e) => { m[e.format] = (m[e.format]||0)+1; return m; }, {}),
      outputPath: outPath,
    };
    combinedSample.push(...sample);
  }

  // Combined-sample xlsx (4N rows, all brands)
  const combinedPath = path.join(OUTDIR, `walmart-loadsheet-combined-q2p1-v1-sample${N}.xlsx`);
  await writeXlsxFromEmissions(combinedSample, combinedPath);
  console.log(`\nCombined: ${combinedSample.length} rows → ${combinedPath}`);

  meta.combined = { path: combinedPath, totalRows: combinedSample.length };
  fs.writeFileSync(path.join(OUTDIR, '_sample.meta.json'), JSON.stringify(meta, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
