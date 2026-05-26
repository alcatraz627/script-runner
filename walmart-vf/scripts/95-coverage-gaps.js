#!/usr/bin/env node
/**
 * 95-coverage-gaps.js — for every loadsheet column we DON'T currently fill,
 * check whether source/scrape/enhanced data exists that COULD fill it.
 *
 * Output: stdout table sorted by (importance × data availability)
 */
'use strict';
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const TPL = process.env.HOME + '/Downloads/Walmart Loadhseet Mar 30.xlsx';
const SHEET = 'Product Content And Site Exp';
const BRANDS = require('./brands.config.js');

// What we currently fill
const FILLED_COLS = new Set([4,5,6,7,9,11,17,19,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,44,45,46,47,48,49,50,51,53,55,63,64,65,67]);

// Per-source attribute key candidates we'd use to fill each column
const COL_FILL_CANDIDATES = {
  8:  { name: 'productName', sourceKeys: [], scrapeKeys: ['title'], note: 'enhanced.title — DELIBERATELY SKIPPED per Q4 (no titles)' },
  10: { name: 'price', sourceKeys: ['price'], scrapeKeys: ['price'], note: 'sale price — out of scope; pricing is broker decision' },
  12: { name: 'shortDescription', sourceKeys: ['description'], scrapeKeys: ['description'], note: 'product description for Walmart page; ~1000 chars; from Enhanced Content if present' },
  13: { name: 'keyFeatures (1)',  sourceKeys: [], scrapeKeys: [], note: 'derive from features bullet 1' },
  14: { name: 'keyFeatures (2)',  sourceKeys: [], scrapeKeys: [], note: 'derive from features bullet 2' },
  15: { name: 'keyFeatures (3)',  sourceKeys: [], scrapeKeys: [], note: 'derive from features bullet 3' },
  16: { name: 'keyFeatures (4)',  sourceKeys: [], scrapeKeys: [], note: 'derive from features bullet 4' },
  18: { name: 'productSecondaryImageURL', sourceKeys: [], scrapeKeys: ['image_url'], note: 'col 18 is "Additional Image URL (+)"; col 19 is "Additional Image URL 1"' },
  20: { name: 'countPerPack', sourceKeys: ['count_per_pack', 'pack_quantity'], scrapeKeys: ['count_per_pack', 'pack_quantity'], note: 'usually 1 unless multipack' },
  21: { name: 'count', sourceKeys: ['quantity', 'pack_quantity'], scrapeKeys: ['quantity'], note: 'total count in pack' },
  22: { name: 'multipackQuantity', sourceKeys: [], scrapeKeys: [], note: 'usually 1; prior pipeline hardcoded' },
  23: { name: 'isProp65WarningRequired', sourceKeys: [], scrapeKeys: ['prop_65_warning'], note: 'Yes/No — depends on chemistry' },
  24: { name: 'automotive_specialty_part_type', sourceKeys: ['part_type'], scrapeKeys: ['part_type'], note: '⭐ HIGH VALUE: source has Part Type for every row!' },
  42: { name: 'automotivePartsDivision', sourceKeys: ['automotive_part_division','sub_type'], scrapeKeys: ['sub_type'], note: 'Walmart hierarchy bucket; prior recommendation: skip until Part-Type→Division map built' },
  43: { name: 'prop65WarningText', sourceKeys: [], scrapeKeys: [], note: 'sparse; skipped previously' },
  52: { name: 'netContentStatement', sourceKeys: [], scrapeKeys: [], note: 'noise (mostly "Sold individually")' },
  54: { name: 'occasion', sourceKeys: [], scrapeKeys: [], note: 'irrelevant for auto parts' },
  56: { name: 'partTerminologyID2', sourceKeys: [], scrapeKeys: [], note: 'secondary part terminology — uncommon' },
  57: { name: 'restoredProductId', sourceKeys: [], scrapeKeys: [], note: 'only if condition=Refurbished' },
  58: { name: 'restoredProductIdType', sourceKeys: [], scrapeKeys: [], note: 'paired with col 57' },
  59: { name: 'size', sourceKeys: ['size'], scrapeKeys: ['size'], note: 'product size category (e.g., Small/Medium/Large)' },
  60: { name: 'sportsLeague', sourceKeys: [], scrapeKeys: [], note: 'irrelevant' },
  61: { name: 'sportsTeam', sourceKeys: [], scrapeKeys: [], note: 'irrelevant' },
  62: { name: 'thirdPartyAccreditationSymbolOnProductPackageCode', sourceKeys: [], scrapeKeys: [], note: 'rare cert codes' },
  66: { name: 'vehicleYear', sourceKeys: [], scrapeKeys: ['fitment'], note: 'derive from compatibleCars year ranges' },
  68: { name: 'warrantyURL', sourceKeys: [], scrapeKeys: [], note: 'rare' },
  69: { name: 'variantGroupId', sourceKeys: [], scrapeKeys: [], note: 'only for variant family parents' },
  70: { name: 'variantAttributeNames', sourceKeys: [], scrapeKeys: [], note: 'paired with variantGroupId' },
  71: { name: 'isPrimaryVariant', sourceKeys: [], scrapeKeys: [], note: 'paired' },
  72: { name: 'swatchImageUrl', sourceKeys: [], scrapeKeys: [], note: 'variant-specific image' },
  73: { name: 'swatchVariantAttribute', sourceKeys: [], scrapeKeys: [], note: 'paired' },
  74: { name: 'states', sourceKeys: [], scrapeKeys: [], note: 'state restrictions' },
  75: { name: 'stateRestrictionsText', sourceKeys: [], scrapeKeys: [], note: 'sparse' },
  76: { name: 'zipCodes', sourceKeys: [], scrapeKeys: [], note: 'rare' },
  77: { name: 'electronicsIndicator', sourceKeys: [], scrapeKeys: [], note: 'derive from part_type for electronic parts' },
  78: { name: 'chemicalAerosolPesticide', sourceKeys: [], scrapeKeys: [], note: 'Yes/No' },
  79: { name: 'batteryTechnologyType', sourceKeys: [], scrapeKeys: ['battery_technology','battery_type'], note: 'only batteries' },
  80: { name: 'fulfillmentLagTime', sourceKeys: ['anticipated_ship_out_time','lead_time'], scrapeKeys: ['anticipated_ship_out_time','lead_time'], note: 'days to ship; prior pipeline used this' },
  81: { name: 'shipsInOriginalPackaging', sourceKeys: [], scrapeKeys: [], note: 'usually Yes' },
  82: { name: 'MustShipAlone', sourceKeys: [], scrapeKeys: [], note: 'usually No' },
  83: { name: 'IsPreorder', sourceKeys: [], scrapeKeys: [], note: 'usually No' },
  84: { name: 'releaseDate', sourceKeys: [], scrapeKeys: [], note: 'rare' },
  85: { name: 'startDate', sourceKeys: [], scrapeKeys: [], note: 'rare' },
  86: { name: 'endDate', sourceKeys: [], scrapeKeys: [], note: 'rare' },
  87: { name: 'quantity (inventory)', sourceKeys: [], scrapeKeys: [], note: 'broker decision' },
  88: { name: 'fulfillmentCenterID', sourceKeys: [], scrapeKeys: [], note: 'broker config' },
  89: { name: 'inventoryAvailabilityDate', sourceKeys: [], scrapeKeys: [], note: 'rare' },
  90: { name: 'externalProductIdType', sourceKeys: ['upc'], scrapeKeys: ['upc'], note: '⭐ "UPC" if upc attr present' },
  91: { name: 'externalProductId', sourceKeys: ['upc'], scrapeKeys: ['upc'], note: '⭐ the UPC value itself' },
  92: { name: 'ProductIdUpdate', sourceKeys: [], scrapeKeys: [], note: 'system flag' },
  93: { name: 'SkuUpdate', sourceKeys: [], scrapeKeys: [], note: 'system flag' },
  94: { name: 'msrp', sourceKeys: [], scrapeKeys: [], note: 'pricing' },
};

// Count availability across all 4 brands' source attrs and scrape
function checkColumn(col, info) {
  let sourceHits = 0, scrapeHits = 0, total = 0;
  for (const brandKey of Object.keys(BRANDS)) {
    const filled = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `02-${brandKey}-filled.json`), 'utf8'))
      .filter(r => !r.missingRequired);
    const source = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `01-${brandKey}-source.json`), 'utf8'));
    const scrape = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', `fullscrape-by-mpn-${brandKey}.json`), 'utf8'));
    for (const row of filled) {
      total++;
      const src = source.find(s => s.mpn === row.mpn);
      if (src) {
        for (const k of (info.sourceKeys || [])) if (src.attributes[k]) { sourceHits++; break; }
      }
      const sc = scrape[row.mpn];
      if (sc) {
        for (const k of (info.scrapeKeys || [])) if (sc.byKey[k]?.[0]?.value) { scrapeHits++; break; }
      }
    }
  }
  return { total, sourceHits, scrapeHits, coverage: Math.max(sourceHits, scrapeHits) };
}

(async () => {
  // Read template labels + importance hints
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL);
  const ws = wb.getWorksheet(SHEET);
  const labels = {}, importance = {};
  for (let c = 1; c <= 94; c++) {
    labels[c]   = String(ws.getRow(4).getCell(c).value || '').trim();
    importance[c] = String(ws.getRow(2).getCell(c).value || '').trim();
  }
  const importanceTier = (s) => {
    if (/Required to sell/i.test(s)) return 'REQUIRED';
    if (/Required for the item to be visible/i.test(s)) return 'REQUIRED-VISIBLE';
    if (/Recommended/i.test(s)) return 'RECOMMENDED';
    if (/Optional/i.test(s)) return 'OPTIONAL';
    return '—';
  };

  const rows = [];
  for (const [colStr, info] of Object.entries(COL_FILL_CANDIDATES)) {
    const col = parseInt(colStr);
    if (FILLED_COLS.has(col)) continue;
    const stats = checkColumn(col, info);
    rows.push({
      col, label: labels[col] || info.name,
      tier: importanceTier(importance[col]),
      coverage: stats.coverage, total: stats.total,
      pct: stats.total ? Math.round(stats.coverage / stats.total * 100) : 0,
      note: info.note,
    });
  }

  // Sort: tier rank desc, then coverage % desc
  const tierRank = { 'REQUIRED': 4, 'REQUIRED-VISIBLE': 3, 'RECOMMENDED': 2, 'OPTIONAL': 1, '—': 0 };
  rows.sort((a, b) => (tierRank[b.tier] - tierRank[a.tier]) || (b.pct - a.pct));

  console.log(`${'Col'.padStart(3)}  ${'Tier'.padEnd(17)}  ${'Label'.padEnd(38)}  ${'Coverage'.padStart(12)}  Note`);
  console.log('─'.repeat(160));
  for (const r of rows) {
    console.log(`${String(r.col).padStart(3)}  ${r.tier.padEnd(17)}  ${r.label.padEnd(38)}  ${(r.coverage + '/' + r.total + ' (' + r.pct + '%)').padStart(12)}  ${r.note.slice(0, 80)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
