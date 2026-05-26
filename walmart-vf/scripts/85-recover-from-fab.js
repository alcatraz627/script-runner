#!/usr/bin/env node
/**
 * 85-recover-from-fab.js — for rows dropped due to missing measure/unit, try to
 * extract a measurement from the Features and Benefits text using regex patterns
 * keyed by part-type expectations.
 *
 *   node 85-recover-from-fab.js --brand <brandKey>
 *
 * Output: data/_fab-recovery-${brandKey}.json — one entry per recovered row with
 *   { mpn, partType, original_measure, original_unit, recovered_measure, recovered_unit, source_quote }
 *
 * Strategy: per part-type "expected unit" (W for bulbs, in for hoses, lbs for batteries, etc.)
 * scan FAB text for "<number><unit>" matches; pick the most prominent.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) { console.error(`Unknown --brand "${brandKey}"`); process.exit(1); }

const FILLED = path.join(__dirname, '..', 'data', `02-${brandKey}-filled.json`);
const OUT    = path.join(__dirname, '..', 'data', `_fab-recovery-${brandKey}.json`);

// Per-part-type expected primary measure unit (used to filter regex hits)
const PART_TYPE_PREFER_UNIT = [
  [/bulb|lamp/i,                 ['W', 'V']],
  [/spark plug/i,                ['mm', 'in']],          // gap or thread
  [/battery/i,                   ['CCA', 'Ah', 'V']],
  [/alternator|starter/i,        ['A', 'V']],
  [/filter|gasket|seal|hose|bushing|clip|bracket|pad set|hardware kit|connector|bearing|joint/i, ['in', 'mm']],
  [/rotor/i,                     ['in']],
  [/cable/i,                     ['in', 'ft']],
  [/strut|tensioner/i,           ['in']],
  [/regulator|switch|solenoid|valve|sensor/i, ['in', 'V']],
  [/belt/i,                      ['in', 'mm']],
];

function pickExpectedUnits(partType) {
  for (const [rx, units] of PART_TYPE_PREFER_UNIT) if (rx.test(partType)) return units;
  return ['in', 'mm', 'lbs', 'W', 'V', 'A'];   // fallback set
}

// Regex to find "number unit" in FAB text. Permissive but capped to reasonable shapes.
const NUM_UNIT_RX = /\b(\d{1,4}(?:\.\d{1,3})?)\s*(in\.?|inches?|mm|cm|ft|lbs?|oz|kg|W|V(?:DC)?|A(?:mps?)?|CCA|Ah)\b/gi;

function normalizeUnit(rawUnit) {
  const u = rawUnit.toLowerCase().replace(/\.$/, '');
  if (u === 'inch' || u === 'inches') return 'in';
  if (u === 'lb') return 'lbs';
  if (u === 'amp' || u === 'amps') return 'A';
  if (u === 'vdc') return 'V';
  if (u === 'w') return 'W';
  if (u === 'v') return 'V';
  if (u === 'a') return 'A';
  if (u === 'cca') return 'CCA';
  if (u === 'ah') return 'Ah';
  return u;
}

function extractFromFab(fabText, expectedUnits) {
  if (!fabText) return null;
  const expectedSet = new Set(expectedUnits.map(u => u.toLowerCase()));
  const candidates = [];
  let m;
  NUM_UNIT_RX.lastIndex = 0;
  while ((m = NUM_UNIT_RX.exec(fabText)) !== null) {
    const num = m[1];
    const unit = normalizeUnit(m[2]);
    if (expectedSet.has(unit.toLowerCase())) {
      candidates.push({ measure: num, unit, source: m[0], position: m.index });
    }
  }
  if (!candidates.length) return null;
  // Prefer earliest occurrence (likely headline spec)
  candidates.sort((a, b) => a.position - b.position);
  return candidates[0];
}

const allFilled = JSON.parse(fs.readFileSync(FILLED, 'utf8'));
const recoveries = [];
for (const row of allFilled) {
  // Only attempt recovery on rows that would otherwise be dropped due to measure/unit
  const needsMeasure = !row.cells.measure?.value;
  const needsUnit = !row.cells.unit?.value;
  if (!needsMeasure && !needsUnit) continue;
  const fab = row.cells.features?.value || '';
  if (!fab) continue;
  const expected = pickExpectedUnits(row.partType);
  const hit = extractFromFab(fab, expected);
  if (!hit) continue;
  recoveries.push({
    mpn: row.mpn,
    partType: row.partType,
    original_measure: row.cells.measure?.value || '',
    original_unit:    row.cells.unit?.value || '',
    recovered_measure: hit.measure,
    recovered_unit:    hit.unit,
    source_quote:      hit.source,
    fab_excerpt:       fab.slice(Math.max(0, hit.position - 30), hit.position + 60),
  });
}

fs.writeFileSync(OUT, JSON.stringify(recoveries, null, 2));
console.log(`Brand: ${cfg.outputBrandString}`);
console.log(`Rows attempted (had FAB but missing measure or unit): scanned ${allFilled.filter(r => !r.cells.measure?.value || !r.cells.unit?.value).filter(r => r.cells.features?.value).length}`);
console.log(`Recovered: ${recoveries.length}`);
console.log(`\nSample recoveries (first 8):`);
for (const r of recoveries.slice(0, 8)) {
  console.log(`  ${r.mpn.padEnd(15)} ${r.partType.slice(0, 30).padEnd(30)} → ${r.recovered_measure} ${r.recovered_unit}   "${r.fab_excerpt.replace(/\n/g, ' ')}"`);
}
console.log(`\nWrote → ${OUT}`);
