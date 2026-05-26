#!/usr/bin/env node
/**
 * build-attribute-inventory.js — brand-parameterized
 *   node build-attribute-inventory.js --brand <brandKey>
 *
 * Output: data/_attribute-inventory-${brandKey}.json
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) { console.error(`Unknown --brand "${brandKey}"`); process.exit(1); }

const SRC = process.env.HOME + '/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx';
const OUT = path.join(__dirname, '..', 'data', `_attribute-inventory-${brandKey}.json`);

const norm = v => String(v ?? '').trim();

function parseAttrs(raw) {
  const m = new Map();
  if (!raw) return m;
  for (const part of String(raw).split('|')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const k = part.slice(0, colon).trim().toLowerCase().replace(/\s+/g, '_');
    const v = part.slice(colon + 1).trim();
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(v);
  }
  return m;
}

(async () => {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore'
  });
  const byPart = {};
  for await (const ws of wb) {
    let n = 0, headers = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) headers = vals.map(norm);
      else {
        const obj = {}; headers.forEach((h, i) => obj[h] = vals[i]);
        if (!cfg.sourceBrandRegex.test(norm(obj['Brand']))) { n++; continue; }
        const partType = norm(obj['Part Type']) || '<UNKNOWN>';
        const mpn = norm(obj['Part Number']);
        const attrs = parseAttrs(obj['attributes']);
        if (!byPart[partType]) byPart[partType] = { mpns: [], keyStats: {} };
        byPart[partType].mpns.push(mpn);
        for (const [k, vList] of attrs) {
          if (!byPart[partType].keyStats[k]) byPart[partType].keyStats[k] = { mpnCount: 0, samples: [] };
          byPart[partType].keyStats[k].mpnCount++;
          if (byPart[partType].keyStats[k].samples.length < 3) {
            byPart[partType].keyStats[k].samples.push({ mpn, value: vList[0] });
          }
        }
      }
      n++;
    }
    break;
  }
  const out = {};
  for (const [pt, info] of Object.entries(byPart)) {
    out[pt] = {
      mpnCount: info.mpns.length,
      mpns: info.mpns,
      keys: Object.entries(info.keyStats).sort((a, b) => b[1].mpnCount - a[1].mpnCount)
        .map(([key, s]) => ({ key, mpnCount: s.mpnCount, samples: s.samples })),
    };
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`Wrote → ${OUT}`);
  console.log(`Part types: ${Object.keys(out).length}`);
  const total = Object.values(out).reduce((s, p) => s + p.mpnCount, 0);
  console.log(`MPNs total: ${total}`);
})().catch(e => { console.error(e); process.exit(1); });
