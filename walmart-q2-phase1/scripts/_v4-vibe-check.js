#!/usr/bin/env node
/**
 * _v4-vibe-check.js — exactly the 3 questions + extra plausibility checks.
 *
 *  1. Year column: range vs single — counts + anomalies
 *  2. True duplicates (same MPN + all 21 ship cols identical) — count + samples
 *  3. SQLite fill opportunities for currently-blank optional cols
 *  +  vibe checks: cross-field plausibility (engine/cyl/body sanity)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATADIR = 'walmart-q2-phase1/data';
const BRANDS = require('./brands.config.js');

const Q2_COLS = [
  'Action','MPN','BrandAAIAD','Year','Make','Model','PartTerminologyId','PartTerminologyName',
  'SubModel','BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType',
  'BedLength','BodyType','BodyNumDoors','Notes',
];

(async () => {
  // ═════════ Q1 — Year range vs single ═════════
  const yearStats = { single: 0, range: 0, malformed: 0, badRange: 0 };
  const sampleBadRange = [];
  const yearLengths = new Map(); // span (in years) → count
  let totalRows = 0;

  // ═════════ Q2 — True duplicate detection ═════════
  // Hash every row's 21-col tuple; count repeats
  const tupleHits = new Map();
  // Also: a separate hash with MPN+Y+M+M only (the duplication illusion we already know about)
  const ymmHits = new Map();

  // For Q3: track which optional cols are blank per row, broken down by brand/year/etc.
  const blankCounts = { BlockType: 0, Cylinders: 0, Liter: 0, CC: 0, Position: 0, FuelType: 0, Aspiration: 0, DriveType: 0, BedLength: 0, BodyType: 0, BodyNumDoors: 0 };
  const blankByMake = new Map();

  // Vibe checks
  const suspiciousCombos = [];
  const engineCheck = { v12underA20L: 0, cyl4overA60L: 0, electricPreA2010: 0, evMakeCheck: [] };

  const ASH12159Rows = [];

  for (const brand of Object.keys(BRANDS)) {
    const fp = path.join(DATADIR, `02-${brand}-filled.jsonl`);
    if (!fs.existsSync(fp) || fs.statSync(fp).size === 0) continue;
    const rl = readline.createInterface({ input: fs.createReadStream(fp), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        totalRows++;
        const cells = r.cells;
        const yearVal = cells.Year?.value || '';

        // Q1 year shape
        if (/^\d{4}$/.test(yearVal)) {
          yearStats.single++;
          yearLengths.set(1, (yearLengths.get(1) || 0) + 1);
        } else if (/^(\d{4})-(\d{4})$/.test(yearVal)) {
          const m = yearVal.match(/^(\d{4})-(\d{4})$/);
          const span = parseInt(m[2]) - parseInt(m[1]) + 1;
          if (span < 1) yearStats.badRange++;
          else {
            yearStats.range++;
            yearLengths.set(span, (yearLengths.get(span) || 0) + 1);
          }
        } else {
          yearStats.malformed++;
          if (sampleBadRange.length < 5) sampleBadRange.push({ brand, mpn: r.mpn, year: yearVal });
        }

        // Q2 full-row dedup hash
        const tupleKey = Q2_COLS.map(c => cells[c]?.value || '').join('||');
        tupleHits.set(tupleKey, (tupleHits.get(tupleKey) || 0) + 1);
        const ymmKey = [r.mpn, cells.Year?.value, cells.Make?.value, cells.Model?.value].join('|');
        ymmHits.set(ymmKey, (ymmHits.get(ymmKey) || 0) + 1);

        // Track specific ASH-12159 rows the user mentioned
        if (r.mpn === 'ASH-12159' && cells.Year?.value === '2015' && cells.Make?.value === 'Ford' && cells.Model?.value === 'F-350 Super Duty') {
          ASH12159Rows.push({ vcdbRow: r.vcdbRow, format: r.format, cells: Object.fromEntries(Object.entries(cells).map(([k,v]) => [k, v?.value])), sourceLabels: Object.fromEntries(Object.entries(cells).map(([k,v]) => [k, v?.source])) });
        }

        // Q3 blank counts (optional cols only)
        const optionalCols = ['BlockType','Cylinders','Liter','CC','Position','FuelType','Aspiration','DriveType','BedLength','BodyType','BodyNumDoors'];
        for (const c of optionalCols) {
          if (!cells[c] || !cells[c].value) blankCounts[c]++;
        }

        // Vibe: cross-field plausibility
        const cyl = parseInt(cells.Cylinders?.value || '0', 10);
        const liter = parseFloat(cells.Liter?.value || '0');
        const make = cells.Make?.value || '';
        const yearStart = parseInt(yearVal.slice(0,4), 10);
        const fuel = cells.FuelType?.value || '';
        if (cyl >= 10 && liter > 0 && liter < 2.0) {
          engineCheck.v12underA20L++;
          if (suspiciousCombos.length < 8) suspiciousCombos.push({ kind: 'big-cyl-tiny-engine', brand, mpn: r.mpn, year: yearVal, make, model: cells.Model?.value, cyl, liter });
        }
        if (cyl === 4 && liter > 6.0) {
          engineCheck.cyl4overA60L++;
          if (suspiciousCombos.length < 8) suspiciousCombos.push({ kind: '4-cyl-but-huge', brand, mpn: r.mpn, year: yearVal, make, model: cells.Model?.value, cyl, liter });
        }
        if (fuel === 'ELECTRIC' && yearStart < 2010) {
          engineCheck.electricPreA2010++;
          if (suspiciousCombos.length < 8) suspiciousCombos.push({ kind: 'electric-pre-2010', brand, mpn: r.mpn, year: yearVal, make, model: cells.Model?.value, fuel });
        }
        if ((make === 'Tesla') && yearStart && yearStart < 2008) {
          engineCheck.evMakeCheck.push({ year: yearVal, make, model: cells.Model?.value });
        }
      } catch (e) {}
    }
  }

  console.log('═════════ Q1 — Year shape distribution ═════════');
  console.log(`Total rows:              ${totalRows}`);
  console.log(`  Single-year:           ${yearStats.single}  (${(yearStats.single/totalRows*100).toFixed(1)}%)`);
  console.log(`  Year range:            ${yearStats.range}  (${(yearStats.range/totalRows*100).toFixed(1)}%)`);
  console.log(`  Malformed:             ${yearStats.malformed}`);
  console.log(`  Bad range (start>end): ${yearStats.badRange}`);
  console.log('\nRange-span distribution (1 = single year):');
  [...yearLengths.entries()].sort((a,b)=>a[0]-b[0]).forEach(([k,v]) => console.log(`  ${String(k).padStart(2)} year${k===1?' ':'s'}  ${v} rows  (${(v/totalRows*100).toFixed(1)}%)`));
  if (sampleBadRange.length) {
    console.log('\nMalformed year samples:');
    sampleBadRange.forEach(s => console.log(`  ${s.brand}/${s.mpn}  year="${s.year}"`));
  }

  console.log('\n═════════ Q2 — True duplicates (every ship col identical) ═════════');
  let exactDupes = 0, exactDupGroups = 0, maxDupCount = 0;
  for (const [k, c] of tupleHits) {
    if (c > 1) { exactDupes += c; exactDupGroups++; maxDupCount = Math.max(maxDupCount, c); }
  }
  console.log(`Total rows:                       ${totalRows}`);
  console.log(`Rows that have at least 1 exact dup: ${exactDupes}  (${(exactDupes/totalRows*100).toFixed(1)}%)`);
  console.log(`Distinct exact-duplicate groups:  ${exactDupGroups}`);
  console.log(`Max single tuple repeat count:    ${maxDupCount}`);

  // Top exact-dup groups
  const topDup = [...tupleHits.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 8);
  console.log('\nTop 8 most-duplicated tuples (by exact repeat count):');
  for (const [k, c] of topDup) {
    if (c < 2) break;
    const parts = k.split('||');
    console.log(`  ×${c}   MPN=${parts[1]} ${parts[3]} ${parts[4]} ${parts[5]} (${parts[6]}-${parts[7]}) SubModel=${parts[8]} ${parts[9]}${parts[10]}/${parts[11]}L  FuelType=${parts[14]} DriveType=${parts[16]}`);
  }

  // The specific ASH-12159 case
  console.log("\nASH-12159 / 2015 Ford F-350 Super Duty rows (user's example):");
  console.log(`Found: ${ASH12159Rows.length} rows total`);
  // Show first 3 with their vcdbRow IDs + EngineBase
  ASH12159Rows.slice(0, 5).forEach((r, i) => {
    console.log(`  [${i+1}] vcdbRow=${r.vcdbRow}  format=${r.format}`);
    console.log(`      cells: SubModel=${r.cells.SubModel}  Block=${r.cells.BlockType}  Cyl=${r.cells.Cylinders}  Liter=${r.cells.Liter}  CC=${r.cells.CC}  Position=${r.cells.Position}`);
    console.log(`      sources for SubModel: ${r.sourceLabels.SubModel}`);
    console.log(`      sources for Liter:    ${r.sourceLabels.Liter}`);
  });

  console.log('\n═════════ Q3 — Optional col blanks (rescue opportunities) ═════════');
  console.log('Col'.padEnd(16) + ' Blank rows    %    Notes');
  console.log('-'.repeat(60));
  for (const [col, blank] of Object.entries(blankCounts)) {
    const pct = (blank/totalRows*100).toFixed(1) + '%';
    console.log(col.padEnd(16) + ' ' + String(blank).padStart(8) + '   ' + pct.padStart(5));
  }

  console.log('\n═════════ Vibe checks — cross-field plausibility ═════════');
  console.log(`Suspicious combos found:`);
  console.log(`  ≥10 cyl with <2.0L:        ${engineCheck.v12underA20L}`);
  console.log(`  4-cyl with >6.0L:          ${engineCheck.cyl4overA60L}`);
  console.log(`  ELECTRIC fuel pre-2010:    ${engineCheck.electricPreA2010}`);
  console.log(`  Tesla pre-2008:            ${engineCheck.evMakeCheck.length}`);
  if (suspiciousCombos.length) {
    console.log('\nSamples:');
    suspiciousCombos.forEach(s => console.log(`  [${s.kind}] ${JSON.stringify(s)}`));
  }

  // Write detail JSON
  fs.writeFileSync(path.join(DATADIR, '_v4-vibe-check.json'), JSON.stringify({
    yearStats, yearLengths: [...yearLengths], totalRows,
    duplicates: { exactDupes, exactDupGroups, maxDupCount, top10: topDup.slice(0,10).map(([k,c])=>({ tuple: k, count: c })) },
    ASH12159: { count: ASH12159Rows.length, samples: ASH12159Rows.slice(0,10) },
    blanks: blankCounts,
    suspiciousCombos,
  }, null, 2));
  console.log('\nDetail: walmart-q2-phase1/data/_v4-vibe-check.json');
})().catch(e => { console.error(e); process.exit(1); });
