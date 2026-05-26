#!/usr/bin/env node
/**
 * probe-fullscrape-deep.js
 * Streams the Full Scrape and computes:
 *   - distinct `productbrand` distribution (top 30)
 *   - distinct `key` distribution (top 100, full count map written to JSON)
 *   - distinct `key` distribution restricted to productbrand=ACDelco (top 60)
 *   - all distinct values of key=`part_fitment` (full count map)
 *   - all distinct values of key=`part_fitment` restricted to ACDelco
 *   - count of ACDelco rows + count of distinct ACDelco mpns
 * Output: data/_fullscrape-deep.json + stdout summary
 */

'use strict';
const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const SRC = process.env.HOME + '/Downloads/Walmart Reference/Walmart_Full Scrape_ vf.xlsx';
const OUT = path.join(__dirname, '..', 'data', '_fullscrape-deep.json');

const tally = (m, k) => { m[k] = (m[k] || 0) + 1; };

(async () => {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore'
  });

  const brandCounts        = {};
  const keyCounts          = {};
  const acdelcoKeyCounts   = {};
  const partFitmentValues  = {};
  const acdelcoPartFitment = {};
  const acdelcoMpns        = new Set();
  let totalRows = 0, acdelcoRows = 0;

  for await (const ws of wb) {
    let n = 0, idx = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) {
        idx = {};
        vals.forEach((h, i) => { idx[String(h).trim()] = i; });
      } else {
        const brand = String(vals[idx['productbrand']] ?? '').trim();
        const mpn   = String(vals[idx['mpn']]          ?? '').trim();
        const key   = String(vals[idx['key']]          ?? '').trim();
        const val   = vals[idx['value']];
        const valStr = (val == null) ? '' : String(val);
        const isAc  = /^acdelco$/i.test(brand);

        tally(brandCounts, brand || '<EMPTY>');
        tally(keyCounts, key || '<EMPTY>');
        if (isAc) {
          tally(acdelcoKeyCounts, key || '<EMPTY>');
          if (mpn) acdelcoMpns.add(mpn);
          acdelcoRows++;
        }
        if (key === 'part_fitment') {
          const norm = valStr === '' ? '<EMPTY>' : valStr.length > 80 ? '<LONG:' + valStr.length + '>' : valStr;
          tally(partFitmentValues, norm);
          if (isAc) tally(acdelcoPartFitment, norm);
        }
        totalRows++;
      }
      n++;
    }
  }

  const top = (m, n) => Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,n);
  const out = {
    totalRows,
    distinctBrands: Object.keys(brandCounts).length,
    distinctKeys: Object.keys(keyCounts).length,
    acdelcoRows,
    acdelcoMpnCount: acdelcoMpns.size,
    brandCounts,
    keyCounts,
    acdelcoKeyCounts,
    partFitmentValues,
    acdelcoPartFitment
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log(`totalRows=${totalRows}  distinctBrands=${out.distinctBrands}  distinctKeys=${out.distinctKeys}`);
  console.log(`ACDelco: rows=${acdelcoRows}  distinctMpns=${out.acdelcoMpnCount}\n`);

  console.log('Top brands:');
  top(brandCounts, 15).forEach(([k,v]) => console.log(`  ${String(v).padStart(8)} ${k}`));

  console.log('\nTop keys (overall):');
  top(keyCounts, 25).forEach(([k,v]) => console.log(`  ${String(v).padStart(8)} ${k}`));

  console.log('\nTop keys (ACDelco only):');
  top(acdelcoKeyCounts, 30).forEach(([k,v]) => console.log(`  ${String(v).padStart(8)} ${k}`));

  console.log('\npart_fitment values (overall, top 25):');
  top(partFitmentValues, 25).forEach(([k,v]) => console.log(`  ${String(v).padStart(6)} ${k}`));

  console.log('\npart_fitment values (ACDelco):');
  top(acdelcoPartFitment, 25).forEach(([k,v]) => console.log(`  ${String(v).padStart(6)} ${k}`));

  console.log(`\nWrote → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
