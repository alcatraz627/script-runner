#!/usr/bin/env node
/**
 * build-fullscrape-by-mpn.js
 *
 * Reads ~/Downloads/Walmart Reference/Walmart_Full Scrape_ vf.xlsx (506K rows,
 * tall key/value layout) and produces a per-MPN grouped index.
 *
 * Output: walmart-vf/data/fullscrape-by-mpn.json
 *   {
 *     "<mpn>": {
 *       partNumber: <mpn>,        // duplicate, for clarity
 *       brand: "ACDelco",         // most-common productbrand for this mpn
 *       rowCount: 196,
 *       firstExcelRow: 12345,     // 1-based Excel row index (incl. header)
 *       byKey: {
 *         "fitment": [
 *           { value: "1977 Buick…", excelRow: 12345, source: "rockauto", confidence: "high" },
 *           …
 *         ],
 *         "part_fitment": [ … ],
 *         …
 *       }
 *     },
 *     …
 *   }
 *
 * --brand <name>   restrict to one productbrand (for smaller output)
 * --keys k1,k2,…   restrict to a subset of keys
 * --keep-evidence  also persist `evidence_text` (default: dropped to save size)
 *
 * No data into Claude context. Only file paths/stats printed.
 */

'use strict';
const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const SRC = process.env.HOME + '/Downloads/Walmart Reference/Walmart_Full Scrape_ vf.xlsx';

const args = process.argv.slice(2);
const ARG  = (k) => { const i = args.indexOf(k); return i !== -1 ? args[i+1] : null; };
const BRAND_FILTER = ARG('--brand');                 // e.g. "ACDelco"
const KEY_FILTER   = ARG('--keys');                  // comma-list, optional
const KEY_SET      = KEY_FILTER ? new Set(KEY_FILTER.split(',').map(s => s.trim())) : null;
const KEEP_EVIDENCE = args.includes('--keep-evidence');

const SUFFIX = BRAND_FILTER ? `-${BRAND_FILTER.toLowerCase()}` : '';
const OUT = path.join(__dirname, '..', 'data', `fullscrape-by-mpn${SUFFIX}.json`);

const norm = v => String(v ?? '').trim();

(async () => {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore'
  });

  const byMpn = {}; // mpn -> { rowCount, brandCounts, byKey }

  for await (const ws of wb) {
    let n = 0, idx = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) {
        idx = {};
        vals.forEach((h, i) => { idx[norm(h)] = i; });
        n++; continue;
      }
      const brand = norm(vals[idx['productbrand']]);
      if (BRAND_FILTER && brand.toLowerCase() !== BRAND_FILTER.toLowerCase()) { n++; continue; }
      const mpn = norm(vals[idx['mpn']]);
      if (!mpn) { n++; continue; }
      const key = norm(vals[idx['key']]);
      if (KEY_SET && !KEY_SET.has(key)) { n++; continue; }
      const value = vals[idx['value']];

      if (!byMpn[mpn]) byMpn[mpn] = { partNumber: mpn, rowCount: 0, brandCounts: {}, firstExcelRow: n + 1, byKey: {} };
      byMpn[mpn].rowCount++;
      byMpn[mpn].brandCounts[brand] = (byMpn[mpn].brandCounts[brand] || 0) + 1;

      const entry = {
        value: (value == null) ? '' : (value.text != null ? value.text : value),
        excelRow: n + 1, // 1-based, +1 because n is 0-indexed and header consumed first iteration
        source: norm(vals[idx['source']]),
        confidence: norm(vals[idx['confidence']]),
      };
      if (KEEP_EVIDENCE) {
        entry.url          = norm(vals[idx['url']]);
        entry.evidence     = norm(vals[idx['evidence_text']]);
        entry.explanation  = norm(vals[idx['explanation']]);
        entry.matchMode    = norm(vals[idx['match_mode']]);
      }
      if (!byMpn[mpn].byKey[key]) byMpn[mpn].byKey[key] = [];
      byMpn[mpn].byKey[key].push(entry);

      n++;
    }
    break;
  }

  // pick most-common brand per mpn
  for (const m of Object.keys(byMpn)) {
    const bc = byMpn[m].brandCounts;
    byMpn[m].brand = Object.entries(bc).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    delete byMpn[m].brandCounts;
  }

  fs.writeFileSync(OUT, JSON.stringify(byMpn, null, 2));

  // stats
  const mpns = Object.keys(byMpn);
  let totalEntries = 0, keysAcrossAll = new Set();
  mpns.forEach(m => {
    Object.keys(byMpn[m].byKey).forEach(k => {
      keysAcrossAll.add(k);
      totalEntries += byMpn[m].byKey[k].length;
    });
  });

  console.log(`Wrote → ${OUT}`);
  console.log(`  MPNs:          ${mpns.length}`);
  console.log(`  total entries: ${totalEntries}`);
  console.log(`  distinct keys: ${keysAcrossAll.size}`);
  if (BRAND_FILTER) console.log(`  brand filter:  ${BRAND_FILTER}`);
  if (KEY_FILTER)   console.log(`  key filter:    ${KEY_FILTER}`);
  const stat = fs.statSync(OUT);
  console.log(`  file size:     ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
})().catch(e => { console.error(e); process.exit(1); });
