#!/usr/bin/env node
/**
 * 95-mixed-format-dupes-audit.js — T5 / R2.1 visibility metric.
 *
 * For each brand, count (Year, Make, Model) tuples whose VCdb rows span
 * multiple formats. Per R2.1 we ship duplicates (no collapse). This audit is
 * for visibility only — Walmart may push back on dupes in submission; if so,
 * a future iteration adds dedup. The metric goes into the per-brand audit so
 * we know what we shipped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const BRANDS = require('./brands.config.js');
const DATADIR = 'walmart-q2-phase1/data';

(async () => {
  for (const brand of Object.keys(BRANDS)) {
    const filledPath = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(filledPath)) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(filledPath), crlfDelay: Infinity });

    // tuple key → { formats: Set, rows: count }
    const tupleMap = new Map();
    let rows = 0;
    for await (const line of rl) {
      if (!line) continue;
      const r = JSON.parse(line);
      rows++;
      const ymm = `${r.mpn}|${r.cells.Year?.value || ''}|${r.cells.Make?.value || ''}|${r.cells.Model?.value || ''}`;
      if (!tupleMap.has(ymm)) tupleMap.set(ymm, { formats: new Set(), count: 0 });
      const t = tupleMap.get(ymm);
      t.formats.add(r.format);
      t.count++;
    }

    let dupeTuples = 0, totalDupeRows = 0, multiFormatTuples = 0, multiFormatRows = 0;
    for (const t of tupleMap.values()) {
      if (t.count > 1) { dupeTuples++; totalDupeRows += t.count; }
      if (t.formats.size > 1) { multiFormatTuples++; multiFormatRows += t.count; }
    }

    const audit = {
      brand,
      rows,
      distinctTuples: tupleMap.size,
      duplicatedTuples: dupeTuples,
      totalDupeRows,
      multiFormatTuples,
      multiFormatRows,
      duplicationRate: rows ? +((totalDupeRows / rows) * 100).toFixed(2) : 0,
    };
    fs.writeFileSync(path.join(DATADIR, `_audit-mixed-format-${brand}.json`), JSON.stringify(audit, null, 2));
    console.log(`[${brand}] rows=${rows} distinctTuples=${tupleMap.size} duplicatedTuples=${dupeTuples} multiFormatTuples=${multiFormatTuples} duplicationRate=${audit.duplicationRate}%`);
  }
})().catch(e => { console.error(e); process.exit(1); });
