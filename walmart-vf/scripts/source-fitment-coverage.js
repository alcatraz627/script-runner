#!/usr/bin/env node
/**
 * For each ACDelco MPN in source, report whether the source `fitment` column
 * has content, the line count, and a 60-char preview.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs      = require('fs');
const path    = require('path');

const SRC = process.env.HOME + '/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx';

(async () => {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SRC, {
    worksheets:'emit', sharedStrings:'cache', hyperlinks:'ignore', styles:'ignore'
  });
  const out = [];
  for await (const ws of wb) {
    let n=0, headers=null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n===0) headers = vals;
      else {
        const obj = {}; headers.forEach((h,i)=>obj[h]=vals[i]);
        if (/^acdelco$/i.test(String(obj['Brand']||''))) {
          const f = String(obj['fitment'] ?? '').trim();
          out.push({
            mpn: String(obj['Part Number']),
            partType: String(obj['Part Type']||''),
            hasFitment: !!f,
            lines: f ? f.split(/\s*\\n\s*|\n/).filter(Boolean).length : 0
          });
        }
      }
      n++;
    }
    break;
  }
  const total   = out.length;
  const withFit = out.filter(r => r.hasFitment).length;
  console.log(`ACDelco rows: ${total}`);
  console.log(`  with non-empty source.fitment: ${withFit}`);
  console.log(`  without fitment:               ${total - withFit}`);
  // Distribution by line count
  const buckets = {'0':0,'1-5':0,'6-20':0,'21-100':0,'100+':0};
  out.forEach(r => {
    if (r.lines === 0) buckets['0']++;
    else if (r.lines <= 5) buckets['1-5']++;
    else if (r.lines <= 20) buckets['6-20']++;
    else if (r.lines <= 100) buckets['21-100']++;
    else buckets['100+']++;
  });
  console.log(`  fitment-line distribution: ${JSON.stringify(buckets)}`);
  console.log(`\nMPNs WITHOUT fitment:`);
  out.filter(r => !r.hasFitment).forEach(r => console.log(`  ${r.mpn.padEnd(15)} ${r.partType}`));
})().catch(e => { console.error(e); process.exit(1); });
