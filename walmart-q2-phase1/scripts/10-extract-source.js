#!/usr/bin/env node
/**
 * 10-extract-source.js — Q2 Phase 1, brand-parameterized
 *   node 10-extract-source.js --brand <brandKey>
 *   node 10-extract-source.js --brand all
 *
 * Filters the source enhancement export to rows matching the brand regex.
 * Writes per-brand 01-{brand}-source.json + sidecar .meta.json (R2.5).
 *
 * Phase 1 v1: scrape-only MPNs NOT included (see brands.config.js note).
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXTRACTOR_VERSION = '1.0.0';
const BRANDS = require('./brands.config.js');
const HOME = process.env.HOME;
const SOURCE = `${HOME}/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`;
const OUTDIR = 'walmart-q2-phase1/data';

const args = process.argv.slice(2);
const brandArg = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
if (!brandArg) {
  console.error('Usage: node 10-extract-source.js --brand <acdelco|dorman|holley|dayco|all>');
  process.exit(1);
}
const brandKeys = brandArg === 'all' ? Object.keys(BRANDS) : [brandArg];
for (const k of brandKeys) {
  if (!BRANDS[k]) { console.error(`Unknown brand "${k}". Valid: ${Object.keys(BRANDS).join(', ')}`); process.exit(1); }
}

const norm = v => String(v ?? '').trim();
const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function parseAttrs(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split('|')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const k = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
    const v = part.slice(colon + 1).trim();
    if (!k) continue;
    if (out[k] === undefined) out[k] = v;
  }
  return out;
}

(async () => {
  console.log(`Source: ${path.basename(SOURCE)} (${(fs.statSync(SOURCE).size / 1024 / 1024).toFixed(1)}MB)`);
  console.log(`Brands: ${brandKeys.join(', ')}`);

  // Read ALL source rows once (one pass for all brands)
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });
  const byBrand = {};
  for (const k of brandKeys) byBrand[k] = [];
  let totalScanned = 0;

  for await (const ws of wb) {
    let n = 0, headers = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) headers = vals.map(norm);
      else {
        totalScanned++;
        const obj = {}; headers.forEach((h, i) => obj[h] = vals[i]);
        const srcBrand = norm(obj['Brand']);
        for (const k of brandKeys) {
          if (BRANDS[k].sourceBrandRegex.test(srcBrand)) {
            byBrand[k].push({
              mpn: norm(obj['Part Number']),
              partType: norm(obj['Part Type']),
              brand: srcBrand,
              title: norm(obj['Title']),
              shortTitle: norm(obj['title']),
              description: norm(obj['Description']),
              featuresAndBenefits: norm(obj['Features & Benefits']),
              attributesRaw: norm(obj['attributes']),
              fitment: norm(obj['fitment']),
              attributes: parseAttrs(obj['attributes']),
              id: norm(obj['id']),
            });
            break;
          }
        }
      }
      n++;
    }
    break;
  }

  fs.mkdirSync(OUTDIR, { recursive: true });
  const inputMeta = { path: SOURCE, sizeBytes: fs.statSync(SOURCE).size, sha256: sha256(SOURCE) };
  console.log(`\nScanned ${totalScanned} source rows.\n`);
  for (const k of brandKeys) {
    const rows = byBrand[k];
    const out = path.join(OUTDIR, `01-${k}-source.json`);
    fs.writeFileSync(out, JSON.stringify(rows, null, 2));
    const meta = {
      extractor: { script: '10-extract-source.js', version: EXTRACTOR_VERSION },
      brand: k,
      input: inputMeta,
      output: { path: out, sizeBytes: fs.statSync(out).size, sha256: sha256(out), rowCount: rows.length },
      generatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(out.replace(/\.json$/, '.meta.json'), JSON.stringify(meta, null, 2));
    console.log(`  ${k.padEnd(10)} → ${rows.length} rows · ${out}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
