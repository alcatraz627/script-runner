#!/usr/bin/env node
// cc30-no-image-audit.js
// Groups cc30 Excel by mpn, checks for image_url key presence,
// produces no-image list + comparison against no-image-items.json

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const XLSX_PATH = path.join(process.env.HOME, 'Downloads', 'Jegs eBay Test 2.16.26_JEGS_EBAY_cc30 (1).xlsx');
const PREV_JSON = path.join(__dirname, 'no-image-items.json');

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.getWorksheet('Extracted Rows');

  // Build header index from row 1
  const headers = {};
  ws.getRow(1).eachCell((cell, col) => { headers[cell.value] = col; });
  const col = (name) => headers[name];

  // Group rows by mpn: track brand, part_type, jegs_url, image_url
  const products = new Map(); // mpn -> { brand, part_type, jegs_url, image_url }

  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    const mpn   = row.getCell(col('mpn')).value;
    const brand = row.getCell(col('productbrand')).value;
    const key   = (row.getCell(col('key')).value || '').toString().toLowerCase().trim();
    const value = (row.getCell(col('value')).value || '').toString().trim();
    const url   = (row.getCell(col('url')).value || '').toString().trim();

    if (!mpn) return;

    if (!products.has(mpn)) {
      products.set(mpn, { brand: brand || '', part_type: '', jegs_url: url, image_url: '' });
    }

    const p = products.get(mpn);

    // Capture jegs url (first non-empty)
    if (!p.jegs_url && url) p.jegs_url = url;

    // Capture part type from key
    if ((key === 'part_type' || key === 'part type') && !p.part_type) p.part_type = value;
    if (key === 'line' && !p.part_type) p.part_type = value; // fallback

    // Capture image url
    if (key === 'image_url' && !p.image_url) p.image_url = value;
  });

  console.log(`Total unique MPNs in cc30 file: ${products.size}`);

  const withImage    = [...products.entries()].filter(([, p]) => p.image_url);
  const withoutImage = [...products.entries()].filter(([, p]) => !p.image_url);

  console.log(`  With image_url:    ${withImage.length}`);
  console.log(`  Without image_url: ${withoutImage.length}`);

  // Build output list
  const noImageList = withoutImage.map(([mpn, p]) => ({
    'Part Number':   mpn,
    'Brand':         p.brand,
    'Part Type':     p.part_type,
    'JEGS URL':      p.jegs_url,
    'Image URL':     p.image_url,
  }));

  const jsonOut = path.join(__dirname, 'cc30-no-image-items.json');
  fs.writeFileSync(jsonOut, JSON.stringify(noImageList, null, 2));
  console.log(`\ncc30 no-image JSON written: ${jsonOut}`);

  // --- Comparison against previous list ---
  const prev = JSON.parse(fs.readFileSync(PREV_JSON, 'utf8'));
  const prevSet = new Set(prev.map(r => r['Part Number']));
  const cc30Set = new Set(noImageList.map(r => r['Part Number']));

  const onlyInPrev  = prev.filter(r => !cc30Set.has(r['Part Number']));
  const onlyInCC30  = noImageList.filter(r => !prevSet.has(r['Part Number']));
  const inBoth      = noImageList.filter(r => prevSet.has(r['Part Number']));

  console.log('\n--- Comparison vs no-image-items.json (jegs-ebay-final-mar25) ---');
  console.log(`  Previous list size:  ${prev.length}`);
  console.log(`  CC30 list size:      ${noImageList.length}`);
  console.log(`  In both (overlap):   ${inBoth.length}`);
  console.log(`  Only in previous:    ${onlyInPrev.length}`);
  console.log(`  Only in CC30:        ${onlyInCC30.length}`);

  if (onlyInPrev.length) {
    console.log('\nOnly in PREVIOUS (pipeline has no image, cc30 has image_url or not present):');
    onlyInPrev.forEach(r => console.log('  ', r['Part Number'], '|', r['Part Type']));
  }

  if (onlyInCC30.length) {
    console.log('\nOnly in CC30 (cc30 has no image_url, but pipeline run had one):');
    onlyInCC30.slice(0, 20).forEach(r => console.log('  ', r['Part Number'], '|', r['Part Type']));
    if (onlyInCC30.length > 20) console.log(`  ... and ${onlyInCC30.length - 20} more`);
  }

  if (inBoth.length) {
    console.log('\nIn BOTH lists (no image in both cc30 and pipeline):');
    inBoth.forEach(r => console.log('  ', r['Part Number'], '|', r['Part Type']));
  }

  // Write comparison JSON
  const comparisonOut = path.join(__dirname, 'cc30-image-comparison.json');
  fs.writeFileSync(comparisonOut, JSON.stringify({ inBoth, onlyInPrev, onlyInCC30 }, null, 2));
  console.log(`\nComparison JSON written: ${comparisonOut}`);

  // Write Excel with both sheets
  const out = new ExcelJS.Workbook();

  function addSheet(name, rows, cols) {
    const sheet = out.addWorksheet(name);
    sheet.columns = cols.map(k => ({ header: k, key: k, width: k.includes('URL') ? 55 : 28 }));
    sheet.getRow(1).eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
    });
    rows.forEach(r => sheet.addRow(r));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const COLS = ['Part Number', 'Brand', 'Part Type', 'JEGS URL', 'Image URL'];
  addSheet('CC30 No Image', noImageList, COLS);
  addSheet('In Both (No Image)', inBoth, COLS);
  addSheet('Only In Previous', onlyInPrev.map(r => ({
    'Part Number': r['Part Number'], 'Brand': r['Brand'], 'Part Type': r['Part Type'],
    'JEGS URL': '', 'Image URL': r['Image URL'] || ''
  })), COLS);
  addSheet('Only In CC30', onlyInCC30, COLS);

  const xlsxOut = path.join(__dirname, 'cc30-image-comparison.xlsx');
  await out.xlsx.writeFile(xlsxOut);
  console.log(`Comparison Excel written: ${xlsxOut}`);
}

main().catch(console.error);
