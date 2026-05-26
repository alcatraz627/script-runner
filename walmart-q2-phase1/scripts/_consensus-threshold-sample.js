#!/usr/bin/env node
/**
 * _consensus-threshold-sample.js — sample distributions of "majority percentage"
 * for each Vehicle-traversal attribute, so we can pick a defensible threshold
 * that's high but adds meaningful fill.
 *
 * For each (Year, Make, Model, SubModel) tuple in our materialized JSONL that
 * the SQLite resolves to ≥1 VehicleID with values:
 *   - count occurrences of each attribute value across matching vehicles
 *   - compute modal percentage = (count of mode) / (count of all values)
 *   - bucket by modal-pct band
 * Reported per attribute: how many tuples have a clean unanimous winner, a
 * 90%+ supermajority, a 75-90%, etc.
 *
 * Reads the parsed JSONL but only the metadata it needs; not memory-heavy.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { VcdbSqliteDecoder } = require('./lib/vcdb-sqlite-decoder.js');

const HOME = process.env.HOME;
const DB = `${HOME}/Downloads/vcdb.sqlite`;
const DATADIR = 'walmart-q2-phase1/data';

(async () => {
  console.log('Loading SQLite decoder...');
  const v = new VcdbSqliteDecoder(DB);

  const attrs = ['driveType', 'bedLength', 'bodyType', 'bodyNumDoors', 'fuelType', 'aspiration'];
  const buckets = { '100%': 0, '95-99%': 0, '90-94%': 0, '80-89%': 0, '67-79%': 0, '50-66%': 0, '<50%': 0 };
  const stats = Object.fromEntries(attrs.map(a => [a, { ...buckets, none: 0, samples: [] }]));

  // Walk our materialized JSONL — dedup (Y,M,M,SM) tuples to avoid double-counting
  const seenTuple = new Set();
  let tuplesProcessed = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DATADIR, '_raw-content-parsed.jsonl')), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const yId = r.vcdbCol['Year ID'], mkId = r.vcdbCol['Make ID'], mdId = r.vcdbCol['Model ID'], smId = r.vcdbCol['SubModel ID'];
    if (!(yId && mkId && mdId && smId)) continue;
    const key = `${yId}|${mkId}|${mdId}|${smId}`;
    if (seenTuple.has(key)) continue;
    seenTuple.add(key);
    tuplesProcessed++;

    const vehicleIds = v.vehicleIds(yId, mkId, mdId, smId);
    if (vehicleIds.length === 0) {
      for (const a of attrs) stats[a].none++;
      continue;
    }

    for (const attr of attrs) {
      // Tally each attribute's value distribution across matching vehicles
      const counts = new Map();
      let totalSeen = 0;
      for (const vId of vehicleIds) {
        const map = attr === 'driveType' ? v.driveTypeByVehicle :
                    attr === 'bedLength' ? v.bedLengthByVehicle :
                    attr === 'bodyType' ? v.bodyByVehicle :
                    attr === 'bodyNumDoors' ? v.bodyByVehicle :
                    attr === 'fuelType' ? v.engineCfgByVehicle :
                    attr === 'aspiration' ? v.engineCfgByVehicle : null;
        const entry = map.get(vId);
        if (!entry) continue;
        const vals = attr === 'driveType' || attr === 'bedLength' ? entry
                   : attr === 'bodyType' ? entry.types
                   : attr === 'bodyNumDoors' ? entry.doors
                   : attr === 'fuelType' ? entry.fuelTypes
                   : attr === 'aspiration' ? entry.aspirations : new Set();
        for (const val of vals) {
          counts.set(val, (counts.get(val) || 0) + 1);
          totalSeen++;
        }
      }
      if (totalSeen === 0) { stats[attr].none++; continue; }

      const sorted = [...counts.entries()].sort((a,b) => b[1] - a[1]);
      const modal = sorted[0][1];
      const pct = (modal / totalSeen) * 100;
      const bucket = pct === 100 ? '100%' :
                     pct >= 95   ? '95-99%' :
                     pct >= 90   ? '90-94%' :
                     pct >= 80   ? '80-89%' :
                     pct >= 67   ? '67-79%' :
                     pct >= 50   ? '50-66%' : '<50%';
      stats[attr][bucket]++;

      if (pct < 100 && stats[attr].samples.length < 4) {
        stats[attr].samples.push({ tuple: key, modal: sorted[0][0], modalPct: +pct.toFixed(0), alternatives: sorted.slice(1, 4).map(([k,c]) => `${k}(${c})`).join(',') });
      }
    }
  }

  console.log(`\nProcessed ${tuplesProcessed} distinct (Year,Make,Model,SubModel) tuples\n`);

  console.log('Bucket'.padEnd(10) + ' ' + attrs.map(a => a.padStart(14)).join('  '));
  console.log('-'.repeat(10 + attrs.length * 16));
  for (const b of ['100%','95-99%','90-94%','80-89%','67-79%','50-66%','<50%']) {
    const cells = attrs.map(a => String(stats[a][b]).padStart(14));
    console.log(b.padEnd(10) + ' ' + cells.join('  '));
  }
  console.log('none'.padEnd(10) + ' ' + attrs.map(a => String(stats[a].none).padStart(14)).join('  '));

  // Per-attribute cumulative coverage at each threshold
  console.log('\nCumulative tuple coverage at each threshold (i.e., how many tuples would get a value):');
  console.log('Threshold'.padEnd(10) + ' ' + attrs.map(a => a.padStart(14)).join('  '));
  console.log('-'.repeat(10 + attrs.length * 16));
  for (const th of [100, 95, 90, 80, 67, 50]) {
    const cells = attrs.map(a => {
      let n = 0;
      for (const b of ['100%','95-99%','90-94%','80-89%','67-79%','50-66%','<50%']) {
        const bPct = b === '100%' ? 100 : b === '95-99%' ? 95 : b === '90-94%' ? 90 : b === '80-89%' ? 80 : b === '67-79%' ? 67 : b === '50-66%' ? 50 : 0;
        if (bPct >= th) n += stats[a][b];
      }
      return String(n).padStart(14);
    });
    console.log((`≥${th}%`).padEnd(10) + ' ' + cells.join('  '));
  }

  // Show non-unanimous samples
  console.log('\nSample non-100% tuples per attribute (modal value + close alternatives):');
  for (const a of attrs) {
    console.log(`  [${a}]`);
    stats[a].samples.forEach(s => console.log(`    tuple=${s.tuple}  modal="${s.modal}" (${s.modalPct}%)  others: ${s.alternatives}`));
  }

  fs.writeFileSync(path.join(DATADIR, '_consensus-threshold-sample.json'), JSON.stringify({ tuplesProcessed, stats }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
