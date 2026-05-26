#!/usr/bin/env node
/**
 * _drop-analysis.js — quantify what got dropped in the iter3 fill stage.
 *
 * Two drop categories:
 *   1. MPN-level drops (02-{brand}-dropped-mpn.jsonl) — entire MPN excluded
 *      because no VCdb match (universal-fit / aftermarket / etc.).
 *   2. Row-level drops (02-{brand}-dropped.jsonl) — individual VCdb rows
 *      dropped because of unknown format, missing required cols, or other
 *      gate failures.
 *
 * For each category: total count, reason breakdown, samples, and an
 * estimate of how "rescuable" the rows are.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATADIR = 'walmart-q2-phase1/data';
const BRANDS = require('./brands.config.js');

(async () => {
  const mpnDrops = { totalEntries: 0, byBrand: {}, byReason: {}, samples: [] };
  const rowDrops = { totalEntries: 0, byBrand: {}, byReason: {}, samples: { byReason: {} } };

  // Also: which MPNs are in VCdb but completely absent from any filled.jsonl?
  // We compute by reading filled jsonls for "MPNs that shipped at least 1 row".
  const shippedMpns = new Set();

  for (const brand of Object.keys(BRANDS)) {
    // 1) MPN-level drops
    const mp = path.join(DATADIR, `02-${brand}-dropped-mpn.jsonl`);
    if (fs.existsSync(mp)) {
      const rl = readline.createInterface({ input: fs.createReadStream(mp), crlfDelay: Infinity });
      for await (const line of rl) {
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          mpnDrops.totalEntries++;
          mpnDrops.byBrand[brand] = (mpnDrops.byBrand[brand] || 0) + 1;
          mpnDrops.byReason[r.reason] = (mpnDrops.byReason[r.reason] || 0) + 1;
          if (mpnDrops.samples.length < 12) mpnDrops.samples.push({ brand, ...r });
        } catch (e) { /* skip */ }
      }
    }
    // 2) Row-level drops
    const rp = path.join(DATADIR, `02-${brand}-dropped.jsonl`);
    if (fs.existsSync(rp)) {
      const rl2 = readline.createInterface({ input: fs.createReadStream(rp), crlfDelay: Infinity });
      for await (const line of rl2) {
        if (!line) continue;
        try {
          const r = JSON.parse(line);
          rowDrops.totalEntries++;
          rowDrops.byBrand[brand] = (rowDrops.byBrand[brand] || 0) + 1;
          // Normalize reason — "missing required: X,Y" → bucket by first missing field
          let reasonBucket = r.reason || 'unknown';
          if (reasonBucket.startsWith('missing required:')) {
            const fields = reasonBucket.slice('missing required:'.length).trim().split(',').map(s => s.trim());
            reasonBucket = `missing required: ${fields[0]}` + (fields.length > 1 ? ' (+more)' : '');
          }
          rowDrops.byReason[reasonBucket] = (rowDrops.byReason[reasonBucket] || 0) + 1;
          if (!rowDrops.samples.byReason[reasonBucket]) rowDrops.samples.byReason[reasonBucket] = [];
          if (rowDrops.samples.byReason[reasonBucket].length < 5) {
            rowDrops.samples.byReason[reasonBucket].push({ brand, ...r });
          }
        } catch (e) { /* skip */ }
      }
    }
    // 3) Shipped MPNs
    const fp = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (fs.existsSync(fp) && fs.statSync(fp).size > 0) {
      const rl3 = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
      for await (const line of rl3) {
        if (!line) continue;
        try { shippedMpns.add(JSON.parse(line).mpn); } catch {}
      }
    }
  }

  // Print
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  MPN-LEVEL DROPS  (entire MPN excluded — no VCdb match etc.)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`Total MPN drops: ${mpnDrops.totalEntries}`);
  console.log(`Brands with at least 1 MPN drop: ${Object.keys(mpnDrops.byBrand).length}`);
  console.log('\nBy reason:');
  for (const [reason, count] of Object.entries(mpnDrops.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${reason}`);
  }
  console.log('\nTop brands by MPN drops:');
  Object.entries(mpnDrops.byBrand).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([b, c]) => {
    console.log(`  ${String(c).padStart(5)}  ${b}`);
  });
  console.log('\nSample MPN drops:');
  for (const s of mpnDrops.samples.slice(0, 8)) {
    console.log(`  ${s.brand.padEnd(15)} ${s.mpn.padEnd(18)} partType="${s.partType || ''}"  reason="${s.reason}"`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  ROW-LEVEL DROPS  (individual VCdb rows dropped)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`Total row drops: ${rowDrops.totalEntries}`);
  console.log(`Brands with at least 1 row drop: ${Object.keys(rowDrops.byBrand).length}`);
  console.log('\nBy reason:');
  for (const [reason, count] of Object.entries(rowDrops.byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${reason}`);
  }
  console.log('\nTop brands by row drops:');
  Object.entries(rowDrops.byBrand).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([b, c]) => {
    console.log(`  ${String(c).padStart(6)}  ${b}`);
  });
  console.log('\nSamples by reason:');
  for (const [reason, samples] of Object.entries(rowDrops.samples.byReason)) {
    console.log(`\n  [${reason}]`);
    for (const s of samples.slice(0, 3)) {
      const partial = s.partial ? `  partial=${JSON.stringify(s.partial)}` : '';
      console.log(`    ${s.brand} mpn=${s.mpn} vcdbRow=${s.vcdbRow}${partial}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log('  TOTALS');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`Shipped MPNs (have ≥1 row in filled.jsonl): ${shippedMpns.size}`);
  console.log(`MPN-level drops:                            ${mpnDrops.totalEntries}`);
  console.log(`Row-level drops:                            ${rowDrops.totalEntries}`);

  // Write JSON
  const report = { generatedAt: new Date().toISOString(), shippedMpnCount: shippedMpns.size, mpnDrops, rowDrops };
  fs.writeFileSync(path.join(DATADIR, '_drop-analysis.json'), JSON.stringify(report, null, 2));
  console.log('\nWrote walmart-q2-phase1/data/_drop-analysis.json');
})().catch(e => { console.error(e); process.exit(1); });
