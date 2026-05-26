#!/usr/bin/env node
/**
 * 10-extract.js — brand-parameterized
 *   node 10-extract.js --brand <brandKey>
 *
 * Filters the source enhancement export to the brand's rows; appends scrape-only
 * MPNs from brands.config.js with isScrapeOnly flag.
 *
 * Output: data/01-${brandKey}-source.json
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) {
  console.error(`Unknown --brand "${brandKey}". Add it to brands.config.js first. Valid: ${Object.keys(BRANDS).join(', ')}`);
  process.exit(1);
}

const SOURCE = process.env.HOME + '/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx';
const SCRAPE_IDX = path.join(__dirname, '..', 'data', `fullscrape-by-mpn-${brandKey}.json`);
const OUT = path.join(__dirname, '..', 'data', `01-${brandKey}-source.json`);

const norm = v => String(v ?? '').trim();

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
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets:'emit', sharedStrings:'cache', hyperlinks:'ignore', styles:'ignore',
  });
  const rows = [];
  const sourceMpns = new Set();

  for await (const ws of wb) {
    let n = 0, headers = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) headers = vals.map(norm);
      else {
        const obj = {}; headers.forEach((h, i) => obj[h] = vals[i]);
        if (!cfg.sourceBrandRegex.test(norm(obj['Brand']))) { n++; continue; }
        const mpn = norm(obj['Part Number']);
        sourceMpns.add(mpn);
        rows.push({
          mpn,
          partType: norm(obj['Part Type']),
          brand: norm(obj['Brand']),
          title: norm(obj['Title']),
          shortTitle: norm(obj['title']),
          description: norm(obj['Description']),
          featuresAndBenefits: norm(obj['Features & Benefits']),
          attributesRaw: norm(obj['attributes']),
          fitment: norm(obj['fitment']),
          attributes: parseAttrs(obj['attributes']),
          id: norm(obj['id']),
          isScrapeOnly: false,
        });
      }
      n++;
    }
    break;
  }

  const scrapeIdx = JSON.parse(fs.readFileSync(SCRAPE_IDX, 'utf8'));
  for (const mpn of cfg.scrapeOnlyMpns) {
    if (sourceMpns.has(mpn)) continue;
    const e = scrapeIdx[mpn];
    if (!e) continue;
    const v = (k) => e.byKey[k]?.[0]?.value || '';
    rows.push({
      mpn,
      partType: norm(v('part_type')) || '<UNKNOWN>',
      brand: cfg.outputBrandString,
      title: norm(v('title')),
      shortTitle: norm(v('title')),
      description: norm(v('description')),
      featuresAndBenefits: '',
      attributesRaw: '',
      fitment: '',
      attributes: {},
      id: '',
      isScrapeOnly: true,
    });
  }

  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  console.log(`Wrote → ${OUT}`);
  console.log(`  brand:       ${cfg.outputBrandString}`);
  console.log(`  source rows: ${rows.filter(r => !r.isScrapeOnly).length}`);
  console.log(`  scrape-only: ${rows.filter(r => r.isScrapeOnly).length}`);
  console.log(`  total:       ${rows.length}`);
})().catch(e => { console.error(e); process.exit(1); });
