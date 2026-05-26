#!/usr/bin/env node
/**
 * _aggregate-dropped-mpns.js — collect every 02-{brand}-dropped-mpn.jsonl
 * into a single iter3 manifest, with per-brand summaries.
 *
 * Per Q2 (2026-05-12): empty brands (75 of them — pure universal-fit
 * products) are included so the audit shows "we processed but had nothing
 * to ship".
 *
 * Output: data/_dropped-mpn-manifest-v3.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRANDS = require('./brands.config.js');
const DATADIR = 'walmart-q2-phase1/data';
const OUT = path.join(DATADIR, '_dropped-mpn-manifest-v3.json');

(async () => {
  const manifest = { generatedAt: new Date().toISOString(), totalDroppedMpns: 0, perBrand: {} };
  let allEntries = 0;

  for (const brand of Object.keys(BRANDS)) {
    const dPath = path.join(DATADIR, `02-${brand}-dropped-mpn.jsonl`);
    if (!fs.existsSync(dPath)) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(dPath), crlfDelay: Infinity });
    const entries = [];
    const reasonCounts = {};
    for await (const line of rl) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        entries.push(obj);
        reasonCounts[obj.reason] = (reasonCounts[obj.reason] || 0) + 1;
      } catch (e) { /* skip */ }
    }
    if (entries.length > 0) {
      manifest.perBrand[brand] = {
        count: entries.length,
        reasonCounts,
        // Keep MPN list for the audit; cap large brands at 100 to keep manifest readable
        mpns: entries.map(e => e.mpn).slice(0, 100),
        truncated: entries.length > 100,
      };
      allEntries += entries.length;
    }
  }
  manifest.totalDroppedMpns = allEntries;
  manifest.brandsWithDrops = Object.keys(manifest.perBrand).length;

  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2));
  console.log(`Wrote: ${OUT}`);
  console.log(`Total dropped MPNs across iter3: ${allEntries}`);
  console.log(`Brands with at least 1 drop: ${manifest.brandsWithDrops}`);
})().catch(e => { console.error(e); process.exit(1); });
