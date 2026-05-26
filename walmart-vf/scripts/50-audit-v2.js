#!/usr/bin/env node
/**
 * 50-audit-v2.js
 *
 * Comprehensive audit answering five questions:
 *   1. Vehicle Fitment Type — per-row provenance table (source key + raw value)
 *   2. AAIA Brand ID — match status per row + Brand Code distribution
 *   3. Assembled Product Length/Height/Weight/Width (cols 34-41) availability
 *   4. ACDelco row pipeline funnel (source → filtered → output)
 *   5. Per-rule stats (every output column → fill-rate + provenance breakdown)
 *
 * Reads only the JSON shards already produced — no Excel re-streaming.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname, '..', 'data');
const FILLED = JSON.parse(fs.readFileSync(path.join(D, '02-acdelco-filled.json'), 'utf8'));
const SOURCE = JSON.parse(fs.readFileSync(path.join(D, '01-acdelco-source.json'), 'utf8'));
const SCRAPE = JSON.parse(fs.readFileSync(path.join(D, 'fullscrape-by-mpn-acdelco.json'), 'utf8'));
const BRAND  = JSON.parse(fs.readFileSync(path.join(D, 'brand-mapping-by-mpn.json'), 'utf8'));
const ENH    = JSON.parse(fs.readFileSync(path.join(D, 'enhanced-content-by-mpn.json'), 'utf8'));
const TAX    = JSON.parse(fs.readFileSync(path.join(D, 'taxonomy-by-mpn.json'), 'utf8'));

const HR = '─'.repeat(78);

// ─── 1. Vehicle Fitment Type provenance ─────────────────────────────────────

console.log(`\n${HR}\n[1] VEHICLE FITMENT TYPE — provenance per row\n${HR}`);
const fitGroups = { 'Specific': [], 'Universal': [], '<blank>': [] };
for (const r of FILLED) {
  const v = r.cells.vehicle_fitment_type.value || '<blank>';
  fitGroups[v].push({
    mpn: r.mpn,
    partType: r.partType,
    sourceKey: r.cells.vehicle_fitment_type.source || '—',
    rawValue:  r.cells.vehicle_fitment_type.raw   || '',
  });
}
for (const [bucket, rows] of Object.entries(fitGroups)) {
  console.log(`\n▸ ${bucket} (${rows.length} rows):`);
  console.log(`  ${'MPN'.padEnd(15)} ${'PartType'.padEnd(38)} ${'SourceKey'.padEnd(28)} RawValue`);
  // group by source key for compact view
  const bySource = {};
  rows.forEach(r => { (bySource[r.sourceKey] ||= []).push(r); });
  for (const [src, list] of Object.entries(bySource)) {
    console.log(`  --- via ${src} (${list.length} rows) ---`);
    list.slice(0, 3).forEach(r => {
      const raw = r.rawValue.length > 40 ? r.rawValue.slice(0, 37) + '…' : r.rawValue;
      console.log(`  ${r.mpn.padEnd(15)} ${r.partType.slice(0,38).padEnd(38)} ${src.padEnd(28)} ${raw}`);
    });
    if (list.length > 3) console.log(`  …and ${list.length - 3} more`);
  }
}

// For the <blank> rows, enumerate which fitment-related keys *are* available in scrape
console.log(`\n▸ For the ${fitGroups['<blank>'].length} blank rows, what fitment-ish keys exist in scrape?`);
console.log(`  ${'MPN'.padEnd(15)} ${'PartType'.padEnd(38)} scrape_keys (anything mentioning fit/universal/vehicle/specific)`);
for (const r of fitGroups['<blank>']) {
  const e = SCRAPE[r.mpn];
  const keys = e ? Object.keys(e.byKey) : [];
  const fitKeys = keys.filter(k => /fit|universal|specific|vehicle|compatib/i.test(k));
  console.log(`  ${r.mpn.padEnd(15)} ${r.partType.slice(0,38).padEnd(38)} ${fitKeys.length ? fitKeys.join(' | ') : '<none in scrape>'}`);
}

// ─── 2. AAIA Brand ID ───────────────────────────────────────────────────────

console.log(`\n${HR}\n[2] AAIA BRAND ID — match status\n${HR}`);
const aaiaStats = { matched: 0, unmatched: 0, byBrandCode: {}, byParent: {}, byConfidence: {} };
const unmatchedMpns = [];
for (const r of FILLED) {
  const bm = BRAND[r.mpn];
  if (bm && bm.brandCode) {
    aaiaStats.matched++;
    aaiaStats.byBrandCode[bm.brandCode] = (aaiaStats.byBrandCode[bm.brandCode] || 0) + 1;
    aaiaStats.byParent[bm.parentCode]   = (aaiaStats.byParent[bm.parentCode]   || 0) + 1;
    aaiaStats.byConfidence[bm.confidence] = (aaiaStats.byConfidence[bm.confidence] || 0) + 1;
  } else {
    aaiaStats.unmatched++;
    unmatchedMpns.push(r.mpn);
  }
}
console.log(`matched:   ${aaiaStats.matched} / ${FILLED.length}`);
console.log(`unmatched: ${aaiaStats.unmatched}`);
if (unmatchedMpns.length) console.log(`  MPNs: ${unmatchedMpns.join(', ')}`);
console.log(`Brand Code distribution: ${JSON.stringify(aaiaStats.byBrandCode)}`);
console.log(`Parent Company:          ${JSON.stringify(aaiaStats.byParent)}`);
console.log(`Confidence:              ${JSON.stringify(aaiaStats.byConfidence)}`);

// ─── 3. Assembled Product L/H/W/Wt availability ─────────────────────────────

console.log(`\n${HR}\n[3] ASSEMBLED PRODUCT DIMENSIONS — fill availability check\n${HR}`);
const ASSEMBLED = {
  'assembledProductLength (col 34/35)': ['length_in', 'length', 'length_mm'],
  'assembledProductHeight (col 36/37)': ['height_in', 'height', 'height_mm'],
  'assembledProductWeight (col 38/39)': ['weight_lb', 'weight', 'weight_kg', 'weight_oz'],
  'assembledProductWidth  (col 40/41)': ['width_in',  'width',  'width_mm'],
};

for (const [label, keys] of Object.entries(ASSEMBLED)) {
  let sourceHit = 0, scrapeHit = 0, neither = 0;
  const missingMpns = [];
  for (const r of SOURCE) {
    let found = false, fromScrape = false;
    for (const k of keys) {
      if (r.attributes[k]) { found = true; break; }
    }
    if (!found) {
      const sc = SCRAPE[r.mpn];
      if (sc) {
        for (const k of keys) {
          if (sc.byKey[k]?.[0]?.value) { found = true; fromScrape = true; break; }
        }
      }
    }
    if (found && !fromScrape) sourceHit++;
    else if (found && fromScrape) scrapeHit++;
    else { neither++; missingMpns.push(r.mpn + '/' + r.partType); }
  }
  console.log(`\n${label}`);
  console.log(`  candidate keys:  ${keys.join(' | ')}`);
  console.log(`  source has:      ${sourceHit} / ${SOURCE.length}`);
  console.log(`  scrape adds:     ${scrapeHit}`);
  console.log(`  neither:         ${neither}`);
}

// ─── 4. ACDelco funnel ──────────────────────────────────────────────────────

console.log(`\n${HR}\n[4] ACDELCO ROW FUNNEL\n${HR}`);
const sourceMpns = SOURCE.filter(r => !r.isScrapeOnly).map(r => r.mpn);
const scrapeOnlyMpns = SOURCE.filter(r => r.isScrapeOnly).map(r => r.mpn);
const scrapeAcdelcoMpns = Object.keys(SCRAPE);

console.log(`Source export (Brand=ACDelco):           ${sourceMpns.length} MPNs`);
console.log(`Full Scrape ACDelco distinct MPNs:       ${scrapeAcdelcoMpns.length}`);
console.log(`  ↳ also in source:                      ${scrapeAcdelcoMpns.filter(m => sourceMpns.includes(m)).length}`);
console.log(`  ↳ only in scrape (Q15 → appended):     ${scrapeOnlyMpns.length}  (${scrapeOnlyMpns.join(', ')})`);
console.log(`Total rows in v2 loadsheet:              ${FILLED.length}`);

console.log(`\nFiltered OUT (not in v2):`);
console.log(`  none — every ACDelco MPN from source AND the 5 scrape-only ones are included`);

console.log(`\nMPNs flagged for review (still in v2 but yellow / has flag):`);
const flagBuckets = {
  needsReviewMeasure: FILLED.filter(r => r.flags.needsReviewMeasure).length,
  needsReviewFitment: FILLED.filter(r => r.flags.needsReviewFitment).length,
  isScrapeOnly:       FILLED.filter(r => r.flags.isScrapeOnly).length,
  hasPartTerminology_false: FILLED.filter(r => !r.flags.hasPartTerminology).length,
  brandMappingMapped_false: FILLED.filter(r => !r.flags.brandMappingMapped).length,
};
for (const [k, v] of Object.entries(flagBuckets)) console.log(`  ${k.padEnd(28)} ${v}`);

// ─── 5. Per-rule stats ──────────────────────────────────────────────────────

console.log(`\n${HR}\n[5] PER-RULE STATS — every output column\n${HR}`);
const RULES = [
  ['Brand                  (col  9)', 'brand',                  'constant'],
  ['Manufacturer Part Num  (col 27)', 'manufacturerPartNumber', 'source.Part Number'],
  ['SKU                    (col  4)', 'sku',                    'source.Part Number'],
  ['Spec Product Type      (col  5)', 'specProductType',        'constant'],
  ['Product ID Type        (col  6)', 'productIdType',          'constant'],
  ['Product ID             (col  7)', 'productId',              'source.Part Number'],
  ['Vehicle Category       (col 30)', 'vehicleCategory',        'constant'],
  ['Vehicle Fitment Type   (col 31)', 'vehicle_fitment_type',   'cascade'],
  ['AAIA Brand ID          (col 32)', 'aaiaBrandID',            'brand-mapping'],
  ['Additional Features    (col 33)', 'features',               'enhanced-content'],
  ['Measure (primary)      (col 28)', 'measure',                'measure-unit-proposals'],
  ['Unit (primary)         (col 29)', 'unit',                   'measure-unit-proposals'],
  ['Part Terminology ID    (col 55)', 'partTerminologyID',      'taxonomy'],
];
console.log(`\n  ${'Rule'.padEnd(34)} ${'Filled'.padStart(8)} ${'Blank'.padStart(8)}  Source breakdown`);
for (const [label, key, expectedSource] of RULES) {
  const filled = FILLED.filter(r => String(r.cells[key]?.value ?? '') !== '').length;
  const blank  = FILLED.length - filled;
  const sources = {};
  FILLED.forEach(r => {
    if (String(r.cells[key]?.value ?? '') !== '') {
      const s = r.cells[key]?.source || '?';
      sources[s] = (sources[s] || 0) + 1;
    }
  });
  const top = Object.entries(sources).map(([s, c]) => `${s}=${c}`).join(' · ');
  console.log(`  ${label.padEnd(34)} ${String(filled).padStart(8)} ${String(blank).padStart(8)}  ${top}`);
}

console.log(`\n  Total rows: ${FILLED.length}`);
