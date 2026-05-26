#!/usr/bin/env node
/**
 * 91-find-subjective.js — find rows where measure/unit selection is subjective
 * (i.e., 2+ legitimate primary-spec candidates exist in source/scrape/title).
 *
 *   node 91-find-subjective.js [--brand <key>] [--limit 5]
 *
 * Output: data/_subjective-${brand}.json
 *
 * Heuristic: a row is "subjective" if any of these is true:
 *   - source.attributes has 3+ dimensional keys (length/width/height/diameter/thickness/weight/voltage/wattage/etc.)
 *   - title text contains 2+ distinct numeric specs
 *   - current measure source is weight while another dim attr exists
 *
 * Returns top-N most-ambiguous rows per brand, sorted by candidate count desc.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const BRANDS = require('./brands.config.js');

const args = process.argv.slice(2);
const brandIdx = args.indexOf('--brand');
const brandArg = brandIdx !== -1 ? (args[brandIdx + 1] || '').toLowerCase() : '';
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? (parseInt(args[limitIdx + 1]) || 5) : 5;

const targets = brandArg ? [brandArg] : Object.keys(BRANDS);

const DIM_KEY_RX = /^(length|width|height|diameter|outer_diameter|inner_diameter|inside_diameter|outside_diameter|shaft_diameter|thickness|wattage|voltage|amperage|cca|capacity_ah|gap|weight|stroke|extended_length|compressed_length|overall_cable_length|reach|gap_in|thread_size|centerline_length|reach|rotor_outside_diameter|rotor_diameter)(_in|_mm|_cm|_ft|_lb|_oz|_kg|_g)?$/i;
const TITLE_NUMERIC_RX = /\b\d+(?:\.\d+)?\s*(in\.?|inches?|mm|cm|ft|lbs?|oz|kg|W|V(?:DC)?|A|cc|psi|Lumens?|gpm|CCA|Ah)\b/gi;

function findSubjective(brandKey) {
  const filled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `02-${brandKey}-filled.json`), 'utf8'));
  const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `01-${brandKey}-source.json`), 'utf8'));
  const scrape = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `fullscrape-by-mpn-${brandKey}.json`), 'utf8'));

  const subjective = [];
  for (const row of filled) {
    if (row.missingRequired) continue;   // only audit shipped rows
    const mpn = row.mpn;
    const src = source.find(r => r.mpn === mpn);
    if (!src) continue;

    // Real source dim keys
    const dimAttrs = Object.entries(src.attributes || {}).filter(([k]) => DIM_KEY_RX.test(k));
    // Title numeric specs (literal substrings)
    const titleHits = []; let m;
    TITLE_NUMERIC_RX.lastIndex = 0;
    while ((m = TITLE_NUMERIC_RX.exec(src.title || '')) !== null) titleHits.push(m[0]);

    const candidateCount = dimAttrs.length + titleHits.length;
    if (candidateCount < 1) continue;   // need at least 2 candidates to be "subjective"

    // Skip rows already recently decided by user (in overrides)
    subjective.push({
      mpn, partType: row.partType,
      title: src.title,
      currentMeasure: row.cells.measure?.value,
      currentUnit:    row.cells.unit?.value,
      currentSource:  row.cells.measure?.source,
      dimAttrs:       dimAttrs.map(([k, v]) => ({ key: k, value: String(v) })),
      titleHits:      [...new Set(titleHits)],
      candidateCount,
    });
  }
  // Sort by candidate count desc, then by title length asc (more compact = clearer to review)
  subjective.sort((a, b) => b.candidateCount - a.candidateCount || a.title.length - b.title.length);
  return subjective.slice(0, LIMIT);
}

const out = {};
for (const brandKey of targets) {
  if (!BRANDS[brandKey]) continue;
  const rows = findSubjective(brandKey);
  out[brandKey] = rows;
  console.log(`\n═══ ${BRANDS[brandKey].outputBrandString} (top ${rows.length}) ═══`);
  for (const r of rows) {
    console.log(`  ${r.mpn.padEnd(15)} ${r.partType.slice(0, 30).padEnd(30)} cands=${r.candidateCount}  current: ${r.currentMeasure}/${r.currentUnit}  src: ${r.currentSource}`);
    console.log(`     title: ${r.title.slice(0, 100)}`);
    console.log(`     dim-attrs: ${r.dimAttrs.slice(0, 6).map(d => d.key + '=' + d.value).join(' | ')}`);
    console.log(`     title-hits: ${r.titleHits.join(', ')}`);
  }
}

const OUT = path.join(__dirname, '..', 'data', '_subjective.json');
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\nWrote → ${OUT}`);
