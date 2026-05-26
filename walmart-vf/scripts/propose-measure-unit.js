#!/usr/bin/env node
/**
 * propose-measure-unit.js — brand-parameterized
 *   node propose-measure-unit.js --brand <brandKey>
 *
 * Output: output/measure-unit-proposals-${brandKey}.csv
 */
'use strict';
const fs = require('fs');
const path = require('path');

const BRANDS = require('./brands.config.js');
const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) { console.error(`Unknown --brand "${brandKey}"`); process.exit(1); }

const INV    = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `_attribute-inventory-${brandKey}.json`), 'utf8'));
const SCRAPE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `fullscrape-by-mpn-${brandKey}.json`), 'utf8'));
const OUT    = path.join(__dirname, '..', 'output', `measure-unit-proposals-${brandKey}.csv`);

const SCRAPE_DIM_RX = /(length|width|height|diameter|thickness|wattage|voltage|amperage|amp_|_amp|cca|capacity|gap|weight|stroke|reach|thread_size|cranking|nominal|rotor|cable_length|hose_length|amperage_output|liter|gallon|ohms?|psi|torque|load|gauge|size_in|size_mm)/i;

function scrapeDimKeysForMpn(mpn) {
  const entry = SCRAPE[mpn];
  if (!entry) return [];
  return Object.keys(entry.byKey).filter(k => SCRAPE_DIM_RX.test(k))
    .map(k => `${k}=${(entry.byKey[k][0]?.value || '').toString().slice(0,40)}`);
}

// v10: extended TYPE_HINTS encoding 8 user-established rules
//   1. bulbs           → wattage > voltage
//   2. fitting parts   → inside_diameter (bushing, connector, seal, gasket, vacuum tee)
//   3. volume products → capacity
//   4. dimensional default → length
//   5. unit preference: _in keys preferred over _mm (handled in pickProposal scoring)
//   6. multi-size kits → length acceptable default
//   7. trailing zeros preserved (handled in splitMeasureUnit)
//   8. no manual unit conversion (handled — never compute mm→in or vice versa)
const TYPE_HINTS = [
  // Rule 1: bulbs/lamps → wattage primary, voltage secondary
  [/^headlight bulb$|^multi-purpose light bulb$|bulb|lamp|led/i, ['wattage', 'voltage', 'lumens', 'diameter_mm']],
  // Specific dimensional parts
  [/^disc brake rotor$/i, ['rotor_outside_diameter_in', 'outside_diameter_in', 'rotor_diameter', 'diameter_in', 'thickness_in']],
  [/^vehicle battery$/i, ['cca', 'capacity_ah', 'voltage']],
  [/^starter motor$|^alternator$/i, ['amperage', 'voltage']],
  [/cabin air filter|engine air filter|^air cleaner mounting gasket/i, ['length_in', 'length', 'height_in', 'thickness_in']],
  [/^spark plug$/i, ['gap_in', 'thread_size', 'reach']],
  // Rule 3: volume products → capacity / volume
  [/reservoir|tank|cell|coolant tank/i, ['capacity', 'volume', 'capacity_ah', 'length_in']],
  // Rule 2: fitting-type parts → inside_diameter primary
  [/connector|tee|adapter|coupling|union|elbow|fitting/i, ['inside_diameter', 'inside_diameter_in', 'inside_diameter_mm', 'diameter_a', 'outside_diameter']],
  [/seal|gasket|o-ring|grommet/i, ['inside_diameter', 'inside_diameter_in', 'inside_diameter_mm', 'thickness_in', 'thickness']],
  [/bushing|knuckle bushing/i, ['inside_diameter', 'inside_diameter_in', 'inside_diameter_mm', 'outside_diameter', 'length_in']],
  [/hose/i, ['inside_diameter', 'inside_diameter_in', 'length_in', 'centerline_length_in', 'length']],
  [/wheel bearing|hub assembly|pinion bearing/i, ['outer_diameter_in', 'inside_diameter', 'inner_diameter_in', 'width_in']],
  [/^suspension strut$|^suspension strut assembly$|^shock/i, ['extended_length_in', 'compressed_length_in', 'length_in']],
  [/stabilizer bar bushing/i, ['inside_diameter', 'inside_diameter_mm', 'inner_diameter_in', 'outer_diameter_in']],
  [/^steering tie rod end$/i, ['length_in', 'length']],
  [/cable/i, ['overall_cable_length', 'length_in', 'length']],
  [/jet|metering jet/i, ['drill_size', 'inside_diameter', 'length']],   // jets: bore primary; title-extraction handles in fill
  [/diaphragm|pump diaphragm|accelerator pump/i, ['volume_cc', 'capacity', 'length']],
  [/^window regulator$|^universal joint$|^suspension stabilizer bar link$/i, ['length_in', 'length']],
  // Rule 4 fallback: dimensional default → length
  [/.*/, ['length_in', 'length', 'length_mm', 'overall_cable_length']],
];

function proposeKey(partType, keysSorted) {
  const has = name => keysSorted.find(k => k.key === name);
  for (const [rx, prefs] of TYPE_HINTS) {
    if (rx.test(partType)) {
      for (const p of prefs) {
        const found = has(p);
        if (found && found.mpnCount > 0) return { key: p, reason: `type-hint(${rx.source})` };
      }
    }
  }
  const FALLBACK_PRIORITY = [
    'length_in', 'length_mm', 'overall_cable_length', 'length',
    'diameter_in', 'diameter_mm', 'outer_diameter_in', 'inner_diameter_in', 'diameter',
    'height_in', 'height_mm', 'width_in', 'width_mm',
    'thickness_in', 'thickness_mm',
    'wattage', 'voltage', 'amperage', 'cca', 'capacity_ah',
    'weight_lb', 'weight',
  ];
  for (const k of FALLBACK_PRIORITY) {
    const found = keysSorted.find(x => x.key === k);
    if (found) return { key: k, reason: `generic-fallback(${k})` };
  }
  return { key: '', reason: 'REVIEW: no dim key found in source' };
}

const DIM_KEY_RX = /^(length|width|height|diameter|outer_diameter|inner_diameter|thickness|wattage|voltage|amperage|amp|cca|capacity_ah|gap|weight|stroke|extended_length|compressed_length|overall_cable_length|reach|gap_in|thread_size)(_in|_mm|_cm|_ft|_lb|_oz|_kg|_g)?$/i;

const csvEscape = s => {
  if (s == null) return '';
  s = String(s);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const rows = [['partType', 'mpn_count', 'mpns', 'source_dim_keys (key=value)', 'scrape_dim_keys (key=value)', 'source_other_keys (top12)', 'proposed_key', 'proposed_source', 'sample_value', 'reason', 'user_override_key', 'user_override_source', 'forced_unit', 'skip', 'notes']];

const partTypes = Object.keys(INV).sort();
for (const pt of partTypes) {
  const info = INV[pt];
  const dimKeys = info.keys.filter(k => DIM_KEY_RX.test(k.key));
  const otherKeys = info.keys.filter(k => !DIM_KEY_RX.test(k.key));
  const dimStr = dimKeys.map(k => `${k.key}=${k.samples[0]?.value || ''}`).join(' | ');
  const otherStr = otherKeys.slice(0, 12).map(k => k.key).join(' | ') + (otherKeys.length > 12 ? ` (+${otherKeys.length - 12} more)` : '');
  const prop = proposeKey(pt, info.keys);
  const sampleEntry = prop.key ? info.keys.find(k => k.key === prop.key)?.samples?.[0] : null;
  let sampleVal = sampleEntry ? sampleEntry.value : '';

  const scrapeDimSet = new Set();
  for (const mpn of info.mpns.slice(0, 3)) scrapeDimKeysForMpn(mpn).forEach(s => scrapeDimSet.add(s));
  const scrapeDimStr = [...scrapeDimSet].join(' | ') || '<none>';

  let proposedSource = '';
  if (prop.key && dimKeys.find(k => k.key === prop.key)) proposedSource = 'source.attributes';
  else if (prop.key && scrapeDimSet.size > 0) proposedSource = 'scrape (verify)';

  let finalKey = prop.key, finalSample = sampleVal, finalReason = prop.reason;
  if (!finalKey && scrapeDimSet.size > 0) {
    const first = [...scrapeDimSet][0];
    const eq = first.indexOf('=');
    finalKey = first.slice(0, eq);
    finalSample = first.slice(eq + 1);
    finalReason = 'fallback-from-scrape';
    proposedSource = 'scrape';
  }

  rows.push([
    pt, info.mpnCount, info.mpns.join('|'),
    dimStr || '<none>', scrapeDimStr, otherStr,
    finalKey, proposedSource, finalSample, finalReason,
    '', '', '', '', '',
  ]);
}

fs.writeFileSync(OUT, rows.map(r => r.map(csvEscape).join(',')).join('\n'));
const data = rows.slice(1);
const fromSource = data.filter(r => r[7] === 'source.attributes').length;
const fromScrape = data.filter(r => String(r[7]).startsWith('scrape')).length;
const noKey      = data.filter(r => !r[6]).length;
console.log(`Wrote → ${OUT}`);
console.log(`Brand: ${cfg.outputBrandString}`);
console.log(`Part types: ${partTypes.length}`);
console.log(`  source.attributes:   ${fromSource}`);
console.log(`  scrape (verify):     ${fromScrape}`);
console.log(`  NO key in either:    ${noKey}`);
