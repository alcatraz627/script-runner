#!/usr/bin/env node
/**
 * Parse "Jegs eBay Test 2.16.26_JEGS_EBAY_cc30.xlsx" — first sheet only.
 *
 * Structure: flat attribute table (one row per attribute per product).
 * Columns: Input Row, productbrand, mpn, site, key, raw_key, value,
 *          source, url, explanation, evidence_text, confidence, match_mode,
 *          page_type, status
 *
 * Output:
 *   1. analysis.json  — schema summary, color map, stats
 *   2. extracted-rows.json — grouped by MPN, each attribute as { key, raw_key, value, ... }
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const INPUT = path.join(
  process.env.HOME,
  'Downloads',
  'Jegs eBay Test 2.16.26_JEGS_EBAY_cc30.xlsx'
);
const OUT_DIR = path.join(__dirname, 'parse-excel', 'output', 'Jegs Ebay cc30');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT);

  const ws = wb.getWorksheet(1); // First sheet: "Extracted Rows"
  const sheetName = ws.name;
  const rowCount = ws.rowCount;
  const colCount = ws.columnCount;

  console.log(`Sheet: "${sheetName}" — ${rowCount} rows × ${colCount} cols`);

  // ── Read header ──
  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNum) => {
    headers[colNum - 1] = cell.value;
  });
  console.log('Headers:', headers.join(', '));

  // ── Scan for row colors ──
  // Map: argb hex → Set<row numbers>
  const colorMap = {};       // color → count
  const rowColors = {};      // rowNum → color (first non-header fill found)

  // Sample every row (exceljs is memory-efficient enough)
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return; // skip header
    // Check first data cell (col A) for fill
    const cell = row.getCell(1);
    const fill = cell.style && cell.style.fill;
    if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor) {
      const argb = fill.fgColor.argb || fill.fgColor.theme || 'unknown';
      // Skip white / no-fill colors
      if (argb && argb !== 'FFFFFFFF' && argb !== '00000000') {
        rowColors[rowNum] = argb;
        colorMap[argb] = (colorMap[argb] || 0) + 1;
      }
    }
  });

  console.log('\nRow colors found (ARGB → count):');
  for (const [c, n] of Object.entries(colorMap).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n} rows`);
  }

  // ── Group rows by MPN ──
  const products = {};  // mpn → { inputRow, brand, attributes: [...], rowColor? }
  let totalAttrs = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const vals = [];
    row.eachCell({ includeEmpty: true }, (cell, colNum) => {
      vals[colNum - 1] = cell.value;
    });

    const inputRow = vals[0];
    const brand = vals[1];
    const mpn = vals[2];
    const site = vals[3];
    const key = vals[4];
    const rawKey = vals[5];
    const value = vals[6];
    const source = vals[7];
    const url = vals[8];
    const explanation = vals[9];
    const evidenceText = vals[10];
    const confidence = vals[11];
    const matchMode = vals[12];
    const pageType = vals[13];
    const status = vals[14];

    if (!mpn) return;

    if (!products[mpn]) {
      products[mpn] = {
        inputRow,
        brand,
        mpn,
        site,
        url,
        attributes: [],
      };
    }

    // Track row color on the product if any row for it has color
    if (rowColors[rowNum]) {
      if (!products[mpn].rowColors) products[mpn].rowColors = {};
      products[mpn].rowColors[rowColors[rowNum]] =
        (products[mpn].rowColors[rowColors[rowNum]] || 0) + 1;
    }

    products[mpn].attributes.push({
      key,
      raw_key: rawKey,
      value,
      source,
      explanation,
      evidence_text: evidenceText,
      confidence,
      match_mode: matchMode,
      page_type: pageType,
      status,
    });

    totalAttrs++;
  });

  const productList = Object.values(products);
  console.log(`\nProducts: ${productList.length}`);
  console.log(`Total attributes: ${totalAttrs}`);
  console.log(`Avg attributes/product: ${(totalAttrs / productList.length).toFixed(1)}`);

  // ── Stats by key ──
  const keyCounts = {};
  for (const p of productList) {
    for (const a of p.attributes) {
      keyCounts[a.key] = (keyCounts[a.key] || 0) + 1;
    }
  }

  // Top 20 most common keys
  const topKeys = Object.entries(keyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log('\nTop 20 attribute keys:');
  for (const [k, n] of topKeys) {
    console.log(`  ${k}: ${n}`);
  }

  // ── Confidence distribution ──
  const confDist = {};
  for (const p of productList) {
    for (const a of p.attributes) {
      confDist[a.confidence] = (confDist[a.confidence] || 0) + 1;
    }
  }
  console.log('\nConfidence distribution:');
  for (const [c, n] of Object.entries(confDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }

  // ── Status distribution ──
  const statusDist = {};
  for (const p of productList) {
    for (const a of p.attributes) {
      statusDist[a.status] = (statusDist[a.status] || 0) + 1;
    }
  }
  console.log('\nStatus distribution:');
  for (const [s, n] of Object.entries(statusDist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }

  // ── Products with row colors ──
  const coloredProducts = productList.filter(p => p.rowColors);
  console.log(`\nProducts with colored rows: ${coloredProducts.length}`);
  if (coloredProducts.length > 0) {
    console.log('Sample colored products:');
    for (const p of coloredProducts.slice(0, 5)) {
      console.log(`  ${p.mpn}: ${JSON.stringify(p.rowColors)}`);
    }
  }

  // ── Write analysis ──
  const analysis = {
    file: path.basename(INPUT),
    sheet: sheetName,
    dimensions: { rows: rowCount, cols: colCount },
    headers,
    products: productList.length,
    totalAttributes: totalAttrs,
    avgAttributesPerProduct: +(totalAttrs / productList.length).toFixed(1),
    topKeys: Object.fromEntries(topKeys),
    confidenceDistribution: confDist,
    statusDistribution: statusDist,
    rowColorMap: colorMap,
    coloredProductCount: coloredProducts.length,
  };

  fs.writeFileSync(
    path.join(OUT_DIR, 'analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  // ── Write grouped product JSON ──
  fs.writeFileSync(
    path.join(OUT_DIR, 'extracted-rows.json'),
    JSON.stringify(productList, null, 2)
  );

  console.log(`\n✓ Written to ${OUT_DIR}/`);
  console.log('  analysis.json');
  console.log('  extracted-rows.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
