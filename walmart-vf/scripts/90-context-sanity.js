#!/usr/bin/env node
/**
 * 90-context-sanity.js — 100% per-row contextual sanity check across all brands.
 * For each shipped row, evaluate whether REQUIRED column values "make sense"
 * for the part type. Flag rows where they don't.
 *
 * Required cols: Brand, MPN, Measure, Unit, Vehicle Category, Vehicle Fitment Type
 * (Brand/MPN/Vehicle Category are constants — only Measure/Unit/Fitment can be wrong)
 *
 *   node 90-context-sanity.js [--brand <key>]  (default: all)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const filterBrand = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const targets = filterBrand ? [filterBrand] : Object.keys(BRANDS);

// Per-part-type expected unit families (non-exhaustive — flag means "looks wrong", not "is wrong")
const EXPECTED_UNITS = [
  // Electrical / electronic — voltage/wattage/current expected
  [/bulb|lamp/i,              { primary: ['W'], also: ['V'], partLabel: 'bulb' }],
  [/battery/i,                { primary: ['V', 'CCA', 'Ah'], also: [], partLabel: 'battery' }],
  [/alternator|starter/i,     { primary: ['A', 'V'], also: ['amp'], partLabel: 'alternator/starter' }],
  [/sensor|switch|solenoid|coil|amplifier/i,
                              { primary: ['V', 'in'], also: ['A', 'mm'], partLabel: 'electronic' }],

  // Dimensional parts — length/width/diameter/thickness expected
  [/hose|brake hose|coolant hose|heater hose|fuel.*hose|filler.*hose/i,
                              { primary: ['in', 'mm'], also: ['ft'], partLabel: 'hose' }],
  [/belt/i,                   { primary: ['in', 'mm'], also: ['ft'], partLabel: 'belt' }],
  [/bearing|hub assembly/i,   { primary: ['in', 'mm'], also: [], partLabel: 'bearing' }],
  [/rotor|brake rotor/i,      { primary: ['in', 'mm'], also: [], partLabel: 'rotor' }],
  [/pad set|brake pad/i,      { primary: ['in', 'mm'], also: [], partLabel: 'pad set' }],
  [/strut|tensioner|shock/i,  { primary: ['in', 'mm'], also: ['lbs'], partLabel: 'strut/shock' }],
  [/gasket|seal|o-ring/i,     { primary: ['in', 'mm'], also: [], partLabel: 'gasket/seal' }],
  [/bushing|bracket|clip/i,   { primary: ['in', 'mm'], also: ['lbs'], partLabel: 'bushing/bracket' }],
  [/cable/i,                  { primary: ['in', 'ft'], also: ['mm'], partLabel: 'cable' }],
  [/manifold/i,               { primary: ['in', 'mm'], also: ['lbs'], partLabel: 'manifold' }],
  [/pump|pump dia/i,          { primary: ['gpm', 'V', 'A'], also: ['in'], partLabel: 'pump' }],
  [/spark plug/i,             { primary: ['mm', 'in'], also: [], partLabel: 'spark plug' }],
  [/regulator|valve|filter/i, { primary: ['in', 'mm'], also: ['lbs'], partLabel: 'flow control' }],
  [/connector|seal|joint|hardware/i,
                              { primary: ['in', 'mm'], also: [], partLabel: 'mechanical' }],
];

function expected(partType) {
  for (const [rx, e] of EXPECTED_UNITS) if (rx.test(partType)) return e;
  return null;
}

// v10: detect title-vs-attribute discrepancies (15215 anomaly: source attr length=9.500, title says 21.50in)
// Returns array of findings if title's stated value diverges from the source attribute the pipeline used.
function detectTitleAttrDiscrepancy(row, source) {
  const findings = [];
  const title = (source?.title || '').toLowerCase();
  if (!title) return findings;
  const measureUsed = row.cells.measure?.value;
  if (!measureUsed) return findings;
  const measureNum = parseFloat(measureUsed);
  if (isNaN(measureNum)) return findings;
  const unit = row.cells.unit?.value;
  // Find all "<number><unit>" tokens in title
  const titleNumRx = /(\d+(?:\.\d+)?)\s*(in\.?|inches?|mm|cm|ft|lbs?|oz|w|v|cc|psi)\b/gi;
  let m;
  const titleHits = [];
  while ((m = titleNumRx.exec(title)) !== null) {
    titleHits.push({ value: parseFloat(m[1]), unit: m[2].toLowerCase().replace(/\.$/, '') });
  }
  // For matching unit, check if our chosen measure is far from any title-stated value of same unit
  const sameUnitHits = titleHits.filter(h => h.unit === String(unit).toLowerCase().replace(/\.$/, ''));
  if (sameUnitHits.length && !sameUnitHits.some(h => Math.abs(h.value - measureNum) / Math.max(h.value, measureNum, 0.001) < 0.05)) {
    findings.push({
      type: 'title_vs_attribute_discrepancy',
      measure_used: measureUsed,
      unit_used: unit,
      title_values: sameUnitHits.map(h => `${h.value}${h.unit}`),
      severity: 'warn',
    });
  }
  return findings;
}

function judge(row, source) {
  const findings = [];
  const m = row.cells.measure?.value;
  const u = row.cells.unit?.value;
  const v = row.cells.vehicle_fitment_type?.value;
  const pt = row.partType || '';

  // v10: title-vs-attribute discrepancy
  if (source) findings.push(...detectTitleAttrDiscrepancy(row, source));

  // Measure should be numeric
  if (m && !/^-?\d+(\.\d+)?$/.test(String(m))) {
    findings.push({ type: 'measure_non_numeric', measure: m });
  }
  // Unit should not be empty if measure exists
  if (m && !u) {
    findings.push({ type: 'measure_without_unit', measure: m });
  }
  // Unit-vs-part-type contextual sense
  const exp = expected(pt);
  if (m && u && exp) {
    const allOk = [...exp.primary, ...exp.also].map(x => x.toLowerCase());
    if (!allOk.includes(String(u).toLowerCase())) {
      findings.push({
        type: 'unit_unusual_for_part_type',
        measure: m, unit: u, partType: pt, expected: exp.primary, partLabel: exp.partLabel,
        severity: 'warn',
      });
    }
  }
  // Suspicious magnitudes
  if (m && /^in$/i.test(u || '') && parseFloat(m) > 100) {
    findings.push({ type: 'huge_inch_value', measure: m, unit: u, partType: pt });
  }
  if (m && /^mm$/i.test(u || '') && parseFloat(m) > 5000) {
    findings.push({ type: 'huge_mm_value', measure: m, unit: u, partType: pt });
  }
  // Fitment vocab check
  if (v && !['Universal', 'Specific'].includes(v)) {
    findings.push({ type: 'fitment_invalid_value', value: v });
  }
  return findings;
}

const flagged = [];
let totalRows = 0;

for (const brandKey of targets) {
  const cfg = BRANDS[brandKey];
  if (!cfg) continue;
  const filled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `02-${brandKey}-filled.json`), 'utf8'))
    .filter(r => !r.missingRequired);
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `01-${brandKey}-source.json`), 'utf8'));
  totalRows += filled.length;
  for (const row of filled) {
    const src = source.find(s => s.mpn === row.mpn);
    const findings = judge(row, src);
    if (findings.length) {
      flagged.push({
        brand: cfg.outputBrandString, mpn: row.mpn, partType: row.partType,
        measure: row.cells.measure?.value, unit: row.cells.unit?.value,
        fitment: row.cells.vehicle_fitment_type?.value,
        findings,
      });
    }
  }
}

const OUT = path.join(__dirname, '..', 'data', '_context-sanity.json');
fs.writeFileSync(OUT, JSON.stringify({ totalRows, flaggedCount: flagged.length, flagged }, null, 2));

console.log(`Total rows checked: ${totalRows}`);
console.log(`Rows flagged: ${flagged.length}\n`);
if (flagged.length) {
  console.log(`brand           mpn              partType                                measure / unit         finding`);
  console.log(`────────────────────────────────────────────────────────────────────────────────────────────────────────`);
  for (const f of flagged) {
    for (const fnd of f.findings) {
      const cell = `${f.measure || '-'} / ${f.unit || '-'}`;
      const reason = fnd.type === 'unit_unusual_for_part_type'
        ? `unit "${fnd.unit}" unexpected for ${fnd.partLabel} (expected ${fnd.expected.join('/')})`
        : `${fnd.type}${fnd.measure ? ' ('+fnd.measure+(fnd.unit?' '+fnd.unit:'')+')' : ''}`;
      console.log(`${f.brand.padEnd(15)} ${f.mpn.padEnd(16)} ${(f.partType||'').slice(0, 38).padEnd(38)} ${cell.padEnd(22)} ${reason}`);
    }
  }
}
console.log(`\nWrote → ${OUT}`);
