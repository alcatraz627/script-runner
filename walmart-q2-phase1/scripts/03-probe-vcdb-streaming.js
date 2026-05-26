#!/usr/bin/env node
/**
 * Streaming probe of large reference workbooks (VCdb, Full Scrape).
 *
 * Uses ExcelJS streaming WorkbookReader so 35MB files don't load 2GB into RAM.
 * Scans every row, retains only those matching the 5 sample MPNs.
 *
 * Usage:
 *   node 03-probe-vcdb-streaming.js [path-to-xlsx] [out.json]
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const SRC = process.argv[2] || `${HOME}/Downloads/Walmart Reference/Walmart_VCdb Mapping_vf.xlsx`;
const OUT = process.argv[3] || `walmart-q2-phase1/data/_vcdb-probe.json`;

const MPNS = new Set(['L97', '639-033', '302-3BK', '95172', '903-103']);

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.text != null) return String(v.text);
    if (v.richText) return v.richText.map(r => r.text).join('');
    if (v.result != null) return String(v.result);
    if (v.formula) return `[formula]`;
  }
  return String(v);
}

(async () => {
  console.log(`Streaming probe of: ${SRC}`);
  console.log(`Size: ${(fs.statSync(SRC).size / 1024 / 1024).toFixed(1)} MB`);

  const report = { source: SRC, probedAt: new Date().toISOString(), sheets: {} };

  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    entries: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
    styles: 'ignore',
  });

  for await (const ws of workbookReader) {
    const sheetName = ws.name;
    console.log(`  [sheet] ${sheetName} ...`);
    let headers = null;
    let mpnColIdx = -1;
    let rowCount = 0;
    const matches = {};

    for await (const row of ws) {
      rowCount++;
      const vals = row.values; // 1-indexed
      if (!headers) {
        headers = vals.slice(1).map(cellText);
        mpnColIdx = headers.findIndex(h => /^(manufacturer.*part.*number|part.*number|mpn|partnumber|part_number)$/i.test((h || '').trim()));
        if (mpnColIdx < 0) {
          console.log(`    no MPN col; headers: ${headers.slice(0, 8).join(' | ')}`);
          break;
        }
        console.log(`    MPN col = ${mpnColIdx + 1} (${headers[mpnColIdx]}); headers=${headers.length}`);
        continue;
      }
      const mpn = cellText(vals[mpnColIdx + 1]).trim();
      if (!MPNS.has(mpn)) continue;
      if (!matches[mpn]) matches[mpn] = [];
      const obj = {};
      for (let i = 0; i < headers.length; i++) {
        const v = cellText(vals[i + 1]).trim();
        if (v) obj[headers[i]] = v;
      }
      matches[mpn].push({ excelRow: row.number, fields: obj });

      if (rowCount % 50000 === 0) console.log(`    ...scanned ${rowCount} rows`);
    }

    report.sheets[sheetName] = {
      headers: headers || [],
      rowCount,
      mpnColIdx: mpnColIdx + 1,
      matches,
      matchCounts: Object.fromEntries(Object.entries(matches).map(([k, v]) => [k, v.length])),
    };
    console.log(`    done. rows=${rowCount} matched={${Object.entries(matches).map(([k,v]) => `${k}:${v.length}`).join(', ')}}`);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  }

  console.log(`\nWrote: ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
