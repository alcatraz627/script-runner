#!/usr/bin/env node
/**
 * 08-discover-brands.js
 *
 * Enumerates ALL brands present in the source enhancement export. For each:
 *   - distinct MPN count
 *   - VCdb match count (from materialized JSONL)
 *   - VCdb fitment row count
 *   - drop rate estimate (MPNs not in VCdb / total)
 *
 * Output: data/_brand-discovery.json + console summary sorted by row count.
 * This feeds iteration-3 scope decisions — large brands get full runs,
 * tiny brands may be skipped, high-drop-rate brands get flagged like Holley.
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const HOME = process.env.HOME;
const SOURCE = `${HOME}/Downloads/export_Walmart Scrape Organized v3 3 30 26 (Enhancement)_Mar 30, 2026, 3_36_09 AM.xlsx`;
const VCDB_JSONL = 'walmart-q2-phase1/data/_raw-content-parsed.jsonl';
const OUT = 'walmart-q2-phase1/data/_brand-discovery.json';

const norm = v => String(v ?? '').trim();

(async () => {
  // 1. Stream source export, collect MPNs per brand
  console.log('Scanning source export for brand distribution...');
  const brandToMpns = new Map(); // brandRaw → Set of MPNs
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(SOURCE, {
    worksheets: 'emit', sharedStrings: 'cache', hyperlinks: 'ignore', styles: 'ignore',
  });
  for await (const ws of wb) {
    let n = 0, headers = null;
    for await (const row of ws) {
      const vals = row.values.slice(1).map(v => (v && v.text) || v);
      if (n === 0) headers = vals.map(norm);
      else {
        const obj = {}; headers.forEach((h, i) => obj[h] = vals[i]);
        const brand = norm(obj['Brand']);
        const mpn = norm(obj['Part Number']);
        if (!brand || !mpn) { n++; continue; }
        if (!brandToMpns.has(brand)) brandToMpns.set(brand, new Set());
        brandToMpns.get(brand).add(mpn);
      }
      n++;
    }
    break;
  }
  console.log(`  Found ${brandToMpns.size} distinct brands in source export`);

  // 2. Stream materialized VCdb JSONL, collect MPN → rowCount
  console.log('Scanning materialized VCdb JSONL for MPN match counts...');
  const vcdbCounts = new Map(); // mpn → row count
  const rl = readline.createInterface({ input: fs.createReadStream(VCDB_JSONL), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      vcdbCounts.set(r.partNumber, (vcdbCounts.get(r.partNumber) || 0) + 1);
    } catch (e) { /* skip */ }
  }
  console.log(`  ${vcdbCounts.size} distinct MPNs in VCdb`);

  // 3. Aggregate per-brand stats
  const brands = [];
  for (const [brandRaw, mpnSet] of brandToMpns.entries()) {
    const mpns = [...mpnSet];
    let matched = 0, vcdbRows = 0;
    for (const m of mpns) {
      const c = vcdbCounts.get(m) || 0;
      if (c > 0) { matched++; vcdbRows += c; }
    }
    brands.push({
      brand: brandRaw,
      mpnCount: mpns.length,
      vcdbMatchedMpns: matched,
      vcdbDroppedMpns: mpns.length - matched,
      vcdbFitmentRows: vcdbRows,
      dropRate: mpns.length ? +(((mpns.length - matched) / mpns.length) * 100).toFixed(1) : 0,
    });
  }
  brands.sort((a, b) => b.vcdbFitmentRows - a.vcdbFitmentRows);

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), totalBrands: brands.length, brands }, null, 2));
  console.log(`\nWrote: ${OUT}\n`);

  // Console table
  console.log('Brand'.padEnd(28), 'MPNs'.padStart(6), 'VCdb✓'.padStart(7), 'Drop'.padStart(6), 'Drop%'.padStart(7), 'FitRows'.padStart(8));
  console.log('-'.repeat(72));
  for (const b of brands.slice(0, 40)) {
    const flag = b.dropRate >= 50 ? ' ⚠' : '';
    console.log(b.brand.slice(0, 27).padEnd(28), String(b.mpnCount).padStart(6), String(b.vcdbMatchedMpns).padStart(7), String(b.vcdbDroppedMpns).padStart(6), (b.dropRate + '%').padStart(7), String(b.vcdbFitmentRows).padStart(8) + flag);
  }
  if (brands.length > 40) console.log(`  ... (${brands.length - 40} more)`);

  // Summary stats
  const totalMpns = brands.reduce((s, b) => s + b.mpnCount, 0);
  const totalRows = brands.reduce((s, b) => s + b.vcdbFitmentRows, 0);
  const highDrop = brands.filter(b => b.dropRate >= 50);
  console.log(`\nTotals: ${brands.length} brands · ${totalMpns} MPNs · ${totalRows} VCdb fitment rows`);
  console.log(`High-drop brands (>=50% MPNs missing from VCdb): ${highDrop.length}  →  ${highDrop.map(b => b.brand).join(', ')}`);
})().catch(e => { console.error(e); process.exit(1); });
