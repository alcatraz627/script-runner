#!/usr/bin/env node
/**
 * _column-completeness.js — per-column fill-rate stats on iter3 combined output.
 *
 * Walks all 02-{brand}-filled.jsonl files (faster than reading the 26.6MB xlsx).
 * For each Q2 column: filled count, fill %, distinct-value count, top brands
 * contributing the populated cells (or the blanks).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRANDS = require('./brands.config.js');
const DATADIR = 'walmart-q2-phase1/data';

const Q2_FIELDS = [
  'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

(async () => {
  const fieldStats = {};
  for (const f of Q2_FIELDS) fieldStats[f] = { filled: 0, distinct: new Set(), brandsWithFill: new Map(), brandsWithBlank: new Map() };
  let totalRows = 0;

  for (const brand of Object.keys(BRANDS)) {
    const fp = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(fp) || fs.statSync(fp).size === 0) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch (e) { continue; }
      totalRows++;
      for (const f of Q2_FIELDS) {
        const v = r.cells[f] && r.cells[f].value;
        const s = fieldStats[f];
        if (v != null && v !== '') {
          s.filled++;
          if (s.distinct.size < 5000) s.distinct.add(String(v));
          s.brandsWithFill.set(brand, (s.brandsWithFill.get(brand) || 0) + 1);
        } else {
          s.brandsWithBlank.set(brand, (s.brandsWithBlank.get(brand) || 0) + 1);
        }
      }
    }
  }

  console.log(`\nTotal rows: ${totalRows}\n`);
  console.log('Col'.padEnd(22), 'Filled'.padStart(8), 'Fill%'.padStart(7), 'Distinct'.padStart(9));
  console.log('-'.repeat(50));
  const report = { totalRows, fields: {} };
  for (const f of Q2_FIELDS) {
    const s = fieldStats[f];
    const pct = totalRows ? ((s.filled / totalRows) * 100) : 0;
    const dist = s.distinct.size;
    console.log(f.padEnd(22), String(s.filled).padStart(8), (pct.toFixed(1) + '%').padStart(7), String(dist >= 5000 ? '5000+' : dist).padStart(9));
    report.fields[f] = { filled: s.filled, fillPct: +pct.toFixed(2), distinct: dist >= 5000 ? '5000+' : dist };
  }

  // Highlight: low-fill cols and which brands fill them
  console.log('\nLow-fill cols (under 50%): top contributing brands\n');
  for (const f of Q2_FIELDS) {
    const s = fieldStats[f];
    const pct = (s.filled / totalRows) * 100;
    if (pct < 50 && s.filled > 0) {
      const top = [...s.brandsWithFill.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
      console.log(`  ${f.padEnd(16)} ${pct.toFixed(1)}%  top: ${top.map(([k,v]) => `${k}(${v})`).join(', ')}`);
      report.fields[f].lowFillTopBrands = top.map(([k,v]) => ({ brand: k, count: v }));
    }
  }

  // Highlight: cols that are not 100% filled (so we know which brands are missing)
  console.log('\nNot-100% cols: top brands contributing BLANK cells\n');
  for (const f of Q2_FIELDS) {
    const s = fieldStats[f];
    const pct = (s.filled / totalRows) * 100;
    if (pct < 100 && pct >= 50) {
      const top = [...s.brandsWithBlank.entries()].sort((a,b) => b[1] - a[1]).slice(0, 5);
      console.log(`  ${f.padEnd(16)} ${pct.toFixed(1)}%  blanks heaviest: ${top.map(([k,v]) => `${k}(${v})`).join(', ')}`);
    }
  }

  fs.writeFileSync(path.join(DATADIR, '_audit-column-completeness-v3.json'), JSON.stringify(report, null, 2));
  console.log('\nWrote: walmart-q2-phase1/data/_audit-column-completeness-v3.json');
})().catch(e => { console.error(e); process.exit(1); });
