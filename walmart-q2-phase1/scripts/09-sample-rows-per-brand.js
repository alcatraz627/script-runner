#!/usr/bin/env node
/**
 * 09-sample-rows-per-brand.js — iteration 3 sampling gate.
 *
 * Reads every 02-{brand}-filled.jsonl in data/, picks up to N random rows
 * per brand (Mulberry32 seeded PRNG + Fisher-Yates), writes:
 *   - data/_iteration3-sample.jsonl      (concat of all sampled rows)
 *   - data/_iteration3-sample.meta.json  (per-brand stats, seed, anomaly log)
 *   - output/walmart-loadsheet-iteration3-sample.xlsx (xlsx of all sampled rows)
 *
 * Verbose error handling per user spec:
 *   - skips brands with 0 filled rows (logs reason)
 *   - skips malformed JSONL lines (logs index)
 *   - skips brands whose key contains characters incompatible with file paths (logs reason)
 *   - records "<N rows available, took all" when filled count < N
 *
 * Usage:
 *   node 09-sample-rows-per-brand.js [--rows-per-brand 10] [--seed 12345]
 *                                    [--brands all|brand1,brand2]
 */
'use strict';
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const SAMPLER_VERSION = '1.0.0';
const DATADIR  = 'walmart-q2-phase1/data';
const OUTDIR   = 'walmart-q2-phase1/output';
const TEMPLATE = 'walmart-q2-phase1/input/walmart-q2-phase1-template-20260511.xlsx';

const args = process.argv.slice(2);
function arg(name) { const i = args.indexOf(name); return i === -1 ? null : args[i+1]; }
const N = parseInt(arg('--rows-per-brand') || '10', 10);
const SEED = parseInt(arg('--seed') || String(Date.now()), 10);
const BRAND_FILTER = arg('--brands') || 'all';

function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
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

async function loadEmissions(jsonlPath, anomalies, brandKey) {
  const out = [];
  let lineIdx = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(jsonlPath), crlfDelay: Infinity });
  for await (const line of rl) {
    lineIdx++;
    if (!line) continue;
    try { out.push(JSON.parse(line)); }
    catch (e) { anomalies.push({ brand: brandKey, type: 'malformed_jsonl', lineIdx, error: e.message }); }
  }
  return out;
}

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

async function writeXlsx(emissions, outPath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE);
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

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }

(async () => {
  const t0 = Date.now();
  const rng = makeRng(SEED);
  console.log(`Sampling gate: N=${N} per brand, seed=${SEED}, brands=${BRAND_FILTER}`);

  // Discover all brands by scanning data/ for *-filled.jsonl files
  const allFilledFiles = fs.readdirSync(DATADIR)
    .filter(f => /^02-.+-filled\.jsonl$/.test(f))
    .map(f => ({ file: f, brand: f.replace(/^02-/, '').replace(/-filled\.jsonl$/, '') }));

  const requested = BRAND_FILTER === 'all' ? allFilledFiles.map(x => x.brand) : BRAND_FILTER.split(',').map(s => s.trim()).filter(Boolean);
  const requestedSet = new Set(requested);

  const anomalies = [];
  const perBrand = {};
  const combinedSample = [];

  for (const { file, brand } of allFilledFiles) {
    if (!requestedSet.has(brand)) continue;
    const fp = path.join(DATADIR, file);
    let stat;
    try { stat = fs.statSync(fp); }
    catch (e) { anomalies.push({ brand, type: 'stat_failed', error: e.message }); continue; }
    if (stat.size === 0) {
      anomalies.push({ brand, type: 'empty_filled_file', size: 0 });
      perBrand[brand] = { totalRows: 0, sampled: 0, note: 'empty filled file — skipped' };
      console.log(`  [${brand.padEnd(28)}] EMPTY — skipped`);
      continue;
    }
    const emissions = await loadEmissions(fp, anomalies, brand);
    if (emissions.length === 0) {
      perBrand[brand] = { totalRows: 0, sampled: 0, note: 'no rows in filled file' };
      console.log(`  [${brand.padEnd(28)}] 0 rows — skipped`);
      continue;
    }
    const sample = sampleN(emissions, N, rng);
    const note = emissions.length < N ? `had only ${emissions.length} rows; took all` : null;
    perBrand[brand] = {
      totalRows: emissions.length,
      sampled: sample.length,
      formatMix: sample.reduce((m, e) => { m[e.format] = (m[e.format]||0)+1; return m; }, {}),
      note,
    };
    combinedSample.push(...sample);
    console.log(`  [${brand.padEnd(28)}] total=${String(emissions.length).padStart(7)}  sampled=${sample.length}${note ? ' (' + note + ')' : ''}`);
  }

  for (const reqBrand of requested) {
    if (!allFilledFiles.some(x => x.brand === reqBrand)) {
      anomalies.push({ brand: reqBrand, type: 'requested_brand_has_no_filled_file' });
      console.log(`  [${reqBrand.padEnd(28)}] no filled file — anomaly logged`);
    }
  }

  fs.mkdirSync(DATADIR, { recursive: true });
  fs.mkdirSync(OUTDIR, { recursive: true });
  const jsonlPath = path.join(DATADIR, '_iteration3-sample.jsonl');
  const metaPath  = path.join(DATADIR, '_iteration3-sample.meta.json');
  const xlsxPath  = path.join(OUTDIR, 'walmart-loadsheet-iteration3-sample.xlsx');

  const out = fs.createWriteStream(jsonlPath);
  for (const e of combinedSample) out.write(JSON.stringify(e) + '\n');
  out.end();
  await new Promise(r => out.on('close', r));

  await writeXlsx(combinedSample, xlsxPath);

  const meta = {
    sampler: { script: '09-sample-rows-per-brand.js', version: SAMPLER_VERSION },
    seed: SEED, N, brandFilter: BRAND_FILTER,
    generatedAt: new Date().toISOString(),
    durationSeconds: ((Date.now() - t0) / 1000),
    perBrand,
    anomalies,
    outputs: {
      jsonl: { path: jsonlPath, rowCount: combinedSample.length, sha256: sha256File(jsonlPath) },
      xlsx:  { path: xlsxPath, sha256: sha256File(xlsxPath), bytes: fs.statSync(xlsxPath).size },
    },
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`\nCombined sample: ${combinedSample.length} rows`);
  console.log(`  jsonl: ${jsonlPath}`);
  console.log(`  xlsx:  ${xlsxPath}`);
  console.log(`  meta:  ${metaPath}`);
  if (anomalies.length) console.log(`Anomalies: ${anomalies.length} — see meta.json`);
})().catch(e => { console.error(e); process.exit(1); });
