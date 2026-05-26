#!/usr/bin/env node
/**
 * probe-fullscrape.js
 * Streams Walmart_Full Scrape_vf.xlsx and reports:
 *   - sheet names
 *   - column headers
 *   - row count
 *   - 50 random sampled rows (header + flattened key/value pairs if any "attributes" col exists)
 *   - distinct value cardinality of `part_fitment` (Universal vs other) if column exists
 *
 * Output: writes JSON summary to walmart-vf/data/_fullscrape-probe.json
 *         and prints a compact human summary to stdout.
 *
 * Zero context cost: only summary printed, full data goes to JSON file.
 */

'use strict';
const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const SRC = process.env.HOME + '/Downloads/Walmart Reference/Walmart_Full Scrape_ vf.xlsx';
const OUT = path.join(__dirname, '..', 'data', '_fullscrape-probe.json');

(async () => {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore'
  });

  const out = { file: SRC, sheets: [] };

  for await (const ws of wb) {
    let n = 0, headers = null;
    const sheetInfo = { name: ws.name, id: ws.id, headers: null, rows: 0,
                        sampleRows: [], partFitmentCounts: {} };
    const reservoir = []; // reservoir-sample 50 rows
    const SAMPLE = 50;

    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) { headers = vals; sheetInfo.headers = headers; }
      else {
        // reservoir sampling
        if (reservoir.length < SAMPLE) reservoir.push({ rowIndex: n + 1, vals });
        else {
          const j = Math.floor(Math.random() * (n + 1));
          if (j < SAMPLE) reservoir[j] = { rowIndex: n + 1, vals };
        }
        // count part_fitment if present
        const pfIdx = headers.findIndex(h => /^part[_ ]?fitment$/i.test(String(h || '')));
        if (pfIdx >= 0) {
          const v = vals[pfIdx];
          const norm = (v == null || v === '') ? '<EMPTY>'
                     : (typeof v === 'string' && v.length > 60) ? '<LONG_TEXT>' : String(v);
          sheetInfo.partFitmentCounts[norm] = (sheetInfo.partFitmentCounts[norm] || 0) + 1;
        }
      }
      n++;
    }

    sheetInfo.rows = n - 1;
    sheetInfo.sampleRows = reservoir.map(r => {
      const obj = { _rowIndex: r.rowIndex };
      headers.forEach((h, i) => { obj[h] = r.vals[i]; });
      return obj;
    });
    out.sheets.push(sheetInfo);
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  // Compact stdout summary
  for (const s of out.sheets) {
    console.log(`Sheet "${s.name}" (id=${s.id}): rows=${s.rows}`);
    console.log(`  Headers (${s.headers.length}): ${JSON.stringify(s.headers).slice(0, 800)}`);
    if (Object.keys(s.partFitmentCounts).length) {
      console.log(`  part_fitment value distribution (top 20):`);
      Object.entries(s.partFitmentCounts).sort((a,b)=>b[1]-a[1]).slice(0,20)
        .forEach(([k,v]) => console.log(`    ${String(v).padStart(6)} ${k}`));
    }
  }
  console.log(`\nWrote full probe + 50 sample rows → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
