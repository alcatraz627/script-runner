#!/usr/bin/env node
/**
 * 40-verify.js — brand-parameterized
 *   node 40-verify.js --brand <brandKey>
 *
 * Re-opens latest brand xlsx; diffs every cell against 02-${brandKey}-filled.json
 * (drop-filtered to mirror assemble).
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const BRANDS = require('./brands.config.js');
const N = require('./lib/normalize.js');
const args = process.argv.slice(2);
const brandKey = (args[args.indexOf('--brand') + 1] || '').toLowerCase();
const cfg = BRANDS[brandKey];
if (!cfg) { console.error(`Unknown --brand "${brandKey}"`); process.exit(1); }

const SHEET = 'Product Content And Site Exp';
const DATA_START = 6;
const OUTDIR = path.join(__dirname, '..', 'output');

const COL = {
  sku: 4, specProductType: 5, productIdType: 6, productId: 7,
  productName: 8, brand: 9,
  ShippingWeight: 11, shortDescription: 12,
  keyFeatures_0: 13, keyFeatures_1: 14, keyFeatures_2: 15, keyFeatures_3: 16,
  mainImageUrl: 17,
  productSecondaryImageURL_18: 18, productSecondaryImageURL: 19,
  count: 21, multipackQuantity: 22,
  automotive_specialty_part_type: 24,
  condition: 25, has_written_warranty: 26,
  manufacturerPartNumber: 27, measure: 28, unit: 29,
  vehicleCategory: 30, vehicle_fitment_type: 31, aaiaBrandID: 32, features: 33,
  assembledLength_measure: 34, assembledLength_unit: 35,
  assembledHeight_measure: 36, assembledHeight_unit: 37,
  assembledWeight_measure: 38, assembledWeight_unit: 39,
  assembledWidth_measure: 40, assembledWidth_unit: 41,
  automotivePartsDivision: 42,
  color: 44, compatibleCars: 45, dimensions: 46, finish: 47, items_included: 48,
  manufacturer: 49, material: 50, modelNumber: 51, pieceCount: 53,
  partTerminologyID: 55, vehicleMake: 63, vehicleModel: 64,
  vehicle_mount_location: 65, vehicleYear: 66, warrantyText: 67,
};

const filledAll = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `02-${brandKey}-filled.json`), 'utf8'));
const filled = filledAll.filter(r => !r.missingRequired);

const rx = new RegExp(`^walmart-loadsheet-${brandKey}-vf-v(\\d+)\\.xlsx$`);
const candidates = fs.readdirSync(OUTDIR)
  .map(f => { const m = f.match(rx); return m ? { f, n: parseInt(m[1]) } : null; })
  .filter(Boolean).sort((a, b) => b.n - a.n);
if (!candidates.length) { console.error(`No xlsx for brand ${brandKey}`); process.exit(1); }
const FILE = path.join(OUTDIR, candidates[0].f);

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet(SHEET);
  let mismatches = 0;
  filled.forEach((row, i) => {
    const r = DATA_START + i;
    const sheetRow = ws.getRow(r);
    for (const [colName, colIdx] of Object.entries(COL)) {
      const expected = N.normalizeText(String(row.cells[colName]?.value ?? ''));
      const actualCell = sheetRow.getCell(colIdx).value;
      const actual = actualCell == null ? '' : (actualCell.text != null ? actualCell.text : String(actualCell));
      if (expected !== actual) {
        mismatches++;
        if (mismatches < 10) console.log(`MISMATCH r${r} col${colIdx} ${colName}: expected="${expected.slice(0,50)}" actual="${String(actual).slice(0,50)}"`);
      }
    }
  });
  console.log(`File: ${FILE}`);
  console.log(`brand:        ${cfg.outputBrandString}`);
  console.log(`rows checked: ${filled.length}`);
  console.log(`mismatches:   ${mismatches}`);
})().catch(e => { console.error(e); process.exit(1); });
