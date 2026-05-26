#!/usr/bin/env node
/**
 * 30-assemble.js — brand-parameterized
 *   node 30-assemble.js --brand <brandKey>
 *
 * Drops rows without measure/unit; auto-versions output xlsx per brand.
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

const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';
const SHEET = 'Product Content And Site Exp';
const DATA_START = 6;
const FILLED = path.join(__dirname, '..', 'data', `02-${brandKey}-filled.json`);
const OUTDIR = path.join(__dirname, '..', 'output');

function nextVersion() {
  const rx = new RegExp(`^walmart-loadsheet-${brandKey}-vf-v(\\d+)\\.xlsx$`);
  const existing = fs.readdirSync(OUTDIR)
    .map(f => { const m = f.match(rx); return m ? parseInt(m[1]) : 0; });
  return (existing.length ? Math.max(...existing) : 0) + 1;
}

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

(async () => {
  const allFilled = JSON.parse(fs.readFileSync(FILLED, 'utf8'));
  // v9: drop if ANY required col is missing (measure/unit/fitment), not just measure
  const filled = allFilled.filter(r => !r.missingRequired);
  const dropped = allFilled.length - filled.length;
  const dropReasonCounts = {};
  for (const r of allFilled) if (r.missingRequired) for (const reason of r.dropReasons || []) dropReasonCounts[reason] = (dropReasonCounts[reason] || 0) + 1;

  const VERSION = nextVersion();
  const OUT = path.join(OUTDIR, `walmart-loadsheet-${brandKey}-vf-v${VERSION}.xlsx`);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new Error(`Template missing sheet "${SHEET}"`);

  for (let r = ws.rowCount; r >= DATA_START; r--) ws.spliceRows(r, 1);

  // v10.3: unhide every column we write data into so the user can SEE the values.
  // v12: explicitly RE-hide columns the user wants out of the visible view, even if filled.
  //      18 Add'l Image URL (+) · 19 Add'l Image URL 1 · 21 Total Count · 22 Multipack Quantity
  //      24 Auto Specialty Part Type · 25 Condition · 26 Has Written Warranty
  const HIDE_AFTER_FILL = new Set([18, 19, 21, 22, 24, 25, 26]);
  for (const colIdx of Object.values(COL)) {
    ws.getColumn(colIdx).hidden = HIDE_AFTER_FILL.has(colIdx);
  }

  filled.forEach((row, i) => {
    const targetRow = ws.getRow(DATA_START + i);
    for (const [colName, colIdx] of Object.entries(COL)) {
      const cellInfo = row.cells[colName];
      const v = cellInfo?.value ?? '';
      targetRow.getCell(colIdx).value = N.normalizeText(v);
    }
    targetRow.commit();
  });

  await wb.xlsx.writeFile(OUT);
  console.log(`Wrote → ${OUT}`);
  console.log(`  brand:        ${cfg.outputBrandString}`);
  console.log(`  rows shipped: ${filled.length}`);
  console.log(`  rows dropped: ${dropped}  (drop reasons: ${JSON.stringify(dropReasonCounts)})`);
})().catch(e => { console.error(e); process.exit(1); });
