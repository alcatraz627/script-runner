#!/usr/bin/env node
// export-no-image-items.js
// Finds all items in jegs-ebay-final normalize.json with no image,
// joins eBay Item URL from raw.json, writes JSON + Excel output.

const path = require('path');
const ExcelJS = require('exceljs');

const RUN = 'jegs-ebay-final-mar25';
const DATA_DIR = path.join(__dirname, 'runs', RUN, 'data');

const normalize = require(path.join(DATA_DIR, 'normalize.json'));
const raw = require(path.join(DATA_DIR, 'raw.json'));

// Build SKU -> eBay Item URL map from raw (raw uses 'SKU', normalize uses 'Part Number')
const urlMap = new Map();
for (const row of raw) {
  if (row['SKU']) urlMap.set(row['SKU'], row['eBay Item URL'] || '');
}

// Filter items with no image
const noImage = normalize
  .filter(row => !row['Images'] || row['Images'].trim() === '')
  .map(row => ({
    'Part Number': row['Part Number'] || '',
    'Brand':       row['Brand'] || '',
    'Part Type':   row['Part Type'] || '',
    'eBay Item URL': urlMap.get(row['Part Number']) || '',
    'Image URL':   row['Images'] || '',
  }));

console.log(`Total items: ${normalize.length}`);
console.log(`Items with no image: ${noImage.length}`);

// Write JSON
const fs = require('fs');
const jsonOut = path.join(__dirname, 'no-image-items.json');
fs.writeFileSync(jsonOut, JSON.stringify(noImage, null, 2));
console.log(`JSON written: ${jsonOut}`);

// Write Excel
async function writeExcel() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('No Image Items');

  const COLS = ['Part Number', 'Brand', 'Part Type', 'eBay Item URL', 'Image URL'];
  ws.columns = COLS.map(k => ({ header: k, key: k, width: k.includes('URL') ? 60 : 24 }));

  // Header style
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  });

  for (const row of noImage) ws.addRow(row);

  // Freeze header
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  const xlsxOut = path.join(__dirname, 'no-image-items.xlsx');
  await wb.xlsx.writeFile(xlsxOut);
  console.log(`Excel written: ${xlsxOut}`);
}

writeExcel().catch(console.error);
