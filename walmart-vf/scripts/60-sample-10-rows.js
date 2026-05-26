#!/usr/bin/env node
/**
 * Sample 10 ACDelco MPNs (deliberate diversity), pull every cell value
 * from data/02-acdelco-filled.json + the canonical Data Definition + raw
 * source/scrape values, and print as a structured audit-ready dump.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, '..', 'data');

const FILLED = JSON.parse(fs.readFileSync(path.join(D, '02-acdelco-filled.json'), 'utf8'));
const SOURCE = JSON.parse(fs.readFileSync(path.join(D, '01-acdelco-source.json'), 'utf8'));
const SCRAPE = JSON.parse(fs.readFileSync(path.join(D, 'fullscrape-by-mpn-acdelco.json'), 'utf8'));
const DEFS   = JSON.parse(fs.readFileSync(path.join(D, '_template-data-definitions.json'), 'utf8'));

// Cell name → Data Definition lookup name
const DEF_LOOKUP = {
  sku: 'SKU',
  specProductType: 'Spec Product Type',
  productIdType: 'Product ID Type',
  productId: 'Product ID',
  brand: 'Brand Name',
  ShippingWeight: 'Shipping Weight',
  condition: 'Condition',
  has_written_warranty: 'Has Written Warranty',
  manufacturerPartNumber: 'Manufacturer Part Number',
  measure: 'Measure',
  unit: 'Unit',
  vehicleCategory: 'Vehicle Category',
  vehicle_fitment_type: 'Vehicle Fitment Type',
  aaiaBrandID: 'AAIA Brand ID',
  features: 'Additional Features',
  assembledLength_measure: 'Assembled Product Depth - Measure',
  assembledLength_unit:    'Assembled Product Depth - Unit',
  assembledHeight_measure: 'Assembled Product Height - Measure',
  assembledHeight_unit:    'Assembled Product Height - Unit',
  assembledWeight_measure: 'Assembled Product Weight - Measure',
  assembledWeight_unit:    'Assembled Product Weight - Unit',
  assembledWidth_measure:  'Assembled Product Width - Measure',
  assembledWidth_unit:     'Assembled Product Width - Unit',
  color: 'Color',
  compatibleCars: 'Compatible Vehicles',
  dimensions: 'Dimensions',
  finish: 'Finish',
  items_included: 'Items Included',
  manufacturer: 'Manufacturer Name',
  material: 'Material',
  modelNumber: 'Model Number',
  pieceCount: 'Number of Pieces',
  partTerminologyID: 'Part Terminology ID',
  vehicleMake: 'Vehicle Make',
  vehicleModel: 'Vehicle Model',
  vehicle_mount_location: 'Vehicle Mount Location',
  warrantyText: 'Warranty Text',
};

// Diverse 10-row sample
const SAMPLE_MPNS = [
  'L97',           // bulb, rich attrs, fitment via scrape.fitment, measure: wattage
  '18FR347',       // brake caliper, rich attrs, fitment via vehicle_fitment_type
  '903-615RS',     // strut, lots of fitment lines, vehicleMake/Model present
  'CF3254',        // cabin air filter, rich dims
  'A3621C',        // engine air filter, has dims
  '47G',           // battery, sparse — measure should be blank yellow
  '41-993',        // spark plug, has part_fitment="Direct Fit" (the unique 1)
  '512372',        // wheel bearing & hub, rich
  '18J602',        // brake hose, has dims
  '45G8101',       // SCRAPE-ONLY mpn
];

const HR = '═'.repeat(78);
const hr = '─'.repeat(78);

function printDef(cellName, defName) {
  const d = DEFS[defName];
  if (!d) return `       (no definition for "${defName}")`;
  let out = `       Definition: ${d.definition.slice(0, 220)}${d.definition.length > 220 ? '…' : ''}`;
  if (d.examples)  out += `\n       Examples:   ${d.examples.slice(0, 200)}`;
  if (d.maxChars)  out += `\n       Min/Max:    ${d.minChars || 0} / ${d.maxChars}`;
  return out;
}

for (const mpn of SAMPLE_MPNS) {
  const row = FILLED.find(r => r.mpn === mpn);
  const src = SOURCE.find(r => r.mpn === mpn);
  const sc  = SCRAPE[mpn];
  if (!row) { console.log(`MISSING in filled: ${mpn}`); continue; }
  console.log(`\n${HR}\n  ${mpn}  —  ${row.partType}  ${row.isScrapeOnly ? '(SCRAPE-ONLY)' : ''}\n${HR}`);
  console.log(`  Title (source): ${(src?.title || row.sourceTitle || '').slice(0, 110)}`);
  console.log(`  source.attributes keys: ${src ? Object.keys(src.attributes).slice(0, 12).join(', ') + (Object.keys(src.attributes).length > 12 ? `… (+${Object.keys(src.attributes).length - 12})` : '') : '<none>'}`);
  console.log(`  scrape keys (count): ${sc ? Object.keys(sc.byKey).length : 0}`);
  console.log(`  Flags: ${JSON.stringify(row.flags)}`);

  for (const [k, ci] of Object.entries(row.cells)) {
    const def = DEF_LOOKUP[k];
    const valDisp = ci.value === '' ? '<EMPTY>' : (typeof ci.value === 'string' ? ci.value.slice(0, 200) + (ci.value.length > 200 ? '…' : '') : String(ci.value));
    console.log(`\n  ${k}`);
    console.log(`    value:  ${valDisp}`);
    console.log(`    source: ${ci.source || '—'}`);
    if (ci.raw) console.log(`    raw:    ${String(ci.raw).slice(0, 100)}`);
    if (def) console.log(printDef(k, def));
  }
}
